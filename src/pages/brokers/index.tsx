// Brokers — handoff §5.6. Linked-account cards, test/sync/import/deactivate
// actions, global sync-all, and add-account onboarding.

import { useState } from 'react'
import { useBrokerAccounts, useTestBrokerAccount, useSyncBrokerAccount, useSyncAllBrokerAccounts, useImportTradebook, useDeactivateBrokerAccount, useCreateBrokerAccount } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import { fmtIstDate } from '../../lib/format'
import { ApiError } from '../../api/types'
import type { Broker, BrokerAccount, SyncResult, ImportResult } from '../../api/types'
import { Panel } from '../../components/Panel'
import { Chip } from '../../components/Chip'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Select } from '../../components/Select'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { Loading } from '../../components/Loading'

const BROKER_LABEL: Record<Broker, string> = { groww: 'Groww', zerodha: 'Zerodha' }

const SYNC_STATUS_LABEL: Record<string, string> = { ok: 'OK', auth_failed: 'Auth failed', error: 'Error' }

const BROKER_OPTIONS = [
  { value: 'groww', label: 'Groww' },
  { value: 'zerodha', label: 'Zerodha (CSV import only, no live client yet)' },
]

function testErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 501) return 'No live client for this broker; use CSV import'
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

function addAccountErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'An account with this broker/label already exists'
    if (error.status === 503) return "Server has no BROKER_MASTER_KEY configured; credentials can't be encrypted"
    return error.message
  }
  return error instanceof Error ? error.message : String(error)
}

export default function BrokersPage() {
  const { settings } = useSettings()
  const { data: accounts, isLoading, isError, error } = useBrokerAccounts()
  const [addOpen, setAddOpen] = useState(false)
  const syncAllMutation = useSyncAllBrokerAccounts()

  if (!settings.apiKey) return <ApiKeyPrompt message="Brokers needs your API key to load linked accounts." />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Brokers</h1>
          <p className="text-sm text-muted">Connect and maintain broker access.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => syncAllMutation.mutate()} disabled={syncAllMutation.isPending}>
            {syncAllMutation.isPending ? 'Syncing all…' : 'Sync all'}
          </Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            Add account
          </Button>
        </div>
      </div>

      {syncAllMutation.isError && <ErrorState error={syncAllMutation.error} title="Sync all failed" />}
      {syncAllMutation.isSuccess && syncAllMutation.data && (
        <Panel title="Sync all results">
          <ul className="flex flex-col gap-1 text-xs">
            {syncAllMutation.data.results.map((r) => (
              <li key={r.account_id}>
                Account #{r.account_id}: {r.ok ? `OK — ${r.result?.trades.upserted ?? 0} trades upserted` : `Failed — ${r.error}`}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {isLoading && <Loading label="Loading broker accounts…" />}
      {isError && <ErrorState error={error} />}
      {!isLoading && !isError && (!accounts || accounts.length === 0) && (
        <EmptyState
          title="No broker accounts linked"
          action={
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              Add account
            </Button>
          }
        />
      )}
      {!isLoading && !isError && accounts && accounts.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <BrokerCard key={a.id} account={a} />
          ))}
        </div>
      )}

      <AddAccountDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

function BrokerCard({ account }: { account: BrokerAccount }) {
  const [syncOpen, setSyncOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const testMutation = useTestBrokerAccount()

  const needsAttention = account.last_sync_status === 'auth_failed' || account.last_sync_status === 'error'

  return (
    <Panel className={needsAttention ? 'border-2 border-warn' : ''}>
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">
              {BROKER_LABEL[account.broker]} — {account.label}
            </p>
            <p className="text-xs text-muted">{account.active ? 'Active' : 'Inactive'}</p>
          </div>
          {account.last_sync_status ? (
            <Chip variant="status" value={account.last_sync_status}>
              {SYNC_STATUS_LABEL[account.last_sync_status] ?? account.last_sync_status}
            </Chip>
          ) : (
            <Chip variant="neutral">Never synced</Chip>
          )}
        </div>

        <p className="text-xs text-muted">Last sync: {account.last_sync_on ? fmtIstDate(account.last_sync_on) : 'never'}</p>
        {account.last_sync_message && <p className="text-xs text-muted">{account.last_sync_message}</p>}

        {needsAttention && (
          <div className="rounded border border-warn bg-surface-2 p-2 text-xs text-warn">
            <p>Groww's API only returns today's trades — if today's sync failed, import the tradebook CSV before tomorrow.</p>
            <Button size="sm" className="mt-1" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => testMutation.mutate(account.id)} disabled={testMutation.isPending}>
            {testMutation.isPending ? 'Testing…' : 'Test'}
          </Button>
          <Button size="sm" onClick={() => setSyncOpen(true)}>
            Sync now
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button size="sm" variant="danger" onClick={() => setDeactivateOpen(true)} disabled={!account.active}>
            Deactivate
          </Button>
        </div>

        {testMutation.isSuccess && testMutation.data && <p className="text-xs text-up">OK — {testMutation.data.holdings} holdings</p>}
        {testMutation.isError && <p className="text-xs text-down">{testErrorMessage(testMutation.error)}</p>}
      </div>

      <SyncDialog open={syncOpen} onClose={() => setSyncOpen(false)} accountId={account.id} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} accountId={account.id} />
      <DeactivateDialog open={deactivateOpen} onClose={() => setDeactivateOpen(false)} account={account} />
    </Panel>
  )
}

function SyncDialog({ open, onClose, accountId }: { open: boolean; onClose: () => void; accountId: number }) {
  const [day, setDay] = useState('')
  const mutation = useSyncBrokerAccount()

  return (
    <Dialog open={open} onClose={onClose} title="Sync now">
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Day (optional — defaults to today)
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
        </label>
        <Button
          variant="primary"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ id: accountId, body: day ? { day } : undefined })}
        >
          {mutation.isPending ? 'Syncing…' : 'Sync'}
        </Button>
        {mutation.isError && <ErrorState error={mutation.error} title="Sync failed" />}
        {mutation.isSuccess && mutation.data && <SyncResultView result={mutation.data} />}
      </div>
    </Dialog>
  )
}

