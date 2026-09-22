# Banner

A page-level alert.

- **Props:** `tone`, `title`, `children`, `actions`, `role`.
- **Tones:**
  - `failed` (red, role alert): a failed broker sync. It must always include the "Import tradebook CSV" action, because Groww only returns today's fills.
  - `degraded` (marigold): candle ingest failed, so signals and verdicts ran on the previous day's candles.
  - `review` (violet, dashed): data needs a human look.
  - `info`.
- Put banners at the top of Today, above the counts. Write a specific title with the date and account, and a single sentence saying what it means for tonight.
