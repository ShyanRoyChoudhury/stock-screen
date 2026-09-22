# Build brief — Stock Screen UI

The product spec is `docs/UI_HANDOFF.md`. **This file is the engineering contract**: stack, layout, tokens, API types, conventions. When the two disagree on engineering matters, this file wins; on product matters (what a screen shows), the handoff wins.

Backend: FastAPI on `http://localhost:8000` (already running). The UI talks to it through the Vite dev proxy at `/api/*` (no CORS on the backend). All backend responses are JSON; errors are `{ "detail": string | object[] }`.

## Stack (fixed — do not substitute)

| Concern | Choice |
|---|---|
| Build | Vite 6, React 19, TypeScript (strict) |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite`; design tokens as CSS variables (below) |
| Routing | `react-router` v7 (library mode: `BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink`, `useParams`, `useSearchParams`) |
| Data | `@tanstack/react-query` v5 |
| Charts | `lightweight-charts` v5 (TradingView). **Read `node_modules/lightweight-charts/dist/typings.d.ts` for the real v5 API before writing chart code** (`createChart`, `chart.addSeries(CandlestickSeries, opts, paneIndex)`, `createSeriesMarkers`, `series.createPriceLine`). |
| Icons | `lucide-react` |
| Fonts | System stack only (no web fonts): `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Numbers use `font-variant-numeric: tabular-nums`. |
| Tables | Hand-rolled (`components/DataTable.tsx`): column defs, client-side sort, client-side pagination (page size 100), sticky header, dense rows. No table library. |
| Dates | Native `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`. No date library. |

Package manager: npm. Scripts: `dev`, `build` (runs `tsc -b && vite build`), `preview`, `typecheck` (`tsc --noEmit -p tsconfig.app.json`), `lint` (optional).

## Layout and navigation

Desktop-first. **Top app bar** (48px): brand "Stock Screen" left; nav links; right side: pipeline-status dot (green/amber/red from latest runs), theme toggle, account menu (`/me` name or "No API key"). Content area full-width with 16px gutters, max content width none (dense tool). On <768px the nav collapses into a menu button.

Routes (all lazy-loaded via `React.lazy`):

| Path | Page | Auth |
|---|---|---|
| `/` | Today | mixed (public parts render without a key; position/broker panels show a key prompt) |
| `/signals` | Signals | public |
| `/symbols/:symbol` (`?tf=1d`) | Symbol detail | public (+held-position overlay when key present) |
| `/positions`, `/positions/:id` | Positions | key |
| `/trades` | Trades | key |
| `/brokers` | Brokers | key |
| `/ops` | Data & Ops | public |
| `/options` | Placeholder ("Coming later") | — |
| `/settings` | Settings (API key, theme, default timeframe, show 1h/4h) | — |

Auth model: the API key lives in `localStorage` (`ss.apiKey`) and is sent as `X-API-Key` on every request that needs it. A page that needs a key and has none renders `<ApiKeyPrompt/>` (short explanation + link to Settings) inside the page, not a full-app gate. A 401 clears nothing; it shows an inline "Invalid API key" error with a link to Settings.

Settings persisted in `localStorage`: `ss.apiKey`, `ss.theme` (`light|dark|system`), `ss.defaultTimeframe` (`1d` default), `ss.showIntraday` (boolean, default **false** — hides 1h/4h options everywhere when false). Wrap every storage read/write in try/catch.

Mock mode: when `import.meta.env.VITE_MOCK === '1'`, `apiFetch` serves the **authenticated** routes (`/me`, `/broker-accounts*`, `/positions*`) from `src/api/mock.ts` fixtures instead of the network; market-data routes still hit the real API. Purpose: design validation of populated position/broker screens (the real DB has none yet). Fixtures: build them from handoff §10.2 and extend to ~6 positions covering every verdict (HOLD, PARTIAL, EXIT, REVIEW), one unmatched position, one closed position, two broker accounts (one `ok`, one `auth_failed`), ~8 trades (BUYs and SELLs, one unmapped with `symbol: null`), and 5 evaluation-history rows for position 1. Use real Nifty 500 symbols (CARBORUNIV, RELIANCE, BHEL, PATANJALI, USHAMART, CDSL) so symbol-detail navigation from mock positions still finds real candles.

## Design tokens (`src/index.css`)

Define under `@theme` so Tailwind v4 emits `bg-surface`, `text-muted`, etc., then override the variables for dark. Dark applies when `:root[data-theme="dark"]`, or when `:root:not([data-theme="light"])` and `prefers-color-scheme: dark`. `body` gets an explicit `background: var(--color-bg); color: var(--color-text)`.

