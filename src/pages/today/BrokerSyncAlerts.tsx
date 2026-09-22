// Handoff §5.1 + §2: an account is alerting when its sync is broken, missing, or older than the
// expected sync date (see `expectedSyncDate` in ./utils — the trading day whose sync should
// already be complete, which lags by a day until 16:30 IST so a mid-day check doesn't cry wolf).
// Groww only returns today's trades, so a failed/missing sync must be acted on before it rolls off.

import { Link, useNavigate } from 'react-router'
import { useBrokerAccounts } from '../../api/hooks'
import { Panel } from '../../components/Panel'
import { Chip } from '../../components/Chip'
import { Button } from '../../components/Button'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { fmtIstDate } from '../../lib/format'
import { useSettings } from '../../lib/settings'
import type { BrokerAccount } from '../../api/types'
import { expectedSyncDate } from './utils'

const SYNC_STATUS_LABEL: Record<string, string> = { ok: 'OK', auth_failed: 'Auth failed', error: 'Error' }

function isAlerting(a: BrokerAccount, expected: string): boolean {
  if (!a.active) return false
  if (a.last_sync_status !== 'ok') return true
  if (a.last_sync_on === null) return true
  return a.last_sync_on < expected
}

function AccountsList() {
  const { data: accounts, isLoading, isError, error } = useBrokerAccounts()
  const navigate = useNavigate()

  if (isLoading) return <Loading label="Loading broker accounts…" />
  if (isError) return <ErrorState error={error} />
  const rows = accounts ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No broker account linked"
        action={
          <Link to="/brokers" className="text-sm text-accent underline">
            Add a broker →
          </Link>
        }
      />
    )
  }

  const expected = expectedSyncDate()
  const alerting = rows.filter((a) => isAlerting(a, expected))
  const okRows = rows.filter((a) => a.active && !isAlerting(a, expected))

  if (alerting.length === 0 && okRows.length === 0) {
    return <EmptyState title="No active broker accounts" />
  }

  return (
    <div className="flex flex-col gap-3">
      {alerting.length > 0 && (
        <ul className="flex flex-col gap-2">
          {alerting.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 rounded border border-warn bg-surface-2 px-2 py-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.label}</span>
                <Chip variant="status" value={a.last_sync_status ?? 'never'}>
                  {a.last_sync_status ? (SYNC_STATUS_LABEL[a.last_sync_status] ?? a.last_sync_status) : 'Never synced'}
                </Chip>
                <span className="text-xs text-muted">
                  {a.last_sync_on ? `Last sync ${fmtIstDate(a.last_sync_on)}` : 'Never synced'}
                </span>
              </div>
              {a.last_sync_message && <p className="text-xs text-muted">{a.last_sync_message}</p>}
              <p className="text-xs text-muted">
                Groww returns only today's trades — if today's sync failed, import the tradebook CSV before tomorrow.
              </p>
              <Button size="sm" variant="primary" className="w-fit" onClick={() => navigate('/brokers')}>
                Import tradebook CSV
              </Button>
            </li>
          ))}
        </ul>
      )}

      {okRows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {okRows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{a.label}</span>
              <Chip variant="status" value="ok">
                OK
              </Chip>
              <span className="text-xs text-muted">synced {fmtIstDate(a.last_sync_on)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function BrokerSyncAlerts() {
  const { settings } = useSettings()
  return (
    <Panel title="Broker sync alerts">
      {!settings.apiKey ? <ApiKeyPrompt message="Broker sync status needs an API key to load." /> : <AccountsList />}
    </Panel>
  )
}
