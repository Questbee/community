"""Add label to pairing_tokens for pre-named device pairing

Revision ID: 005
Revises: 004
Create Date: 2026-05-02

"""
import sqlalchemy as sa
from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("pairing_tokens", sa.Column("label", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("pairing_tokens", "label")
