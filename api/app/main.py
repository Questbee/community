import logging
import subprocess
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import AsyncSessionLocal
from app.routers import auth, export, forms, health, media, mobile, projects
from app.routers import settings as settings_router
from app.routers import submissions, users, api_keys, headless, webhooks

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "message": "%(message)s"}',
)
logger = logging.getLogger("questbee")

app = FastAPI(
    title="Questbee API",
    version="1.0.0",
    docs_url="/docs" if not settings.mcp_enabled else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000)
    logger.info(
        '{"method": "%s", "path": "%s", "status": %d, "duration_ms": %d}',
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


api_v1 = FastAPI(title="Questbee API v1")
api_v1.include_router(health.router, tags=["health"])
api_v1.include_router(auth.router, prefix="/auth", tags=["auth"])
api_v1.include_router(projects.router, prefix="/projects", tags=["projects"])
api_v1.include_router(forms.router, prefix="/forms", tags=["forms"])
api_v1.include_router(mobile.router, prefix="/mobile", tags=["mobile"])
api_v1.include_router(export.router, prefix="/submissions/export", tags=["export"])
api_v1.include_router(submissions.router, prefix="/submissions", tags=["submissions"])
api_v1.include_router(users.router, prefix="/users", tags=["users"])
api_v1.include_router(settings_router.router, prefix="/settings", tags=["settings"])
api_v1.include_router(api_keys.router, prefix="/api-keys", tags=["api-keys"])
api_v1.include_router(headless.router, prefix="/headless", tags=["headless"])
api_v1.include_router(media.router, prefix="/media", tags=["media"])
api_v1.include_router(webhooks.router, tags=["webhooks"])

app.mount("/api/v1", api_v1)


@app.on_event("startup")
async def startup():
    # Run migrations
    try:
        subprocess.run(["alembic", "upgrade", "head"], check=True, cwd="/app", capture_output=True)
        logger.info("Migrations applied")
    except Exception as e:
        logger.warning("Migration warning: %s", e)
    # Seed admin user
    async with AsyncSessionLocal() as db:
        from app.seed import seed_admin
        await seed_admin(db)
