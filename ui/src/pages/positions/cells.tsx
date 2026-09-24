// Small shared cell renderers for the Positions tables, built entirely on the
// design system (src/ds) — no src/components imports.

import { Badge, StrategyTag } from '../../ds'
import { Num } from '../../ds'
import type { Position } from '../../api/types'

/** "As paid" price: muted when the structural factor is 1 (no split/bonus since the buy); the
 *  factor shows in the cell's own title otherwise. */
export function AsPaidCell({ position }: { position: Position }) {
  const differs = position.structural_factor_applied !== 1
  return (
    <span title={differs ? `factor ${position.structural_factor_applied}` : undefined}>
      <Num value={position.avg_entry_price_raw} className={differs ? undefined : 'ss-muted'} />
    </span>
  )
}

/** Matched strategy chip + confidence %, or a muted "Unmatched" badge. */
export function MatchCell({ position }: { position: Position }) {
  if (position.is_unmatched || !position.matched_strategy) {
    return <Badge title="Trailing stop only, no targets">Unmatched</Badge>
  }
  return <StrategyTag strategy={position.matched_strategy} extra={` ${Math.round((position.match_confidence ?? 0) * 100)}%`} />
}
