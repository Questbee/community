import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_role
from app.db import get_db
from app.models.core import DeviceToken, PairingToken, Tenant, User

router = APIRouter()


@router.post("/mobile/pairing-token")
async def generate_pairing_token(
    current_user: User = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    pt = PairingToken(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        user_email=current_user.email,
        token=token,
        expires_at=expires_at,
    )
    db.add(pt)
    await db.commit()
    return {"pairing_token": token, "expires_at": expires_at.isoformat()}


@router.get("/mobile/devices")
async def list_devices(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all active (non-revoked) devices paired by the current user.
    Admins and managers see all devices for the tenant."""
    if current_user.role in ("admin", "manager"):
        stmt = select(DeviceToken).where(
            DeviceToken.tenant_id == current_user.tenant_id,
            DeviceToken.revoked == False,  # noqa: E712
        )
    else:
        stmt = select(DeviceToken).where(
            DeviceToken.user_id == current_user.id,
            DeviceToken.revoked == False,  # noqa: E712
        )
    result = await db.execute(stmt)
    devices = result.scalars().all()
    return [
        {
            "id": d.id,
            "label": d.label,
            "user_email": d.user_email,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "last_used_at": d.last_used_at.isoformat() if d.last_used_at else None,
        }
        for d in devices
    ]


@router.delete("/mobile/devices/{device_id}", status_code=204)
async def revoke_device(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a device token. Admins/managers can revoke any device in the
    tenant; field workers can only revoke their own devices."""
    result = await db.execute(
        select(DeviceToken).where(DeviceToken.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device or device.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Device not found")
    if current_user.role not in ("admin", "manager") and device.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot revoke another user's device")
    device.revoked = True
    await db.commit()


@router.get("/mobile/server-url")
async def get_default_server_url(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the tenant-wide default server URL for QR code generation."""
    result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = result.scalar_one_or_none()
    url = (tenant.settings_json or {}).get("mobile_server_url", "") if tenant else ""
    return {"server_url": url}


@router.put("/mobile/server-url")
async def save_default_server_url(
    server_url: str = Body(..., embed=True),
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Persist the default server URL for all users in this tenant (admin only)."""
    result = await db.execute(select(Tenant).where(Tenant.id == current_user.tenant_id))
    tenant = result.scalar_one_or_none()
    if tenant:
        tenant.settings_json = {**(tenant.settings_json or {}), "mobile_server_url": server_url.rstrip("/")}
        await db.commit()
    return {"server_url": server_url}
