import { useState } from 'react'
import { useStartSignals } from '../../api/hooks'
import { Button } from '../../components/Button'
import { Chip } from '../../components/Chip'
import type { Strategy, Timeframe } from '../../api/types'
import { STRATEGIES } from '../../lib/domain'
import { TimeframeCheckboxes, describeError } from './utils'

export function TriggerSignals({ disabled }: { disabled: boolean }) {
  const [timeframes, setTimeframes] = useState<Set<Timeframe>>(new Set(['1d', '4h', '1h']))
  const [strategies, setStrategies] = useState<Set<Strategy>>(new Set())
  const [symbolsText, setSymbolsText] = useState('')
  const mutation = useStartSignals()

  function toggleTf(tf: Timeframe) {
    setTimeframes((prev) => {
      const next = new Set(prev)
      if (next.has(tf)) next.delete(tf)
      else next.add(tf)
      return next
    })
  }

  function toggleStrategy(s: Strategy) {
    setStrategies((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function submit() {
    const symbols = symbolsText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    mutation.mutate({
      timeframes: Array.from(timeframes),
      symbols: symbols.length ? symbols : undefined,
      strategies: strategies.size ? Array.from(strategies) : undefined,
    })
  }

  const isDisabled = disabled || mutation.isPending || timeframes.size === 0

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <h4 className="text-sm font-semibold">Signals</h4>
      <div className="flex flex-wrap items-center gap-2">
        <TimeframeCheckboxes selected={timeframes} onToggle={toggleTf} disabled={disabled} />
        <input
          type="text"
          placeholder="RELIANCE,TCS (optional)"
          value={symbolsText}
          onChange={(e) => setSymbolsText(e.target.value)}
          disabled={disabled}
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {STRATEGIES.map((s) => (
          <button
            key={s.key}
            type="button"
            disabled={disabled}
            onClick={() => toggleStrategy(s.key)}
            className={strategies.has(s.key) ? '' : 'opacity-40'}
          >
            <Chip variant="strategy" value={s.key} />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">No strategies selected = run all strategies.</p>
      <div>
        <Button size="sm" onClick={submit} disabled={isDisabled}>
          {mutation.isPending ? 'Starting…' : 'Generate signals'}
        </Button>
      </div>
      {mutation.isSuccess && (
        <p className="text-xs text-up">
          Started run #{mutation.data.id} →{' '}
          <a href="#runs-log" className="underline">
            see runs log
          </a>
        </p>
      )}
      {mutation.isError && <p className="text-xs text-down">{describeError(mutation.error)}</p>}
    </div>
  )
}
