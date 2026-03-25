import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.auth import hash_password
from app.config import settings

logger = logging.getLogger("questbee")

async def seed_admin(db: AsyncSession) -> None:
    from app.models.core import Tenant, User
    result = await db.execute(select(Tenant))
    if result.scalar_one_or_none():
        return  # already seeded
    tenant = Tenant(name="Default Organization", slug="default")
    db.add(tenant)
    await db.flush()
    admin = User(
        tenant_id=tenant.id,
        email=settings.admin_email,
        password_hash=hash_password(settings.admin_password),
        role="admin",
        force_password_reset=True,
    )
    db.add(admin)
    await db.commit()
    logger.info("Seeded default tenant and admin user: %s", settings.admin_email)
