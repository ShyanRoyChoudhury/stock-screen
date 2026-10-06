"""candles.price_basis server default -> fyers_adjusted

Every candle write is fyers_adjusted now (app.ingest.service.FYERS_BASIS), so
the column default must say the same. Schema only: existing rows keep their
price_basis (the Fyers cutover rewrites them), no data changes.

Revision ID: c85fe6dc94cf
Revises: c3d8f1a5e602
Create Date: 2026-10-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c85fe6dc94cf'
down_revision: Union[str, Sequence[str], None] = 'c3d8f1a5e602'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column('candles', 'price_basis',
               existing_type=sa.String(length=16),
               existing_nullable=False,
               server_default='fyers_adjusted')


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('candles', 'price_basis',
               existing_type=sa.String(length=16),
               existing_nullable=False,
               server_default='splits_only')
