import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_role
from app.db import get_db
from app.models.core import Form, FormVersion, MediaFile, Project, Submission, User, Webhook
from app.routers.media import MEDIA_ROOT
from app.schemas.forms import FormCreate, FormOut, FormUpdate, FormVersionOut

router = APIRouter()

VALID_FIELD_TYPES = {
    # Phase 1 — basic inputs
    "text", "textarea", "number", "email", "phone",
    "date", "time", "datetime",
    "select_one", "select_multiple", "select_one_other",
    "note", "divider",
    # Phase 2 — structure
    "group", "repeat", "calculated", "hidden",
    # Phase 2 — media
    "photo", "audio", "signature", "file",
    # Phase 2 — location / scan
    "geopoint", "geotrace", "route", "barcode",
}


def _validate_fields(fields: list, seen_ids: set[str], prefix: str, errors: list) -> None:
    """Recursively validate a list of field definitions."""
    for i, field in enumerate(fields):
        path = f"{prefix}[{i}]"
        fid = field.get("id")
        ftype = field.get("type")
        if not fid:
            errors.append(f"{path}: missing 'id'")
        elif fid in seen_ids:
            errors.append(f"{path}: duplicate id '{fid}'")
        else:
            seen_ids.add(fid)
        if not ftype:
            errors.append(f"{path}: missing 'type'")
        elif ftype not in VALID_FIELD_TYPES:
            errors.append(f"{path}: unknown type '{ftype}'")
        if ftype in ("select_one", "select_multiple", "select_one_other"):
            opts = field.get("options", [])
            if not opts:
                errors.append(f"{path}: '{ftype}' must have at least one option")
        if ftype in ("group", "repeat"):
            nested = field.get("fields")
            if not isinstance(nested, list):
                errors.append(f"{path}: '{ftype}' must have a 'fields' array")
            else:
                _validate_fields(nested, seen_ids, f"{path}.fields", errors)


def validate_form_schema(schema: dict) -> None:
    if not isinstance(schema.get("fields"), list):
        raise HTTPException(status_code=422, detail="schema.fields must be a list")
    seen_ids: set[str] = set()
    errors: list[str] = []
    _validate_fields(schema["fields"], seen_ids, "fields", errors)
    if errors:
        raise HTTPException(status_code=422, detail=errors)


@router.get("/", response_model=list[dict])
async def list_forms(
    project_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .outerjoin(FormVersion, Form.current_version_id == FormVersion.id)
        .where(Project.tenant_id == current_user.tenant_id)
    )
    if project_id:
        q = q.where(Form.project_id == project_id)
    rows = (await db.execute(q)).all()
    result = []
    for form, version in rows:
        result.append({
            "id": form.id,
            "name": form.name,
            "project_id": form.project_id,
            "current_version_id": form.current_version_id,
            "is_published": version.published_at is not None if version else False,
            "has_draft": form.draft_version_id is not None,
            "version_num": version.version_num if version else None,
        })
    return result


