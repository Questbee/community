"""
Headless API — external integration surface for IoT, scripts, and AI agents.

All endpoints authenticate with an API key (X-API-Key header) and are scoped
to the key's tenant.  The surface is intentionally limited to:

  GET  /headless/projects              → discover projects
  GET  /headless/forms                 → list published forms
  GET  /headless/forms/{id}/schema     → read a form's published schema
  POST /headless/submit                → submit a response

Form and project management (create, edit, publish, delete) is only available
through the web dashboard (JWT auth).  External systems can collect data but
cannot modify the collection instruments.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_api_key_auth
from app.db import get_db
from app.models.core import ApiKey, Form, FormVersion, Project, Submission

router = APIRouter()


@router.get("/projects")
async def list_projects(
    api_key: ApiKey = Depends(get_api_key_auth),
    db: AsyncSession = Depends(get_db),
):
    """List all projects visible to this API key's tenant."""
    result = await db.execute(
        select(Project).where(Project.tenant_id == api_key.tenant_id)
    )
    return [
        {"id": p.id, "name": p.name, "description": p.description}
        for p in result.scalars().all()
    ]


@router.get("/forms")
async def list_forms(
    project_id: str | None = Query(default=None),
    api_key: ApiKey = Depends(get_api_key_auth),
    db: AsyncSession = Depends(get_db),
):
    """List published forms for this tenant, optionally filtered by project."""
    q = (
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .join(FormVersion, Form.current_version_id == FormVersion.id)
        .where(
            Project.tenant_id == api_key.tenant_id,
            FormVersion.published_at.isnot(None),
        )
    )
    if project_id:
        q = q.where(Form.project_id == project_id)
    rows = (await db.execute(q)).all()
    return [
        {
            "id": form.id,
            "name": form.name,
            "project_id": form.project_id,
            "version_num": version.version_num,
        }
        for form, version in rows
    ]


@router.get("/forms/{form_id}/schema")
async def get_form_schema(
    form_id: str,
    api_key: ApiKey = Depends(get_api_key_auth),
    db: AsyncSession = Depends(get_db),
):
    """Return the published schema for a form.

    Only published forms are accessible.  Draft schemas are never exposed
    through the external API.
    """
    result = await db.execute(
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .join(FormVersion, Form.current_version_id == FormVersion.id)
        .where(
            Form.id == form_id,
            Project.tenant_id == api_key.tenant_id,
            FormVersion.published_at.isnot(None),
        )
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Form not found or not published")
    form, version = row
    return {
        "id": form.id,
        "name": form.name,
        "version_num": version.version_num,
        "schema": version.schema_json,
    }


class HeadlessSubmitRequest(BaseModel):
    form_id: str
    data_json: dict
    collected_at: str | None = None
    local_uuid: str | None = None


@router.post("/submit", status_code=201)
async def headless_submit(
    body: HeadlessSubmitRequest,
    api_key: ApiKey = Depends(get_api_key_auth),
    db: AsyncSession = Depends(get_db),
):
    """Submit a form response via API key authentication.

    Validates the payload against the form's current published schema.
    Idempotent: submitting the same `local_uuid` twice returns 200 without
    creating a duplicate.
    """
    # Idempotency
    if body.local_uuid:
        existing = await db.execute(
            select(Submission).where(Submission.local_uuid == body.local_uuid)
        )
        if existing.scalar_one_or_none():
            return {"status": "ignored", "local_uuid": body.local_uuid}

    # Resolve form — must belong to the API key's tenant
    result = await db.execute(
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .outerjoin(FormVersion, Form.current_version_id == FormVersion.id)
        .where(Form.id == body.form_id, Project.tenant_id == api_key.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Form not found")
    form, version = row

    if not version or not version.published_at:
        raise HTTPException(status_code=400, detail="Form has no published version")

    # Validate required fields
    errors = []
    for field in version.schema_json.get("fields", []):
        fid = field.get("id")
        if field.get("required") and (fid not in body.data_json or body.data_json[fid] in (None, "")):
            errors.append(f"Field '{fid}' is required")
    if errors:
        raise HTTPException(status_code=422, detail=errors)

    collected_at: datetime | None = None
    if body.collected_at:
        try:
            collected_at = datetime.fromisoformat(body.collected_at.replace("Z", "+00:00"))
        except ValueError:
            pass

    submission = Submission(
        form_version_id=version.id,
        local_uuid=body.local_uuid,
        data_json=body.data_json,
        collected_at=collected_at,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return {"status": "accepted", "id": submission.id}
