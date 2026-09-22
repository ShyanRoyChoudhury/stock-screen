// Handoff §5.1 + §2: an account is alerting when its sync is broken, missing, or stale on a
// trading weekday. Groww only returns today's trades, so a failed sync must be acted on today.

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
import { isIstWeekday, todayIstKey } from './utils'

const SYNC_STATUS_LABEL: Record<string, string> = { ok: 'OK', auth_failed: 'Auth failed', error: 'Error' }

function isAlerting(a: BrokerAccount, todayKey: string, weekday: boolean): boolean {
  if (!a.active) return false
  if (a.last_sync_status !== 'ok') return true
  if (a.last_sync_on === null) return true
  if (weekday && a.last_sync_on < todayKey) return true
  return false
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

  const todayKey = todayIstKey()
  const weekday = isIstWeekday()
  const alerting = rows.filter((a) => isAlerting(a, todayKey, weekday))

  if (alerting.length === 0) {
    const dates = rows.filter((a) => a.active && a.last_sync_on).map((a) => a.last_sync_on as string)
    const latest = dates.length ? [...dates].sort().at(-1) : null
    return (
      <p className="text-sm text-up">
        All {rows.length} account{rows.length === 1 ? '' : 's'} synced{latest ? ` ${fmtIstDate(latest)}` : ''}.
      </p>
    )
  }

  return (
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
