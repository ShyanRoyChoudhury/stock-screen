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
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --port 8000
```

For day-to-day operation (env, backups, scripts, every endpoint, troubleshooting), see [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

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

## Web UI

`ui/` is the front end (Vite + React + TypeScript), built to `docs/UI_HANDOFF.md`
and the design system vendored in `ui/design/`. It talks to this service through
the Vite dev proxy, so no CORS config is needed in development:

```bash
cd ui && npm install
npm run dev            # http://localhost:5173, proxies /api -> :8000
VITE_MOCK=1 npm run dev  # fixture positions/brokers, for screens the DB can't fill yet
```

Authenticated screens need an API key (`scripts/create_user.py` prints one);
paste it into Settings, or put it in `ui/.env.local` as `VITE_DEV_API_KEY`.
`npm run build` emits `ui/dist/`. A deployed build must be served from this
service's origin (or the service needs CORS middleware) — see §11 of the handoff
for the other gaps the UI works around.

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
- Prices are split-adjusted, dividend-unadjusted (yfinance `auto_adjust=False`).
- `ingest_runs` records every run's status, counts, and per-symbol errors.

## Daily job

`scripts/daily_sync.py` is the daily orchestration job: run it once after
the NSE close and it chains the whole pipeline for a trading day, in order:

1. **reap** — fail any `IngestRun` stuck in `status="running"` for 6h+ (a
   dead process's leftover row, which would otherwise 409-block every manual
   `/ingest`, `/indicators`, `/signals` POST — see `scripts/reap_stale_runs.py`).
2. **ingest** — incremental candle pull (`app.ingest.service.run_ingest`).
3. **indicators** — recompute indicators (`app.indicators.service.run_compute`).
4. **signals** — regenerate strategy signals (`app.signals.service.run_signals`).
5. **actions** — pull NSE corporate actions for a `[day-7, day+30]` window
   (`app.ingest.corporate_actions.load_actions`); failures here are a
   warning, not fatal.
6. **broker** — sync every active `BrokerAccount`, across all users
   (`app.brokers.service.sync_account`), one `IngestRun(mode="broker_sync")`
   row per invocation. **Groww's trades API only ever serves the current
   day** — if an account's sync fails with an auth error, that day's trades
   are gone for good and must be recovered manually via
   `POST /broker-accounts/{id}/import-tradebook`; the job's output says so
   explicitly per account.
7. **ledger** — fold newly-synced fills into positions
   (`app.positions.ledger.apply_unapplied_trades`).
8. **evaluate** — compute today's HOLD/PARTIAL/EXIT/REVIEW verdict for every
   open position (`app.positions.evaluator.evaluate_all`).

Steps 2-4 and 6-8 each isolate their own failures per symbol/account/position
and keep going; only a step that could not run at all fails the job. If
**ingest** itself fails, the rest of the pipeline still runs on the
previous day's candles (marked `degraded` in the summary) rather than
skipping signals/evaluation entirely.

Every run first calls `app.db.assert_schema_current` and refuses to do
anything if the DB isn't on the latest Alembic migration.

### Scheduling

Cron (crontab entry, any Linux box or a Mac kept awake/on IST):

```
15 16 * * 1-5 cd /path/to/stock-screen && .venv/bin/python scripts/daily_sync.py >> logs/daily_sync.log 2>&1
```

macOS launchd alternative: `scripts/launchd/com.stockscreen.daily-sync.plist`
is a template (see the comment at its top for install steps — substitute
your repo path with `sed`, copy to `~/Library/LaunchAgents/`, then
`launchctl load`). launchd fires `StartCalendarInterval` on the **machine's
local time**, not IST, so the Mac running it needs to be set to IST or the
Hour adjusted to match 15:45–16:15 IST in its own time zone.

### Options

```
--day YYYY-MM-DD       trading day to run for (default: last trading day)
--steps a,b,c           subset of reap,ingest,indicators,signals,actions,
                         broker,ledger,evaluate (default: all, in that order)
--symbols A,B            passthrough to ingest/indicators/signals, for a
                         quick smoke run instead of the full universe
--timeframes 1h,4h,1d    passthrough to ingest/indicators/signals (default: all)
--json                   print only the JSON summary (for scripting/alerting)
```

Fast smoke run with no market-data calls:

```bash
.venv/bin/python scripts/daily_sync.py --steps reap,actions,ledger,evaluate
```

Market-data steps on a couple of symbols only:

```bash
.venv/bin/python scripts/daily_sync.py --steps ingest,indicators,signals \
  --symbols RELIANCE,TCS --timeframes 1d
```

A stuck run can also be reaped standalone: `.venv/bin/python scripts/reap_stale_runs.py [--hours 6]`.

## Migrations

Schema changes go through Alembic (`alembic/`), not `create_all()`. To make
a change:

1. Edit `app/models.py`.
2. `.venv/bin/alembic revision --autogenerate -m "..."`
3. Review the generated file in `alembic/versions/` — autogenerate is a
   starting point, not the final word (it can miss things like data
   backfills, and needs a manual look whenever a table has `use_alter`
   foreign keys).
4. `.venv/bin/alembic upgrade head`

The app checks at startup that the DB is on the latest migration and
refuses to start otherwise (see `app/main.py`). An existing pre-Alembic
database — one whose tables were created by the old `create_all()` path —
is adopted by stamping it at the baseline revision instead of replaying
migrations against it: `.venv/bin/alembic stamp head`.
