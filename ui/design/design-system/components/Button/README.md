# Button

Buttons for actions the operator takes in the app: sync, import, evaluate, match. Since the platform never places orders, no button is labelled Buy or Sell.

- **Variants:**
  - `primary` (accent) is the one thing the view is for. Use at most one per panel.
  - `secondary` is the default.
  - `danger` (exit fill) is only for the urgent recovery action "Import tradebook CSV" after a failed sync.
  - `ghost` is for navigation-like and tertiary actions.
- **Sizes:** `md` (`control-md`, 30px) and `sm` (`control-sm`, 24px) for toolbars, table rows and cards.
- **Props:** `variant`, `size`, `icon` (an `Icon` name), `kbd` (shortcut hint, e.g. `"s"`), `loading`, plus any `<button>` attribute.
- **Labels:** verb first, sentence case ("Sync now", "Re-evaluate", "Import tradebook CSV").
- **When disabled,** always give a `title` saying why. For example, pipeline triggers are disabled with "A run is active: signals #214" while the API would return 409.
