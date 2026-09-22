// Small helpers local to the Ops page (mirrors src/pages/today/utils.ts — see the final
// report for why these aren't shared).

import { Fragment } from 'react'
import { ApiError } from '../../api/types'
import type { Timeframe } from '../../api/types'
import { TIMEFRAMES } from '../../lib/domain'

/** Maps a mutation error to the message the trigger row should show. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'Another run is in progress'
    return err.message
  }
  if (err instanceof Error) return err.message
  return String(err)
}

/** m:ss duration between two ISO timestamps. '—' when not finished or invalid. */
export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—'
  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return '—'
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Renders an unknown JSON-ish object (loadCorporateActions / refreshSymbols results) as key: value pairs. */
export function KeyValueDump({ data }: { data: unknown }) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return <p className="text-xs text-muted">(empty result)</p>
    return (
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
        {entries.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="num">{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}</dd>
          </Fragment>
        ))}
      </dl>
    )
  }
  return <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(data, null, 2) ?? String(data)}</pre>
}

/** Shared 1h/4h/1d checkbox row used by the ingest/indicators/signals triggers. */
export function TimeframeCheckboxes({
  selected,
  onToggle,
  disabled,
}: {
  selected: Set<Timeframe>
  onToggle: (tf: Timeframe) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      {TIMEFRAMES.map((tf) => (
        <label key={tf.key} className="inline-flex items-center gap-1 text-xs">
          <input type="checkbox" checked={selected.has(tf.key)} disabled={disabled} onChange={() => onToggle(tf.key)} />
          {tf.label}
        </label>
      ))}
    </div>
  )
}
