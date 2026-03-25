"""
Tests for §2.7 — Webhooks.
Covers: CRUD endpoints, HMAC-SHA256 payload signing, delivery retry logic,
and wiring into the submissions endpoint.
"""
import hashlib
import hmac
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call
from httpx import ASGITransport, AsyncClient

from app.main import app, api_v1
from app.routers.webhooks import _sign_payload, fire_webhooks_for_submission


# ---------------------------------------------------------------------------
# _sign_payload — HMAC-SHA256 signing
# ---------------------------------------------------------------------------

class TestSignPayload:
    def test_returns_sha256_prefix(self):
        sig = _sign_payload("my-secret", b'{"event": "test"}')
        assert sig.startswith("sha256=")

    def test_signature_is_valid_hmac(self):
        secret = "super-secret"
        body = b'{"submission_id": "abc"}'
        sig = _sign_payload(secret, body)
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        assert sig == expected

    def test_different_secrets_produce_different_sigs(self):
        body = b'{"x": 1}'
        assert _sign_payload("secret-a", body) != _sign_payload("secret-b", body)

    def test_different_bodies_produce_different_sigs(self):
        secret = "same-secret"
        assert _sign_payload(secret, b'{"a": 1}') != _sign_payload(secret, b'{"b": 2}')

    def test_empty_body(self):
        sig = _sign_payload("sec", b"")
        assert sig.startswith("sha256=")
        assert len(sig) > 7


# ---------------------------------------------------------------------------
# POST /forms/{id}/webhooks — create
# ---------------------------------------------------------------------------

def make_manager_user(tenant_id="t1"):
    u = MagicMock()
    u.id = "user-mgr"
    u.tenant_id = tenant_id
    u.role = "manager"
    return u


def make_db():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    return db


@pytest.mark.asyncio
async def test_create_webhook_returns_201():
    from app.db import get_db
    from app.auth import get_current_user
    from app.models.core import Form, Webhook

    db = make_db()
    form = MagicMock(spec=Form)

    form_result = MagicMock()
    form_result.scalar_one_or_none.return_value = form
    db.execute = AsyncMock(return_value=form_result)

    wh_instance = MagicMock(spec=Webhook)
    wh_instance.id = "wh-1"
    wh_instance.url = "https://example.com/hook"
    wh_instance.is_active = True
    wh_instance.created_at = "2026-01-01T00:00:00"

    async def mock_refresh(obj):
        obj.id = wh_instance.id
        obj.url = wh_instance.url
        obj.is_active = wh_instance.is_active
        obj.created_at = wh_instance.created_at

    db.refresh = mock_refresh
    manager = make_manager_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: manager

    with patch("app.routers.webhooks.Webhook") as MockWH:
        MockWH.return_value = wh_instance
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/forms/form-x/webhooks",
                json={"url": "https://example.com/hook", "secret": "abc123"},
            )

    api_v1.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert body["url"] == "https://example.com/hook"
    assert body["is_active"] is True


@pytest.mark.asyncio
async def test_create_webhook_form_not_found_returns_404():
    from app.db import get_db
    from app.auth import get_current_user

    db = make_db()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)

    manager = make_manager_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: manager

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/forms/ghost-form/webhooks",
            json={"url": "https://example.com/hook"},
        )

    api_v1.dependency_overrides.clear()
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /forms/{id}/webhooks/{webhook_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_webhook_returns_204():
    from app.db import get_db
    from app.auth import get_current_user
    from app.models.core import Webhook

    db = make_db()
    wh = MagicMock(spec=Webhook)
    result = MagicMock()
    result.scalar_one_or_none.return_value = wh
    db.execute = AsyncMock(return_value=result)
    db.delete = AsyncMock()

    manager = make_manager_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: manager

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete("/api/v1/forms/form-x/webhooks/wh-1")

    api_v1.dependency_overrides.clear()
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_delete_webhook_not_found_returns_404():
    from app.db import get_db
    from app.auth import get_current_user

    db = make_db()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)

    manager = make_manager_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: manager

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete("/api/v1/forms/form-x/webhooks/ghost-wh")

    api_v1.dependency_overrides.clear()
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# fire_webhooks_for_submission — queues background tasks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fire_webhooks_queues_task_for_each_active_webhook():
    """fire_webhooks_for_submission adds one BackgroundTask per active webhook."""
    from app.models.core import Webhook
    from fastapi import BackgroundTasks

    db = AsyncMock()
    wh1 = MagicMock(spec=Webhook)
    wh1.id = "wh-a"
    wh2 = MagicMock(spec=Webhook)
    wh2.id = "wh-b"

    result = MagicMock()
    result.scalars.return_value.all.return_value = [wh1, wh2]
    db.execute = AsyncMock(return_value=result)

    bg = MagicMock(spec=BackgroundTasks)
    bg.add_task = MagicMock()

    await fire_webhooks_for_submission(
        "form-id",
        {"submission_id": "sub-1", "form_id": "form-id"},
        bg,
        db,
    )

    assert bg.add_task.call_count == 2


@pytest.mark.asyncio
async def test_fire_webhooks_no_active_webhooks_no_tasks():
    from fastapi import BackgroundTasks

    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(return_value=result)

    bg = MagicMock(spec=BackgroundTasks)
    bg.add_task = MagicMock()

    await fire_webhooks_for_submission("form-id", {}, bg, db)

    bg.add_task.assert_not_called()