@router.post("/", status_code=201)
async def create_form(
    body: FormCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify project belongs to tenant
    result = await db.execute(select(Project).where(Project.id == body.project_id, Project.tenant_id == current_user.tenant_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")
    schema = body.schema_json
    schema.setdefault("title", body.name)
    schema.setdefault("fields", [])
    form = Form(project_id=body.project_id, name=body.name)
    db.add(form)
    await db.flush()
    version = FormVersion(form_id=form.id, version_num=1, schema_json=schema)
    db.add(version)
    await db.flush()
    form.current_version_id = version.id
    await db.commit()
    await db.refresh(form)
    return {"id": form.id, "name": form.name, "project_id": form.project_id, "current_version_id": form.current_version_id, "is_published": False, "version_num": 1}


@router.get("/{form_id}")
async def get_form(
    form_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .outerjoin(FormVersion, Form.current_version_id == FormVersion.id)
        .where(Form.id == form_id, Project.tenant_id == current_user.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Form not found")
    form, published_version = row

    has_draft = form.draft_version_id is not None
    is_published = published_version is not None and published_version.published_at is not None

    # The builder always edits the draft when one exists; otherwise it edits
    # the current (unpublished) version directly.
    if has_draft:
        draft_res = await db.execute(
            select(FormVersion).where(FormVersion.id == form.draft_version_id)
        )
        active_version = draft_res.scalar_one_or_none()
    else:
        active_version = published_version

    return {
        "id": form.id,
        "name": form.name,
        "project_id": form.project_id,
        "current_version_id": form.current_version_id,
        "draft_version_id": form.draft_version_id,
        "is_published": is_published,
        "has_draft": has_draft,
        "version_num": active_version.version_num if active_version else None,
        "schema_json": active_version.schema_json if active_version else {"version": 1, "title": form.name, "fields": []},
    }


@router.put("/{form_id}")
async def update_form(
    form_id: str,
    body: FormUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    validate_form_schema(body.schema_json)
    result = await db.execute(
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .outerjoin(FormVersion, Form.current_version_id == FormVersion.id)
        .where(Form.id == form_id, Project.tenant_id == current_user.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Form not found")
    form, published_version = row

    if form.draft_version_id:
        # Active draft exists — update it in place.  current_version_id stays
        # pointing to the live published version throughout.
        draft_res = await db.execute(
            select(FormVersion).where(FormVersion.id == form.draft_version_id)
        )
        draft = draft_res.scalar_one_or_none()
        if draft:
            draft.schema_json = body.schema_json
    elif published_version and published_version.published_at:
        # Form is published with no active draft — create a new draft version.
        # current_version_id is NOT changed so the published version stays live.
        new_draft = FormVersion(
            form_id=form.id,
            version_num=published_version.version_num + 1,
            schema_json=body.schema_json,
        )
        db.add(new_draft)
        await db.flush()
        form.draft_version_id = new_draft.id
    else:
        # Initial unpublished form — edit the current version in place.
        if published_version:
            published_version.schema_json = body.schema_json

    await db.commit()
    return {"status": "updated"}


@router.post("/{form_id}/publish")
async def publish_form(
    form_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .outerjoin(FormVersion, Form.current_version_id == FormVersion.id)
        .where(Form.id == form_id, Project.tenant_id == current_user.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Form not found")
    form, _published_version = row

    if form.draft_version_id:
        # Publish the active draft and promote it to current.
        draft_res = await db.execute(
            select(FormVersion).where(FormVersion.id == form.draft_version_id)
        )
        draft = draft_res.scalar_one_or_none()
        if not draft:
            raise HTTPException(status_code=400, detail="Draft version not found")
        validate_form_schema(draft.schema_json)
        draft.published_at = datetime.now(timezone.utc)
        form.current_version_id = draft.id
        form.draft_version_id = None
        await db.commit()
        return {"status": "published", "version_id": draft.id, "version_num": draft.version_num}
    elif _published_version and not _published_version.published_at:
        # Initial publish of a brand-new form.
        validate_form_schema(_published_version.schema_json)
        _published_version.published_at = datetime.now(timezone.utc)
        await db.commit()
        return {"status": "published", "version_id": _published_version.id, "version_num": _published_version.version_num}
    else:
        raise HTTPException(status_code=400, detail="No draft to publish")


@router.get("/{form_id}/versions")
async def list_form_versions(
    form_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all versions for a form, including submission count per version."""
    # Verify access
    result = await db.execute(
        select(Form).join(Project, Form.project_id == Project.id)
        .where(Form.id == form_id, Project.tenant_id == current_user.tenant_id)
    )
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    # Fetch versions with submission counts in one query
    rows = await db.execute(
        select(FormVersion, func.count(Submission.id).label("submission_count"))
        .outerjoin(Submission, Submission.form_version_id == FormVersion.id)
        .where(FormVersion.form_id == form_id)
        .group_by(FormVersion.id)
        .order_by(FormVersion.version_num.desc())
    )
    return [
        {
            "id": v.id,
            "version_num": v.version_num,
            "published_at": v.published_at,
            "is_current": v.id == form.current_version_id,
            "is_draft": v.id == form.draft_version_id,
            "submission_count": count,
        }
        for v, count in rows.all()
    ]


@router.get("/{form_id}/versions/{version_id}")
async def get_form_version_schema(
    form_id: str,
    version_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the full schema JSON for a specific form version (tenant-scoped)."""
    result = await db.execute(
        select(FormVersion, Form)
        .join(Form, FormVersion.form_id == Form.id)
        .join(Project, Form.project_id == Project.id)
        .where(
            FormVersion.id == version_id,
            FormVersion.form_id == form_id,
            Project.tenant_id == current_user.tenant_id,
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    version, form = row
    return {
        "id": version.id,
        "version_num": version.version_num,
        "published_at": version.published_at,
        "form_name": form.name,
        "schema_json": version.schema_json,
    }


@router.delete("/{form_id}", status_code=204)
async def delete_form(
    form_id: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete a form and all its data (admin only).

    Cascades: media files on disk → media_file rows → submission rows →
    form_version rows → webhook rows → form row.
    """
    result = await db.execute(
        select(Form)
        .join(Project, Form.project_id == Project.id)
        .where(Form.id == form_id, Project.tenant_id == current_user.tenant_id)
    )
    form = result.scalar_one_or_none()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    # 1. Collect all submission IDs for this form
    version_ids_result = await db.execute(
        select(FormVersion.id).where(FormVersion.form_id == form_id)
    )
    version_ids = [row[0] for row in version_ids_result.all()]

    if version_ids:
        submission_ids_result = await db.execute(
            select(Submission.id).where(Submission.form_version_id.in_(version_ids))
        )
        submission_ids = [row[0] for row in submission_ids_result.all()]

        if submission_ids:
            # 2. Delete media files from disk
            media_result = await db.execute(
                select(MediaFile.storage_path).where(MediaFile.submission_id.in_(submission_ids))
            )
            for (storage_path,) in media_result.all():
                abs_path = os.path.join(MEDIA_ROOT, storage_path)
                try:
                    os.remove(abs_path)
                except OSError:
                    pass

            # 3. Delete media_file rows
            await db.execute(sa_delete(MediaFile).where(MediaFile.submission_id.in_(submission_ids)))

            # 4. Delete submission rows
            await db.execute(sa_delete(Submission).where(Submission.id.in_(submission_ids)))

        # 5. Delete form_version rows
        await db.execute(sa_delete(FormVersion).where(FormVersion.form_id == form_id))

    # 6. Delete webhook rows
    await db.execute(sa_delete(Webhook).where(Webhook.form_id == form_id))

    # 7. Delete the form itself
    await db.delete(form)
    await db.commit()
