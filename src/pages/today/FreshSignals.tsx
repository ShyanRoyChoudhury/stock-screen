// Handoff §5.1: today's 1d signals by strategy. Confluence is a state (§5.2 design
// constraint), so it's kept separate from the event-strategy counts and table.
//
// /signals/fresh?days=1 is time-window based (now - 1 day), not calendar-date based, so it
// is often empty until the evening job has produced today's bar (verified against the real
// backend: empty at midday on 22 Sep, 72 rows for the 21 Sep session with days=2). A second,
// tiny query (/signals?timeframe=1d&limit=1, newest first) finds the latest bar's date
// regardless of that window, so the "stale" note can be shown without an extra loading state.

import { Link } from 'react-router'
import { useFreshSignals, useSignals, useSymbols } from '../../api/hooks'
import { Panel } from '../../components/Panel'
import { Chip } from '../../components/Chip'
import { Stat } from '../../components/Stat'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { fmtInr, fmtPct, fmtIstDate, istDateKey } from '../../lib/format'
import { STRATEGIES } from '../../lib/domain'
import type { Signal } from '../../api/types'
import { todayIstKey } from './utils'

const OPEN_SCANNER = (
  <Link to="/signals?timeframe=1d&days=1" className="text-xs text-accent underline">
    Open scanner →
  </Link>
)

export function FreshSignals() {
  const fresh = useFreshSignals({ days: 1, timeframe: '1d' })
  const latest = useSignals({ timeframe: '1d', limit: 1 })
  const symbols = useSymbols()

  if (fresh.isLoading) {
    return (
      <Panel title="Fresh signals" actions={OPEN_SCANNER}>
        <Loading label="Loading fresh signals…" />
      </Panel>
    )
  }
  if (fresh.isError) {
    return (
      <Panel title="Fresh signals" actions={OPEN_SCANNER}>
        <ErrorState error={fresh.error} />
      </Panel>
    )
  }

  const signals = fresh.data ?? []
  const todayKey = todayIstKey()

  if (signals.length === 0) {
    const latestSignal = latest.data?.[0]
    const latestKey = latestSignal ? istDateKey(latestSignal.ts) : null
    const stale = latestKey !== null && latestKey < todayKey
    return (
      <Panel title="Fresh signals" actions={OPEN_SCANNER}>
        {stale && latestSignal ? (
          <p className="text-sm text-muted">
            Latest bar: {fmtIstDate(latestSignal.ts)} (the daily job runs after the close)
          </p>
        ) : (
          <EmptyState title="No fresh signals" message="Nothing fired on 1d in the last day." />
        )}
      </Panel>
    )
  }

  const nameBySymbol = new Map((symbols.data ?? []).map((s) => [s.symbol, s.name]))
  const eventSignals = signals.filter((s) => s.strategy !== 'Confluence')
  const confluenceCount = signals.length - eventSignals.length
  const distinctSymbols = new Set(signals.map((s) => s.symbol)).size

  const byStrategy = new Map<string, number>()
  for (const s of signals) byStrategy.set(s.strategy, (byStrategy.get(s.strategy) ?? 0) + 1)

  const top10 = eventSignals
    .filter((s): s is Signal & { risk_pct: number } => s.risk_pct !== null)
    .sort((a, b) => a.risk_pct - b.risk_pct)
    .slice(0, 10)

  return (
    <Panel title="Fresh signals" actions={OPEN_SCANNER}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-4">
          <Stat label="Event signals" value={eventSignals.length} />
          <Stat label="Distinct symbols" value={distinctSymbols} />
          <div className="opacity-60">
            <Stat label="Confluence (state)" value={confluenceCount} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {STRATEGIES.map((s) => (
            <div key={s.key} className={`flex items-center gap-1.5 ${s.kind === 'state' ? 'opacity-60' : ''}`}>
              <Chip variant="strategy" value={s.key} />
              <span className="num text-xs text-muted">{byStrategy.get(s.key) ?? 0}</span>
            </div>
          ))}
        </div>

        {top10.length > 0 && (
          <div className="w-full overflow-x-auto">
            <table className="dense">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Strategy</th>
                  <th className="align-right">Entry</th>
                  <th className="align-right">Stop</th>
                  <th className="align-right">Risk %</th>
                </tr>
              </thead>
              <tbody>
                {top10.map((s, i) => (
                  <tr key={`${s.symbol}-${s.strategy}-${i}`}>
                    <td>
                      <Link
                        to={`/symbols/${s.symbol}`}
                        className="text-accent hover:underline"
                        title={nameBySymbol.get(s.symbol) ?? undefined}
                      >
                        {s.symbol}
                      </Link>
                    </td>
                    <td>
                      <Chip variant="strategy" value={s.strategy} />
                    </td>
                    <td className="align-right num">{fmtInr(s.entry)}</td>
                    <td className="align-right num">{fmtInr(s.stop_loss)}</td>
                    <td className="align-right num">{fmtPct(s.risk_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  )
}