```
Light                              Dark
--color-bg:        #f5f6f8         #0e1116
--color-surface:   #ffffff         #161a21
--color-surface-2: #eef0f3         #1d222b
--color-border:    #d9dde3         #2a3039
--color-text:      #14171c         #e6e9ee
--color-muted:     #5b6470         #9aa3b0
--color-accent:    #2563eb         #60a5fa
--color-up:        #15803d         #22c55e
--color-down:      #dc2626         #f87171
--color-exit:      #dc2626         #f87171
--color-partial:   #d97706         #fbbf24
--color-review:    #7c3aed         #a78bfa
--color-hold:      #64748b         #94a3b8
--color-warn:      #b45309         #f59e0b
```

Base font size 13px; table row height 28px; cell padding 4px 8px; numeric cells right-aligned with tabular-nums; 2-decimal prices; borders 1px `border`; radius 4px; no drop shadows heavier than `0 1px 2px rgb(0 0 0 / .06)`.

**Verdict chips always carry the text label** (never colour alone). REVIEW must look distinct from EXIT (violet vs red).

## Source layout (fixed)

```
src/
  main.tsx                 providers: QueryClientProvider, BrowserRouter, ThemeProvider
  App.tsx                  Shell + lazy routes
  index.css                tailwind import, @theme tokens, dark overrides, base styles
  api/client.ts            apiFetch<T>(path, init?) → parses JSON, throws ApiError{status,message}; adds X-API-Key; base '/api'; mock hook
  api/types.ts             ALL response/request types (copied from this brief)
  api/endpoints.ts         one typed function per endpoint (below)
  api/hooks.ts             react-query hooks wrapping endpoints (useSymbols, useCandles, ...), query keys
  api/mock.ts              fixtures + router for mock mode
  lib/format.ts            fmtInr, fmtNum, fmtPct (percent input), fmtFrac (fraction input → %), fmtIstDate, fmtIstDateTime, rr(), signedClass()
  lib/domain.ts            STRATEGIES (key, label, kind: 'event'|'state', colour, description), VERDICTS, REASON_LABELS, WARNING_LABELS, TIMEFRAMES, RUN_MODES, ACTION_TYPES, INDUSTRIES helper
  lib/settings.ts          typed localStorage settings + useSettings() hook (React context)
  lib/theme.ts             theme resolution + <ThemeProvider/>
  components/              Shell, TopNav, DataTable, Chip (verdict/strategy/status), Panel, Stat, EmptyState, ErrorState, Loading, ApiKeyPrompt, ExperimentalBadge, Tooltip, Toggle, Select, Button, Dialog
  charts/CandleChart.tsx   lightweight-charts wrapper (owned by the Symbol-page builder)
  pages/today/ pages/signals/ pages/symbol/ pages/positions/ pages/trades/ pages/brokers/ pages/ops/ pages/settings/ pages/options/
```

Rules for page builders working in parallel: **edit only your own `pages/<x>/` folder (and `charts/` if assigned)**. Do not edit `api/`, `lib/`, `components/`, `App.tsx`, `index.css`. If something shared is missing, create it inside your own page folder and note it in your final report so it can be promoted later.

## Endpoints (`api/endpoints.ts`) — exact paths and types

```ts
// Public
health(): {status:string; database:string}
listSymbols(activeOnly=true): Symbol[]
refreshSymbols(): unknown                                       // POST /symbols/refresh
getCandles(symbol, {timeframe, start?, end?, limit?}): Candle[]  // GET /candles/{symbol}   limit ≤ 10000, oldest→newest
getIndicators(symbol, {timeframe, start?, end?, limit?}): IndicatorRow[]  // GET /indicators/{symbol}, same order/alignment as candles
listSignals({symbol?, strategy?, timeframe?, since?, limit?}): Signal[]   // GET /signals   limit ≤ 5000, newest first
freshSignals({days?, strategy?, timeframe?}): Signal[]          // GET /signals/fresh  days 1..30 (default 3); UNPAGINATED — always pass timeframe
listCorporateActions({symbol?, action_type?, limit?}): CorporateAction[]  // limit ≤ 500
loadCorporateActions(body: {from_date?, to_date?, symbols?}): unknown      // POST, synchronous
startIngest(body: {mode:'backfill'|'incremental'; timeframes: Timeframe[]; symbols?: string[]}): IngestRun   // 202; 409 if a run is active
startIndicators(body: {timeframes?; symbols?}): IngestRun       // POST /indicators/run
startSignals(body: {timeframes?; symbols?; strategies?}): IngestRun       // POST /signals/run
listRuns(limit=20): IngestRun[]                                 // GET /ingest/runs (all modes, newest first)
getRun(id): IngestRun                                           // GET /ingest/runs/{id}

// Authenticated (X-API-Key)
me(): User
listBrokerAccounts(): BrokerAccount[]
createBrokerAccount(body: {broker:'groww'|'zerodha'; label; api_key; totp_secret}): BrokerAccount  // 201; 409 dup; 503 master key missing
deactivateBrokerAccount(id): BrokerAccount                      // DELETE
testBrokerAccount(id): {ok:boolean; holdings:number}            // POST .../test ; 501 no client ; 502 broker error
syncBrokerAccount(id, body: {day?: string}): SyncResult         // POST .../sync
syncAllBrokerAccounts(): {accounts:number; results:{account_id:number; ok:boolean; result?:SyncResult; error?:string}[]}
importTradebook(id, file: File): ImportResult                   // POST .../import-tradebook  multipart field name "file"
listTrades({from_date?, to_date?, symbol?}): Trade[]            // GET /broker-accounts/trades  newest first
listPositions(status?: 'open'|'closed'): Position[]
getPosition(id): Position
positionEvaluations(id): Evaluation[]                           // newest first
evaluationsForDay(as_of?: string): Evaluation[]                 // GET /positions/evaluations
evaluatePositions(body: {as_of?: string}): {as_of:string; evaluated:number; by_verdict:Record<Verdict,number>; errors:{position_id:number; error:string}[]}
matchPosition(id, body: {strategy: Strategy; ts: string}): Position   // 404 if no such 1d signal
reattributeSell(sellId, body: {allocations:{position_id:number; quantity:number}[]}): unknown   // 422 with message on invalid split
```

