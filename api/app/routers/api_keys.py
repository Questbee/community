"""
API key management endpoints.

Admins can create API keys for headless/IoT integrations.  The plain key is
returned **once** at creation time and never stored.  Only the SHA-256 hash
is persisted.  Revoked keys are excluded from authentication checks.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, hash_token, require_role
from app.db import get_db
from app.models.core import ApiKey, User

router = APIRouter()


class ApiKeyCreate(BaseModel):
    name: str | None = None
    scopes: list[str] = []


@router.post("/", status_code=201)
async def create_api_key(
    body: ApiKeyCreate,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    """Create a new API key.  Returns the plain key — save it now, it won't be shown again."""
    plain_key = secrets.token_urlsafe(32)
    api_key = ApiKey(
        tenant_id=current_user.tenant_id,
        key_hash=hash_token(plain_key),
        scopes=body.scopes,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)
    return {
        "id": api_key.id,
        "key": plain_key,          # returned once only
        "scopes": api_key.scopes,
        "created_at": api_key.created_at,
    }


@router.get("/")
async def list_api_keys(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.tenant_id == current_user.tenant_id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()
    return [
        {
            "id": k.id,
            "scopes": k.scopes,
            "revoked": k.revoked,
            "created_at": k.created_at,
            "expires_at": k.expires_at,
        }
        for k in keys
    ]


@router.delete("/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.tenant_id == current_user.tenant_id)
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.revoked = True
    await db.commit()
