// Expandable row content for the Signals table: the full `details` object
// rendered legibly, per handoff §5.2.

import { Link } from 'react-router'
import type { Signal } from '../../api/types'
import { DETAIL_LABELS, formatDetailValue, readBool, readObj, readStr } from './details'

function ScoreLine({ label, value }: { label: string; value: string | undefined }) {
  const ok = !!value && value.includes('✓')
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className={ok ? 'text-up' : 'text-down'}>{value ?? '—'}</span>
    </div>
  )
}

function ConfluenceScorecard({ details }: { details: Record<string, unknown> }) {
  const breakdown = readObj(details, 'breakdown')
  return (
    <div className="flex max-w-sm flex-col gap-1 rounded border border-border bg-surface p-2">
      <div className="mb-1 flex items-center justify-between text-sm font-medium">
        <span>{readStr(details, 'score') ?? '—'}</span>
        <span>{readStr(details, 'conviction') ?? '—'}</span>
      </div>
      {breakdown ? (
        <>
          <ScoreLine label="Supertrend" value={readStr(breakdown, 'supertrend')} />
          <ScoreLine label="MACD" value={readStr(breakdown, 'macd')} />
          <ScoreLine label="BB position" value={readStr(breakdown, 'bb_position')} />
          <ScoreLine label="Volume" value={readStr(breakdown, 'volume')} />
          <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
            <span className="text-muted">Room to upper band</span>
            <span>{readStr(breakdown, 'room_to_upper') ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">High conviction</span>
            <span>{readBool(breakdown, 'high_conviction') ? 'Yes' : 'No'}</span>
          </div>
        </>
      ) : (
        <p className="text-muted">No breakdown available.</p>
      )}
    </div>
  )
}

function GenericDetailsGrid({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details)
  if (entries.length === 0) return <p className="text-muted">No extra details.</p>
  return (
    <div className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center justify-between gap-2">
          <span className="text-muted">{DETAIL_LABELS[key] ?? key}</span>
          <span className="num">{formatDetailValue(value)}</span>
        </div>
      ))}
    </div>
  )
}

export function SignalDetails({ signal }: { signal: Signal }) {
  return (
    <div className="flex flex-col gap-2 p-2 text-xs">
      {signal.strategy === 'Confluence' ? (
        <ConfluenceScorecard details={signal.details} />
      ) : (
        <GenericDetailsGrid details={signal.details} />
      )}
      <Link to={`/symbols/${signal.symbol}?tf=${signal.timeframe}`} className="w-fit text-accent underline">
        Open chart →
      </Link>
    </div>
  )
}
