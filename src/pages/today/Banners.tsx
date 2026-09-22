// app.jsx 93-101: the banner stack at the top of Today — a running-run notice, one failed-sync
// banner per alerting broker account, and a degraded-ingest notice. Order matches the prototype.
//
// The broker-alert rule is kept from the previous implementation (not the prototype's sample-data
// stand-in `a.broker !== 'zerodha' && ...`): an account alerts when it's active and its sync is
// broken, missing, or older than the expected sync date (see `expectedSyncDate` — the trading day
// whose sync should already be complete, lagging by a day until 16:30 IST).

import { useNavigate } from 'react-router'
import { Banner, Button, fmt } from '../../ds'
import { useBrokerAccounts, useRuns } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import type { BrokerAccount } from '../../api/types'
import { expectedSyncDate } from './utils'

type AlertKind = 'failed' | 'stale' | 'never'

/** Classifies why an active account is alerting, so the banner can say the right thing:
 *  a hard failure (auth_failed/error), a sync that's simply behind schedule (status ok but
 *  last_sync_on predates the expected session), or one that has never completed at all. */
function alertKind(a: BrokerAccount, expected: string): AlertKind | null {
  if (!a.active) return null
  if (a.last_sync_status === 'auth_failed' || a.last_sync_status === 'error') return 'failed'
  if (a.last_sync_on === null) return 'never'
  if (a.last_sync_status === 'ok' && a.last_sync_on < expected) return 'stale'
  return null
}

export function Banners({ session }: { session: string }) {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const { data: runsData } = useRuns(50)
  const runs = runsData ?? []
  const running = runs.find((r) => r.status === 'running')
  const ingest = runs.find((r) => r.mode === 'incremental' || r.mode === 'backfill')

  const { data: accountsData } = useBrokerAccounts({ enabled: !!settings.apiKey })
  const expected = expectedSyncDate()
  const alerting = settings.apiKey
    ? (accountsData ?? [])
        .map((a) => ({ account: a, kind: alertKind(a, expected) }))
        .filter((x): x is { account: BrokerAccount; kind: AlertKind } => x.kind !== null)
    : []

  return (
    <>
      {running ? (
        <Banner
          tone="info"
          title={`Run #${running.id} · ${running.mode} in progress`}
          actions={
            <Button size="sm" onClick={() => navigate('/ops')}>
              Open Data &amp; Ops
            </Button>
          }
        >
          {running.symbols_ok}/{running.symbols_total} symbols. Triggers are disabled until it finishes.
        </Banner>
      ) : null}
      {alerting.map(({ account: a, kind }) => {
        const actions = (
          <Button
            variant={kind === 'failed' ? 'danger' : 'primary'}
            size="sm"
            icon="upload"
            onClick={() => navigate(`/brokers?import=${a.id}`)}
          >
            Import tradebook CSV
          </Button>
        )
        if (kind === 'failed') {
          return (
            <Banner
              key={a.id}
              tone="failed"
              title={`Broker sync failed · ${a.label} (${a.broker}) · ${a.last_sync_status ?? 'error'}`}
              actions={actions}
            >
              {`Last good sync ${fmt.date(a.last_sync_on ?? '', true)}. Fills from ${fmt.date(session, true)} are lost to the API after today — upload the tradebook CSV before tomorrow’s 16:15 IST run.`}
            </Banner>
          )
        }
        if (kind === 'stale') {
          return (
            <Banner
              key={a.id}
              tone="degraded"
              title={`Broker sync behind · ${a.label} (${a.broker}) · last sync ${fmt.date(a.last_sync_on ?? '', true)}`}
              actions={actions}
            >
              {`The ${fmt.date(expected, true)} session’s fills are not in the platform yet. Groww only serves the current day’s trades — upload the tradebook CSV before tomorrow’s 16:15 IST run.`}
            </Banner>
          )
        }
        return (
          <Banner key={a.id} tone="degraded" title={`Broker never synced · ${a.label} (${a.broker})`} actions={actions}>
            {`No sync has completed for this account yet. Groww only serves the current day’s trades — upload the tradebook CSV before tomorrow’s 16:15 IST run.`}
          </Banner>
        )
      })}
      {ingest && ingest.status === 'failed' ? (
        <Banner tone="degraded" title={`Degraded: candle ingest failed for ${fmt.date(session, true)}`}>
          Signals and verdicts below ran on the previous session’s candles.
        </Banner>
      ) : null}
    </>
  )
}
