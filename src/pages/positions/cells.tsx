// Small shared render helpers for the Positions list/detail tables — kept
// local to this page folder since components/ is out of ownership.

import { Tooltip } from '../../components/Tooltip'
import { Chip } from '../../components/Chip'
import { fmtInr, fmtPct } from '../../lib/format'
import { reasonLabel, warningLabel } from '../../lib/domain'
import type { Position, ReasonCode } from '../../api/types'

/** Reason codes as small labelled chips; hovering one shows its `detail` text. */
export function ReasonsInline({ reasons }: { reasons: ReasonCode[] }) {
  if (reasons.length === 0) return <span className="text-muted">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((r, i) => (
        <Tooltip key={`${r.code}-${i}`} text={r.detail ?? reasonLabel(r.code)}>
          <span className="text-xs">{reasonLabel(r.code)}</span>
        </Tooltip>
      ))}
    </span>
  )
}

/** Warning count badge; hover lists every warning's label/detail. */
export function WarningsBadge({ warnings }: { warnings: ReasonCode[] }) {
  if (warnings.length === 0) return <span className="text-muted">—</span>
  const text = warnings.map((w) => w.detail ?? warningLabel(w.code)).join('; ')
  return (
    <Tooltip text={text}>
      <span className="inline-flex items-center rounded border border-warn px-1.5 py-0.5 text-xs text-warn">
        {warnings.length} ⚠
      </span>
    </Tooltip>
  )
}

/** Adjusted avg entry price; tooltip shows the raw "as paid" price and the structural factor when it differs from 1. */
export function AvgEntryCell({ position }: { position: Position }) {
  const differs = position.structural_factor_applied !== 1
  const tooltip = differs
    ? `As paid: ${fmtInr(position.avg_entry_price_raw)} · structural factor ${position.structural_factor_applied}`
    : `As paid: ${fmtInr(position.avg_entry_price_raw)}`
  return (
    <Tooltip text={tooltip}>
      <span className="num">{fmtInr(position.avg_entry_price)}</span>
    </Tooltip>
  )
}

/** Matched strategy chip + confidence %, or a muted "Unmatched" label. */
export function MatchCell({ position }: { position: Position }) {
  if (position.is_unmatched || !position.matched_strategy) {
    return <span className="text-xs text-muted">Unmatched — trailing stop only</span>
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Chip variant="strategy" value={position.matched_strategy} />
      <span className="num text-xs text-muted">{fmtPct((position.match_confidence ?? 0) * 100)}</span>
    </span>
  )
}
