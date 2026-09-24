# SessionBar

The top bar on every screen. It shows the trading session date, the EOD reminder, the daily job's status and time, and an optional data note, with room on the right for search.

- **Props:** `session` (YYYY-MM-DD), `pipeline` (`ok` | `running` | `warning` | `failed`), `pipelineAt` (UTC), `dataNote`, `children`.
- It makes the end-of-day nature of the data visible without a clock or a ticker.
