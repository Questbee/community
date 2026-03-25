"""
Tests for the bulk submissions endpoint.

Uses AsyncClient + ASGITransport with dependency_overrides to provide a mock DB session.
"""
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, MagicMock
from app.main import app, api_v1
from app.routers.submissions import _process_submission
from app.schemas.submissions import SubmissionCreate, BulkSubmissionRequest


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def make_mock_db():
    """Return a lightweight AsyncMock that mimics an AsyncSession."""
    db = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.add = MagicMock()
    return db


# ---------------------------------------------------------------------------
# Unit tests for _process_submission (no HTTP layer needed)
# ---------------------------------------------------------------------------

class TestProcessSubmission:
    """Direct unit tests for the _process_submission helper."""

    @pytest.mark.asyncio
    async def test_duplicate_local_uuid_returns_ignored(self):
        """A submission whose local_uuid already exists must be ignored."""
        from app.models.core import Submission

        db = make_mock_db()

        # Simulate existing record found
        existing_submission = MagicMock(spec=Submission)
        existing_submission.id = "server-sub-id-999"
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = existing_submission
        db.execute = AsyncMock(return_value=mock_result)

        sub = SubmissionCreate(
            form_version_id="fv-001",
            local_uuid="dup-uuid-1234",
            data_json={"name": "Alice"},
        )
        status, id_or_uuid, error = await _process_submission(sub, db)
        assert status == "ignored"
        # On duplicate, _process_submission returns the existing server submission ID
        # so the mobile client can use it for media uploads.
        assert id_or_uuid == "server-sub-id-999"
        assert error is None

    @pytest.mark.asyncio
    async def test_missing_required_field_returns_error(self):
        """A submission missing a required field must return status='error'."""
        from app.models.core import FormVersion

        db = make_mock_db()

        # First call: no existing submission (idempotency check passes)
        # Second call: return form version with a required field
        version = MagicMock(spec=FormVersion)
        version.schema_json = {
            "version": 1,
            "title": "Test",
            "fields": [
                {"id": "name", "type": "text", "label": "Name", "required": True},
            ],
        }

        no_result = MagicMock()
        no_result.scalar_one_or_none.return_value = None
        version_result = MagicMock()
        version_result.scalar_one_or_none.return_value = version

        db.execute = AsyncMock(side_effect=[no_result, version_result])

        sub = SubmissionCreate(
            form_version_id="fv-002",
            local_uuid="new-uuid-5678",
            data_json={},  # "name" field missing
        )
        status, id_or_uuid, error = await _process_submission(sub, db)
        assert status == "error"
        assert "name" in (error or "")

    @pytest.mark.asyncio
    async def test_unknown_form_version_returns_error(self):
        """A submission referencing a non-existent form_version_id must error."""
        db = make_mock_db()

        no_result = MagicMock()
        no_result.scalar_one_or_none.return_value = None

        # Both calls return None (idempotency: no dup, then form_version: not found)
        db.execute = AsyncMock(return_value=no_result)

        sub = SubmissionCreate(
            form_version_id="does-not-exist",
            local_uuid=None,
            data_json={"x": 1},
        )
        status, id_or_uuid, error = await _process_submission(sub, db)
        assert status == "error"
        assert "does-not-exist" in (error or "")


