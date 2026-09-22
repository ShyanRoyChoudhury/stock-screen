// Local helpers for the Positions pages (list aggregation, sorting, date math).
// Not promoted to lib/ per BUILD_BRIEF ownership rules — kept inside this page
// folder and noted in the final report.

import type { Position, Verdict } from '../../api/types'

/** Verdict urgency order used for default row sort and group "worst verdict": EXIT > REVIEW > PARTIAL > HOLD. */
export const VERDICT_PRECEDENCE: Verdict[] = ['EXIT', 'REVIEW', 'PARTIAL', 'HOLD']

export function verdictRank(v: Verdict | null | undefined): number {
  if (!v) return VERDICT_PRECEDENCE.length
  const i = VERDICT_PRECEDENCE.indexOf(v)
  return i === -1 ? VERDICT_PRECEDENCE.length : i
}

/** The verdict driving a position row: its latest evaluation's verdict, or null if never evaluated. */
export function positionVerdict(p: Position): Verdict | null {
  return p.latest_evaluation?.verdict ?? null
}

/** Rows sorted EXIT, REVIEW, PARTIAL, HOLD (handoff §5.4 default order). */
export function sortByVerdict(positions: Position[]): Position[] {
  return [...positions].sort((a, b) => verdictRank(positionVerdict(a)) - verdictRank(positionVerdict(b)))
}

/** qty_open × (latest_evaluation.close − avg_entry_price); null when the position has never been evaluated. */
export function unrealizedInr(p: Position): number | null {
  if (!p.latest_evaluation) return null
  return p.qty_open * (p.latest_evaluation.close - p.avg_entry_price)
}

export interface SymbolGroup {
  symbol: string
  lots: Position[]
  qtyOpen: number
  qtyTotal: number
  /** Weighted by each lot's qty_total (cost-weighted average entry price). */
  weightedAvgEntry: number
  lastClose: number | null
  unrealizedInr: number | null
  realizedInr: number | null
  worstVerdict: Verdict | null
}

/** Group lots by symbol: aggregate qty, weighted avg entry, summed unrealised/realised ₹, worst verdict. */
export function groupBySymbol(positions: Position[]): SymbolGroup[] {
  const bySymbol = new Map<string, Position[]>()
  for (const p of positions) {
    const list = bySymbol.get(p.symbol) ?? []
    list.push(p)
    bySymbol.set(p.symbol, list)
  }

  const groups: SymbolGroup[] = []
  for (const [symbol, lots] of bySymbol) {
    const qtyOpen = lots.reduce((s, p) => s + p.qty_open, 0)
    const qtyTotal = lots.reduce((s, p) => s + p.qty_total, 0)
    const weightedAvgEntry = qtyTotal > 0 ? lots.reduce((s, p) => s + p.avg_entry_price * p.qty_total, 0) / qtyTotal : 0

    const evaluatedLots = lots.filter((p) => p.latest_evaluation)
    const lastClose = evaluatedLots.length ? (evaluatedLots[0].latest_evaluation?.close ?? null) : null
    const unrealized = evaluatedLots.length ? lots.reduce((s, p) => s + (unrealizedInr(p) ?? 0), 0) : null

    const realizedLots = lots.filter((p) => p.realized_pnl !== null)
    const realizedInr = realizedLots.length ? realizedLots.reduce((s, p) => s + (p.realized_pnl ?? 0), 0) : null

    let worst: Verdict | null = null
    for (const p of lots) {
      const v = positionVerdict(p)
      if (v && (worst === null || verdictRank(v) < verdictRank(worst))) worst = v
    }

    groups.push({ symbol, lots, qtyOpen, qtyTotal, weightedAvgEntry, lastClose, unrealizedInr: unrealized, realizedInr, worstVerdict: worst })
  }

  return groups.sort((a, b) => verdictRank(a.worstVerdict) - verdictRank(b.worstVerdict))
}

/** Latest `last_evaluated_on` across a set of positions (max date string), or null if none evaluated. */
export function maxEvaluatedOn(positions: Position[]): string | null {
  let max: string | null = null
  for (const p of positions) {
    if (p.last_evaluated_on && (max === null || p.last_evaluated_on > max)) max = p.last_evaluated_on
  }
  return max
}

/** Win rate (%) across closed positions with a recorded realised P&L. Null if there are none. */
export function winRate(positions: Position[]): number | null {
  const closed = positions.filter((p) => p.status === 'closed' && p.realized_pnl !== null)
  if (closed.length === 0) return null
  const wins = closed.filter((p) => (p.realized_pnl ?? 0) > 0).length
  return (wins / closed.length) * 100
}

/** Whole calendar days between two YYYY-MM-DD trading-day dates. */
export function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00Z`).getTime()
  const b = new Date(`${toDate}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** ISO date (YYYY-MM-DD) `days` before `dateStr` (also YYYY-MM-DD). Used for the match-candidate window. */
export function subDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}
