"""
Webhook management and delivery.

Admins can register URLs to be called when new submissions arrive for a form.
Delivery happens in a background asyncio task with up to 3 retries.
An optional `secret` is used to sign the payload (HMAC-SHA256 in the
`X-Questbee-Signature` header) so the receiver can verify authenticity.
"""
import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, HttpUrl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_role
from app.db import get_db, AsyncSessionLocal
from app.models.core import Form, Project, User, Webhook

router = APIRouter()

# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


class WebhookCreate(BaseModel):
    url: HttpUrl
    secret: str | None = None


@router.post("/forms/{form_id}/webhooks", status_code=201)
async def create_webhook(
    form_id: str,
    body: WebhookCreate,
    current_user: User = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Form).join(Project, Form.project_id == Project.id)
        .where(Form.id == form_id, Project.tenant_id == current_user.tenant_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Form not found")

    webhook = Webhook(
        form_id=form_id,
        tenant_id=current_user.tenant_id,
        url=str(body.url),
        secret=body.secret,
    )
    db.add(webhook)
    await db.commit()
    await db.refresh(webhook)
    return {"id": webhook.id, "url": webhook.url, "is_active": webhook.is_active, "created_at": webhook.created_at}


@router.get("/forms/{form_id}/webhooks")
async def list_webhooks(
    form_id: str,
    current_user: User = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Webhook)
        .join(Form, Webhook.form_id == Form.id)
        .join(Project, Form.project_id == Project.id)
        .where(Webhook.form_id == form_id, Project.tenant_id == current_user.tenant_id)
        .order_by(Webhook.created_at.desc())
    )
    return [
        {"id": w.id, "url": w.url, "is_active": w.is_active, "created_at": w.created_at}
        for w in result.scalars().all()
    ]


@router.delete("/forms/{form_id}/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    form_id: str,
    webhook_id: str,
    current_user: User = Depends(require_role("admin", "manager")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Webhook)
        .join(Form, Webhook.form_id == Form.id)
        .join(Project, Form.project_id == Project.id)
        .where(
            Webhook.id == webhook_id,
            Webhook.form_id == form_id,
            Project.tenant_id == current_user.tenant_id,
        )
    )
    webhook = result.scalar_one_or_none()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(webhook)
    await db.commit()


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------


def _sign_payload(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def _deliver(webhook_id: str, payload: dict, attempt: int = 0) -> None:
    """Fire the webhook with up to 3 attempts (exponential back-off)."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
        webhook = result.scalar_one_or_none()
        if not webhook or not webhook.is_active:
            return

    body = json.dumps(payload).encode()
    headers = {
        "Content-Type": "application/json",
        "X-Questbee-Event": "submission.created",
    }
    if webhook.secret:
        headers["X-Questbee-Signature"] = _sign_payload(webhook.secret, body)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(webhook.url, content=body, headers=headers)
            if resp.status_code < 300:
                return
    except Exception:
        pass

    # Retry up to 3 times with exponential back-off
    if attempt < 2:
        await asyncio.sleep(2 ** (attempt + 1))
        await _deliver(webhook_id, payload, attempt + 1)


async def fire_webhooks_for_submission(
    form_id: str,
    submission_payload: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession,
) -> None:
    """Called by the submissions router after a new submission is accepted."""
    result = await db.execute(
        select(Webhook).where(Webhook.form_id == form_id, Webhook.is_active == True)  # noqa: E712
    )
    for webhook in result.scalars().all():
        background_tasks.add_task(_deliver, webhook.id, submission_payload)
