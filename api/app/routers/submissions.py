from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, get_device_auth
from app.db import get_db
from sqlalchemy.orm import aliased
from app.models.core import DeviceToken, Form, FormVersion, MediaFile, Project, Submission, User
from app.schemas.submissions import BulkSubmissionRequest, SubmissionCreate, SubmissionOut
from app.routers.webhooks import fire_webhooks_for_submission

router = APIRouter()


def _validate_submission_data(schema: dict, data: dict) -> list[str]:
    """Return list of validation error strings, empty if valid."""
    errors = []
    for field in schema.get("fields", []):
        fid = field.get("id")
        if field.get("required") and (fid not in data or data[fid] is None or data[fid] == ""):
            errors.append(f"Field '{fid}' is required")
    return errors


async def _get_form_version(form_version_id: str, db: AsyncSession) -> FormVersion | None:
    result = await db.execute(select(FormVersion).where(FormVersion.id == form_version_id))
    return result.scalar_one_or_none()


async def _process_submission(
    sub: SubmissionCreate,
    db: AsyncSession,
    user_id: str | None = None,
    tenant_id: str | None = None,
) -> tuple[str, str, str | None]:
    """Returns (status, id_or_uuid, error_or_form_id)
    status: 'accepted' | 'ignored' | 'error'
    Third element is form_id on accepted, local_uuid on ignored, error message on error.
    """
    # Idempotency check
    if sub.local_uuid:
        existing = await db.execute(select(Submission).where(Submission.local_uuid == sub.local_uuid))
        existing_sub = existing.scalar_one_or_none()
        if existing_sub:
            # Return the server submission ID so the client can set server_submission_id
            # and proceed to upload media files for this already-accepted submission.
            return "ignored", existing_sub.id, None

    version = await _get_form_version(sub.form_version_id, db)
    if not version:
        return "error", sub.local_uuid or "", f"form_version_id '{sub.form_version_id}' not found"

    errors = _validate_submission_data(version.schema_json, sub.data_json)
    if errors:
        return "error", sub.local_uuid or "", "; ".join(errors)

    submission = Submission(
        form_version_id=sub.form_version_id,
        # Mobile submissions carry user_id in the payload; web submissions use
        # the authenticated user injected by the caller.
        user_id=sub.user_id or user_id,
        device_id=sub.device_id,
        local_uuid=sub.local_uuid,
        data_json=sub.data_json,
        collected_at=sub.collected_at,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(submission)
    await db.flush()
    return "accepted", submission.id, version.form_id


@router.post("/", status_code=201)
async def submit(
    body: SubmissionCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_current_user),
):
    status, id_or_uuid, extra = await _process_submission(body, db, user_id=current_user.id if current_user else None)
    await db.commit()
    if status == "error":
        raise HTTPException(status_code=422, detail=extra)
    if status == "accepted":
        await fire_webhooks_for_submission(
            extra,  # form_id
            {"submission_id": id_or_uuid, "form_id": extra, "data": body.data_json},
            background_tasks,
            db,
        )
    return {"id": id_or_uuid, "status": status}


@router.post("/bulk")
async def submit_bulk(
    body: BulkSubmissionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    if len(body.submissions) > 100:
        raise HTTPException(status_code=400, detail="Maximum 100 submissions per bulk request")
    accepted, ignored, errors = [], [], []
    webhook_events: list[tuple[str, str]] = []  # (form_id, submission_id)
    for sub in body.submissions:
        try:
            status, id_or_uuid, extra = await _process_submission(sub, db)
            if status == "accepted":
                # Include local_uuid so the mobile client can match server IDs
                # without relying on fragile index correspondence.
                accepted.append({"local_uuid": sub.local_uuid, "id": id_or_uuid})
                webhook_events.append((extra, id_or_uuid))  # (form_id, submission_id)
            elif status == "ignored":
                ignored.append({"local_uuid": sub.local_uuid, "id": id_or_uuid})
            else:
                errors.append({"local_uuid": sub.local_uuid, "error": extra})
        except Exception as e:
            errors.append({"local_uuid": sub.local_uuid, "error": str(e)})
    await db.commit()
    for form_id, sub_id in webhook_events:
        await fire_webhooks_for_submission(
            form_id,
            {"submission_id": sub_id, "form_id": form_id},
            background_tasks,
            db,
        )
    return {"accepted": accepted, "ignored": ignored, "errors": errors}



@router.get("/")
async def list_submissions(
    form_id: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Alias User to avoid conflicts with the current_user dependency.
    Submitter = aliased(User, name="submitter")

    q = (
        select(Submission, Submitter.email.label("submitted_by_email"))
        .join(FormVersion, Submission.form_version_id == FormVersion.id)
        .join(Form, FormVersion.form_id == Form.id)
        .join(Project, Form.project_id == Project.id)
        .outerjoin(Submitter, Submission.user_id == Submitter.id)
        .where(Project.tenant_id == current_user.tenant_id)
        .order_by(Submission.submitted_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    if form_id:
        q = q.where(Form.id == form_id)

    result = await db.execute(q)
    rows = result.all()
    return [
        {
            "id": sub.id,
            "form_version_id": sub.form_version_id,
            "local_uuid": sub.local_uuid,
            "data_json": sub.data_json,
            "collected_at": sub.collected_at,
            "submitted_at": sub.submitted_at,
            "submitted_by_email": submitted_by_email,
        }
        for sub, submitted_by_email in rows
    ]


@router.get("/{submission_id}")
async def get_submission(
    submission_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Submission, FormVersion, Form)
        .join(FormVersion, Submission.form_version_id == FormVersion.id)
        .join(Form, FormVersion.form_id == Form.id)
        .join(Project, Form.project_id == Project.id)
        .where(Submission.id == submission_id, Project.tenant_id == current_user.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")
    sub, version, form = row

    # Resolve submitted_by_email from user_id if present.
    submitted_by_email: str | None = None
    if sub.user_id:
        user_result = await db.execute(select(User).where(User.id == sub.user_id))
        submitter = user_result.scalar_one_or_none()
        if submitter:
            submitted_by_email = submitter.email

    media_result = await db.execute(
        select(MediaFile).where(MediaFile.submission_id == submission_id)
    )
    media_files = media_result.scalars().all()

    return {
        "id": sub.id,
        "form_id": form.id,
        "form_name": form.name,
        "form_version_id": sub.form_version_id,
        "version_num": version.version_num,
        "schema_fields": version.schema_json.get("fields", []),
        "data_json": sub.data_json,
        "collected_at": sub.collected_at,
        "submitted_at": sub.submitted_at,
        "submitted_by_email": submitted_by_email,
        "local_uuid": sub.local_uuid,
        "media_files": [
            {
                "id": mf.id,
                "field_name": mf.field_name,
                "mime_type": mf.mime_type,
                "size_bytes": mf.size_bytes,
            }
            for mf in media_files
        ],
    }
