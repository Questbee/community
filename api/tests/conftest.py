"""
Shared test fixtures and environment setup.

Sets required environment variables before any app module is imported,
so pydantic-settings can populate Settings without a real .env file.
"""
import os

# Must be set before `app.config` is imported (happens at module collection time)
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
os.environ.setdefault("ADMIN_EMAIL", "admin@test.com")
os.environ.setdefault("ADMIN_PASSWORD", "test-password")
