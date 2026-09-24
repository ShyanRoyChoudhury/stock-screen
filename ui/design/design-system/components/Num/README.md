# Num

The only way to print a number. It sets mono tabular figures, Indian digit grouping, `−` for minus and optional ₹.

- **Props:** `value`, `kind`, `decimals`, `signed`, `tone`, `currency`.
- **`kind` values:**
  - `price` (default, 2dp, no symbol)
  - `inr` (₹)
  - `qty`
  - `int`
  - `pct` (the value is already a percent, e.g. `risk_pct` 8.92)
  - `frac` (the value is a fraction, e.g. `unrealized_pnl_pct` 0.019 → 1.90%)
  - `mult` (2.05×)
  - `rr`
- `tone="auto"` colours by sign (`up` / `down` / muted zero). Use it only for changes and P&L, never for levels.
- `null` renders a disabled em dash. Indicators are null during warm-up.
- Unrealised ₹ is not in the API. Compute `qty_open × (latest_evaluation.close − avg_entry_price)`.
