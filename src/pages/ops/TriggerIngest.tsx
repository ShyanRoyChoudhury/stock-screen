import { useState } from 'react'
import { useStartIngest } from '../../api/hooks'
import { Select } from '../../components/Select'
import { Button } from '../../components/Button'
import type { Timeframe } from '../../api/types'
import { TimeframeCheckboxes, describeError } from './utils'

export function TriggerIngest({ disabled }: { disabled: boolean }) {
  const [mode, setMode] = useState<'backfill' | 'incremental'>('incremental')
  const [timeframes, setTimeframes] = useState<Set<Timeframe>>(new Set(['1d', '4h', '1h']))
  const [symbolsText, setSymbolsText] = useState('')
  const mutation = useStartIngest()

  function toggleTf(tf: Timeframe) {
    setTimeframes((prev) => {
      const next = new Set(prev)
      if (next.has(tf)) next.delete(tf)
      else next.add(tf)
      return next
    })
  }

  function submit() {
    const symbols = symbolsText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    mutation.mutate({ mode, timeframes: Array.from(timeframes), symbols: symbols.length ? symbols : undefined })
  }

  const isDisabled = disabled || mutation.isPending || timeframes.size === 0

  return (
    <div className="flex flex-col gap-1.5 py-3 first:pt-0">
      <h4 className="text-sm font-semibold">Ingest</h4>
      <p className="text-xs text-warn">Full-universe backfill takes ~20 min; indicators ~16 min; signals ~7 min.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={mode}
          onChange={(v) => setMode(v as 'backfill' | 'incremental')}
          disabled={disabled}
          options={[
            { value: 'incremental', label: 'Incremental' },
            { value: 'backfill', label: 'Backfill' },
          ]}
        />
        <TimeframeCheckboxes selected={timeframes} onToggle={toggleTf} disabled={disabled} />
        <input
          type="text"
          placeholder="RELIANCE,TCS (optional)"
          value={symbolsText}
          onChange={(e) => setSymbolsText(e.target.value)}
          disabled={disabled}
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
        />
        <Button size="sm" onClick={submit} disabled={isDisabled}>
          {mutation.isPending ? 'Starting…' : 'Start ingest'}
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
