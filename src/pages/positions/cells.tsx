// Small shared render helpers for the Positions list/detail tables — kept
// local to this page folder since components/ is out of ownership.

import { Tooltip } from '../../components/Tooltip'
import { Chip } from '../../components/Chip'
import { fmtInr, fmtPct } from '../../lib/format'
import { reasonLabel, warningLabel } from '../../lib/domain'
import type { Position, ReasonCode } from '../../api/types'

/** Reason codes joined into a sentence, clamped to two lines with a title tooltip carrying the
 *  full text — some labels (e.g. DEMERGER_CLIFF) are full sentences that would otherwise force
 *  the whole row wide against the table's default `white-space: nowrap` cells. */
export function ReasonsInline({ reasons }: { reasons: ReasonCode[] }) {
  if (reasons.length === 0) return <span className="text-muted">—</span>
  const short = reasons.map((r) => reasonLabel(r.code)).join('; ')
  const full = reasons.map((r) => (r.detail ? `${reasonLabel(r.code)} — ${r.detail}` : reasonLabel(r.code))).join('; ')
  return (
    <div className="line-clamp-2 max-w-[260px] whitespace-normal text-xs leading-snug" title={full}>
      {short}
    </div>
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