## Types (`api/types.ts`) — copy verbatim, then extend only if the API proves different

```ts
export type Timeframe = '1h' | '4h' | '1d';
export type Strategy = 'PIPELINE' | 'S1_ST_Flip' | 'S2_MACD_Zero' | 'S3_BB_Squeeze' | 'TTM_Squeeze' | 'Confluence';
export type Verdict = 'HOLD' | 'PARTIAL' | 'EXIT' | 'REVIEW';
export type RunMode = 'backfill' | 'incremental' | 'indicators' | 'signals' | 'broker_sync' | 'evaluate';
export type RunStatus = 'running' | 'completed' | 'failed';
export type ActionType = 'dividend' | 'split' | 'bonus' | 'rights' | 'demerger';
export type Broker = 'groww' | 'zerodha';
export type SyncStatus = 'ok' | 'auth_failed' | 'error';

export interface Symbol { id: number; symbol: string; name: string | null; industry: string | null; isin: string | null; active: boolean }
export interface Candle { ts: string; timeframe: Timeframe; open: number; high: number; low: number; close: number; volume: number }
export interface IndicatorRow {
  ts: string; timeframe: Timeframe;
  atr_10: number | null; supertrend_10_3: number | null; supertrend_dir: 1 | -1 | null;
  macd_12_26: number | null; macd_signal_9: number | null; macd_hist: number | null;
  ema_50: number | null; ema_200: number | null; adx_14: number | null;
  bb_upper_20_2: number | null; bb_middle_20_2: number | null; bb_lower_20_2: number | null; bb_bandwidth: number | null;
  volume_ma_20: number | null;
  kc_upper_20_15: number | null; kc_middle_20: number | null; kc_lower_20_15: number | null;
  ttm_squeeze_on: boolean | null; ttm_squeeze_off: boolean | null; ttm_momentum: number | null;
  rvol_20: number | null; computed_at: string;
}
export interface Signal {
  symbol: string; strategy: Strategy; timeframe: Timeframe; ts: string;
  entry_mode: 'IMMEDIATE' | 'RETEST' | null;
  entry: number; stop_loss: number; target_1: number; target_2: number;
  risk_pct: number | null;   // PERCENT (8.92 = 8.92%)
  rr_ratio: number | null;   // only Confluence and TTM_Squeeze fill this; compute client-side otherwise
  details: Record<string, unknown>;
}
export interface CorporateAction {
  symbol: string; action_type: ActionType; ex_date: string; record_date: string | null;
  value: number | null; ratio_from: number | null; ratio_to: number | null; price_factor: number | null;
  is_extraordinary: boolean; affects_share_count: boolean; subject: string;
}
export interface IngestRun {
  id: number; mode: RunMode; status: RunStatus; timeframes: string[];
  symbols_total: number; symbols_ok: number; symbols_failed: number;
  candles_written: number;   // generic "rows written" for every mode
  message: string | null; errors: { symbol?: string; position_id?: number; error: string }[];
  started_at: string; finished_at: string | null;
}
export interface User { id: number; name: string; email: string | null; created_at: string }
export interface BrokerAccount {
  id: number; broker: Broker; label: string; active: boolean;
  last_sync_on: string | null; last_sync_status: SyncStatus | null; last_sync_message: string | null; created_at: string;
}
export interface Trade {
  id: number; broker: string; tradingsymbol: string; symbol: string | null; isin: string | null;
  side: 'BUY' | 'SELL'; quantity: number; price: number; trade_ts: string; trade_date: string;
  position_id: number | null; applied_at: string | null;
}
export interface ReasonCode { code: string; detail: string | null }
export interface Evaluation {
  position_id: number; as_of: string; bar_ts: string; close: number; high: number; low: number;
  stop_level: number | null; trail_level: number | null; target_1: number | null; target_2: number | null;
  supertrend_dir: 1 | -1 | null; atr: number | null; verdict: Verdict;
  reasons: ReasonCode[]; warnings: ReasonCode[];
  unrealized_pnl_pct: number;   // FRACTION (0.019 = 1.9%)
  days_held: number;
}
export interface Position {
  id: number; user_id: number; broker_account_id: number; symbol_id: number; symbol: string;
  status: 'open' | 'closed'; opened_on: string; entry_trade_id: number;
  qty_open: number; qty_total: number;
  avg_entry_price: number;       // adjusted (comparable to chart)
  avg_entry_price_raw: number;   // as paid
  structural_factor_applied: number; last_restated_on: string | null;
  matched_strategy: Strategy | null; matched_signal_ts: string | null; matched_timeframe: Timeframe;
  match_confidence: number | null; match_reason: string | null; is_unmatched: boolean;
  frozen_entry: number | null; frozen_stop: number | null; frozen_target_1: number | null; frozen_target_2: number | null;
  frozen_details: Record<string, unknown>;
  closed_on: string | null; exit_trade_id: number | null;
  realized_pnl: number | null;       // ₹ gross
  realized_pnl_pct: number | null;   // FRACTION
  last_evaluated_on: string | null; last_verdict: Verdict | null;
  created_at: string; updated_at: string;
  latest_evaluation: Evaluation | null;
}
export interface LedgerResult { buys_opened: number; sells_allocated: number; orphan_sells: {trade_id:number; leftover:number}[]; skipped_unmapped: number; errors: {trade_id:number; error:string}[] }
export interface SyncResult { trades: { received: number; upserted: number; unmapped: number }; holdings: number; ledger: LedgerResult | null }
export interface ImportResult { rows: number; upserted: number; unmapped: number; ledger: LedgerResult | null }
export class ApiError extends Error { constructor(public status: number, message: string, public detail?: unknown) { super(message) } }
```

