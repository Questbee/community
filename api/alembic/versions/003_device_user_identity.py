"""Add user identity to pairing/device tokens and revocation support

Revision ID: 003
Revises: 002
Create Date: 2026-03-21

"""
import sqlalchemy as sa
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # pairing_tokens: record which user generated the QR code
    op.add_column("pairing_tokens", sa.Column("user_id", sa.String(36), nullable=True))
    op.add_column("pairing_tokens", sa.Column("user_email", sa.String(255), nullable=True))

    # device_tokens: store user identity and allow revocation
    op.add_column("device_tokens", sa.Column("user_id", sa.String(36), nullable=True))
    op.add_column("device_tokens", sa.Column("user_email", sa.String(255), nullable=True))
    op.add_column("device_tokens", sa.Column("label", sa.String(255), nullable=True))
    op.add_column(
        "device_tokens",
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("device_tokens", "revoked")
    op.drop_column("device_tokens", "label")
    op.drop_column("device_tokens", "user_email")
    op.drop_column("device_tokens", "user_id")
    op.drop_column("pairing_tokens", "user_email")
    op.drop_column("pairing_tokens", "user_id")
