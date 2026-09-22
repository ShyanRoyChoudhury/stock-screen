# Field

A labelled text input.

- **Props:** `label`, `hint`, `error`, `mono`, `secret`, `saved`, plus input attributes.
- `secret` is for broker API keys and TOTP secrets, which are write-only. After save, render `saved` so the field shows "Stored encrypted · write-only, never shown again". Never refill it.
- Show API errors verbatim with their status (e.g. 409 duplicate broker+label).
