import logging
from contextlib import asynccontextmanager

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import FastAPI
from sqlalchemy import text

from app.db import engine
from app.routers import (
    brokers,
    candles,
    corporate_actions,
    indicators,
    ingest,
    positions,
    signals,
    symbols,
    users,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema management is Alembic's job now (see alembic/). Startup only
    # verifies the DB is at the latest migration; it never applies one.
    alembic_cfg = Config("alembic.ini")
    script = ScriptDirectory.from_config(alembic_cfg)
    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        db_heads = set(context.get_current_heads())
    script_heads = set(script.get_heads())
    if db_heads != script_heads:
        raise RuntimeError(
            "database schema is not at the latest migration; run: "
            ".venv/bin/alembic upgrade head"
        )
    yield


app = FastAPI(title="NSE Market Data Service", version="0.1.0", lifespan=lifespan)
app.include_router(symbols.router)
app.include_router(ingest.router)
app.include_router(candles.router)
app.include_router(indicators.router)
app.include_router(signals.router)
app.include_router(corporate_actions.router)
app.include_router(users.router)
app.include_router(brokers.router)
app.include_router(positions.router)


@app.get("/health")
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}