# ---------------------------------------------------------------------------
# _deliver — sends HTTP POST and retries
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_deliver_sends_post_with_correct_headers():
    """_deliver posts to the webhook URL with Content-Type and event headers."""
    from app.routers.webhooks import _deliver
    from app.models.core import Webhook

    wh = MagicMock(spec=Webhook)
    wh.id = "wh-x"
    wh.url = "https://listener.example.com/hook"
    wh.is_active = True
    wh.secret = None

    result = MagicMock()
    result.scalar_one_or_none.return_value = wh

    with patch("app.routers.webhooks.AsyncSessionLocal") as MockSession, \
         patch("app.routers.webhooks.httpx.AsyncClient") as MockHttpx:

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=result)
        MockSession.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        MockSession.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_resp = MagicMock()
        mock_resp.status_code = 200

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        MockHttpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockHttpx.return_value.__aexit__ = AsyncMock(return_value=False)

        await _deliver("wh-x", {"submission_id": "s1"})

        mock_client.post.assert_called_once()
        _, kwargs = mock_client.post.call_args
        assert kwargs["headers"]["Content-Type"] == "application/json"
        assert kwargs["headers"]["X-Questbee-Event"] == "submission.created"


@pytest.mark.asyncio
async def test_deliver_includes_hmac_signature_when_secret_set():
    """When webhook has a secret, X-Questbee-Signature header must be present."""
    from app.routers.webhooks import _deliver
    from app.models.core import Webhook

    wh = MagicMock(spec=Webhook)
    wh.id = "wh-signed"
    wh.url = "https://listener.example.com/hook"
    wh.is_active = True
    wh.secret = "my-secret"

    result = MagicMock()
    result.scalar_one_or_none.return_value = wh

    with patch("app.routers.webhooks.AsyncSessionLocal") as MockSession, \
         patch("app.routers.webhooks.httpx.AsyncClient") as MockHttpx:

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=result)
        MockSession.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        MockSession.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        MockHttpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockHttpx.return_value.__aexit__ = AsyncMock(return_value=False)

        payload = {"submission_id": "s2"}
        await _deliver("wh-signed", payload)

        _, kwargs = mock_client.post.call_args
        assert "X-Questbee-Signature" in kwargs["headers"]
        sig = kwargs["headers"]["X-Questbee-Signature"]
        assert sig.startswith("sha256=")

        # Verify the signature is correct
        body = json.dumps(payload).encode()
        expected = "sha256=" + hmac.new("my-secret".encode(), body, hashlib.sha256).hexdigest()
        assert sig == expected


@pytest.mark.asyncio
async def test_deliver_retries_on_non_2xx():
    """_deliver retries up to 2 times (attempt 0, 1) on non-2xx responses."""
    from app.routers.webhooks import _deliver
    from app.models.core import Webhook

    wh = MagicMock(spec=Webhook)
    wh.id = "wh-retry"
    wh.url = "https://listener.example.com/hook"
    wh.is_active = True
    wh.secret = None

    result = MagicMock()
    result.scalar_one_or_none.return_value = wh

    call_count = 0

    async def mock_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        resp = MagicMock()
        resp.status_code = 500  # always fail
        return resp

    with patch("app.routers.webhooks.AsyncSessionLocal") as MockSession, \
         patch("app.routers.webhooks.httpx.AsyncClient") as MockHttpx, \
         patch("app.routers.webhooks.asyncio.sleep", new_callable=AsyncMock):

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=result)
        MockSession.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        MockSession.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_client = AsyncMock()
        mock_client.post = mock_post
        MockHttpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockHttpx.return_value.__aexit__ = AsyncMock(return_value=False)

        await _deliver("wh-retry", {}, attempt=0)

    # attempt 0 → fail → retry attempt 1 → fail → retry attempt 2 → fail → stop
    assert call_count == 3


@pytest.mark.asyncio
async def test_deliver_stops_after_max_attempts():
    """_deliver does NOT retry past attempt=2 (max 3 total attempts)."""
    from app.routers.webhooks import _deliver
    from app.models.core import Webhook

    wh = MagicMock(spec=Webhook)
    wh.url = "https://x.com"
    wh.is_active = True
    wh.secret = None

    result = MagicMock()
    result.scalar_one_or_none.return_value = wh

    call_count = 0

    async def mock_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        resp = MagicMock()
        resp.status_code = 500
        return resp

    with patch("app.routers.webhooks.AsyncSessionLocal") as MockSession, \
         patch("app.routers.webhooks.httpx.AsyncClient") as MockHttpx, \
         patch("app.routers.webhooks.asyncio.sleep", new_callable=AsyncMock):

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=result)
        MockSession.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        MockSession.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_client = AsyncMock()
        mock_client.post = mock_post
        MockHttpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockHttpx.return_value.__aexit__ = AsyncMock(return_value=False)

        # Start at attempt=2 (the last allowed attempt)
        await _deliver("wh-x", {}, attempt=2)

    assert call_count == 1  # fires once, does not retry further


@pytest.mark.asyncio
async def test_deliver_skips_inactive_webhook():
    """_deliver does nothing if the webhook is not active."""
    from app.routers.webhooks import _deliver
    from app.models.core import Webhook

    wh = MagicMock(spec=Webhook)
    wh.is_active = False

    result = MagicMock()
    result.scalar_one_or_none.return_value = wh

    with patch("app.routers.webhooks.AsyncSessionLocal") as MockSession, \
         patch("app.routers.webhooks.httpx.AsyncClient") as MockHttpx:

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=result)
        MockSession.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        MockSession.return_value.__aexit__ = AsyncMock(return_value=False)

        mock_client = AsyncMock()
        MockHttpx.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockHttpx.return_value.__aexit__ = AsyncMock(return_value=False)

        await _deliver("wh-inactive", {})

        mock_client.post.assert_not_called()
