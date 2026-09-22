# FileDrop

Tradebook CSV import: a button, a drop zone, and the expected columns (required solid, optional dashed).

- **Props:** `onFile`, `busy`, `result`.
- `result` is the `import-tradebook` response. It renders rows read, upserted, unmapped, buys opened, sells allocated, orphan sells and errors. Non-zero unmapped, orphan and error counts turn `down`.
