# StatusDot

Status of a pipeline step, run or broker sync, as a dot plus a word.

- **Props:** `status`, `label`, `bare`.
- **Accepted `status` values:** `ok`, `completed`, `running`, `warning`, `degraded`, `failed`, `error`, `auth_failed`, `never`, `pending`, `skipped`.
- **Each state has its own shape:**
  - ok is a green disc.
  - running is an accent disc that pulses.
  - warning is a marigold diamond.
  - failed is a red square.
  - never is a hollow ring.
- Only `bare` (inside `PipelineSteps`) drops the word, and then the row name carries it.