# ---------------------------------------------------------------------------
# Integration-style tests for POST /submissions/bulk
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bulk_duplicate_ignored():
    """
    Submitting the same local_uuid twice in a bulk request:
    - first occurrence accepted
    - second occurrence ignored (idempotency)
    """
    from app.db import get_db
    from app.models.core import FormVersion, Submission

    # We'll track calls to simulate state changes between two subs
    call_count = 0

    version = MagicMock(spec=FormVersion)
    version.id = "fv-bulk-001"
    version.schema_json = {"version": 1, "title": "T", "fields": []}

    accepted_sub = MagicMock(spec=Submission)
    accepted_sub.id = "sub-generated-id"

    async def mock_execute(stmt):
        nonlocal call_count
        r = MagicMock()
        call_count += 1
        # For the first sub (new): idempotency → None, then form_version → found
        if call_count == 1:
            r.scalar_one_or_none.return_value = None   # no dup
        elif call_count == 2:
            r.scalar_one_or_none.return_value = version  # form version exists
        # For the second sub (dup): idempotency → found
        elif call_count == 3:
            r.scalar_one_or_none.return_value = accepted_sub  # duplicate!
        else:
            r.scalar_one_or_none.return_value = None
        return r

    # Capture added submission object and set its id in flush
    added_obj = None

    def capture_add(obj):
        nonlocal added_obj
        added_obj = obj

    async def mock_flush():
        if added_obj is not None:
            added_obj.id = "sub-generated-id"

    mock_db = make_mock_db()
    mock_db.execute = mock_execute
    mock_db.add = capture_add
    mock_db.flush = mock_flush

    async def override_get_db():
        yield mock_db

    api_v1.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/submissions/bulk",
            json={
                "submissions": [
                    {"form_version_id": "fv-bulk-001", "local_uuid": "same-uuid", "data_json": {}},
                    {"form_version_id": "fv-bulk-001", "local_uuid": "same-uuid", "data_json": {}},
                ]
            },
        )

    api_v1.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    # First is accepted, second is ignored
    assert len(body["accepted"]) == 1
    assert len(body["ignored"]) == 1
    # ignored entries are objects {local_uuid, id} so the mobile client gets the server ID
    assert body["ignored"][0]["local_uuid"] == "same-uuid"
    assert len(body["errors"]) == 0


@pytest.mark.asyncio
async def test_bulk_mixed_batch():
    """
    Mixed batch:
    - one with unknown form_version_id → error
    - one duplicate → ignored
    - one completely new (no local_uuid) → accepted
    """
    from app.db import get_db
    from app.models.core import FormVersion, Submission

    version = MagicMock(spec=FormVersion)
    version.id = "fv-real"
    version.schema_json = {"version": 1, "title": "T", "fields": []}

    dup_submission = MagicMock(spec=Submission)
    dup_submission.id = "existing-sub"

    new_sub_instance = MagicMock()
    new_sub_instance.id = "brand-new-sub-id"

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        r = MagicMock()
        call_count += 1
        # Sub 1: unknown form_version
        # call 1: idempotency check → None (no dup, local_uuid = "unknown-fv-uuid")
        # call 2: form_version lookup → None (not found)
        if call_count == 1:
            r.scalar_one_or_none.return_value = None
        elif call_count == 2:
            r.scalar_one_or_none.return_value = None  # form version not found
        # Sub 2: duplicate local_uuid
        # call 3: idempotency check → found
        elif call_count == 3:
            r.scalar_one_or_none.return_value = dup_submission
        # Sub 3: new with no local_uuid, form_version exists
        # call 4: form_version lookup → version
        elif call_count == 4:
            r.scalar_one_or_none.return_value = version
        else:
            r.scalar_one_or_none.return_value = None
        return r

    # Capture added submission and set its id in flush
    added_obj = None

    def capture_add(obj):
        nonlocal added_obj
        added_obj = obj

    async def mock_flush():
        if added_obj is not None:
            added_obj.id = "brand-new-sub-id"

    mock_db = make_mock_db()
    mock_db.execute = mock_execute
    mock_db.add = capture_add
    mock_db.flush = mock_flush

    async def override_get_db():
        yield mock_db

    api_v1.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/submissions/bulk",
            json={
                "submissions": [
                    {"form_version_id": "fv-does-not-exist", "local_uuid": "unknown-fv-uuid", "data_json": {}},
                    {"form_version_id": "fv-real", "local_uuid": "known-dup-uuid", "data_json": {}},
                    {"form_version_id": "fv-real", "local_uuid": None, "data_json": {}},
                ]
            },
        )

    api_v1.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert len(body["errors"]) == 1
    assert body["errors"][0]["local_uuid"] == "unknown-fv-uuid"
    assert len(body["ignored"]) == 1
    # ignored entries are objects {local_uuid, id} so the mobile client gets the server ID
    assert body["ignored"][0]["local_uuid"] == "known-dup-uuid"
    assert len(body["accepted"]) == 1
    # accepted entries are objects {local_uuid, id} for mobile ID reconciliation
    assert body["accepted"][0]["id"] == "brand-new-sub-id"
