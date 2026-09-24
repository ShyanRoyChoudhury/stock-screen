# StatTile

A count tile.

- **Props:** `label`, `value`, `sub`, `verdict`, `size` (`lg` | `sm`), `onClick`.
- On Today, show one tile per verdict (EXIT, PARTIAL, REVIEW, HOLD). The `verdict` prop sets the top rule and the chip, and clicking a tile filters the list.
- A zero value dims to `ink-faint`.
- Use `sm` for secondary counts such as fresh signals.
