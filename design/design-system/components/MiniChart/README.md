# MiniChart

A static SVG candlestick chart for side panels and row expands.

- **Props:**
  - `bars`: `[{o,h,l,c,v}]`
  - `width`, `height`
  - `ema50`, `ema200` (arrays aligned to `bars`)
  - `levels`: `[{kind: entry|stop|trail|t1|t2, value, label}]`
  - `markers`: `[{index, kind: signal|action|demerger, glyph}]`
  - `volume`, `axis`
- The full Symbol chart uses TradingView Lightweight Charts, configured from the same chart tokens.
- Stop is solid, trail and targets are dashed. Signal markers are accent triangles under the bar, and corporate actions are lettered squares, with demergers in `marker-demerger`.
