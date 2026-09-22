# TimeframeBadge

Timeframe marker.

- **Props:** `timeframe` (`1d` | `4h` | `1h`).
- `1d` is the primary, trusted feed and has a plain border.
- `4h` and `1h` come from an unreconciled Yahoo hourly feed. They render dashed in `review` violet with EXP.
- Show this badge wherever a non-daily value appears (tables, chart header, signal panel).
