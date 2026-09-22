"""One-off migration: add candles.price_basis.

`Base.metadata.create_all()` only creates missing tables, never alters existing
ones, so a column added to the model needs this. Idempotent — safe to re-run.

Existing rows are stamped 'splits_only': the full backfill on 2026-09-22 was the
first to run with yfinance auto_adjust=False, so every stored row is on that
basis. Run this BEFORE starting the service with the new model.

Run: .venv/bin/python scripts/migrate_add_price_basis.py
"""

import sys

from sqlalchemy import text

sys.path.insert(0, ".")
from app.db import engine  # noqa: E402
from app.models import PRICE_BASIS_DEFAULT  # noqa: E402

with engine.begin() as conn:
    exists = conn.scalar(text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'candles' AND column_name = 'price_basis'
    """))
    if exists:
        print("price_basis already present — nothing to do")
    else:
        conn.execute(text(
            "ALTER TABLE candles ADD COLUMN price_basis VARCHAR(16) "
            f"NOT NULL DEFAULT '{PRICE_BASIS_DEFAULT}'"
        ))
        print(f"added candles.price_basis DEFAULT '{PRICE_BASIS_DEFAULT}'")

    counts = conn.execute(text(
        "SELECT price_basis, count(*) FROM candles GROUP BY 1 ORDER BY 2 DESC"
    )).all()
    for basis, n in counts:
        print(f"  {basis}: {n:,} rows")
