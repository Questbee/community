"""
Tests for §2.6 — Headless API (API key management + /headless/submit).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import ASGITransport, AsyncClient

from app.main import app, api_v1
from app.auth import hash_token


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_admin_user(tenant_id="tenant-1"):
    user = MagicMock()
    user.id = "user-admin"
    user.tenant_id = tenant_id
    user.role = "admin"
    return user


def make_db():
    db = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.add = MagicMock()
    return db


# ---------------------------------------------------------------------------
# POST /api-keys — create key
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_api_key_returns_plain_key():
    """POST /api-keys/ creates a key and returns the plain text once."""
    from app.db import get_db
    from app.auth import get_current_user
    from app.models.core import ApiKey

    db = make_db()
    key_instance = MagicMock(spec=ApiKey)
    key_instance.id = "key-id-1"
    key_instance.scopes = ["headless:submit"]
    key_instance.created_at = "2026-01-01T00:00:00"

    async def mock_refresh(obj):
        obj.id = key_instance.id
        obj.scopes = key_instance.scopes
        obj.created_at = key_instance.created_at

    db.refresh = mock_refresh
    admin = make_admin_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/api-keys/",
            json={"scopes": ["headless:submit"]},
        )

    api_v1.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert "key" in body
    assert len(body["key"]) > 20   # should be a long random token
    assert body["scopes"] == ["headless:submit"]


@pytest.mark.asyncio
async def test_create_api_key_hash_not_in_response():
    """The key hash must never appear in the API response."""
    from app.db import get_db
    from app.auth import get_current_user
    from app.models.core import ApiKey

    db = make_db()
    key_instance = MagicMock(spec=ApiKey)
    key_instance.id = "key-id-2"
    key_instance.scopes = []
    key_instance.created_at = "2026-01-01T00:00:00"

    async def mock_refresh(obj):
        obj.id = key_instance.id
        obj.scopes = key_instance.scopes
        obj.created_at = key_instance.created_at

    db.refresh = mock_refresh
    admin = make_admin_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/api-keys/", json={})

    api_v1.dependency_overrides.clear()

    body = response.json()
    assert "key_hash" not in body
    assert "hash" not in body


# ---------------------------------------------------------------------------
# DELETE /api-keys/{id} — revoke
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_revoke_api_key_sets_revoked_true():
    """DELETE /api-keys/{id} sets api_key.revoked = True."""
    from app.db import get_db
    from app.auth import get_current_user
    from app.models.core import ApiKey

    db = make_db()
    existing_key = MagicMock(spec=ApiKey)
    existing_key.id = "key-abc"
    existing_key.revoked = False

    result = MagicMock()
    result.scalar_one_or_none.return_value = existing_key
    db.execute = AsyncMock(return_value=result)

    admin = make_admin_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete("/api/v1/api-keys/key-abc")

    api_v1.dependency_overrides.clear()

    assert response.status_code == 204
    assert existing_key.revoked is True


@pytest.mark.asyncio
async def test_revoke_nonexistent_key_returns_404():
    from app.db import get_db
    from app.auth import get_current_user

    db = make_db()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)

    admin = make_admin_user()

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete("/api/v1/api-keys/ghost-key")

    api_v1.dependency_overrides.clear()
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /headless/submit — submit with API key auth
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_headless_submit_accepted():
    """Valid payload with published form → 201 accepted."""
    from app.db import get_db
    from app.auth import get_api_key_auth
    from app.models.core import ApiKey, Form, FormVersion, Project, Submission

    db = make_db()
    api_key = MagicMock(spec=ApiKey)
    api_key.tenant_id = "tenant-1"

    form = MagicMock(spec=Form)
    form.id = "form-x"
    version = MagicMock(spec=FormVersion)
    version.id = "fv-x"
    version.published_at = "2026-01-01"
    version.schema_json = {"fields": [{"id": "name", "type": "text", "required": True}]}

    sub_instance = MagicMock(spec=Submission)
    sub_instance.id = "new-sub-id"

    async def mock_execute(stmt):
        r = MagicMock()
        # Only one execute call: form lookup (no local_uuid, idempotency check skipped)
        r.first.return_value = (form, version)
        return r

    db.execute = mock_execute

    async def mock_refresh(obj):
        obj.id = sub_instance.id

    db.refresh = mock_refresh

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_api_key_auth] = lambda: api_key

    with patch("app.routers.headless.Submission") as MockSub:
        MockSub.return_value = sub_instance
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/headless/submit",
                json={"form_id": "form-x", "data_json": {"name": "Alice"}},
                headers={"X-API-Key": "fake-key"},
            )

    api_v1.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["status"] == "accepted"


@pytest.mark.asyncio
async def test_headless_submit_missing_required_field_returns_422():
    """Missing required field returns 422 with field-level errors."""
    from app.db import get_db
    from app.auth import get_api_key_auth
    from app.models.core import ApiKey, Form, FormVersion

    db = make_db()
    api_key = MagicMock(spec=ApiKey)
    api_key.tenant_id = "tenant-1"

    form = MagicMock(spec=Form)
    version = MagicMock(spec=FormVersion)
    version.id = "fv-y"
    version.published_at = "2026-01-01"
    version.schema_json = {"fields": [{"id": "email", "type": "email", "required": True}]}

    async def mock_execute(stmt):
        r = MagicMock()
        # Only one execute call: form lookup (no local_uuid, idempotency check skipped)
        r.first.return_value = (form, version)
        return r

    db.execute = mock_execute

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_api_key_auth] = lambda: api_key

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/headless/submit",
            json={"form_id": "form-y", "data_json": {}},
            headers={"X-API-Key": "fake-key"},
        )

    api_v1.dependency_overrides.clear()

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("email" in str(e) for e in detail)


@pytest.mark.asyncio
async def test_headless_submit_idempotent_duplicate_returns_ignored():
    """Submitting the same local_uuid twice returns 'ignored' on the second call."""
    from app.db import get_db
    from app.auth import get_api_key_auth
    from app.models.core import ApiKey, Submission

    db = make_db()
    api_key = MagicMock(spec=ApiKey)
    api_key.tenant_id = "tenant-1"

    existing_sub = MagicMock(spec=Submission)
    result = MagicMock()
    result.scalar_one_or_none.return_value = existing_sub
    db.execute = AsyncMock(return_value=result)

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_api_key_auth] = lambda: api_key

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/headless/submit",
            json={"form_id": "form-z", "data_json": {}, "local_uuid": "dup-123"},
        )

    api_v1.dependency_overrides.clear()

    assert response.status_code == 201
    assert response.json()["status"] == "ignored"


@pytest.mark.asyncio
async def test_headless_submit_form_not_found_returns_404():
    from app.db import get_db
    from app.auth import get_api_key_auth
    from app.models.core import ApiKey

    db = make_db()
    api_key = MagicMock(spec=ApiKey)
    api_key.tenant_id = "tenant-1"

    async def mock_execute(stmt):
        r = MagicMock()
        # Only one execute call: form lookup (no local_uuid, idempotency check skipped)
        r.first.return_value = None  # form not found
        return r

    db.execute = mock_execute

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_api_key_auth] = lambda: api_key

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/headless/submit",
            json={"form_id": "ghost-form", "data_json": {}},
        )

    api_v1.dependency_overrides.clear()
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# get_api_key_auth dependency
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_api_key_auth_invalid_key_returns_401():
    """An invalid/missing X-API-Key header causes 401 on any headless endpoint."""
    from app.db import get_db
    from app.models.core import ApiKey

    db = make_db()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None  # key not found in DB
    db.execute = AsyncMock(return_value=result)

    async def override_db():
        yield db

    api_v1.dependency_overrides[get_db] = override_db
    # Don't override get_api_key_auth — let it run for real

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/headless/submit",
            json={"form_id": "f", "data_json": {}},
            headers={"X-API-Key": "definitely-wrong-key"},
        )

    api_v1.dependency_overrides.clear()
    assert response.status_code == 401
