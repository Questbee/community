"""
Media file upload and serving endpoints.

Files are stored on the local filesystem under the MEDIA_ROOT directory
(Docker volume mounted at /media by default). The path structure is:
    {media_root}/{tenant_id}/{submission_id}/{field_name}/{original_filename}

The `media_files` table records the mapping. Files are served back through
this API so they remain protected behind authentication.
"""
import mimetypes
import os
import uuid

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, get_device_auth
from app.config import settings
from app.db import get_db
from app.models.core import MediaFile, Submission, FormVersion, Form as FormModel, Project, User

router = APIRouter()

MEDIA_ROOT = os.environ.get("MEDIA_ROOT", "/media")
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB hard cap


def _safe_filename(name: str) -> str:
    """Strip path components and replace unsafe chars."""
    name = os.path.basename(name)
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name) or "file"


@router.post("/upload", status_code=201)
async def upload_media(
    submission_id: str = Form(...),
    field_name: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    # Accept either device token (mobile sync) or JWT (web)
    device_auth=Depends(get_device_auth),
):
    """Upload a media file attached to a submission field.

    Called by the mobile sync engine after submitting form data.
    The `submission_id` must already exist in the database.
    """
    # Verify submission exists and belongs to the device's tenant
    result = await db.execute(
        select(Submission, FormVersion, FormModel, Project)
        .join(FormVersion, Submission.form_version_id == FormVersion.id)
        .join(FormModel, FormVersion.form_id == FormModel.id)
        .join(Project, FormModel.project_id == Project.id)
        .where(Submission.id == submission_id, Project.tenant_id == device_auth.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission = row[0]
    tenant_id = device_auth.tenant_id

    # Size limit
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds maximum size of {MAX_UPLOAD_BYTES // (1024*1024)} MB")

    # Determine MIME type
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

    # Build storage path
    safe_name = _safe_filename(file.filename or f"upload_{uuid.uuid4().hex[:8]}")
    rel_path = os.path.join(tenant_id, submission_id, field_name, safe_name)
    abs_path = os.path.join(MEDIA_ROOT, rel_path)

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    async with aiofiles.open(abs_path, "wb") as f:
        await f.write(content)

    media_file = MediaFile(
        submission_id=submission_id,
        field_name=field_name,
        storage_path=rel_path,
        mime_type=mime,
        size_bytes=len(content),
    )
    db.add(media_file)
    await db.commit()
    await db.refresh(media_file)

    return {
        "id": media_file.id,
        "storage_path": rel_path,
        "mime_type": mime,
        "size_bytes": len(content),
    }


@router.get("/{media_id}")
async def serve_media(
    media_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serve a media file.  Requires JWT authentication (web dashboard)."""
    result = await db.execute(
        select(MediaFile, Submission, FormVersion, FormModel, Project)
        .join(Submission, MediaFile.submission_id == Submission.id)
        .join(FormVersion, Submission.form_version_id == FormVersion.id)
        .join(FormModel, FormVersion.form_id == FormModel.id)
        .join(Project, FormModel.project_id == Project.id)
        .where(MediaFile.id == media_id, Project.tenant_id == current_user.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Media file not found")

    media_file = row[0]
    abs_path = os.path.join(MEDIA_ROOT, media_file.storage_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="File not found on storage")

    return FileResponse(abs_path, media_type=media_file.mime_type)
