import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.db import assert_schema_current, engine
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
    assert_schema_current(engine)
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
