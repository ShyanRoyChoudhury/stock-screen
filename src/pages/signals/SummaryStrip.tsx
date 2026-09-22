import { Chip } from '../../components/Chip'
import { STRATEGY_BY_KEY } from '../../lib/domain'
import type { Signal, Strategy } from '../../api/types'

interface SummaryStripProps {
  signals: Signal[]
  strategies: Strategy[]
}

export function SummaryStrip({ signals, strategies }: SummaryStripProps) {
  const symbols = new Set(signals.map((s) => s.symbol))
  const counts = new Map<Strategy, number>()
  for (const s of signals) counts.set(s.strategy, (counts.get(s.strategy) ?? 0) + 1)

  return (
    <div className="flex flex-wrap items-center gap-4 rounded border border-border bg-surface px-3 py-2 text-sm">
      <span className="flex items-baseline gap-1">
        <span className="num font-semibold">{signals.length}</span>
        <span className="text-muted">signals</span>
      </span>
      <span className="flex items-baseline gap-1">
        <span className="num font-semibold">{symbols.size}</span>
        <span className="text-muted">symbols</span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {strategies.map((key) => {
          const n = counts.get(key) ?? 0
          if (n === 0) return null
          return (
            <Chip key={key} variant="strategy" value={key}>
              {`${STRATEGY_BY_KEY[key].label} · ${n}`}
            </Chip>
          )
        })}
      </span>
    </div>
  )
}
