# VerdictTimeline

A position's verdict history, newest first, one row per trading day: date and days held, verdict, close, stop, trail (when separate), P&L, and codes. A row whose verdict differs from the previous day is flagged "verdict changed".

- **Props:** `entries` (the `/positions/{id}/evaluations` response).
