"""add bar_checks

Revision ID: c3d8f1a5e602
Revises: b7c1e4a92f10
Create Date: 2026-10-05 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3d8f1a5e602'
down_revision: Union[str, Sequence[str], None] = 'b7c1e4a92f10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('bar_checks',
    sa.Column('symbol_id', sa.Integer(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('timeframe', sa.String(length=4), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=8), nullable=False),
    sa.Column('high_diff', sa.Float(), nullable=True),
    sa.Column('low_diff', sa.Float(), nullable=True),
    sa.Column('open_diff', sa.Float(), nullable=True),
    sa.Column('close_diff', sa.Float(), nullable=True),
    sa.Column('vol_diff_pct', sa.Float(), nullable=True),
    sa.Column('bar_count', sa.Integer(), nullable=True),
    sa.Column('note', sa.String(length=128), nullable=True),
    sa.Column('checked_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['symbol_id'], ['symbols.id'], ),
    sa.PrimaryKeyConstraint('symbol_id', 'day', 'timeframe')
    )
    op.create_index('ix_bar_checks_status_day', 'bar_checks', ['status', 'day'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_bar_checks_status_day', table_name='bar_checks')
    op.drop_table('bar_checks')
