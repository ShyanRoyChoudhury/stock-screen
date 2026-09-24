# Stock Screen: UI Handoff for Claude Design

**Prepared:** 22 Sep 2026 · **Backend branch:** `feat/broker-positions` · **Backend:** FastAPI + Postgres, `http://localhost:8000` (OpenAPI docs at `/docs`)

This document is the full brief for designing the web UI of Stock Screen. The backend exists. **There is no UI of any kind today**: every interaction happens through `curl`, Python scripts or Jupyter notebooks. Your job is to design the front end that sits on this API.

Read sections 1–3 for the product, section 5 for the screens, and sections 6–10 for exact data, vocabulary and constraints. Section 11 lists what the API cannot yet provide, so you know which parts of a design depend on backend work.

---

## 1. What the platform is

**Stock Screen is a decision-support platform for swing trading Indian equities (NSE).** It does two jobs:

1. **Screen.** Every trading day after the market closes, it scans the **Nifty 500** universe, computes technical indicators and runs six rule-based strategies. The output is a list of trade setups, each with an entry, a stop-loss and two targets.
2. **Manage what you actually bought.** It pulls your real fills from your broker, builds positions from them, links each position to the signal that probably triggered it, and gives every open position a daily verdict: **HOLD, PARTIAL, EXIT or REVIEW**, with the reasons.

**It never places orders.** It is advisory only. The trader reads the verdicts and signals, then acts at the broker (placing buys, sells and GTT stop orders there). The platform only *reads* from the broker.

**It is end-of-day, not real-time.** Data updates once a day, after the 15:30 IST close. There are no live prices, streaming quotes or intraday alerts. A candle is stored only once it is complete.

**Where it's going:** options strategies are the long-term destination (not designed or built yet). Design the navigation so an "Options" area can be added later without restructuring. Do not design it now.

## 2. Who uses it, and when

**Primary user:** Shyan, an algorithmic trader with about 10 years of profitable experience, trading NSE equities on a swing horizon (days to a few weeks). They are fluent in market structure, indicators and corporate actions, and they check numbers. Design for an expert:

- Density over hand-holding. They want many rows and many numbers on screen, and no onboarding fluff.
- Exact numbers, never rounded away. Show prices to 2 decimals, ₹, in Indian digit grouping (₹1,23,456.78).
- **Show why.** Every verdict and signal already carries its reasons. Surface them, don't hide them behind a single colour.
- **All times in IST.** The API returns UTC and the UI must convert (see §8).

**Multi-user capable, single user today.** The backend scopes broker accounts, trades and positions per user (API-key auth). Exactly one user exists. Design for one operator, but don't hard-code that assumption into navigation (e.g. keep an account/profile menu).

### The daily rhythm the UI must serve

```
15:30 IST  NSE closes
16:15 IST  Daily job runs automatically (8 steps; est. 30–40 min for the full universe,
           not yet timed end-to-end):
           reap stale runs → ingest candles → indicators → signals
           → corporate actions → broker sync → ledger → evaluate positions
Evening    Trader opens the app:
             1. Did last night's pipeline succeed? Any data problems?
             2. Positions: which ones say EXIT / PARTIAL / REVIEW today? Why?
             3. Fresh signals: what set up today? Shortlist, open charts, decide.
             4. Broker: did today's trade sync work? (If not, act TODAY; see below.)
Next day   Trader places orders at the broker (buys, sells, stop updates).
Next 16:15 Sync pulls those fills → positions open/close automatically
           → each new position is auto-matched to a signal → verdicts begin.
```

**Critical time-sensitive state:** Groww's API returns only *today's* trades. If a broker sync fails (e.g. authentication), that day's fills are lost to the API for good, and the trader must upload the broker's tradebook CSV manually. The UI must make a failed sync loud and point straight to the CSV import.

## 3. The core loop, in objects

```
Symbol (Nifty 500, 501 rows)
  └─ Candles (1h / 4h / 1d OHLCV)  →  Indicator values (one wide row per candle)
                                         └─ Signals (strategy × timeframe × bar: entry / SL / T1 / T2)
Corporate actions (dividends, splits, bonuses, rights, demergers; NSE-sourced)

User
  └─ Broker account (Groww; credentials encrypted)
        └─ Broker trades (raw fills)  ──FIFO ledger──►  Positions (one per BUY fill / lot)
                                                          ├─ matched Signal (auto or manual) → frozen stop/targets
                                                          ├─ Sell allocations (which SELL closed which lot)
                                                          └─ Position evaluations (one per day: verdict + reasons + warnings)
Ingest runs (audit log of every pipeline job: status, counts, errors)
```

---

## 4. Implementation status

### Done (backend, working, with tests)

