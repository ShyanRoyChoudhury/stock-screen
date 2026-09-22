// Expandable row content for the Signals table: app.jsx 211-228 (SignalDetail).
// Left column: Scorecard (Confluence) or a KV grid (other strategies), the
// RETEST defect note, and "Open chart". Right column: a ~70-bar MiniChart
// ending 15 bars after the signal, fetched lazily (only while the row is open).

import { useNavigate } from 'react-router'
import { useCandles } from '../../api/hooks'
import type { Signal } from '../../api/types'
import { Button, KV, MiniChart, Scorecard, type MiniChartMarker } from '../../ds'
import { readObj, readStr, renderDetailValue } from './details'

function dayKey(ts: string): string {
  return ts.slice(0, 10)
}

interface SignalDetailProps {
  signal: Signal
  symbolName?: string
}

export function SignalDetail({ signal: s, symbolName }: SignalDetailProps) {
  const navigate = useNavigate()
  const d = s.details ?? {}

  // "~70 bars ending 15 bars after the signal": the API's `end` is a window edge, not an
  // exact bar, so we ask for a window that comfortably contains the signal bar plus ~15
  // bars of follow-through, then locate the signal's own bar inside whatever comes back.
  const end = new Date(new Date(s.ts).getTime() + 20 * 86_400_000).toISOString()
  const candlesQuery = useCandles(s.symbol, { timeframe: s.timeframe, end, limit: 70 })
  const bars = candlesQuery.data ?? []
  const signalIndex = bars.findIndex((b) => dayKey(b.ts) === dayKey(s.ts))
  const markers: MiniChartMarker[] = signalIndex >= 0 ? [{ index: signalIndex, kind: 'signal' }] : []

  return (
    <div className="app-sigd">
      <div className="app-sigd-l">
        {s.strategy === 'Confluence' ? (
          <Scorecard score={readStr(d, 'score') ?? '—'} conviction={readStr(d, 'conviction')} breakdown={readObj(d, 'breakdown') ?? {}} />
        ) : (
          <KV items={Object.entries(d).map(([k, v]) => [k.replace(/_/g, ' '), renderDetailValue(k, v)] as const)} />
        )}
        {s.strategy === 'PIPELINE' && s.entry_mode === 'RETEST' ? (
          <span className="ss-muted app-small">RETEST logic has a known defect (tests continuation, not a true retest).</span>
        ) : null}
        <div className="app-row">
          <Button size="sm" variant="primary" icon="symbol" onClick={() => navigate(`/symbols/${s.symbol}?sig=${s.strategy}@${dayKey(s.ts)}`)}>
            Open chart
          </Button>
          <span className="ss-muted app-small">{symbolName}</span>
        </div>
      </div>
      {bars.length ? (
        <div className="app-sigd-r">
          <MiniChart
            bars={bars.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }))}
            width={440}
            height={180}
            levels={[
              { kind: 't2', label: 'T2', value: s.target_2 },
              { kind: 't1', label: 'T1', value: s.target_1 },
              { kind: 'entry', label: 'E', value: s.entry },
              { kind: 'stop', label: 'SL', value: s.stop_loss },
            ]}
            markers={markers}
          />
        </div>
      ) : null}
    </div>
  )
}
