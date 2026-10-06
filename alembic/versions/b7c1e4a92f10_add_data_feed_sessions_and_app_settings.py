"""add data_feed_sessions and app_settings

Revision ID: b7c1e4a92f10
Revises: 9d5140c06546
Create Date: 2026-10-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b7c1e4a92f10'
down_revision: Union[str, Sequence[str], None] = '9d5140c06546'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('data_feed_sessions',
    sa.Column('provider', sa.String(length=16), nullable=False),
    sa.Column('access_token_enc', sa.Text(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('logged_in_by_user_id', sa.Integer(), nullable=True),
    sa.Column('logged_in_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['logged_in_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('provider')
    )
    op.create_table('app_settings',
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('value', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('updated_by_user_id', sa.Integer(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('key')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('app_settings')
    op.drop_table('data_feed_sessions')
