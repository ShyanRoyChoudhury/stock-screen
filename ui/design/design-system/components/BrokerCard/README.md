# BrokerCard

A linked broker account.

- **Props:** `account`, `lastTradingDay`, `onTest`, `onSync`, `onImport`, `onDeactivate`, `busy`.
- **Loud states:**
  - A failed sync (`auth_failed` / `error`) gets a red top rule and explains that the day's fills are lost to the API. "Import tradebook CSV" becomes the danger action.
  - A stale sync (`last_sync_on` ≠ last trading day) gets a marigold rule.
- `zerodha` accounts show "CSV import only", with sync and test disabled.
