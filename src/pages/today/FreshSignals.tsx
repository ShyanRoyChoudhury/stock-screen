// app.jsx 125-133: "Fresh 1d signals" — counts per strategy for the latest session. KEEPS the
// richer session logic from the previous implementation: /signals/fresh?days=N is a wall-clock
// window, not a calendar-date filter, so days=1 is often empty until the evening job has produced
// today's bar (verified against the real backend). Fix: widen to days=3, then take the latest IST
// calendar date actually present in the response as "the session" this panel reports on.

import { useNavigate } from 'react-router'
import { Button, cx, ErrorState, fmt, labels, Loading, Panel, StrategyTag } from '../../ds'
import { useFreshSignals } from '../../api/hooks'
import { istDateKey } from '../../lib/format'
import { todayIstKey } from './utils'

export function FreshSignals() {
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useFreshSignals({ days: 3, timeframe: '1d' })

  if (isLoading) {
    return (
      <Panel title="Fresh 1d signals">
        <Loading label="Loading fresh signals…" />
      </Panel>
    )
  }
  if (isError) {
    return (
      <Panel title="Fresh 1d signals">
        <ErrorState error={error} />
      </Panel>
    )
  }

  const signals = data ?? []
  const dateKeys = signals.map((s) => istDateKey(s.ts)).filter((d): d is string => d !== null)
  const sessionDate = dateKeys.length ? dateKeys.reduce((a, b) => (a > b ? a : b)) : null
  const sessionSignals = sessionDate ? signals.filter((s) => istDateKey(s.ts) === sessionDate) : []
  const distinctSymbols = new Set(sessionSignals.map((s) => s.symbol)).size

  const byStrategy = new Map<string, number>()
  for (const s of sessionSignals) byStrategy.set(s.strategy, (byStrategy.get(s.strategy) ?? 0) + 1)
  const strategies = Object.keys(labels.strategies).sort((a, b) => (byStrategy.get(b) ?? 0) - (byStrategy.get(a) ?? 0))

  return (
    <Panel
      title="Fresh 1d signals"
      right={
        <>
          <span className="ss-muted ss-n app-small">
            {sessionSignals.length} · {distinctSymbols} symbols
          </span>
          <Button size="sm" variant="ghost" kbd="g s" onClick={() => navigate('/signals')}>
            Signals
          </Button>
        </>
      }
    >
      <div className="app-strat-grid">
        {strategies.map((k) => (
          <button type="button" key={k} className="app-strat-row" onClick={() => navigate(`/signals?strategy=${k}&days=1`)}>
            <StrategyTag strategy={k} />
            <span className={cx('ss-n', !byStrategy.get(k) && 'ss-faint')}>{byStrategy.get(k) ?? 0}</span>
          </button>
        ))}
      </div>
      {sessionDate && sessionDate !== todayIstKey() ? (
        <p className="ss-muted app-small" style={{ margin: '8px 0 0' }}>
          Session of {fmt.date(sessionDate)} · the daily job runs after the close
        </p>
      ) : null}
    </Panel>
  )
}
