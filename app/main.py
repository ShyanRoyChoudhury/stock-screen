import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.db import Base, engine
from app.routers import candles, indicators, ingest, signals, symbols

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # v1 schema management; switch to Alembic once the schema starts evolving.
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="NSE Market Data Service", version="0.1.0", lifespan=lifespan)
app.include_router(symbols.router)
app.include_router(ingest.router)
app.include_router(candles.router)
app.include_router(indicators.router)
app.include_router(signals.router)


@app.get("/health")
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}
