# Stock Screen UI

Web front end for Stock Screen (see `BUILD_BRIEF.md` and `docs/UI_HANDOFF.md`).

## Run

```
npm install
npm run dev
```

The backend (FastAPI) must be running on `http://localhost:8000`. The Vite dev
server proxies `/api/*` to it (see `vite.config.ts`), so the app itself runs
at `http://localhost:5173`.

## Mock mode

The real database currently has no broker accounts, trades or positions. To
design/exercise those screens against fixture data instead of the live API:

```
VITE_MOCK=1 npm run dev
```

In mock mode, `/me`, `/broker-accounts*` and `/positions*` are served from
`src/api/mock.ts`. Market-data routes (`/symbols`, `/candles`, `/signals`,
etc.) still hit the real backend.

## Settings

Stored in `localStorage`, editable from the Settings page:

| Key | Meaning |
|---|---|
| `ss.apiKey` | `X-API-Key` sent on authenticated requests. Falls back to `VITE_DEV_API_KEY` (see `.env.local`) when empty. |
| `ss.theme` | `light` \| `dark` \| `system` |
| `ss.defaultTimeframe` | `1d` \| `4h` \| `1h` (default `1d`) |
| `ss.showIntraday` | Whether to show 1h/4h timeframes at all (default `false`) |

Copy `.env.example` to `.env.local` to set `VITE_DEV_API_KEY` / `VITE_MOCK` for your machine; `.env.local` is git-ignored.

## Pages

| Route | Page | Needs API key |
|---|---|---|
| `/` | Today — evening brief: pipeline status, positions needing action, broker sync alerts, fresh signals, upcoming corporate actions on held symbols | partly |
| `/signals` | Scanner: fresh signals with filters (event strategies by default; Confluence separated) | no |
| `/symbols/:symbol` | Candlestick chart (lightweight-charts) with EMA/Supertrend/BB/KC overlays, Volume/MACD/ADX/RVOL/TTM panes, signal and corporate-action markers, demerger banner | no |
| `/positions`, `/positions/:id` | Book: lots, verdicts, levels, verdict history, signal match, fills | yes |
| `/trades` | Raw broker fills; reattribute a SELL across lots | yes |
| `/brokers` | Linked accounts: add, test, sync, import tradebook CSV, deactivate | yes |
| `/ops` | Health, pipeline triggers, runs log, corporate-actions browser | partly |
| `/settings` | API key, theme, default timeframe, show 1h/4h | no |

Production build: `npm run build` → `dist/`. There is no CORS on the backend,
so a deployed build must be served from the same origin as the API (or the
backend needs CORS middleware); in development the Vite proxy handles it.

## Known backend gaps the UI works around

See `docs/UI_HANDOFF.md` §11. In short: no login flow (raw API key), no
daily-job summary endpoint (Today reconstructs it from `/ingest/runs`), no
read endpoints for holdings snapshots or sell allocations, `/signals/fresh`
is unpaginated (always filtered by timeframe here), and `Trade` rows carry no
broker-account id (reattribution filters candidate lots by symbol only).
