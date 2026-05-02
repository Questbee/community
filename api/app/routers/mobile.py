import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_device_auth, hash_token
from app.db import get_db
from app.models.core import DeviceToken, Form, FormVersion, PairingToken, Project

router = APIRouter()


class PairRequest(BaseModel):
    pairing_token: str
    label: str | None = None  # optional human-readable device name


@router.post("/pair")
async def pair_device(body: PairRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PairingToken).where(
            PairingToken.token == body.pairing_token,
            PairingToken.used == False,  # noqa: E712
        )
    )
    pt = result.scalar_one_or_none()
    if not pt:
        raise HTTPException(status_code=401, detail="Invalid pairing token")
    if pt.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Pairing token expired")

    pt.used = True
    raw_token = secrets.token_urlsafe(32)
    device_token = DeviceToken(
        tenant_id=pt.tenant_id,
        user_id=pt.user_id,
        user_email=pt.user_email,
        label=body.label or pt.label,  # prefer app-supplied, fall back to pre-assigned name
        token_hash=hash_token(raw_token),
    )
    db.add(device_token)
    await db.commit()

    return {
        "device_token": raw_token,
        "tenant_id": pt.tenant_id,
        "user_id": pt.user_id,
        "user_email": pt.user_email,
    }


@router.get("/forms")
async def get_mobile_forms(
    device_token=Depends(get_device_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Form, FormVersion)
        .join(Project, Form.project_id == Project.id)
        .join(FormVersion, Form.current_version_id == FormVersion.id)
        .where(
            Project.tenant_id == device_token.tenant_id,
            FormVersion.published_at.isnot(None),
        )
    )
    return [
        {
            "id": form.id,
            "name": form.name,
            "version_num": version.version_num,
            "version_id": version.id,
            "schema_json": version.schema_json,
        }
        for form, version in result.all()
    ]
