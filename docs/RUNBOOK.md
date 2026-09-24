# Operations Runbook

Hands-on reference for running stock-screen from a terminal. Every endpoint,
flag, and field below is cross-checked against the code and, where marked
"Live", against a real run of the server on branch `feat/broker-positions`.

All commands assume CWD is the **repo root**
(`/Users/shyanroychoudhury/Desktop/stock-screen`), venv `.venv`.

---

## 1. Environment

`app/config.py`'s `Settings` reads `.env` via pydantic-settings
(`env_file=".env"`) — **relative to the process's current working
directory**, not the repo location. Always run `uvicorn`, `alembic`, and
`scripts/*.py` from the repo root, or `.env` (and its `BROKER_MASTER_KEY`,
DB URL, etc.) will silently not be picked up.

There is no `.env` file in the repo by default — copy the example first:

```bash
cp .env.example .env
```

All settings, in `app/config.py` order:

| `.env` key | Settings field | Default | Meaning |
|---|---|---|---|
| `DATABASE_URL` | `database_url` | `postgresql+psycopg://stockscreen:stockscreen@localhost:5433/stockscreen` | SQLAlchemy URL; matches `docker-compose.yml` |
| `HOURLY_BACKFILL_DAYS` | `hourly_backfill_days` | `728` | Days of 1h history to request. Sent as an explicit start date, not `period="730d"` — Yahoo resolves the period form to the listing date for recently-listed symbols and rejects it; 728 keeps margin under Yahoo's 730-day hourly cap |
| `DAILY_BACKFILL_PERIOD` | `daily_backfill_period` | `"5y"` | yfinance `period=` for daily backfill |
| `FETCH_DELAY_SECONDS` | `fetch_delay_seconds` | `0.5` | Sleep between per-symbol Yahoo fetches |
| `INCREMENTAL_OVERLAP_DAYS` | `incremental_overlap_days` | `2` | An incremental ingest re-fetches this many days before the last stored candle; the upsert dedupes and also picks up any Yahoo revisions |
| `BROKER_MASTER_KEY` | `broker_master_key` | unset (`None`) | Fernet key encrypting `broker_accounts.credentials_enc` / `access_token_enc`. Unset until generated; `app.brokers.crypto` raises `MasterKeyMissing` on first use |
| `GROWW_REQUEST_TIMEOUT` | `groww_request_timeout` | `30` | Timeout (seconds) for outbound Groww API calls |
| `MATCH_WINDOW_SESSIONS` | `match_window_sessions` | `5` | Trading sessions after a fill to search for a matching signal |
| `MATCH_MAX_PRICE_GAP_PCT` | `match_max_price_gap_pct` | `5.0` | Max % gap between a signal's entry and the fill price to still count as a match |
| `CHANDELIER_ATR_MULTIPLE` | `chandelier_atr_multiple` | `2.5` | ATR multiple for the chandelier trailing stop on matched positions |
| `SWING_REVIEW_AFTER_SESSIONS` | `swing_review_after_sessions` | `30` | Sessions an unmatched swing position runs before the evaluator flags it `HORIZON` |
| `UPCOMING_ACTION_WARN_SESSIONS` | `upcoming_action_warn_sessions` | `5` | Sessions ahead of an upcoming corporate action to start warning on it |

Generate `BROKER_MASTER_KEY` (needed before creating any broker account):

```bash
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Paste the output into `.env` as `BROKER_MASTER_KEY=...`, then restart uvicorn
so the new value is read.

---

## 2. Server

### Postgres (Docker)

```bash
docker compose up -d db           # postgres:16 as container `stockscreen-db`, localhost:5433
docker exec stockscreen-db pg_isready -U stockscreen -d stockscreen   # readiness check
docker compose stop                # stop; volume `stockscreen_pgdata` (data) is untouched
docker compose logs -f db          # or: docker logs -f stockscreen-db
```

`docker compose up -d` with no service name now starts the **API container
too** (§9). Name `db` explicitly when you want only Postgres and intend to
run uvicorn from the venv, or the two will both serve the same database.

### uvicorn

```bash
.venv/bin/uvicorn app.main:app --port 8000                                  # foreground, Ctrl-C to stop
nohup .venv/bin/uvicorn app.main:app --port 8000 > /tmp/uvicorn.log 2>&1 &   # background
kill $(pgrep -f "uvicorn app.main:app")                                     # stop a backgrounded instance
```

Health check (`GET /health`):

```bash
curl -sf localhost:8000/health
# -> {"status":"ok","database":"ok"}
```

Interactive API docs (Swagger UI, from the live `openapi.json`): `http://localhost:8000/docs`

### Startup schema check

`app/main.py`'s `lifespan` calls `app.db.assert_schema_current(engine)`
before the app finishes starting. It compares the DB's current Alembic
head(s) against `alembic/versions`' head(s) and, on mismatch, raises:

```
RuntimeError: database schema is not at the latest migration; run:
.venv/bin/alembic upgrade head
```

uvicorn will fail to start (crash with that traceback) until you run
`.venv/bin/alembic upgrade head`. The app **never** auto-applies a
migration — schema changes are Alembic's job only (see §3). The container
image runs `alembic upgrade head` in its entrypoint, *before* uvicorn, so a
deploy migrates itself; that is the entrypoint's doing, not the app's (§9).

---

## 3. Database

### psql

```bash
docker exec -it stockscreen-db psql -U stockscreen -d stockscreen
```

(Drop `-it` — use plain `docker exec stockscreen-db psql -U stockscreen -d
stockscreen -c "..."` — when running non-interactively, e.g. from a script
or a tool without a TTY.)

### Tables

