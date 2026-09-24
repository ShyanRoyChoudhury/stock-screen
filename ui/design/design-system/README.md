Stock Screen is an end-of-day decision-support terminal for swing-trading NSE equities (Nifty 500). It is used by one expert operator every evening after the 16:15 IST daily job. It is advisory only: it reads from the broker and never places orders. Every screen answers the same three questions: did last night's data run cleanly, what needs action and why, and what set up today.

## Principles

1. **Density first.** 13px base, 26–32px rows, many columns. Never add onboarding copy, illustrations or empty padding to fill space.
2. **Exact numbers.** Every price shows 2 decimals, Indian digit grouping and ₹ (`₹1,23,456.78`). Never round away precision, abbreviate to lakh/crore in tables, or show a bare colour without the number.
3. **Show why.** A verdict chip always has its reason codes beside it. A signal always has its levels. A status dot always has a word.
4. **Say how much to trust it.** Experimental timeframes, demerger cliffs, degraded runs and unmatched positions are marked where the data appears, not in a help page.
5. **End of day.** No live tickers, blinking prices or "real-time" framing. The session date and the daily job's status sit in the top bar on every screen.

## Content fundamentals

- **Voice:** terse, declarative, trader-to-trader. Use "Close below stop", not "Your position may have hit its stop". Address the user as "you" only in instructions ("Import today's tradebook"). No exclamation marks, emoji or praise.
- **Casing:** sentence case for headings, buttons and messages ("Import tradebook CSV"). UPPERCASE only in the `label` style: column headers, field labels, verdicts and badges.
- **Keep the system's words exactly.** Show verdicts, reason codes, warning codes, strategy keys and API statuses verbatim, in `code` or mono: `EXIT`, `STOP_HIT`, `S1_ST_Flip`, `auth_failed`. Put the plain-language label next to the code. Never rename a code.
- **Numbers:** use `−` (U+2212) for minus and `+` for positive changes. Percent fields keep 2 decimals. Multiples use `×` ("2.05×"). R:R is a bare ratio ("1.10"). Quantities have no decimals.
- **Dates and times:** always IST. Trading dates read `21 Sep 2026`, with the weekday when it matters (`Mon 21 Sep 2026`). Times are 24-hour with the zone: `16:47 IST`. Daily candles show a date only. Use `fmt.date`/`fmt.time`: the API returns UTC.
- **Real examples:** "Degraded: candle ingest failed for Mon 21 Sep. Signals and verdicts below ran on Fri 18 Sep candles." · "Unmatched: trailing stop only, no targets." · "Broker may cancel GTT stops on ex-date. Re-place them after."

## Visual foundations

**Colour.** Dark is the primary theme and light is its equal. Both are in `tokens.json`, with dark listed first.
- Grounds step down from `surface-raised` (headers, nav, popovers) to `surface` (panels, tables), `bg` (page) and `surface-sunken` (chart canvas, expanded rows). Separate panels with `line` hairlines, not shadows. `shadow-pop` is only for things that float.
- Text: `ink` for data, `ink-muted` for headers and metadata, `ink-faint` only for tertiary ids at 12px+ on `surface`/`bg`. Every text/ground pair named in a token's usage note holds 4.5:1 in both themes.
- **Market direction follows Indian and Western convention: green up, red down.** `up` and `down` are only for price direction, P&L and bullish/bearish state. Always pair them with a sign or ▲▼, because colour alone is not enough for colour-blind users.
- **Verdicts each have their own treatment**, so a verdict can be told apart by shape and word as well as hue:
  - `EXIT`: a solid `exit` fill (an alias of `down`) with ■. The loudest thing on any screen.
  - `PARTIAL`: a solid `partial` (marigold) fill with ◧, meaning half booked.
  - `REVIEW`: `review` violet, hatched, with a ?. It means "data unsure", never "sell", so it must not look like EXIT.
  - `HOLD`: a quiet outline in `hold`.
- `accent` (azure) is for interaction only: links, the selected tab, the active nav item, the keyboard-cursor bar and the primary button. Never use it for market meaning.
- `focus` (marigold) is the focus ring: 2px solid with a 2px offset, and at least 3:1 on every ground.
- Warnings (the six warning codes) sit on `partial-soft` with a `!`. They are informational and never change a verdict.
- Chart colours are their own tokens (`candle-*`, `volume-*`, `ema-50`, `ema-200`, `bb-band`, `kc-band`, `macd-*`, `level-*`, `marker-*`). The full chart (TradingView Lightweight Charts) reads the same values, so overlays match the legend everywhere.

