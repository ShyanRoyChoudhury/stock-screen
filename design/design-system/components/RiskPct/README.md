# RiskPct

A signal's `risk_pct` (entry to stop, in percent) with a scale bar, so high-risk setups stand out in a long table.

- **Props:** `value`, `caution` (default 3), `high` (default 8), `max` (bar full-scale, default 16).
- Above `high`, the value turns `down` with a `!`. Values from S1/S2 often exceed 12–15%, while PIPELINE is capped at 1%.
