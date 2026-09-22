# PipelineSteps

The daily job as a step list: status, name, optional message, counts and IST finish time. A running step shows its progress percentage.

- **Props:** `steps`: `[{name, status, finishedAt, counts, message, progress}]`.
- There is no daily-job endpoint yet. Build the steps from `/ingest/runs` rows (ingest, indicators, signals, broker_sync, evaluate).
