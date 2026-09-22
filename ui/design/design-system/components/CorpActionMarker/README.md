# CorpActionMarker

A corporate action: a lettered glyph (D dividend, S split, B bonus, R rights, DM demerger), its subject and its ex-date.

- **Props:** `type`, `exDate`, `subject`, `showLabel`.
- Demergers are dashed violet with "Not price-adjusted", because stored prices show a false cliff.
- For held symbols, pair it with the reminder that the broker may cancel GTT stops on the ex-date.