**Type.** IBM Plex, loaded from the bundled files.
- `sans` (Plex Sans) is for UI text: base `body` 13/20.
- `mono` (Plex Mono) is for every number, code and date in a table: `num`, `num-sm`, `num-lg`, `num-xl`, `code`. Numbers are always right-aligned and tabular.
- `cond` (Plex Sans Condensed) is for UPPERCASE labels (`label`, `label-lg`), so column headers never set a column's width.
- Use one `title` per screen. `num-xl` is only for the verdict counts on Today.

**Space and shape.** Spacing uses `space-2` to `space-48`. Table cells are `space-8` inline. Panels use `space-12`/`space-16` padding. Panels sit `space-24` apart (`space-16` on phones).
- Data surfaces are square (`radius-0`).
- Chips and tags use `radius-2`, controls `radius-4`, and panels and banners `radius-6`, which is the largest radius.
- Rows are `row-compact` (26px, Signals) or `row-default` (32px). Controls are `control-md` (30px) or `control-sm` (24px).

**Layout.** Desktop-first shell: `NavRail` (`nav-width`) + `SessionBar` (`topbar`) + page.
- Headers stay sticky.
- Keyboard: `g`+letter moves between screens, `j`/`k` or arrows move the row cursor, `↵` expands a row, `/` searches for a symbol.
- Under 720px, the nav hides, grids collapse to one column, and wide tables scroll inside their own frame. Today and Positions must stay readable on a phone.

**States.**
- Hover is `row-hover`. Selection is `row-selected` with a 2px `accent` bar.
- Disabled uses `ink-disabled`, and its tooltip explains why (e.g. "A run is active: signals #214").
- A running process pulses only its dot, and the pulse respects `prefers-reduced-motion`.
- Nothing else animates. There are no transitions on data.

## Trust markers (use them wherever the data appears)

- **1h / 4h data:** `TimeframeBadge` renders these dashed, in `review` violet, marked EXP. Signals default to 1d.
- **Confluence is a state, not an event.** `StrategyTag` gives it a hollow ring (event strategies get a solid square). In tables, dim its rows or split it into its own tab so it never buries event signals.
- **Demergers:** `CorpActionMarker type="demerger"` shows "Not price-adjusted". On charts, use `marker-demerger`.
- **Degraded or failed runs:** show a `Banner` at the top of Today. For a failed broker sync, use `tone="failed"`, which always carries the "Import tradebook CSV" action.
- **High risk:** `RiskPct` flags values over 8% with `!` and `down`.
- **Unmatched positions:** `LevelLadder matched={false}` states "trailing stop only, no targets".

## Iconography

The system uses its own 16px line icons (1.5px stroke, square caps), exported as `Icon` with names `today`, `signals`, `positions`, `symbol`, `trades`, `brokers`, `ops`, `options`, `settings`, `upload`, `sync`, `search`, `chevron` and `external`. They inherit `currentColor`.
- Keep icons for navigation and actions. Never use them as decoration in data cells.
- Status and meaning are carried by glyphs in the type: ■ ◧ ? · for verdicts, ▲ ▼ for direction, ✓ ✗ for checks, ! for warnings.
- No emoji. The one exception is the ⚡ in Confluence's own `HIGH ⚡` conviction value, which is shown verbatim.
- There is no logo yet. The product name is set in `mono` uppercase ("STOCK SCREEN") next to the ▮▯ glyph.

## Using the components

The components are in `components/bundle.js` as `window.StockScreen`, and they need React 18 on the page. The namespace also exports:
- `fmt`: `inr`, `price`, `qty`, `pct`, `frac`, `mult`, `rr`, `date`, `time`, `dateTime` and `dur`.
- `labels`: every verdict, reason, warning, strategy and corporate-action label.

**Always format through `fmt` or `Num`.** Watch the unit traps:
- `risk_pct` is a percent (`kind="pct"`).
- `unrealized_pnl_pct` and `realized_pnl_pct` are fractions (`kind="frac"`).
- `rr_ratio` exists only for some strategies. Compute R:R with `fmt.rr` for every row.