## Domain constants (`lib/domain.ts`)

- `STRATEGIES`: ordered `PIPELINE, S1_ST_Flip, S2_MACD_Zero, S3_BB_Squeeze, TTM_Squeeze, Confluence` with `label` (e.g. "Supertrend flip", "MACD zero-cross", "BB squeeze breakout", "TTM squeeze", "Pipeline (breakout/retest)", "Confluence"), `kind: 'event' | 'state'` (Confluence is `state`), a distinct chart-marker colour each, and the one-line description from handoff §6.1.
- `REASON_LABELS` and `WARNING_LABELS`: the plain-language labels from handoff §6.2, keyed by code. Unknown codes fall back to the code itself.
- `VERDICT_META`: order `EXIT, PARTIAL, REVIEW, HOLD`, colour token per verdict, one-line meaning.
- `TIMEFRAMES = ['1d','4h','1h']` with `trusted: boolean` (only 1d).
- `RUN_MODE_LABELS`, `ACTION_TYPE_LABELS`.

## Formatting rules (`lib/format.ts`)

- `fmtInr(n, {decimals=2})` → `₹1,23,456.78` (Indian grouping via `Intl.NumberFormat('en-IN')`). Negative: `−₹1,234.00` (use a real minus sign).
- `fmtNum(n, decimals)` → `en-IN` grouping without the ₹.
- `fmtPct(p)` for values already in percent (`risk_pct`) → `8.92%`.
- `fmtFrac(f)` for fractions (`unrealized_pnl_pct`, `realized_pnl_pct`) → `+1.90%` (with sign).
- `fmtIstDate(iso)` → `21 Sep 2026`; `fmtIstDateTime(iso)` → `22 Sep 2026, 09:32 IST`. Daily candle `ts` is 03:45Z = 09:15 IST → always show daily bars as dates.
- `rr(entry, stop, t1)` → `(t1-entry)/(entry-stop)`, `null` if stop ≥ entry.
- Never round prices below 2 decimals. Compact numbers only for volume (`1.0 Cr`, `12.5 L` Indian units, with a full tooltip).

## Definition of done for every page

- Loading, empty, error (`ApiError` message visible), and no-API-key states.
- Handles `null` indicator/signal fields.
- Works in light and dark.
- Readable at 390px width (Today and Positions must be genuinely usable there; others may scroll horizontally).
- `npm run typecheck` and `npm run build` pass.