| Area | What exists | Notes |
|---|---|---|
| **Universe** | Nifty 500 list fetched from NSE into `symbols` (symbol, name, industry, ISIN) | 501 symbols, 20 industries |
| **Market data ingest** | Yahoo Finance OHLCV at **1h** (fetched), **4h** (resampled from 1h, bins 09:15–13:15 / 13:15–15:30) and **1d** (fetched). Backfill and incremental modes. Idempotent upserts. Holiday-aware (NSE calendar). | **2.68M candles.** 1d from 2021-09-22, 1h/4h from 2024-09-24, 500 symbols each |
| **Indicators** | ATR(10), Supertrend(10,3) + direction, MACD(12,26,9), EMA 50/200, ADX(14), Bollinger(20,2) + bandwidth, Keltner(20,1.5), TTM squeeze on/off + momentum, Volume MA(20), RVOL(20) | Stored one row per candle; recomputed in full every run |
| **Signals** | 6 strategies (§6.1) across all 3 timeframes, verified against the original reference code | **554,875 signals** stored |
| **Corporate actions** | NSE corporate actions parsed and stored (dividend, split, bonus, rights, demerger) with price factors | 3,121 actions (2,965 dividends, 74 bonuses, 52 splits, 16 rights, 14 demergers) |
| **Price convention** | Stored prices are split/bonus-adjusted, dividend-unadjusted. Read-time adjustment functions exist for other conventions. | Adjustment functions are **not** exposed via the API yet |
| **Users and auth** | Users with API keys (`X-API-Key` header). Keys created by a CLI script and shown once. | No login screen/password flow; see §11 |
| **Broker accounts** | Add, list, deactivate, test connection, sync one account, sync all. Credentials (API key + TOTP secret) encrypted at rest. | **Groww** client implemented. `zerodha` is an accepted broker value but has **no client** (API returns 501). CSV import works for any broker. |
| **Tradebook CSV import** | Upload a CSV of fills; flexible column names | Recovery path for missed syncs |
| **Positions ledger** | Each BUY fill opens a position (a lot). SELLs close lots oldest-first (FIFO). Realized P&L per lot. Manual reattribution of a SELL across lots. Positions restated automatically when a split/bonus happens while held. | |
| **Signal matching** | Each new position is auto-matched to the most likely 1d signal (price proximity + strategy type + recency) with a confidence score. Manual override endpoint. | |
| **Daily verdicts** | Rule engine gives every open position HOLD / PARTIAL / EXIT / REVIEW daily, with reason codes and warning codes (§6.2) | Stored as history, one row per position per day |
| **Daily orchestration job** | `scripts/daily_sync.py` runs all 8 steps with per-step isolation; launchd/cron template for 16:15 IST | **In the working tree, not yet committed** |
| **Run audit** | Every pipeline job is an `ingest_runs` row with live progress counts and per-symbol errors | |

**Live data state right now:** market data is fully populated, with the last 1d candle on Mon 21 Sep 2026. **The broker and positions side has never run against a real account: 0 broker accounts, 0 trades, 0 positions.** Positions, trades and verdict screens must be designed from the schema and the illustrative payloads in §10.2.

### Not built

- **Any UI.** This handoff is the first step.
- Any API endpoint for the items in §11.

## 5. Screens to design

Suggested information architecture (adjust freely; what matters is that each job is covered):

```
Today (home) · Signals · Positions · Symbol (detail, reached from anywhere) · Trades · Brokers · Data & Ops · [Options: future placeholder]
```

For each screen: **purpose → content → data source → states → interactions.**

### 5.1 Today (home / evening brief)

**Purpose:** answer "is everything OK, and what needs my attention?" in one glance after the daily job.

