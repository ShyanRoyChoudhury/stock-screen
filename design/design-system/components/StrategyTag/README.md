# StrategyTag

A strategy key in mono, verbatim. Event strategies (PIPELINE, S1_ST_Flip, S2_MACD_Zero, S3_BB_Squeeze, TTM_Squeeze) get a solid square. Confluence is a *state* that fires on ~23% of daily bars, so it gets a hollow ring and muted ink.

- **Props:** `strategy`, `extra` (e.g. PIPELINE's `entry_mode`, or a match-confidence suffix).
- Don't restyle Confluence to compete with the event strategies.
