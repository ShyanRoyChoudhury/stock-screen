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

function isAlerting(a: BrokerAccount, expected: string): boolean {
  if (!a.active) return false
  if (a.last_sync_status !== 'ok') return true
  if (a.last_sync_on === null) return true
  return a.last_sync_on < expected
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
  const alerting = settings.apiKey ? (accountsData ?? []).filter((a) => isAlerting(a, expected)) : []

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
      {alerting.map((a) => (
        <Banner
          key={a.id}
          tone="failed"
          title={`Broker sync failed · ${a.label} (${a.broker}) · ${a.last_sync_status ?? 'stale'}`}
          actions={
            <Button variant="danger" size="sm" icon="upload" onClick={() => navigate(`/brokers?import=${a.id}`)}>
              Import tradebook CSV
            </Button>
          }
        >
          {`Last good sync ${fmt.date(a.last_sync_on ?? '', true)}. Fills from ${fmt.date(session, true)} are lost to the API after today — upload the tradebook CSV before tomorrow’s 16:15 IST run.`}
        </Banner>
      ))}
      {ingest && ingest.status === 'failed' ? (
        <Banner tone="degraded" title={`Degraded: candle ingest failed for ${fmt.date(session, true)}`}>
          Signals and verdicts below ran on the previous session’s candles.
        </Banner>
      ) : null}
    </>
  )
}