**Content:**
- **Pipeline status for the last trading day**: each step (ingest, indicators, signals, broker sync, evaluate) with status ok/warning/failed, finish time and counts. Show a **"Degraded"** banner if ingest failed (signals/verdicts then ran on the previous day's candles).
- **Positions needing action**: counts by verdict, then the list of EXIT, PARTIAL and REVIEW positions first with their reason codes. HOLD collapsed below.
- **Broker sync alerts**: any account whose `last_sync_status` is `auth_failed` or `error`, or whose `last_sync_on` is not the last trading day. Include a direct **"Import tradebook CSV"** action (§2 explains why this is urgent).
- **Fresh signals summary**: counts of today's 1d signals by strategy, with a link into Signals. Real example, session of Mon 21 Sep: 72 daily signals across 66 symbols. Across the three sessions 17–21 Sep: Confluence 158, S1_ST_Flip 30, S2_MACD_Zero 14, TTM_Squeeze 6.
- **Upcoming corporate actions on held symbols**: ex-dates within the next 5 sessions. The broker may cancel GTT stop orders on ex-date, so the trader must re-place them.

**Data:** `GET /ingest/runs`, `GET /positions?status=open` (includes `latest_evaluation`), `GET /positions/evaluations`, `GET /broker-accounts`, `GET /signals/fresh?days=1&timeframe=1d`, `GET /corporate-actions`.

**States:** normal; pipeline failed or still running; nothing to act on (all HOLD); no broker account linked yet (onboarding prompt to add one); no positions yet.

### 5.2 Signals (the scanner)

**Purpose:** browse and shortlist setups.

**Content:** a dense, sortable table. One row per signal:
`Symbol · Name · Industry · Strategy · Timeframe · Signal date (IST) · Entry · Stop · Risk % · T1 · T2 · R:R · Strategy-specific details`

- **Filters:** strategy (multi-select), timeframe (**default 1d**), freshness (last N days, 1–30), industry, max risk %, min R:R, conviction (Confluence only), entry mode (PIPELINE only).
- **Row expand / side panel:** the full `details` object rendered legibly. Confluence's `breakdown` is a four-part scorecard (supertrend / MACD / BB position / volume), each ✓ or ✗, plus "room to upper band". A mini-chart and a link to the Symbol page.
- **Compute R:R client-side for every row** as `(T1 − entry) / (entry − stop)`. The API fills `rr_ratio` only for Confluence and TTM_Squeeze.
- **Flag high risk visually.** Risk % varies hugely by strategy (PIPELINE is capped at 1%; S1/S2 can exceed 12–15%).

**Design constraints (important):**
- **Confluence is a *state*, not an *event*.** It fires on about 23% of all daily bars (measured) and dominates counts (158 of 208 fresh daily signals in the example above). Keep it separate or de-emphasised (its own tab, a toggle, or a "confirms" badge on other signals for the same symbol) so it doesn't bury the event strategies.
- **1h and 4h signals are from an untrusted feed** (§8). Default to 1d. When 1h/4h is shown, mark it clearly as experimental.
- `/signals/fresh` is unpaginated and 1h alone can return thousands of rows. Always request with a timeframe filter, and paginate or virtualise the table.

**Data:** `GET /signals/fresh?days=&strategy=&timeframe=`, `GET /signals?symbol=&strategy=&timeframe=&since=&limit=`, and `GET /symbols` (join name and industry client-side; there are only 501 rows).

### 5.3 Symbol detail (chart page)

**Purpose:** everything about one stock on one screen. It's where decisions get made.

**Content:**
- **Candlestick chart** with a timeframe switch (1d default, 4h, 1h marked experimental) and volume bars.
- **Overlays (toggleable):** EMA 50, EMA 200, Supertrend line (colour by direction +1/−1), Bollinger bands, Keltner channels.
- **Sub-panes (toggleable):** MACD (line, signal, histogram), ADX, RVOL, TTM momentum with squeeze-on/off dots.
- **Signal markers** on the bars where each strategy fired. Selecting one draws its entry, stop, T1 and T2 as horizontal levels.
- **Corporate action markers** on ex-dates (dividend, split, bonus, rights, demerger). **Demerger markers need a warning treatment**: price history is *not* demerger-adjusted, so there may be a false cliff (§8).
- **If held:** position entry/exit markers, current stop, trail, targets and the latest verdict.
- **Header:** symbol, name, industry, ISIN, last close and change, latest indicator snapshot (trend state: close vs EMA50/200, Supertrend dir, ADX, RVOL).

**Data:** `GET /candles/{symbol}?timeframe=&start=&end=&limit=` (max 10,000, returned oldest→newest), `GET /indicators/{symbol}?timeframe=...` (same shape, aligned on `ts`), `GET /signals?symbol=`, `GET /corporate-actions?symbol=`, `GET /positions`.

### 5.4 Positions

**Purpose:** manage the book.

**List (tabs: Open / Closed):**
`Symbol · Qty open / total · Avg entry (adjusted) · Avg entry (as paid) · Last close · Unrealised % and ₹ · Days held · Stop · Trail · T1 · T2 · Verdict · Reasons · Warnings · Matched strategy + confidence (or "Unmatched")`

- **Verdict chip** is the primary visual; reasons sit next to it as readable labels (§6.2 has the full code list).
- **Positions are per lot.** Each BUY fill is its own position. Three buys of RELIANCE make three rows. Offer a **group-by-symbol** view with aggregate qty and weighted average.
- **Closed tab:** opened/closed dates, realised P&L ₹ and %, matched strategy (useful for per-strategy performance later).

**Position detail:**
- Chart (reuse Symbol) with this position's entry, stop, trail and targets.
- **Verdict history timeline**: one entry per trading day with verdict, close, stop and trail levels, reasons and warnings (`GET /positions/{id}/evaluations`).
- **Match panel:** matched strategy, signal date, confidence, reason text (e.g. `S1_ST_Flip @2026-09-21, fill 0.3% from entry`) and the frozen entry/stop/targets. **Manual match / re-match:** show candidate 1d signals for this symbol in the sessions before `opened_on`, and the user picks one (`POST /positions/{id}/match`).
- **Fills:** the BUY that opened it and the SELL(s) that reduced/closed it.
- **Two entry prices, explained.** `avg_entry_price` is in adjusted terms (comparable to the chart); `avg_entry_price_raw` is what was actually paid. They differ only if a split/bonus happened after the buy. Show both with a tooltip, and show `structural_factor_applied` when it isn't 1.0.

**Actions:** "Re-evaluate" (`POST /positions/evaluate`, optional `as_of` date), manual match, and jump to Trades for SELL reattribution.

### 5.5 Trades (broker fills / ledger)

**Purpose:** audit the raw fills and fix the ledger when FIFO guessed wrong.

- Table: `Date/time (IST) · Broker · Tradingsymbol · Mapped symbol · ISIN · Side · Qty · Price · Position link · Applied?`. Filters: date range, symbol.
- **Unmapped fills** (`symbol` is null: the broker's symbol didn't resolve to a Nifty 500 symbol) need a visible "unmapped" state. The ledger skips them.
- **Reattribute a SELL:** select a SELL, then allocate its quantity across that symbol's open lots, with quantities that must sum to the fill quantity. Submits `POST /positions/trades/{sell_id}/reattribute`. Validation errors come back as 422 with a message.

### 5.6 Brokers (linked accounts)

**Purpose:** connect and maintain broker access.

- **Account cards:** broker, label, active, last sync date, last sync status (`ok` / `auth_failed` / `error` / never) and last sync message.
- **Add account (Groww):** label, API key, TOTP secret. Secrets are write-only: they are never returned by the API, so never show them after save.
- **Per-account actions:** Test connection (returns holdings count), Sync now (optional date), **Import tradebook CSV**, Deactivate. Global: Sync all.
- **CSV import:** show the expected columns and the result (rows read, upserted, unmapped, ledger summary: buys opened, sells allocated, orphan sells, errors).
  - Required: `trade_date` or `date` (YYYY-MM-DD or DD-MM-YYYY), `symbol` and/or `isin`, `side` or `trade_type` (BUY/SELL), `quantity`, `price`.
  - Optional: `exchange` (NSE), `segment` (CASH), `product` (CNC), `time` (HH:MM, default 15:29), `trade_id`.
- **Error states to design:** 503 "master key missing" (server not configured for credential encryption), 501 "no client registered for broker zerodha", 502 "broker call failed: …", 409 duplicate broker+label.

### 5.7 Data & Ops (admin)

**Purpose:** see and drive the pipeline by hand.

- **Runs log:** every job with mode (`backfill`, `incremental`, `indicators`, `signals`, `broker_sync`, `evaluate`), status (`running` / `completed` / `failed`), started/finished, `symbols_ok/total/failed`, rows written, message, expandable per-symbol errors.
- **Live progress:** counters update per symbol while a run is `running`. Poll `GET /ingest/runs/{id}` for a progress bar. Real durations for the full universe: backfill ≈ 20 min, indicators ≈ 16 min, signals ≈ 6.5 min.
- **Triggers:** ingest (backfill/incremental; timeframes; optional symbols), compute indicators, generate signals, load corporate actions (date range), refresh universe, evaluate positions. **Only one run can be active at a time.** Any trigger returns 409 while another runs, so disable the triggers and show which run is in progress.
- **Corporate actions browser:** filter by symbol and type. Columns: ex-date, record date, value, ratio, price factor, extraordinary flag, raw NSE subject text.
- **Health:** `GET /health`.

### 5.8 Settings / account

- API-key entry (there's no login flow; see §11). Show `GET /me` (name, email).
- Display preferences (theme, default timeframe, whether to show 1h/4h at all).

---

## 6. Domain reference

### 6.1 Strategies

All strategies are long-only. "Event" strategies fire on a discrete change; "state" fires while a condition holds.

| Strategy key | Type | What it detects | Stop-loss | Targets | `details` fields |
|---|---|---|---|---|---|
| `PIPELINE` | Event | 10-step trend-breakout-retest: uptrend (close > EMA50 > EMA200, EMA50 rising, ADX > 25), prior 15-bar tight consolidation (range < 5%, ATR falling), breakout close ≥ resistance + 0.2 ATR, MACD histogram positive and rising, volume confirmed. `entry_mode` is **IMMEDIATE** (breakout ≥ 0.5 ATR) or **RETEST** (weaker breakout, then a retest of the level within 10 bars). | Structural low − 0.5 ATR, capped so risk ≤ 1% | T1 = +2 ATR, T2 = +3.5 ATR | `atr`, `rvol`, `breakout_atr`, `volume_grade` |
| `S1_ST_Flip` | Event | Supertrend flips red → green with volume above its 20-bar average | Supertrend × 0.995 | +7% / +12% | `supertrend`, `vol_ratio` |
| `S2_MACD_Zero` | Event | MACD line crosses above zero while Supertrend is green | 10-bar swing low × 0.995 | +7% / +12% | `macd` |
| `S3_BB_Squeeze` | Event | Bollinger bandwidth < 3% within the last 10 bars, then a fresh close above the upper band on volume > 1.5× average | BB middle | +8% / +15% | `upper_bb`, `middle_bb`, `bandwidth`, `vol_ratio` |
| `TTM_Squeeze` | Event | TTM squeeze fires (Bollinger exits Keltner) with positive, rising momentum and Supertrend green | Keltner mid × 0.99 | +8% / +15% | `momentum`, `kc_mid`, `squeeze_bars` |
| `Confluence` | **State** | Scores 4 checks: Supertrend green (hard veto if not), MACD bullish, close above BB middle, volume above average. Needs ≥ 3/4; skipped if < 1% room to the upper band. | Supertrend × 0.99 | +7% / +12% | `score` ("3/4"), `conviction` (**HIGH ⚡** = MACD was negative in the last 10 bars; **STRONG** = 4/4; **MODERATE**), `breakdown` {supertrend, macd, bb_position, volume, room_to_upper, high_conviction}, `supertrend` |

Rarity on 1d over 5 years, for scale: PIPELINE 26, S3 141, TTM 3,659, S1 5,670, S2 5,688, Confluence 128,800.

Every signal has `entry` (= that bar's close), `stop_loss`, `target_1`, `target_2`, `risk_pct` (percent, e.g. `8.92` = 8.92%). `rr_ratio` is filled only for Confluence and TTM_Squeeze.

### 6.2 Verdicts

One verdict per open position per trading day. **Precedence: the first rule that fires sets the verdict, but every rule that fires adds its reason**, so a position can say EXIT with three reasons. **Warnings never change the verdict.**

| Verdict | Meaning | Suggested treatment |
|---|---|---|
| **EXIT** | Get out | Highest urgency |
| **PARTIAL** | Book part (T1 reached) | Action, lower urgency |
| **REVIEW** | The system can't be trusted here; a human must look | Distinct from EXIT: it means "data/logic unsure", not "sell" |
| **HOLD** | Nothing to do | Quiet |

**Reason codes, in precedence order:**

| Code | Verdict | Plain-language label |
|---|---|---|
| `NO_DATA` | REVIEW | No price data for this symbol/date |
| `DEMERGER_CLIFF` | REVIEW | A demerger happened while held; stored prices aren't demerger-adjusted, so levels are unreliable |
| `QTY_MISMATCH` | REVIEW | Quantity doesn't divide cleanly after a split/bonus restatement |
| `STOP_HIT` | EXIT | Close below stop (detail: `close X < stop Y`) |
| `SUPERTREND_FLIP` | EXIT | Supertrend turned bearish |
| `TRAIL_HIT` | EXIT | Close below the trailing stop (only when the trail is separate from the stop) |
| `T2_HIT` | EXIT | Close reached target 2 |
| `T1_HIT` | PARTIAL | Close reached target 1 |

**Warning codes (informational):**

| Code | Label |
|---|---|
| `LOW_BREACH` | Intraday low went below the stop, but the close held above it |
| `VOLUME_DIVERGENCE` | Price rising while volume declines (last 5 bars) |
| `UPCOMING_ACTION` | Corporate action within 5 sessions. Detail text says the broker may cancel your GTT and you should re-place the stop after the ex-date. |
| `QTY_DIFFERS_FROM_BROKER` | Platform quantity ≠ broker holdings (suppressed for the first 2 sessions, for T+1 settlement) |
| `HORIZON` | Held more than 30 sessions (swing horizon exceeded) |
| `STALE_BAR` | Latest candle is older than the evaluation date |

**Which stop applies:** if the position is **matched** to a signal, the stop is that signal's frozen stop, the targets are its frozen T1/T2, and a separate **chandelier trail** (highest high since entry − 2.5 × ATR, never moves down) also applies. If **unmatched**, there are no targets and the trail *is* the stop. The UI should make this difference visible, e.g. "Unmatched: trailing stop only, no targets".

### 6.3 Matching a fill to a signal

When a BUY fill arrives, the matcher looks at 1d signals for that symbol from the 5 sessions up to the fill date with entry within 5% of the fill price. Score = 0.5 × price proximity + 0.3 × strategy weight (event strategies 1.0, Confluence 0.5) + 0.2 × recency. The best candidate with score ≥ 0.5 wins. `match_confidence` is that score (0–1). `match_reason` is human-readable. A manual match sets confidence 1.0 and reason `manual`.

### 6.4 Timeframes

`1d` (primary, trusted), `4h`, `1h` (both experimental; see §8). Daily candles have `ts` = 09:15 IST session open. 4h bins are 09:15–13:15 and 13:15–15:30.

---

## 7. Units and formats (read before binding any number)

| Field | Unit | Watch out |
|---|---|---|
| `risk_pct` (signals) | **Percent** (8.92 = 8.92%) | |
| `unrealized_pnl_pct` (evaluations) | **Fraction** (0.019 = 1.9%) | The name says pct but it isn't |
| `realized_pnl_pct` (positions) | **Fraction** | Same trap |
| `realized_pnl` | ₹, gross | No brokerage/taxes deducted |
| Unrealised ₹ | Not provided | Compute `qty_open × (latest_evaluation.close − avg_entry_price)` |
| `match_confidence` | 0–1 | |
| `bb_bandwidth`, `details.bandwidth` | Fraction | |
| `rvol_20`, `vol_ratio` | Multiple of average (2.05 = 2.05×) | |
| `supertrend_dir` | +1 bullish / −1 bearish | |
| All timestamps | ISO-8601 **UTC** (suffix `Z` or `+00:00` depending on endpoint) | Convert to IST. A daily candle arrives as `…T03:45:00Z`, which is 09:15 IST on that date; show it as a date only. |
| Dates (`as_of`, `opened_on`, `ex_date`) | `YYYY-MM-DD` | Already trading-day dates |

## 8. Data caveats the UI must surface, not hide

These are measured facts about the data. The trader knows them. The UI should make them visible where they matter.

1. **1h/4h data is unreliable.** The Yahoo hourly feed doesn't reconcile with the daily bars on a large share of days, and about 13% of hourly bars have zero volume, which distorts RVOL and every volume-gated strategy. The trader's verdict: don't trade 1h/4h signals off this feed. **Default everything to 1d; badge 1h/4h as experimental.** A broker data feed is planned to replace it (§9).
2. **Demerger cliffs.** Prices are not adjusted for demergers, so charts show false price drops. 7 of 14 demergers leave a > 10% cliff: VEDL, ABFRL, TMPV, SIEMENS, SCI, AARTIIND, MOTHERSON. Mark demerger ex-dates on charts, and treat indicators and signals spanning one as suspect.
3. **Prices are split/bonus-adjusted, dividend-unadjusted.** Old prices on the chart are scaled for later splits and bonuses, so they won't match what the broker showed on that date. Dividends are left in the price.
4. **Signals are regenerated every run** (deleted and re-inserted). There's no "first seen" history: a signal can change or disappear if the source data is revised. Don't design features that promise signal immutability.
5. **PIPELINE RETEST logic has a known defect.** It currently tests continuation to new highs rather than a true retest, and only 2 daily RETEST signals exist in 5 years. The fix is pending a strategy decision. It's fine to show RETEST; don't make it a headline feature.
6. **Bollinger bands are about 2.6% wider than TradingView's** (sample vs population standard deviation). This affects S3, Confluence and TTM counts slightly. A fix is pending a decision. Values won't exactly match TradingView.
7. **No intraday freshness.** Today's daily bar exists only after the close and the daily job. During market hours the latest 1d candle is yesterday's.

## 9. Roadmap (planned, not built)

| Item | Status | UI implication |
|---|---|---|
| **Web UI** | Not started; this handoff | |
| **Schedule the daily job** | Script and launchd/cron template ready, uncommitted | Today screen depends on it running nightly |
| **NSE bhavcopy as the primary daily data source** (replacing Yahoo for 1d) | Not started (prototyped in notebooks) | A per-candle `source` field already exists; could show data provenance |
| **Broker market-data API** for intraday bars and the **option chain** | Not started | Would make 1h/4h trustworthy; prerequisite for options |
| **Options strategies** | Not started, long-term destination | Reserve a nav slot; do not design |
| **Zerodha broker client** | Accepted as a broker value, no client (501) | Show Zerodha as "CSV import only" or "coming soon" |
| **Data fixes:** demerger adjustment, RETEST logic, Bollinger convention, stronger data validation | Identified, pending decisions | Caveat badges in §8 can be removed as these land |
| **Dividend handling in signals/backtests** | Adjustment functions exist, not wired in | Possible future "adjusted / unadjusted" chart toggle |

## 10. API reference

Base URL `http://localhost:8000`. JSON everywhere. Interactive docs at `/docs`.

### 10.1 Endpoints

**Public (no auth): market data and pipeline**

| Method & path | Params / body | Returns |
|---|---|---|
| `GET /health` | | `{status, database}` |
| `GET /symbols` | `active_only=true` | `[{id, symbol, name, industry, isin, active}]` |
| `POST /symbols/refresh` | | Refresh the Nifty 500 list from NSE |
| `GET /candles/{symbol}` | `timeframe=1d\|4h\|1h`, `start`, `end`, `limit≤10000` (default 500) | `[{ts, timeframe, open, high, low, close, volume}]`, oldest→newest |
| `GET /indicators/{symbol}` | same as candles | Wide rows: `ts`, `timeframe` and every indicator column (see §10.2), oldest→newest |
| `GET /signals` | `symbol`, `strategy`, `timeframe`, `since`, `limit≤5000` (default 200) | Signal list, newest first |
| `GET /signals/fresh` | `days=1..30` (default 3), `strategy`, `timeframe` | Signals in the last N days, **unpaginated** |
| `GET /corporate-actions` | `symbol`, `action_type`, `limit≤500` (default 50) | Actions, newest ex-date first |
| `POST /corporate-actions/load` | `{from_date?, to_date?, symbols?}` (default last 5 years) | Synchronous load summary |
| `POST /ingest/run` | `{mode: "backfill"\|"incremental", timeframes: [...], symbols?}` | 202 + run object; **409 if any run is active** |
| `POST /indicators/run` | `{timeframes?, symbols?}` | 202 + run object; 409 if busy |
| `POST /signals/run` | `{timeframes?, symbols?, strategies?}` | 202 + run object; 409 if busy |
| `GET /ingest/runs` | `limit=20` | Run objects, newest first (all modes) |
| `GET /ingest/runs/{id}` | | One run object (poll for progress) |

**Authenticated (`X-API-Key: sk_…` header; 401 if missing/invalid): user-scoped**

| Method & path | Params / body | Returns |
|---|---|---|
| `GET /me` | | `{id, name, email, created_at}` |
| `GET /broker-accounts` | | `[{id, broker, label, active, last_sync_on, last_sync_status, last_sync_message, created_at}]` |
| `POST /broker-accounts` | `{broker: "groww", label, api_key, totp_secret}` | 201 account; 409 duplicate; 503 master key missing |
| `DELETE /broker-accounts/{id}` | | Deactivates (soft) and returns the account |
| `POST /broker-accounts/{id}/test` | | `{ok, holdings: <count>}`; 501 no client; 502 broker error |
| `POST /broker-accounts/{id}/sync` | `{day?}` | `{trades: {received, upserted, unmapped}, holdings: <count>, ledger: {…}}` |
| `POST /broker-accounts/sync-all` | | `{accounts, results: [{account_id, ok, result \| error}]}` |
| `POST /broker-accounts/{id}/import-tradebook` | multipart `file` | `{rows, upserted, unmapped, ledger: {buys_opened, sells_allocated, orphan_sells, skipped_unmapped, errors}}` |
| `GET /broker-accounts/trades` | `from_date`, `to_date`, `symbol` | Trade list, newest first |
| `GET /positions` | `status=open\|closed` | Positions, each with `latest_evaluation` embedded |
| `GET /positions/{id}` | | One position |
| `GET /positions/{id}/evaluations` | | Verdict history, newest first |
| `GET /positions/evaluations` | `as_of` (default last trading day) | All evaluations for that day |
| `POST /positions/evaluate` | `{as_of?}` | `{as_of, evaluated, by_verdict: {HOLD: n, …}, errors}` |
| `POST /positions/{id}/match` | `{strategy, ts}` (a 1d signal) | Updated position; 404 if no such signal |
| `POST /positions/trades/{sell_id}/reattribute` | `{allocations: [{position_id, quantity}]}` | Result; 422 with message on invalid split |

### 10.2 Sample payloads

**Real, from the live database: one latest 1d signal per strategy**

```json
[
  {"symbol":"BHEL","strategy":"Confluence","timeframe":"1d","ts":"2026-09-21T03:45:00+00:00","entry_mode":null,
   "entry":433.4,"stop_loss":394.72,"target_1":463.74,"target_2":485.41,"risk_pct":8.92,"rr_ratio":0.78,
   "details":{"score":"3/4","conviction":"MODERATE","supertrend":398.71,
     "breakdown":{"supertrend":"GREEN ✓","macd":"Bullish ✓","bb_position":"Upper half ✓","volume":"0.8x avg X","room_to_upper":"2.6%","high_conviction":false}}},
  {"symbol":"BAJAJ-AUTO","strategy":"PIPELINE","timeframe":"1d","ts":"2026-09-01T03:45:00+00:00","entry_mode":"IMMEDIATE",
   "entry":12361,"stop_loss":12237.39,"target_1":12803.72,"target_2":13135.75,"risk_pct":1,"rr_ratio":null,
   "details":{"atr":221.36,"rvol":2.05,"breakout_atr":1.04,"volume_grade":"STRONG (>=2x avg)"}},
  {"symbol":"CARBORUNIV","strategy":"S1_ST_Flip","timeframe":"1d","ts":"2026-09-21T03:45:00+00:00","entry_mode":null,
   "entry":1178.9,"stop_loss":1032.04,"target_1":1261.42,"target_2":1320.37,"risk_pct":12.46,"rr_ratio":null,
   "details":{"vol_ratio":10.37,"supertrend":1037.22}},
  {"symbol":"PATANJALI","strategy":"S2_MACD_Zero","timeframe":"1d","ts":"2026-09-21T03:45:00+00:00","entry_mode":null,
   "entry":396.2,"stop_loss":334.07,"target_1":423.93,"target_2":443.74,"risk_pct":15.68,"rr_ratio":null,
   "details":{"macd":3.45}},
  {"symbol":"CDSL","strategy":"S3_BB_Squeeze","timeframe":"1d","ts":"2026-08-21T03:45:00+00:00","entry_mode":null,
   "entry":1388.9,"stop_loss":1340.77,"target_1":1500.01,"target_2":1597.24,"risk_pct":3.47,"rr_ratio":null,
   "details":{"upper_bb":1370.06,"middle_bb":1340.77,"bandwidth":0.0437,"vol_ratio":3.31}},
  {"symbol":"USHAMART","strategy":"TTM_Squeeze","timeframe":"1d","ts":"2026-09-21T03:45:00+00:00","entry_mode":null,
   "entry":533.9,"stop_loss":495.11,"target_1":576.61,"target_2":613.99,"risk_pct":7.27,"rr_ratio":1.1,
   "details":{"kc_mid":500.11,"momentum":0.0244,"squeeze_bars":12}}
]
```

**Real: RELIANCE 1d, 21 Sep 2026 (candle merged with its indicator row; floats rounded here)**

```json
{"ts":"2026-09-21T03:45:00+00:00","open":1234.10,"high":1249.10,"low":1232.50,"close":1247.40,"volume":10007218,
 "atr_10":19.62,"supertrend_10_3":1294.68,"supertrend_dir":-1,
 "macd_12_26":-17.93,"macd_signal_9":-12.53,"macd_hist":-5.40,
 "ema_50":1290.99,"ema_200":1346.12,"adx_14":26.16,
 "bb_upper_20_2":1338.32,"bb_middle_20_2":1278.66,"bb_lower_20_2":1219.00,"bb_bandwidth":0.0933,
 "kc_upper_20_15":1300.67,"kc_middle_20":1271.25,"kc_lower_20_15":1241.82,
 "ttm_squeeze_on":false,"ttm_squeeze_off":false,"ttm_momentum":-21.79,
 "volume_ma_20":11079946.65,"rvol_20":0.90}
```

Indicator fields can be `null` during warm-up at the start of a series.

**Real: symbol and corporate action**

```json
{"id":396,"symbol":"RELIANCE","name":"Reliance Industries Ltd.","industry":"Oil Gas & Consumable Fuels","isin":"INE002A01018","active":true}

{"symbol":"BRIGADE","action_type":"bonus","ex_date":"2026-06-17","record_date":"2026-06-17","value":null,
 "ratio_from":1,"ratio_to":3,"price_factor":0.75,"is_extraordinary":true,"affects_share_count":true,"subject":"Bonus 1:3"}
```

**Real: a completed run**

```json
{"id":5,"mode":"signals","status":"completed","timeframes":["1h","4h","1d"],
 "symbols_total":501,"symbols_ok":501,"symbols_failed":0,"candles_written":554875,
 "message":"501/501 symbols ok, 554875 signals written","errors":[],
 "started_at":"2026-09-22T10:08:46.840130Z","finished_at":"2026-09-22T10:15:13.478189Z"}
```

(`candles_written` is reused as the generic "rows written" count for every run mode.)

**Illustrative (shape is exact, values invented; no positions exist yet): an open, matched position with its latest evaluation**

```json
{"id":1,"user_id":1,"broker_account_id":1,"symbol_id":106,"symbol":"CARBORUNIV","status":"open",
 "opened_on":"2026-09-22","entry_trade_id":1,"qty_open":40,"qty_total":40,
 "avg_entry_price":1182.0,"avg_entry_price_raw":1182.0,"structural_factor_applied":1.0,"last_restated_on":"2026-09-22",
 "matched_strategy":"S1_ST_Flip","matched_signal_ts":"2026-09-21T03:45:00+00:00","matched_timeframe":"1d",
 "match_confidence":0.9337,"match_reason":"S1_ST_Flip @2026-09-21, fill 0.3% from entry","is_unmatched":false,
 "frozen_entry":1178.9,"frozen_stop":1032.04,"frozen_target_1":1261.42,"frozen_target_2":1320.37,
 "frozen_details":{"vol_ratio":10.37,"supertrend":1037.22},
 "closed_on":null,"exit_trade_id":null,"realized_pnl":null,"realized_pnl_pct":null,
 "last_evaluated_on":"2026-09-25","last_verdict":"HOLD",
 "created_at":"2026-09-22T10:50:00Z","updated_at":"2026-09-25T10:50:00Z",
 "latest_evaluation":{"position_id":1,"as_of":"2026-09-25","bar_ts":"2026-09-25T03:45:00+00:00",
   "close":1204.5,"high":1211.0,"low":1190.2,"stop_level":1032.04,"trail_level":1158.3,
   "target_1":1261.42,"target_2":1320.37,"supertrend_dir":1,"atr":21.1,
   "verdict":"HOLD","reasons":[],
   "warnings":[{"code":"UPCOMING_ACTION","detail":"dividend ex 2026-09-29: Interim Dividend - Rs 3 Per Share; broker may cancel your GTT; re-place the stop after the ex-date"}],
   "unrealized_pnl_pct":0.019,"days_held":3}}
```

**Illustrative: an EXIT evaluation with multiple reasons**

```json
{"position_id":7,"as_of":"2026-10-06","verdict":"EXIT","close":512.3,"stop_level":521.0,"trail_level":521.0,
 "reasons":[{"code":"STOP_HIT","detail":"close 512.3 < stop 521.0"},{"code":"SUPERTREND_FLIP","detail":null}],
 "warnings":[{"code":"VOLUME_DIVERGENCE","detail":null}],"unrealized_pnl_pct":-0.041,"days_held":9}
```

**Illustrative: a broker account after a failed sync, and a trade**

```json
{"id":1,"broker":"groww","label":"Main","active":true,"last_sync_on":"2026-09-24",
 "last_sync_status":"auth_failed","last_sync_message":"auth: token request rejected","created_at":"2026-09-22T09:00:00Z"}

{"id":1,"broker":"groww","tradingsymbol":"CARBORUNIV","symbol":"CARBORUNIV","isin":"INE120A01034","side":"BUY",
 "quantity":40,"price":1182.0,"trade_ts":"2026-09-22T04:02:11+00:00","trade_date":"2026-09-22",
 "position_id":1,"applied_at":"2026-09-22T10:50:00Z"}
```

## 11. Backend gaps the UI will run into

Design for the intended experience, but know that these don't exist yet. Each needs backend work before the UI can be fully wired.

| Gap | Effect | Likely fix |
|---|---|---|
| **No CORS**, and no static hosting of a front end | A browser app on another origin can't call the API | Add CORS middleware, or serve the UI from FastAPI |
| **No login**: auth is a raw API key in a header | UI needs an "enter API key" gate and must store the key client-side | Session login later; API key is fine for a single-operator v1 |
| **Market-data endpoints are unauthenticated** | Anyone reaching the server can read signals | Fine locally; fix before any hosting |
| **No "daily job" summary endpoint** | Today screen must reconstruct pipeline status from `/ingest/runs` (ingest, indicators, signals, broker_sync and evaluate each write a row; reap, actions and ledger steps don't) | Add a daily-sync run record/endpoint |
| **Daily job can't be triggered from the API** | No "run tonight's job now" button | Endpoint wrapping `daily_sync` |
| **No holdings-snapshot or sell-allocation read endpoints** | Can't show broker-reported holdings next to platform positions, or which SELL closed which lot | Add read endpoints (tables exist) |
| **No candidate-signals endpoint for manual matching** | UI must query `/signals?symbol=X&timeframe=1d&since=…` and filter client-side | Optional convenience endpoint |
| **No portfolio aggregates** (total exposure, P&L curve, per-strategy stats) | Compute client-side from positions, or skip in v1 | Add later |
| **`/signals/fresh` is unpaginated** | Large payloads for 1h | Always filter by timeframe; add pagination later |
| **Signals don't include name/industry** | Join with `/symbols` client-side (501 rows, cache it) | Fine as is |
| **No notifications** (email/push/Telegram) for EXIT verdicts or failed syncs | In-app only | Later |

## 12. Design direction and open questions

**Direction (suggestions, not fixed):**
- A professional trading tool, not a consumer app. Think terminal-grade density with modern clarity: compact tables, tabular (monospaced) numerals, right-aligned numbers, sticky headers, keyboard navigation.
- Verdict and status colours need text labels too (red/green alone fails for colour-blind users and in dense tables). Keep REVIEW visually distinct from EXIT: it means "check the data", not "sell".
- Support light and dark themes. Dark is common for trading tools.
- Desktop-first (it's an evening review and analysis tool). Make Today and Positions readable on a phone, since checking verdicts on the go is plausible.
- Charts are central. A TradingView-style candlestick chart with overlays and sub-panes (e.g. TradingView Lightweight Charts) is the expected quality bar.

**Open questions for Shyan (the designer should not decide these alone):**
1. Should 1h/4h appear in the UI at all before the broker feed lands, or be hidden behind a setting?
2. How should Confluence be presented: its own tab, a filter, or only as a "confirms" badge on event signals?
3. Is position sizing (qty from account risk %) wanted in the signal view, and if so what capital/risk inputs?
4. Group positions by symbol by default, or show per-lot rows by default?
5. Is mobile a real use case, or desktop-only for v1?
