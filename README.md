# NSE Market Data Service

FastAPI service that pulls Nifty 500 OHLCV data from Yahoo Finance into a
Dockerized Postgres, at three timeframes: **1h** (fetched), **4h** (derived —
Yahoo has no 4h interval; resampled session-anchored 09:15–13:15 / 13:15–15:30),
and **1d** (fetched). Extracted from `nifty500_scanner.ipynb`; the
calculation/signal layer comes next and will read candles from this DB.

## Run

```bash
docker compose up -d            # Postgres 16 on localhost:5433
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
```

## Typical flow

```bash
curl -X POST localhost:8000/symbols/refresh          # load Nifty 500 universe
curl -X POST localhost:8000/ingest/run \
  -H 'Content-Type: application/json' \
  -d '{"mode":"backfill"}'                           # full universe backfill (~10 min)
curl localhost:8000/ingest/runs/1                    # poll status
curl "localhost:8000/candles/RELIANCE?timeframe=4h&limit=10"
```

- `mode: "backfill"` — 730 days of 1h (Yahoo's cap) + 5 years of 1d.
- `mode: "incremental"` — refetches from 2 days before the last stored candle;
  upserts are idempotent, so re-runs and Yahoo revisions are safe. This is the
  call a daily cron will make later.
- Optional `"symbols": ["RELIANCE", ...]` restricts a run (useful for testing);
  `"timeframes": ["1h","4h","1d"]` restricts timeframes.

## Market closes / holidays

Two layers: `app/market_calendar.py` (exchange_calendars XBOM — the Indian
market calendar; NSE/BSE share holidays) answers "is today a trading day", and
ingestion treats "no new rows from the source" as a normal outcome, never an
error — so unlisted ad-hoc closures self-correct.

Still-forming candles are never stored: the current hour, the current 4h bin,
and today's daily bar are dropped until their end time (capped at the 15:30
session close) has passed.

## Data conventions

- `candles.ts` is the candle **start**, timezone-aware. Daily candles use
  09:15 IST (session open). Unique on `(symbol_id, timeframe, ts)`.
- Prices are split-adjusted (yfinance `auto_adjust=True`).
- `ingest_runs` records every run's status, counts, and per-symbol errors.
