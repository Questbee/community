"""
Tests for §2.4 schema validation (group/repeat nested fields)
and §2.5 schema versioning endpoint (GET /forms/{id}/versions).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.main import app, api_v1
from app.routers.forms import _validate_fields, validate_form_schema


# ---------------------------------------------------------------------------
# §2.4 — _validate_fields recursive schema validator
# ---------------------------------------------------------------------------

class TestValidateFields:
    """Unit tests for the recursive _validate_fields helper."""

    def _run(self, fields: list) -> list[str]:
        errors: list[str] = []
        _validate_fields(fields, set(), "fields", errors)
        return errors

    def test_valid_flat_fields(self):
        fields = [
            {"id": "name", "type": "text", "label": "Name"},
            {"id": "age", "type": "number", "label": "Age"},
        ]
        assert self._run(fields) == []

    def test_missing_id(self):
        errors = self._run([{"type": "text", "label": "No ID"}])
        assert any("missing 'id'" in e for e in errors)

    def test_missing_type(self):
        errors = self._run([{"id": "field1", "label": "No type"}])
        assert any("missing 'type'" in e for e in errors)

    def test_unknown_type(self):
        errors = self._run([{"id": "f1", "type": "unicorn"}])
        assert any("unknown type 'unicorn'" in e for e in errors)

    def test_duplicate_id(self):
        errors = self._run([
            {"id": "name", "type": "text"},
            {"id": "name", "type": "number"},
        ])
        assert any("duplicate id 'name'" in e for e in errors)

    def test_select_without_options(self):
        errors = self._run([{"id": "colour", "type": "select_one"}])
        assert any("at least one option" in e for e in errors)

    def test_select_with_options_valid(self):
        errors = self._run([{
            "id": "colour",
            "type": "select_one",
            "options": [{"value": "red", "label": "Red"}],
        }])
        assert errors == []

    def test_group_without_fields_key(self):
        errors = self._run([{"id": "grp", "type": "group"}])
        assert any("'fields' array" in e for e in errors)

    def test_group_with_empty_fields_valid(self):
        errors = self._run([{"id": "grp", "type": "group", "fields": []}])
        assert errors == []

    def test_group_nested_field_validates(self):
        errors = self._run([{
            "id": "grp",
            "type": "group",
            "fields": [{"id": "child", "type": "text"}],
        }])
        assert errors == []

    def test_group_nested_field_invalid_type(self):
        errors = self._run([{
            "id": "grp",
            "type": "group",
            "fields": [{"id": "child", "type": "ghost_type"}],
        }])
        assert any("ghost_type" in e for e in errors)

    def test_group_nested_duplicate_id_detected(self):
        """Nested field IDs share the same seen_ids set — duplicates across levels are caught."""
        errors = self._run([
            {"id": "name", "type": "text"},
            {
                "id": "grp",
                "type": "group",
                "fields": [{"id": "name", "type": "text"}],  # duplicate of top-level
            },
        ])
        assert any("duplicate id 'name'" in e for e in errors)

    def test_repeat_without_fields_key(self):
        errors = self._run([{"id": "rep", "type": "repeat"}])
        assert any("'fields' array" in e for e in errors)

    def test_repeat_nested_fields_valid(self):
        errors = self._run([{
            "id": "rep",
            "type": "repeat",
            "fields": [{"id": "item_name", "type": "text"}],
        }])
        assert errors == []

    def test_deeply_nested_group_in_repeat(self):
        errors = self._run([{
            "id": "rep",
            "type": "repeat",
            "fields": [{
                "id": "inner_grp",
                "type": "group",
                "fields": [{"id": "leaf", "type": "text"}],
            }],
        }])
        assert errors == []

    def test_hidden_and_calculated_valid(self):
        errors = self._run([
            {"id": "h", "type": "hidden"},
            {"id": "c", "type": "calculated"},
        ])
        assert errors == []


class TestValidateFormSchema:
    """Tests for the validate_form_schema wrapper (raises HTTPException)."""

    def test_no_fields_key_raises_422(self):
        with pytest.raises(HTTPException) as exc:
            validate_form_schema({})
        assert exc.value.status_code == 422

    def test_fields_not_list_raises_422(self):
        with pytest.raises(HTTPException) as exc:
            validate_form_schema({"fields": "not a list"})
        assert exc.value.status_code == 422

    def test_valid_schema_does_not_raise(self):
        validate_form_schema({"fields": [{"id": "name", "type": "text"}]})

    def test_invalid_schema_raises_422_with_details(self):
        with pytest.raises(HTTPException) as exc:
            validate_form_schema({"fields": [{"id": "f1", "type": "invisible"}]})
        assert exc.value.status_code == 422
        assert isinstance(exc.value.detail, list)


# ---------------------------------------------------------------------------
# §2.5 — GET /forms/{id}/versions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_form_versions_returns_sorted_list():
    """Endpoint returns versions ordered newest first with submission counts."""
    from app.db import get_db
    from app.auth import get_current_user
    from app.models.core import Form, FormVersion

    form = MagicMock(spec=Form)
    form.id = "form-abc"
    form.current_version_id = "v2"

    v1 = MagicMock(spec=FormVersion)
    v1.id = "v1"
    v1.version_num = 1
    v1.published_at = None

    v2 = MagicMock(spec=FormVersion)
    v2.id = "v2"
    v2.version_num = 2
    v2.published_at = "2026-01-01T00:00:00Z"

    mock_db = AsyncMock()

    # First call: get the form itself
    form_result = MagicMock()
    form_result.scalar_one_or_none.return_value = form

    # Second call: version list with submission counts
    row1 = (v2, 5)   # version, submission_count
    row2 = (v1, 0)
    versions_result = MagicMock()
    versions_result.all.return_value = [row1, row2]

    mock_db.execute = AsyncMock(side_effect=[form_result, versions_result])

    admin_user = MagicMock()
    admin_user.tenant_id = "t1"
    admin_user.role = "admin"

    async def override_db():
        yield mock_db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: admin_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/forms/form-abc/versions")

    api_v1.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["version_num"] == 2
    assert data[0]["submission_count"] == 5
    assert data[0]["is_current"] is True
    assert data[1]["version_num"] == 1
    assert data[1]["is_current"] is False


@pytest.mark.asyncio
async def test_list_form_versions_form_not_found_returns_404():
    from app.db import get_db
    from app.auth import get_current_user

    mock_db = AsyncMock()
    not_found = MagicMock()
    not_found.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(return_value=not_found)

    admin_user = MagicMock()
    admin_user.tenant_id = "t1"
    admin_user.role = "admin"

    async def override_db():
        yield mock_db

    api_v1.dependency_overrides[get_db] = override_db
    api_v1.dependency_overrides[get_current_user] = lambda: admin_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/forms/does-not-exist/versions")

    api_v1.dependency_overrides.clear()
    assert response.status_code == 404
