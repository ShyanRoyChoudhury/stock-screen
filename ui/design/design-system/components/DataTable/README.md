# DataTable

The dense, sortable, keyboard-navigable table behind Signals, Positions, Trades and the runs log.

- **Props:**
  - `columns`: `[{key, label, align, width, sortable, sortValue, render, title}]`
  - `rows`
  - `rowKey`
  - `density` (`compact` 26px | `default` 32px)
  - `initialSort`
  - `renderExpanded` (row expand, e.g. a Confluence `Scorecard` or the `details` object)
  - `onRowOpen`
  - `rowClassName` (`ss-dim` de-emphasises rows, e.g. Confluence)
  - `footer`
  - `maxHeight`
  - `ariaLabel`
- **Behaviour:** sticky headers. Numbers are right-aligned via `align: "right"` (numeric columns sort descending first). `↑↓` / `j k` move the cursor and `↵` expands.
- **Large results:** `/signals/fresh` is unpaginated, so page or virtualise large results and always filter by timeframe.
- **R:R** is computed client-side with `fmt.rr` for every row.
- `SymbolCell` (also exported) renders a symbol with an optional name or sub-line.
