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
