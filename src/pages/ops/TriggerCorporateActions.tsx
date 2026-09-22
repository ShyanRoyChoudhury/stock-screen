import { useState } from 'react'
import { useLoadCorporateActions } from '../../api/hooks'
import { Button } from '../../components/Button'
import { KeyValueDump, describeError } from './utils'

export function TriggerCorporateActions({ disabled }: { disabled: boolean }) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [symbolsText, setSymbolsText] = useState('')
  const mutation = useLoadCorporateActions()

  function submit() {
    const symbols = symbolsText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    mutation.mutate({
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      symbols: symbols.length ? symbols : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <h4 className="text-sm font-semibold">Corporate actions load</h4>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          disabled={disabled}
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
        />
        <span className="text-xs text-muted">to</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          disabled={disabled}
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
        />
        <input
          type="text"
          placeholder="RELIANCE,TCS (optional)"
          value={symbolsText}
          onChange={(e) => setSymbolsText(e.target.value)}
          disabled={disabled}
          className="rounded border border-border bg-surface px-2 py-1 text-sm"
        />
        <Button size="sm" onClick={submit} disabled={disabled || mutation.isPending}>
          {mutation.isPending ? 'Loading…' : 'Load corporate actions'}
        </Button>
      </div>
      <p className="text-xs text-muted">Defaults to the last 5 years when dates are left blank. Runs synchronously.</p>
      {mutation.isSuccess && <KeyValueDump data={mutation.data} />}
      {mutation.isError && <p className="text-xs text-down">{describeError(mutation.error)}</p>}
    </div>
  )
}
