import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_health_returns_ok():
    from app.main import api_v1
    from app.db import get_db

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock()

    async def override_get_db():
        yield mock_session

    api_v1.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=api_v1), base_url="http://test"
    ) as client:
        response = await client.get("/health")

    api_v1.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
