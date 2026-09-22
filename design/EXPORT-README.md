# Stock Screen UI

Front end for the Stock Screen backend (FastAPI, `http://localhost:8000`). The backend brief is `UI_HANDOFF.md`.

## Layout
- `design-system/` — the source of truth for look and behaviour.
  - `README.md`: brand book and usage rules. Read it before building UI.
  - `tokens.json` / `tokens.css`: colours (dark first, light second), type, spacing, radius, sizes. Never hard-code a colour; use `var(--token)`.
  - `components/`: `bundle.js` exposes `window.StockScreen` (React 18 components + `fmt` + `labels`); `bundle.css` styles them; `index.d.ts` has the props; each folder has a README and a live `preview.html`.
  - `src/index.jsx`: component source. `npm run build` rebuilds `components/bundle.js`.
  - `fonts/`: IBM Plex Sans, Mono and Sans Condensed (woff2, includes ₹).
- `prototype/` — clickable app on sample data. `npm run serve`, then open http://localhost:5173.
  - `src/data.js`: sample universe, indicators, strategies, verdict engine and matcher (sample only; the backend is authoritative).
  - `src/app.jsx`: screens (Today, Signals, Symbol, Positions, Position, Trades, Brokers, Data & Ops, Settings). `src/chart.jsx`: Lightweight Charts wrapper.
  - `npm run build` rebuilds `public/app.js`.

## Rules
- Format every number with `fmt` / `<Num>`: Indian grouping, 2 decimals, U+2212 minus. `risk_pct` is a percent, `*_pnl_pct` are fractions.
- The API returns UTC. Show IST (`fmt.date`, `fmt.time`); daily candles as a date only.
- Verdict chips always sit next to their reason codes. REVIEW must never look like EXIT.
- 1h/4h is experimental: default to 1d and badge anything else EXP.
- The app never places orders.

## Next step: wire to the real API
Add CORS to FastAPI (or serve `prototype/public` from FastAPI), then swap the sample `buildWorld()` for fetches to the endpoints in §10 of the handoff. The data shapes already match the API.
