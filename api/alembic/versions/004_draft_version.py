"""add draft_version_id to forms

Revision ID: 004
Revises: 003
Create Date: 2026-03-23

Separates the "live published version" (current_version_id) from an optional
"active draft" (draft_version_id).  This lets a draft coexist alongside the
published version so mobile devices and headless consumers always read the
published schema while the builder edits the draft independently.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "forms",
        sa.Column(
            "draft_version_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("form_versions.id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("forms", "draft_version_id")