`\dt` lists 14 tables (13 app tables + Alembic's own `alembic_version`):
`symbols`, `candles`, `corporate_actions`, `indicator_values`, `signals`,
`ingest_runs`, `users`, `broker_accounts`, `positions`, `broker_trades`,
`broker_holdings_snapshots`, `sell_allocations`, `position_evaluations`.

### Row counts per table

```sql
SELECT 'symbols' t, count(*) FROM symbols
UNION ALL SELECT 'candles', count(*) FROM candles
UNION ALL SELECT 'indicator_values', count(*) FROM indicator_values
UNION ALL SELECT 'signals', count(*) FROM signals
UNION ALL SELECT 'corporate_actions', count(*) FROM corporate_actions
UNION ALL SELECT 'ingest_runs', count(*) FROM ingest_runs
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'broker_accounts', count(*) FROM broker_accounts
UNION ALL SELECT 'positions', count(*) FROM positions
UNION ALL SELECT 'broker_trades', count(*) FROM broker_trades
UNION ALL SELECT 'broker_holdings_snapshots', count(*) FROM broker_holdings_snapshots
UNION ALL SELECT 'sell_allocations', count(*) FROM sell_allocations
UNION ALL SELECT 'position_evaluations', count(*) FROM position_evaluations;
```

Live: `candles`/`indicator_values` 2,682,081; `signals` 554,875;
`corporate_actions` 3,125; `symbols` 501; `ingest_runs` 10; `users` 1;
`broker_trades`/`broker_accounts`/`positions`/`sell_allocations`/
`broker_holdings_snapshots`/`position_evaluations` 0.

### Useful read queries

Latest daily candle per symbol:

```sql
SELECT DISTINCT ON (c.symbol_id) s.symbol, c.ts, c.close
FROM candles c JOIN symbols s ON s.id = c.symbol_id
WHERE c.timeframe = '1d'
ORDER BY c.symbol_id, c.ts DESC;
```

Last N ingest runs with status/message:

```sql
SELECT id, mode, status, message, started_at, finished_at
FROM ingest_runs ORDER BY id DESC LIMIT 10;
```

Open positions with symbol:

```sql
SELECT p.id, s.symbol, p.status, p.qty_open, p.avg_entry_price, p.last_verdict
FROM positions p JOIN symbols s ON s.id = p.symbol_id
WHERE p.status = 'open';
```

Today's evaluations with verdict/reasons:

```sql
SELECT pe.position_id, pe.verdict, pe.reasons, pe.warnings
FROM position_evaluations pe
WHERE pe.as_of = CURRENT_DATE;
```

A symbol's corporate actions:

```sql
SELECT ca.* FROM corporate_actions ca
JOIN symbols s ON s.id = ca.symbol_id
WHERE s.symbol = 'RELIANCE'
ORDER BY ca.ex_date DESC;
```

`price_basis` distribution (should be entirely `splits_only` — see
`app/models.py`'s `PRICE_BASES`):

```sql
SELECT price_basis, count(*) FROM candles GROUP BY price_basis ORDER BY 1;
```

Live output: `splits_only | 2682081` (only basis in use).

### Alembic

Baseline revision (current head, `down_revision = None`): **`9d5140c06546`**
— *"baseline: full schema as of broker/positions phase 1"*.

| Command | When to use |
|---|---|
| `.venv/bin/alembic current` | Show the DB's current revision |
| `.venv/bin/alembic check` | Fail if `app/models.py` has un-migrated changes (CI-style check, no DB write) |
| `.venv/bin/alembic upgrade head` | Apply all pending migrations — run this after every `git pull` that touches `app/models.py` or `alembic/versions/` |
| `.venv/bin/alembic downgrade -1` | Roll back the single most recent migration |
| `.venv/bin/alembic history` | List all revisions in order |
| `.venv/bin/alembic revision --autogenerate -m "..."` | Generate a new migration after editing `app/models.py`. Always review the generated file — autogenerate misses data backfills and needs a manual look for any `use_alter` foreign key (see `Position.entry_trade_id`/`exit_trade_id`) |
| `.venv/bin/alembic stamp head` | Mark an existing pre-Alembic DB (tables created by the old `create_all()` path) as being at head, without replaying migrations against it |

### Backup and restore

```bash
docker exec stockscreen-db pg_dump -U stockscreen stockscreen > backup.sql
cat backup.sql | docker exec -i stockscreen-db psql -U stockscreen -d stockscreen   # restore
```

### ⚠️ Full reset

```bash
docker compose down -v
docker compose up -d
.venv/bin/alembic upgrade head
```

**Destroys:** the `stockscreen_pgdata` Docker volume and every row in every
table — all candles, indicators, signals, ingest run history, corporate
actions, users, broker accounts/credentials, trades, positions, and
evaluations. There is no undo short of a `pg_dump` backup taken beforehand.

---

## 4. Scripts

All scripts insert the repo root onto `sys.path` themselves (`sys.path.insert(0,
".")`), but still need to be run with the repo root as CWD so `.env`
resolves (see §1).

### `scripts/create_user.py`

Creates a `User` row and prints its raw API key exactly once (only the
sha256 hash is stored — `app/auth.py`; if the key is lost, the only
recovery is creating a new one).

```bash
.venv/bin/python scripts/create_user.py --name <name> [--email <email>]
```

| Flag | Default | Notes |
|---|---|---|
| `--name` | required | |
| `--email` | none | If given and already in use, the script prints the existing user's id and exits 1 without creating a duplicate |

Expected output:

```
created user id=1 name='Shyan' email=None

API key (shown once, cannot be recovered): sk_...
```

Exit codes: `0` on success (or nothing to do), `1` if `--email` collides
with an existing user.

### `scripts/daily_sync.py`

The daily orchestration job — chains the whole pipeline for one trading
day, in order: **reap → ingest → indicators → signals → actions → broker →
ledger → evaluate**. Calls `app.db.assert_schema_current` first and refuses
to run at all if the DB isn't on the latest migration.

```bash
.venv/bin/python scripts/daily_sync.py
```

| Flag | Default | Notes |
|---|---|---|
| `--day YYYY-MM-DD` | last trading day | Trading day to run for |
| `--steps a,b,c` | all, in `STEP_ORDER` | Subset of `reap,ingest,indicators,signals,actions,broker,ledger,evaluate` (always executed in that canonical order regardless of the order typed) |
| `--symbols A,B` | full active universe | Passthrough to ingest/indicators/signals; upper-cased |
| `--timeframes 1h,4h,1d` | all three | Passthrough to ingest/indicators/signals |
| `--json` | off | Print only the JSON summary (for scripting/alerting) |

Two smoke-run forms:

```bash
.venv/bin/python scripts/daily_sync.py --steps reap,actions,ledger,evaluate   # fast, no market-data calls
.venv/bin/python scripts/daily_sync.py --steps ingest,indicators,signals \
  --symbols RELIANCE,TCS --timeframes 1d                                      # market data, 2 symbols
```

| # | Step | What it does | Fatal to the job? |
|---|---|---|---|
| 1 | `reap` | Fails any `IngestRun` stuck `status="running"` for 6h+ (dead process) — see `scripts/reap_stale_runs.py` | no (always `ok`) |
| 2 | `ingest` | Incremental candle pull (`app.ingest.service.run_ingest`) | no — the rest of the pipeline still runs on yesterday's candles, marked `degraded` in the summary |
| 3 | `indicators` | Recompute indicators (`app.indicators.service.run_compute`) | no |
| 4 | `signals` | Regenerate strategy signals (`app.signals.service.run_signals`) | no |
| 5 | `actions` | Pull NSE corporate actions for `[day-7, day+30]` (`app.ingest.corporate_actions.load_actions`) | no — a failure here is always a `warning` (NSE's site can 403/timeout independently of everything else) |
| 6 | `broker` | Sync every active `BrokerAccount` across all users (`app.brokers.service.sync_account`), one `IngestRun(mode="broker_sync")` row per invocation | no |
| 7 | `ledger` | Fold newly-synced fills into positions (`app.positions.ledger.apply_unapplied_trades`) | no |
| 8 | `evaluate` | Compute today's HOLD/PARTIAL/EXIT/REVIEW verdict for every open position (`app.positions.evaluator.evaluate_all`) | **yes**, if the step itself crashes (not if individual positions error) |

"warning" vs "failed" vs `DEGRADED`:

| Status | Meaning |
|---|---|
| `ok` | The step ran clean. |
| `warning` | The step *completed* but something inside it was imperfect: a worker step (`ingest`/`indicators`/`signals`) finished with `symbols_failed > 0`, or `ledger`/`evaluate`/`broker` recorded per-item errors. Does **not** fail the job. |
| `failed` | The step could not complete at all (worker `IngestRun` status is `"failed"`, or the step function raised and was caught by `main()`'s per-step try/except). **Only a `failed` step makes the job exit non-zero** (`exit_code_for`). |
| `DEGRADED` (summary header, not a step status) | Set only when the `ingest` step's own status is `failed`; signals/evaluation ran against stale (yesterday's) candles rather than being skipped. |

Output (non-`--json`): `daily_sync 2026-09-22 [DEGRADED: ingest failed]` header,
then one `  STATUS   step        message` line per step, then
`  counts: {'ok': N, 'warning': N, 'failed': N}`. Exit `0` unless any step
is `failed`, else `1`.

### `scripts/reap_stale_runs.py`

Fails any `IngestRun` stuck `status="running"` because its process died —
the release valve for the 409 "already in progress" guard shared by
`/ingest/run`, `/indicators/run`, `/signals/run` (they all check for *any*
row with `status == "running"`, regardless of mode).

```bash
.venv/bin/python scripts/reap_stale_runs.py [--hours 6]
```

`--hours` (default `6.0`): age threshold; only runs `started_at` older than
this are reaped. Output: `reaped N stale run(s): [ids]` or `no stale runs
found`. Exit code always `0`.

### `scripts/validate.py`

Validates ingested candle data, two layers:

- **Layer 1 — internal consistency, full dataset** (every row, not
  sampled): OHLC invariants; no candles on non-trading days (XBOM
  calendar); every stored 4h candle equals the aggregate of its 1h
  constituents (no orphan 4h rows); symbols with daily data but no hourly.
- **Layer 2 — external validation, sampled**: daily candles vs NSE's
  official bhavcopy for the latest trading day and ~3 weeks back (15
  symbols each), with a split-ratio lookup to exempt legitimate divergences
  from a split/bonus since the sampled date.

```bash
.venv/bin/python scripts/validate.py    # no flags; exit 0 all pass, 1 if any FAIL
```

**Known false FAIL during market hours:** the Layer-1 "4h candles =
aggregate of 1h constituents" check aggregates *all* stored 1h candles into
their 4h bins and left-joins against the `candles` 4h rows, counting any
bin with no matching 4h row as `missing_4h`. During market hours, the
*current* (still-forming) 4h bin already has its constituent 1h candles
stored, but ingestion deliberately withholds the 4h candle itself until the
bin's end time has passed (`app/ingest/service.py` / README's "Still-forming
candles are never stored" rule) — so that one bin always shows as missing
until after 13:15 or 15:30 IST. Re-run after the relevant bin has closed, or
disregard a `FAIL` confined to today's still-open bin.

### `scripts/verify_indicators.py` / `scripts/verify_signals.py`

Parity checks: run `app.indicators.*` / `app.signals.core` side by side
with verbatim, unmodified copies of the source gist code on real DB candle
data, and assert every output is identical. No CLI flags.

```bash
.venv/bin/python scripts/verify_indicators.py
.venv/bin/python scripts/verify_signals.py
```

Output: a `[PASS]`/`[FAIL]` line per indicator/strategy, then `RESULT: all
implementations are exactly identical to the gist code` (or `... emit
output identical to the gist`). Exit `1` on any parity failure, else `0`.

### Scheduling

Cron (any Linux box, or a Mac kept awake/on IST):

```
15 16 * * 1-5 cd /path/to/stock-screen && .venv/bin/python scripts/daily_sync.py >> logs/daily_sync.log 2>&1
```

launchd (`scripts/launchd/com.stockscreen.daily-sync.plist`, a template —
`{REPO}` is a literal placeholder, not resolved by launchd):

```bash
sed 's|{REPO}|/absolute/path/to/stock-screen|g' \
  scripts/launchd/com.stockscreen.daily-sync.plist \
  > ~/Library/LaunchAgents/com.stockscreen.daily-sync.plist   # 1. substitute the repo path
mkdir -p /absolute/path/to/stock-screen/logs                  # 2. launchd won't create this itself
launchctl load ~/Library/LaunchAgents/com.stockscreen.daily-sync.plist   # 3. load it
# reinstall after edits: launchctl unload <plist>, then load again
# run once immediately, to verify: launchctl start com.stockscreen.daily-sync
```

The plist fires `StartCalendarInterval` weekdays at **16:15 in the
machine's local time zone**, not IST — that only lands at 15:45–16:15 IST
if the Mac itself is set to Asia/Kolkata; otherwise adjust `Hour`/`Minute`
or run it from a box that is on IST.

A stuck run can also be reaped standalone:
`.venv/bin/python scripts/reap_stale_runs.py [--hours 6]`.

---

## 5. API — open endpoints (no auth)

Base URL: `http://localhost:8000`. All confirmed against a live
`/openapi.json` diffed against every endpoint in this document (see
end of file).

### symbols (`app/routers/symbols.py`)

| Method + path | Params | Response | Status codes |
|---|---|---|---|
| `GET /symbols` | query `active_only: bool = true` | list of `SymbolOut`: `id, symbol, name, industry, isin, active` | 200 |
| `POST /symbols/refresh` | none | `{"fetched": int, "created": int, "updated": int}` (pulls the Nifty 500 list from NSE; falls back to a small static list if NSE blocks the request) | 200 |

```bash
curl -s "localhost:8000/symbols?active_only=true" | python3 -m json.tool
```
Live (trimmed to 2 of 501):
```json
[
  {"id": 1, "symbol": "360ONE", "name": "360 ONE WAM Ltd.", "industry": "Financial Services", "isin": "INE466L01038", "active": true},
  {"id": 2, "symbol": "3MINDIA", "name": "3M India Ltd.", "industry": "Diversified", "isin": "INE470A01017", "active": true}
]
```

### ingest (`app/routers/ingest.py`)

| Method + path | Params | Response | Status codes |
|---|---|---|---|
| `POST /ingest/run` | body `IngestRequest` | `IngestRunOut` | 202 accepted (runs in a `BackgroundTasks` worker); 422 bad `mode`/`timeframes`; 409 a run is already in progress |
| `GET /ingest/runs` | query `limit: int = 20` | list of `IngestRunOut` | 200 |
| `GET /ingest/runs/{run_id}` | path `run_id: int` | `IngestRunOut` | 200; 404 not found |

`IngestRequest` body fields: `mode: str = "incremental"` (must be
`"backfill"` or `"incremental"`), `timeframes: list[str] = ["1h","4h","1d"]`
(each must be one of `TIMEFRAMES = ("1h","4h","1d")`), `symbols: list[str]
| None = None` (optional subset; unknown symbols are auto-created as new
`Symbol` rows).

- `mode="backfill"` — 728 days of 1h (`HOURLY_BACKFILL_DAYS`) + `5y`
  (`DAILY_BACKFILL_PERIOD`) of 1d.
- `mode="incremental"` — refetches from `INCREMENTAL_OVERLAP_DAYS` (2) days
  before the last stored candle; upserts are idempotent.

`IngestRunOut` fields: `id, mode, status, timeframes, symbols_total,
symbols_ok, symbols_failed, candles_written, message, errors, started_at,
finished_at`.

The 409 (`"Ingest run {id} is already in progress"`) fires whenever any
`IngestRun` row (any mode — ingest/indicators/signals all share this guard)
has `status == "running"`. Clear a dead one with
`.venv/bin/python scripts/reap_stale_runs.py`.

```bash
curl -X POST localhost:8000/ingest/run -H 'Content-Type: application/json' \
  -d '{"mode":"incremental","symbols":["RELIANCE"],"timeframes":["1d"]}'
```

```bash
curl -s "localhost:8000/ingest/runs?limit=3" | python3 -m json.tool
```
Live (first of 3):
```json
{
  "id": 12, "mode": "signals", "status": "completed",
  "timeframes": ["1d"], "symbols_total": 2, "symbols_ok": 2,
  "symbols_failed": 0, "candles_written": 551,
  "message": "2/2 symbols ok, 551 signals written", "errors": [],
  "started_at": "2026-09-22T14:25:32.883779Z",
  "finished_at": "2026-09-22T14:25:33.207264Z"
}
```

### candles (`app/routers/candles.py`)

| Method + path | Params | Response | Status codes |
|---|---|---|---|
| `GET /candles/{symbol}` | path `symbol: str`; query `timeframe: str = "1d"` (pattern `^(1h|4h|1d)$`), `start: datetime \| None`, `end: datetime \| None`, `limit: int = 500` (max 10000) | list of `CandleOut`, oldest → newest | 200; 404 unknown symbol; 422 bad timeframe |

`CandleOut` fields: `ts, timeframe, open, high, low, close, volume`.

```bash
curl -s "localhost:8000/candles/RELIANCE?timeframe=1d&limit=2" | python3 -m json.tool
```
Live:
```json
[
  {"ts": "2026-09-21T03:45:00Z", "timeframe": "1d", "open": 1234.0999755859375, "high": 1249.0999755859375, "low": 1232.5, "close": 1247.4000244140625, "volume": 10007218},
  {"ts": "2026-09-22T03:45:00Z", "timeframe": "1d", "open": 1247.5999755859375, "high": 1251.9000244140625, "low": 1237.4000244140625, "close": 1240.4000244140625, "volume": 10681733}
]
```

(`ts` is the candle **start**; a `1d` bar's `ts` of `03:45:00Z` is
`09:15:00` IST, the session open — see `docs/`'s data-conventions notes.)

### indicators (`app/routers/indicators.py`)

| Method + path | Params | Response | Status codes |
|---|---|---|---|
| `POST /indicators/run` | body `ComputeRequest {timeframes, symbols}` (both optional, default all/full universe) | `IngestRunOut` (mode `"indicators"`) | 202; 422 bad timeframe; 409 a run is in progress |
| `GET /indicators/{symbol}` | path `symbol`; query `timeframe="1d"`, `start`, `end`, `limit=500` (max 10000) | list of dicts, one per bar (no `response_model` — every `IndicatorValue` column except `id`/`symbol_id`) | 200; 404 unknown symbol |

`GET /indicators/{symbol}` response fields per row: `timeframe, ts, atr_10,
supertrend_10_3, supertrend_dir, macd_12_26, macd_signal_9, macd_hist,
ema_50, ema_200, adx_14, bb_upper_20_2, bb_middle_20_2, bb_lower_20_2,
bb_bandwidth, volume_ma_20, kc_upper_20_15, kc_middle_20, kc_lower_20_15,
ttm_squeeze_on, ttm_squeeze_off, ttm_momentum, rvol_20, computed_at`.

```bash
curl -s "localhost:8000/indicators/RELIANCE?timeframe=1d&limit=1" | python3 -m json.tool
```

### signals (`app/routers/signals.py`)

| Method + path | Params | Response | Status codes |
|---|---|---|---|
| `POST /signals/run` | body `SignalRunRequest {timeframes, symbols, strategies}` (all optional) | `IngestRunOut` (mode `"signals"`) | 202; 422 bad timeframe/strategy; 409 a run is in progress |
| `GET /signals` | query `symbol`, `strategy`, `timeframe`, `since: datetime`, `limit=200` (max 5000) | list of signal dicts | 200 |
| `GET /signals/fresh` | query `days: int = 3` (1–30), `strategy`, `timeframe` | list of signal dicts | 200 |

Valid `strategy` values (`app.signals.core.STRATEGY_FUNCS`): `PIPELINE`,
`S1_ST_Flip`, `S2_MACD_Zero`, `S3_BB_Squeeze`, `Confluence`, `TTM_Squeeze`.

Signal dict fields: `symbol, strategy, timeframe, ts, entry_mode, entry,
stop_loss, target_1, target_2, risk_pct, rr_ratio, details`.

`/signals/fresh`'s `days` semantics: `since = now_ist() - timedelta(days=days)`
— a **wall-clock** window (calendar days back from the current IST instant),
not a count of trading sessions, and it is **not** capped to `timeframe=1d`
bars — a 3-day window can include several 1h/4h signals per symbol.

```bash
curl -s "localhost:8000/signals/fresh?days=3&timeframe=1d" | python3 -m json.tool
```
Live (1 of 72 — trimmed):
```json
{
  "symbol": "3MINDIA", "strategy": "S1_ST_Flip", "timeframe": "1d",
  "ts": "2026-09-21T03:45:00+00:00", "entry_mode": null,
  "entry": 34725.0, "stop_loss": 31233.75, "target_1": 37155.75,
  "target_2": 38892.0, "risk_pct": 10.05, "rr_ratio": null,
  "details": {"vol_ratio": 1.15, "supertrend": 31390.7}
}
```

### corporate-actions (`app/routers/corporate_actions.py`)

| Method + path | Params | Response | Status codes |
|---|---|---|---|
| `POST /corporate-actions/load` | body `CorporateActionLoadRequest {from_date, to_date, symbols}` (default: today − 5y to today) | `{"written", "unparsed", "unknown_symbol", ...}` (see `app.ingest.corporate_actions.load_actions`) | 200; 422 `from_date` after `to_date`; 502 NSE fetch failed |
| `GET /corporate-actions` | query `symbol`, `action_type` (must be in `ACTION_TYPES`), `limit=50` (max 500) | list of action dicts | 200; 422 bad `action_type` |

`ACTION_TYPES = ("dividend", "split", "bonus", "rights", "demerger")`.

Action dict fields: `symbol, action_type, ex_date, record_date, value,
ratio_from, ratio_to, price_factor, is_extraordinary, affects_share_count,
subject`.

```bash
curl -s "localhost:8000/corporate-actions?symbol=RELIANCE" | python3 -m json.tool
```
Live (1 of 7):
```json
{
  "symbol": "RELIANCE", "action_type": "dividend", "ex_date": "2026-06-05",
  "record_date": "2026-06-05", "value": 6.0, "ratio_from": null,
  "ratio_to": null, "price_factor": null, "is_extraordinary": false,
  "affects_share_count": false, "subject": "Dividend - Rs 6 Per Share"
}
```

---

## 6. API — authenticated endpoints

All routes below require an `X-API-Key: <key>` header (`app/auth.py`'s
`get_current_user`). The raw key is printed **once**, by
`scripts/create_user.py`, and never stored — only its sha256 hash lands in
`users.api_key_hash`.

| Failure | Status | Message |
|---|---|---|
| Header absent | 401 | `missing API key` |
| Header present but no active user matches its hash | 401 | `invalid API key` |

```bash
export API_KEY=sk_...   # from create_user.py's one-time output
curl -s localhost:8000/me -H "X-API-Key: $API_KEY"
```

### `/me` (`app/routers/users.py`)

| Method + path | Response |
|---|---|
| `GET /me` | `UserOut`: `id, name, email, created_at` |

### `/broker-accounts` (`app/routers/brokers.py`)

`BROKERS = ("groww", "zerodha")`. Only `groww` has a registered client
(`app/brokers/groww.py`'s `@register("groww")`) — `zerodha` will 501 on
`/test` and `/sync`.

| Method + path | Params | Notes |
|---|---|---|
| `POST /broker-accounts` | body `BrokerAccountCreate {broker, label, api_key, totp_secret}` | 422 `broker` not in `BROKERS`; 503 `BROKER_MASTER_KEY` unset (`MasterKeyMissing`); 409 duplicate `(user, broker, label)`. Response `BrokerAccountOut` (201) |
| `GET /broker-accounts` | — | list of `BrokerAccountOut`, this user's accounts only |
| `DELETE /broker-accounts/{account_id}` | path `account_id` | **Deactivates** (`active=False`), does not delete the row. Returns the updated `BrokerAccountOut`. 404 not owned/not found |
| `POST /broker-accounts/{account_id}/test` | path `account_id` | Calls `authenticate()` + `fetch_holdings()`. `{"ok": true, "holdings": N}`. 501 no client registered for that `broker`; 502 `broker call failed: {e}` |
| `POST /broker-accounts/{account_id}/sync` | body `SyncRequest {day: date \| None}` (default: last trading day) | Runs `sync_account` — see §7 for what it does |
| `POST /broker-accounts/sync-all` | — | Syncs every active account for this user; per-account try/except, `{"accounts": N, "results": [...]}` |
| `POST /broker-accounts/{account_id}/import-tradebook` | multipart `file` (CSV) | See CSV contract below |
| `GET /broker-accounts/trades` | query `from_date`, `to_date`, `symbol` | list of `TradeOut` |

`BrokerAccountOut` fields: `id, broker, label, active, last_sync_on,
last_sync_status, last_sync_message, created_at`.

`TradeOut` fields: `id, broker, tradingsymbol, symbol, isin, side,
quantity, price, trade_ts, trade_date, position_id, applied_at`.

**Tradebook CSV contract** (`app.brokers.service.import_tradebook_csv` /
`upsert_trades`), column matching is case-insensitive and by header name:

| Field | Accepted header(s) | Required | Default / parsing |
|---|---|---|---|
| trade date | `trade_date`, `date` | yes | Parsed as `%Y-%m-%d` or `%d-%m-%Y`; 422 on anything else |
| symbol / isin | `symbol`, `isin` | at least one | `symbol` (upper-cased) or `isin` used as the lookup key; whichever is present becomes `tradingsymbol` |
| side | `side`, `trade_type` | yes | Upper-cased; must be `BUY` or `SELL` (`TRADE_SIDES`), else 422 |
| quantity | `quantity` | yes | `int(float(...))` |
| price | `price` | yes | `float(...)` |
| exchange | `exchange` | no | default `"NSE"`, upper-cased |
| segment | `segment` | no | default `"CASH"`, upper-cased |
| product | `product` | no | default `"CNC"`, upper-cased |
| time | `time` | no | default `"15:29"`; parsed as `HH:MM`, combined with the trade date in IST |
| trade id | `trade_id` | no | if absent, synthesized as `"csv:" + sha1(f"{trade_date}|{symbol}|{side}|{quantity}|{price}|{row_idx}")[:16]` — so two truly-identical rows in the same file get distinct ids (row index is part of the hash) |

Response: `{"rows": N, "upserted": N, "unmapped": [symbols], "ledger":
{...}}`. `unmapped` lists tradingsymbols that didn't match an existing
`Symbol` by ISIN or ticker and were auto-created.

```bash
curl -s -X POST localhost:8000/broker-accounts/1/import-tradebook \
  -H "X-API-Key: $API_KEY" -F "file=@tradebook.csv"
```

### `/positions` (`app/routers/positions.py`)

| Method + path | Params | Notes |
|---|---|---|
| `GET /positions` | query `status` (must be in `POSITION_STATUSES = ("open","closed")` if given) | list of `PositionOut`, this user's positions |
| `GET /positions/{position_id}` | path | `PositionOut`. 404 not owned/not found |
| `GET /positions/evaluations` | query `as_of: date` (default: last trading day) | list of `EvaluationOut` for that day, this user |
| `POST /positions/evaluate` | body `EvaluateRequest {as_of: date \| None}` | Runs `evaluate_all` for this user; `{"as_of", "evaluated", "by_verdict", "errors"}` |
| `GET /positions/{position_id}/evaluations` | path | Full evaluation history for one position, newest first |
| `POST /positions/{position_id}/match` | body `MatchRequest {strategy, ts}` | Manually matches a position to a specific `Signal` row (`timeframe="1d"`); 404 no matching signal |
| `POST /positions/trades/{sell_id}/reattribute` | body `ReattributeRequest {allocations: [{position_id, quantity}]}` | Manually reassign a SELL's `SellAllocation`s; 422 (from a `ValueError`) on an invalid reallocation; 404 trade not found/not owned |

`PositionOut` fields: `id, user_id, broker_account_id, symbol_id, symbol,
status, opened_on, entry_trade_id, qty_open, qty_total, avg_entry_price,
avg_entry_price_raw, structural_factor_applied, last_restated_on,
matched_strategy, matched_signal_ts, matched_timeframe, match_confidence,
match_reason, is_unmatched, frozen_entry, frozen_stop, frozen_target_1,
frozen_target_2, frozen_details, closed_on, exit_trade_id, realized_pnl,
realized_pnl_pct, last_evaluated_on, last_verdict, created_at, updated_at,
latest_evaluation`.

`EvaluationOut` fields: `position_id, as_of, bar_ts, close, high, low,
stop_level, trail_level, target_1, target_2, supertrend_dir, atr, verdict,
reasons, warnings, unrealized_pnl_pct, days_held`.

```bash
curl -s "localhost:8000/positions?status=open" -H "X-API-Key: $API_KEY"
```

#### Verdict vocabulary (`VERDICTS`, `app/positions/evaluator.py: decide()`)

| Verdict | Meaning |
|---|---|
| `HOLD` | No exit/review condition fired — default when nothing else matches |
| `PARTIAL` | First target (`frozen_target_1`) hit on a matched position — take partial profit |
| `EXIT` | Stop, trail, supertrend flip, or second target hit — close the position |
| `REVIEW` | No candle data, a demerger in the holding window, or a fractional-share quantity mismatch — needs a human look, not an automated verdict |

`decide()` evaluates rules **in this fixed order**; every rule whose
condition is true appends its reason code, but only the *first* one sets
the verdict (later-firing rules still show up in `reasons` for context).
Precedence (first-wins) and reason codes:

| Order | Reason code | Sets verdict | Fires when |
|---|---|---|---|
| — | `NO_DATA` | `REVIEW` (short-circuits everything else) | No candle exists on/before `as_of` for this position's symbol |
| 1 | `DEMERGER_CLIFF` | `REVIEW` | A `demerger` corporate action's `ex_date` falls between the position's `opened_on` and `as_of` — stored prices aren't demerger-adjusted, so levels are unreliable |
| 2 | `QTY_MISMATCH` | `REVIEW` | `qty_total * structural_factor_applied` isn't (nearly) an integer — a split/bonus restatement left a fractional share count |
| 3 | `STOP_HIT` | `EXIT` | `close < stop_level` (effective stop: `frozen_stop` if matched, else the chandelier `trail`) |
| 4 | `SUPERTREND_FLIP` | `EXIT` | Daily Supertrend direction is `-1` |
| 5 | `TRAIL_HIT` | `EXIT` | `close < trail` **and** the trail is a level distinct from the effective stop (for an unmatched position the trail *is* the stop, so this would just duplicate `STOP_HIT`) |
| 6 | `T2_HIT` | `EXIT` | Matched position, `close >= frozen_target_2` |
| 7 | `T1_HIT` | `PARTIAL` | Matched position, `close >= frozen_target_1` |
| — | *(none fired)* | `HOLD` | default |

Warning codes (`app/positions/evaluator.py: decide()` — never change the
verdict):

| Warning code | Fires when |
|---|---|
| `LOW_BREACH` | Intraday `low` dipped below the stop but `close` recovered above it (`low < stop_level <= close`) |
| `VOLUME_DIVERGENCE` | `app.indicators.core.check_volume_divergence` flags the recent bar |
| `UPCOMING_ACTION` | A corporate action's `ex_date` falls within `UPCOMING_ACTION_WARN_SESSIONS` sessions ahead — includes a reminder that the broker may cancel a GTT order across the ex-date |
| `QTY_DIFFERS_FROM_BROKER` | Broker holdings quantity (from the latest `BrokerHoldingSnapshot`) differs from the summed open platform quantity for that symbol/account, **and** `days_held >= 2` (settlement lag — a fresh BUY doesn't appear in broker holdings until T+1/T+2, so this is suppressed before then) |
| `HORIZON` | `days_held > SWING_REVIEW_AFTER_SESSIONS` (default 30) |
| `STALE_BAR` | The latest available candle is older than `as_of` (data hasn't caught up) |

---

## 7. Common flows

### First-time setup, end to end

```bash
cp .env.example .env
# generate & paste BROKER_MASTER_KEY into .env (see §1)
docker compose up -d
.venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --port 8000 &

curl -X POST localhost:8000/symbols/refresh
curl -X POST localhost:8000/ingest/run -H 'Content-Type: application/json' \
  -d '{"mode":"backfill"}'                    # full universe, ~10 min
curl localhost:8000/ingest/runs/1              # poll status

.venv/bin/python scripts/create_user.py --name "Shyan" --email you@example.com
# -> save the printed API key
```

### Daily manual run (instead of cron/launchd)

```bash
.venv/bin/python scripts/daily_sync.py
# or, machine-readable:
.venv/bin/python scripts/daily_sync.py --json
```

### Backfilling history from a broker CSV

```bash
curl -X POST "localhost:8000/broker-accounts/1/import-tradebook" \
  -H "X-API-Key: $API_KEY" -F "file=@tradebook.csv"
```
Check the response's `unmapped` list — any tradingsymbol not resolved to an
existing `Symbol` was auto-created; backfill its candles separately (see
below) before the evaluator can price it.

### Checking why a position got EXIT

```bash
curl -s "localhost:8000/positions/42" -H "X-API-Key: $API_KEY" | python3 -m json.tool
# .latest_evaluation.reasons -> e.g. [{"code":"STOP_HIT","detail":"close 1180 < stop 1200"}]

curl -s "localhost:8000/positions/42/evaluations" -H "X-API-Key: $API_KEY"
# full day-by-day history
```

### Re-running evaluation for a past date

```bash
curl -X POST localhost:8000/positions/evaluate -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' -d '{"as_of":"2026-09-15"}'
```
(Re-running a day overwrites that day's `PositionEvaluation` row — `UNIQUE
(position_id, as_of)` — rather than accumulating duplicates.)

### Adding a symbol that is not in the Nifty 500

There is no direct "create symbol" endpoint. Passing an unknown ticker in
`POST /ingest/run`'s `symbols` list auto-creates the `Symbol` row on demand
(`app.ingest.service._resolve_symbols`):

```bash
curl -X POST localhost:8000/ingest/run -H 'Content-Type: application/json' \
  -d '{"mode":"backfill","symbols":["YOURTICKER"]}'
```
Follow with `POST /indicators/run` and `POST /signals/run` scoped to that
symbol (or just let the next `daily_sync.py` pick it up, since it defaults
to the full active universe).

---

## 8. Troubleshooting

| Symptom | Cause | Command |
|---|---|---|
| `409 "... already in progress"` on `/ingest/run`, `/indicators/run`, or `/signals/run` | An `IngestRun` row is stuck `status="running"` (dead process) — the guard checks *any* row in that state, any mode | `.venv/bin/python scripts/reap_stale_runs.py --hours 0` (or wait, if it's genuinely still running) |
| `RuntimeError: database schema is not at the latest migration` on startup | DB is behind the Alembic head | `.venv/bin/alembic upgrade head` |
| `503` on `POST /broker-accounts` | `BROKER_MASTER_KEY` unset in `.env` | Generate a key (§1), set it, restart uvicorn |
| `401 missing/invalid API key` | `X-API-Key` header absent, or wrong/inactive user | Use the raw key `scripts/create_user.py` printed once; create a new user if lost |
| Broker sync fails, account's `last_sync_status = "auth_failed"` | Bad TOTP secret/API key, or an auth error that also burned Groww's current-day trade window | Fix credentials; then **that day's trades are gone from the broker API** — recover via `POST /broker-accounts/{account_id}/import-tradebook` with a manually exported CSV |
| `unmapped` symbols listed after a tradebook import/sync | Broker's ISIN/tradingsymbol didn't match any existing `Symbol`; a new one was auto-created with no candle history yet | Check the `unmapped` list; backfill via `POST /ingest/run {"symbols":[...]}` |
| `scripts/validate.py` Layer-1 `FAIL` on the 4h-vs-1h check, only during market hours | The current 4h bin's 1h candles exist but its own 4h row is withheld until the bin closes (13:15/15:30 IST) — see §4 | Re-run after 15:30 IST, or disregard a `FAIL` confined to today |
| 1h/4h signals look unreliable / RVOL looks wrong | Documented in `docs/UI_HANDOFF.md`: ~13% of Yahoo hourly bars have zero volume, distorting every volume-gated strategy on 1h/4h | Treat 1h/4h as experimental; use `timeframe=1d` for real decisions |
| `docker exec stockscreen-db ...` / `docker compose up -d` fails to connect | Docker daemon/Desktop isn't running | Start Docker Desktop, then `docker compose up -d` |
| `stockscreen-api` exits 1 with `entrypoint: database unreachable after N attempts` | Wrong `DATABASE_URL` for the container (e.g. `localhost:5433`, which inside the container is the container itself), or the DB is genuinely down | `docker compose config \| grep DATABASE_URL` — in-network it must be `db:5432`; §9 |
| `stockscreen-api` restarts in a loop right after a deploy | Two replicas raced `alembic upgrade head`; the loser fails the startup schema check | `RUN_MIGRATIONS=0` on the replicas, migrate once as a release step (§9) |
| Port 8000 already in use on `docker compose up` | A venv uvicorn is still running on the host | `kill $(pgrep -f "uvicorn app.main:app")`, or set `API_PORT` in `.env` |

---

## 9. Deployment (Docker)

The backend ships as one image (`Dockerfile`) that serves the API *and* runs
the `scripts/` jobs — the daily job is this app's own code path, so it needs
the same dependencies and the same schema check, just a different command.

Two separate things, deliberately: **`docker-compose.yml` is the local
stack** (Postgres + API on this machine). **Hosting runs the image
directly** — `docker run`, or a platform that takes an image — against a
Postgres that lives somewhere else and is not managed from this repo.

### Layout

| File | Role |
|---|---|
| `Dockerfile` | Two-stage build: deps into `/opt/venv` (with a compiler available), then a `python:3.12-slim` runtime with no compiler. Runs as uid 10001, CWD `/srv/stock-screen`, `TZ=Asia/Kolkata` |
| `docker/entrypoint.sh` | Maps `$PORT`→`UVICORN_PORT`, waits for Postgres, runs `alembic upgrade head`, then `exec`s the command |
| `.dockerignore` | Keeps `.venv`, `.git`, `.env`, `ui/`, notebooks, tests and docs out of the image |
| `docker-compose.yml` | **Local only:** `db` + `api`, plus `sync` (the daily job) under the `jobs` profile |

### Local stack (compose)

```bash
docker compose up -d --build         # db + api; api waits for db's healthcheck
docker compose ps                    # both should read "(healthy)"
docker compose logs -f api
curl -sf localhost:8000/health       # {"status":"ok","database":"ok"}
docker compose down                  # stop; the pgdata volume is untouched
```

Compose feeds the containers the repo-root `.env` (`env_file`, optional) and
then overrides `DATABASE_URL`, because the value in `.env` is the **host's**
view (`localhost:5433`, for venv `alembic`/`pytest`/`scripts`) while
in-network the DB is `db:5432`.

### Hosting: run the image against an external Postgres

There is no `.env` in the image, by design (`.dockerignore`): every setting
arrives as a **real environment variable**, which is what a platform's
"environment"/"secrets" panel sets. `app/config.py` reads them directly
(pydantic-settings), so the names are the same as §1's.

```bash
docker build -t stockscreen-backend:$(git rev-parse --short HEAD) .
docker tag  stockscreen-backend:$(git rev-parse --short HEAD) registry.example.com/stockscreen-backend:latest
docker push registry.example.com/stockscreen-backend:latest

docker run -d --name stockscreen-api -p 8000:8000 \
  -e DATABASE_URL='postgresql+psycopg://user:pass@db.example.com:5432/stockscreen?sslmode=require' \
  -e BROKER_MASTER_KEY='...' \
  --restart unless-stopped \
  registry.example.com/stockscreen-backend:latest
```

**Where the value actually goes.** `DATABASE_URL` is a *runtime* variable —
never a build arg, never baked into the image, so the same image runs
against staging and production:

| How you run it | Where the URL goes |
|---|---|
| `docker run` | `-e DATABASE_URL='...'` (single-quoted; `?`, `&` and `$` are shell metacharacters) |
| `docker run`, many vars | `--env-file /etc/stockscreen.env` on the **host** — one `KEY=VALUE` per line. Docker does **not** strip quotes here: `DATABASE_URL="postgres..."` keeps the quotes as part of the value and fails to connect. Write it bare |
| systemd unit | `Environment=` / `EnvironmentFile=` on the `docker run` service |
| Render / Railway / Fly / Heroku | The environment or secrets panel (`fly secrets set DATABASE_URL=...`); many of them offer to inject their own managed-DB URL, which still needs its scheme rewritten to `postgresql+psycopg://` |
| ECS / Cloud Run | Task definition `secrets` from Secrets Manager / SSM, or Secret Manager env refs |
| Kubernetes | A `Secret` plus `envFrom.secretRef` on the pod spec |

That is the whole configuration surface for a single instance:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | the local compose URL, which is wrong anywhere else | Must keep the `postgresql+psycopg://` scheme (SQLAlchemy 2 + psycopg 3) |
| `BROKER_MASTER_KEY` | for broker features | unset | Fernet key (§1). Platform secret store, never the image |
| `PORT` | no | unset | Copied to `UVICORN_PORT` by the entrypoint — what Render/Railway/Fly/Cloud Run inject. `CMD` passes no `--port` on purpose: an explicit flag would win over the environment |
| `UVICORN_HOST` / `UVICORN_PORT` | no | `0.0.0.0` / `8000` | Read by uvicorn's own CLI (click, `auto_envvar_prefix="UVICORN"`) |
| `RUN_MIGRATIONS` | no | `1` | `0` skips `alembic upgrade head` on boot |
| `WAIT_FOR_DB` | no | `1` | `0` skips the startup readiness wait |
| `DB_WAIT_SECONDS` | no | `60` | How long to wait for the DB before exiting 1 |
| `TZ` | no | `Asia/Kolkata` | A few paths date off the local clock (e.g. the default corporate-actions window); "today" here always means the Indian trading day |

Everything else in §1's table (`HOURLY_BACKFILL_DAYS`, `FETCH_DELAY_SECONDS`,
`CHANDELIER_ATR_MULTIPLE`, ...) is optional and keeps its `app/config.py`
default unless set.

**Writing `DATABASE_URL`:**

| Where the DB runs | Host in the URL |
|---|---|
| Managed (RDS/Neon/Supabase/...) | The provider's hostname, usually with `?sslmode=require` |
| Another machine / VM | Its hostname or IP, reachable from the container |
| **Its own container on this host** | The DB **container's name**, on a shared user-defined network, with its *internal* port: `@stockscreen-db:5432`. See below |
| **The same machine, outside Docker** | `host.docker.internal` — **not** `localhost`, which inside a container is the container itself. Docker Desktop resolves it; on Linux add `--add-host=host.docker.internal:host-gateway` |

When Postgres is its own container, the two containers must share a
**user-defined** network — Docker's DNS resolves container names only there,
not on the default bridge:

```bash
docker network create stockscreen-net                       # once
docker network connect stockscreen-net stockscreen-db       # if the DB is already running

docker run -d --name stockscreen-api --network stockscreen-net -p 8000:8000 \
  -e DATABASE_URL='postgresql+psycopg://stockscreen:stockscreen@stockscreen-db:5432/stockscreen' \
  stockscreen-backend
```

Two details that catch people out:

- Use the DB's **internal** port (5432), not the host-published one (5433).
  Publishing is irrelevant between containers on the same network; the API
  container talks to the DB directly.
- Without the shared network the entrypoint exits with
  `failed to resolve host 'stockscreen-db'`. Either connect the networks as
  above, or fall back to the published port via `host.docker.internal:5433`.

- A provider-supplied `postgres://` / `postgresql://` URL needs its scheme
  rewritten to `postgresql+psycopg://`; nothing else about it changes.
- Percent-encode a password containing `@ : / ? # [ ] %`.
- libpq parameters (`sslmode`, `connect_timeout`, `options`) go in the query
  string and are passed through to psycopg.

Verify the wiring the moment the container is up — `/health` opens a real DB
connection, so a green `/health` means the URL, credentials, network path
and schema version are all good:

```bash
curl -sf https://your-host/health     # {"status":"ok","database":"ok"}
docker logs stockscreen-api           # entrypoint's migration output, then uvicorn's bind line
```

A bad `DATABASE_URL` fails fast and loudly instead of serving errors: the
entrypoint exits 1 with `entrypoint: database unreachable after N attempts`
and the reason from psycopg.

### The daily job and the scripts, in a container

Same image, different command — every `scripts/*.py` runs this way.

Hosted (the `--rm` container exits when the pipeline is done; give it the
same env as the API, and `RUN_MIGRATIONS=0` so it never migrates behind the
running service):

```bash
docker run --rm \
  -e DATABASE_URL="$DATABASE_URL" -e BROKER_MASTER_KEY="$BROKER_MASTER_KEY" \
  -e RUN_MIGRATIONS=0 \
  registry.example.com/stockscreen-backend:latest \
  python scripts/daily_sync.py --json

docker run --rm -e DATABASE_URL="$DATABASE_URL" -e RUN_MIGRATIONS=0 \
  registry.example.com/stockscreen-backend:latest \
  python scripts/create_user.py --name shyan
```

On a platform, the same thing is a scheduled/cron job on the image (Render
Cron Job, Fly machine `schedule`, ECS scheduled task, k8s CronJob) with
command `python scripts/daily_sync.py`, at 16:15 IST on weekdays — mind the
scheduler's own time zone, which is usually UTC (10:45 UTC).

Locally, the same job is the compose `sync` service (in the `jobs` profile,
so `docker compose up` never starts it):

```bash
docker compose run --rm sync                                    # full pipeline
docker compose run --rm sync python scripts/daily_sync.py --json
docker compose run --rm sync python scripts/daily_sync.py \
  --steps ingest,indicators,signals --symbols RELIANCE,TCS --timeframes 1d
```

Either way the job refuses to do anything if the schema is behind
(`assert_schema_current`), so a job container that outlives a rollback fails
loudly rather than writing against the wrong schema. Host cron entry in
README's "Scheduling"; the flags are in §4.

### Migrations on deploy

The entrypoint runs `alembic upgrade head` before uvicorn starts, so
deploying a new image migrates the DB by itself — nothing to remember, and
the service cannot come up against a schema it does not match.

Two cases where you take that over instead:

- **More than one API instance.** Set `RUN_MIGRATIONS=0` on all of them and
  migrate once as a release step, or they race on the same
  `alembic_version` row and the losers crash on the startup schema check:

  ```bash
  docker run --rm -e DATABASE_URL="$DATABASE_URL" -e RUN_MIGRATIONS=0 \
    registry.example.com/stockscreen-backend:latest alembic upgrade head
  ```

  (`RUN_MIGRATIONS=0` so the entrypoint doesn't also migrate; the explicit
  `alembic upgrade head` command is the one that does the work.)

- **A migration you want to watch.** Same command, run by hand before
  rolling the image out.

Downgrades are not automatic and never run on boot: `alembic downgrade -1`
in the same one-off container, before deploying the older image.

### Notes before hosting this on the open internet

- **CORS.** The service has no CORS middleware, so a UI served from another
  origin cannot call it. Either serve `ui/dist` from this origin (a reverse
  proxy in front of both), or add `CORSMiddleware` to `app/main.py`.
- **Auth coverage.** Only `/me`, `/broker-accounts` and `/positions` require
  `X-API-Key` (§5, §6). Ingest, indicators, signals and candles are open —
  including the POST endpoints that start a full universe backfill. Put the
  service behind a network boundary (VPN/private network/proxy auth) unless
  and until those are authenticated.
- **`BROKER_MASTER_KEY` is the whole security of stored broker credentials.**
  It belongs in the platform's secret store, never in the image or a
  committed `.env`. Rotating it invalidates every stored credential.
- **Dependency pinning.** `requirements.txt` uses `>=`, so two builds of the
  same commit can resolve different versions. Pin (or add a lockfile) before
  this matters — yfinance in particular moves fast.
- **Outbound network.** The container needs egress to Yahoo Finance
  (yfinance), `archives.nseindia.com` (the Nifty 500 list),
  `www.nseindia.com` (corporate actions) and Groww's API. NSE blocks
  non-browser clients often; the universe fetch has a static fallback
  (`app/universe.py`), corporate actions do not.
- **One uvicorn worker.** `POST /ingest/run` and friends do the work in a
  FastAPI `BackgroundTask` inside the serving process, so a request-scoped
  restart mid-run leaves an `IngestRun` stuck `running` (reap it, §4). Scale
  with replicas only after checking that the 409 in-progress guard —
  which is DB-level — is doing what you want across them.

---

*Unverified: the exact Groww `GrowwAPI.get_access_token()` failure modes
beyond the TOTP/auth-error path (`app/brokers/groww.py`) were not exercised
live — no broker account exists in this DB to test `/test` or `/sync`
against a real Groww login. Everything else in this document was confirmed
either directly in the source files listed at the top, or against a live
run of the server (openapi.json cross-check: all 30 documented endpoints
match `GET /openapi.json` exactly, no extras on either side).*
