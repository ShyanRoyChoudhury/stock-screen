"""candles.price_basis default: the model and the migration agree on
fyers_adjusted. Pure/offline: the migration is rendered to SQL text, no DB."""

import importlib.util
import io
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.ingest import service
from app.models import PRICE_BASES, PRICE_BASIS_DEFAULT, Candle

MIGRATION = (Path(__file__).parent.parent / "alembic" / "versions"
             / "c85fe6dc94cf_candles_price_basis_default_fyers_adjusted.py")


def _load_migration():
    spec = importlib.util.spec_from_file_location("price_basis_default_migration", MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sql(step) -> str:
    """The SQL a migration step would emit on Postgres (offline mode)."""
    buf = io.StringIO()
    ctx = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buf})
    with Operations.context(ctx):
        step()
    return buf.getvalue()


def test_default_is_what_ingest_writes():
    assert PRICE_BASIS_DEFAULT == service.FYERS_BASIS == "fyers_adjusted"
    assert PRICE_BASIS_DEFAULT in PRICE_BASES


def test_candle_column_python_and_server_default():
    col = Candle.__table__.c.price_basis
    assert col.default.arg == PRICE_BASIS_DEFAULT
    assert str(col.server_default.arg) == PRICE_BASIS_DEFAULT


def test_migration_moves_the_server_default_both_ways_and_touches_no_data():
    mod = _load_migration()
    assert mod.down_revision == "c3d8f1a5e602"
    up, down = _sql(mod.upgrade), _sql(mod.downgrade)
    assert "ALTER TABLE candles ALTER COLUMN price_basis SET DEFAULT 'fyers_adjusted'" in up
    assert "ALTER TABLE candles ALTER COLUMN price_basis SET DEFAULT 'splits_only'" in down
    assert "UPDATE" not in up + down and "DELETE" not in up + down