function SyncResultView({ result }: { result: SyncResult }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-2 text-xs">
      <p>
        Trades: {result.trades.received} received, {result.trades.upserted} upserted, {result.trades.unmapped} unmapped
      </p>
      <p>Holdings: {result.holdings}</p>
      {result.ledger && (
        <p>
          Ledger: {result.ledger.buys_opened} buys opened, {result.ledger.sells_allocated} sells allocated, {result.ledger.orphan_sells.length} orphan sells
        </p>
      )}
    </div>
  )
}

function ImportDialog({ open, onClose, accountId }: { open: boolean; onClose: () => void; accountId: number }) {
  const [file, setFile] = useState<File | null>(null)
  const mutation = useImportTradebook()

  return (
    <Dialog open={open} onClose={onClose} title="Import tradebook CSV">
      <div className="flex flex-col gap-2 text-sm">
        <div className="rounded border border-border bg-surface-2 p-2 text-xs text-muted">
          <p className="font-medium text-text">Expected columns</p>
          <p>Required: trade_date or date (YYYY-MM-DD or DD-MM-YYYY), symbol and/or isin, side or trade_type (BUY/SELL), quantity, price.</p>
          <p>Optional: exchange (NSE), segment (CASH), product (CNC), time (HH:MM, default 15:29), trade_id.</p>
        </div>
        <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <Button variant="primary" disabled={!file || mutation.isPending} onClick={() => file && mutation.mutate({ id: accountId, file })}>
          {mutation.isPending ? 'Importing…' : 'Import'}
        </Button>
        {mutation.isError && <ErrorState error={mutation.error} title="Import failed" />}
        {mutation.isSuccess && mutation.data && <ImportResultView result={mutation.data} />}
      </div>
    </Dialog>
  )
}

function ImportResultView({ result }: { result: ImportResult }) {
  return (
    <div className="rounded border border-border bg-surface-2 p-2 text-xs">
      <p>
        {result.rows} rows, {result.upserted} upserted, {result.unmapped} unmapped
      </p>
      {result.ledger && (
        <>
          <p>
            Ledger: {result.ledger.buys_opened} buys opened, {result.ledger.sells_allocated} sells allocated, {result.ledger.orphan_sells.length} orphan sells
          </p>
          {result.ledger.errors.length > 0 && <p className="text-down">{result.ledger.errors.length} errors</p>}
        </>
      )}
    </div>
  )
}

function DeactivateDialog({ open, onClose, account }: { open: boolean; onClose: () => void; account: BrokerAccount }) {
  const mutation = useDeactivateBrokerAccount()

  return (
    <Dialog open={open} onClose={onClose} title="Deactivate account">
      <div className="flex flex-col gap-2 text-sm">
        <p>
          Deactivate {BROKER_LABEL[account.broker]} — {account.label}? This stops future syncs; existing trades and positions are kept.
        </p>
        <div className="flex gap-2">
          <Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate(account.id, { onSuccess: onClose })}>
            {mutation.isPending ? 'Deactivating…' : 'Deactivate'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
        {mutation.isError && <ErrorState error={mutation.error} />}
      </div>
    </Dialog>
  )
}

function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [broker, setBroker] = useState<Broker>('groww')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const mutation = useCreateBrokerAccount()

  function reset() {
    setLabel('')
    setApiKey('')
    setTotpSecret('')
    setBroker('groww')
    mutation.reset()
  }

  function handleClose() {
    onClose()
    reset()
  }

  function submit() {
    mutation.mutate(
      { broker, label, api_key: apiKey, totp_secret: totpSecret },
      { onSuccess: handleClose },
    )
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Add broker account">
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Broker
          <Select options={BROKER_OPTIONS} value={broker} onChange={(v) => setBroker(v as Broker)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          API key
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          TOTP secret
          <input type="password" value={totpSecret} onChange={(e) => setTotpSecret(e.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-sm text-text" />
        </label>
        <p className="text-xs text-muted">Stored encrypted; never shown again.</p>
        <Button variant="primary" disabled={!label || !apiKey || !totpSecret || mutation.isPending} onClick={submit}>
          {mutation.isPending ? 'Adding…' : 'Add account'}
        </Button>
        {mutation.isError && <p className="text-xs text-down">{addAccountErrorMessage(mutation.error)}</p>}
      </div>
    </Dialog>
  )
}
