// Local helpers for the Positions pages (verdict ordering, symbol/strategy
// aggregation, chart level mapping, date math). Kept inside this page folder
// per BUILD_BRIEF ownership rules — not promoted to lib/.

import { ApiError } from '../../api/types'
import type { Position, Verdict } from '../../api/types'
import type { ChartLevel } from '../../charts/CandleChart'

/** Verdict urgency order used for the default table sort and "worst verdict": EXIT, PARTIAL, REVIEW, HOLD. */
export const VORDER: Record<Verdict, number> = { EXIT: 0, PARTIAL: 1, REVIEW: 2, HOLD: 3 }

export function worstVerdict(vs: (Verdict | null | undefined)[]): Verdict | null {
  const present = vs.filter((v): v is Verdict => !!v)
  if (!present.length) return null
  return present.slice().sort((a, b) => VORDER[a] - VORDER[b])[0]
}

/** qty_open × (latest_evaluation.close − avg_entry_price); null when the lot has never been evaluated. */
export function unrlInr(p: Position): number | null {
  const e = p.latest_evaluation
  return e ? p.qty_open * (e.close - p.avg_entry_price) : null
}

export interface SymbolGroup {
  symbol: string
  lots: Position[]
  qty: number
  avg: number
  close: number | null | undefined
  verdict: Verdict | null
}

/** Open lots grouped by symbol: qty-weighted avg entry, last close from the group's first lot,
 *  worst verdict across the group. Mirrors the prototype (design/prototype/src/app.jsx:349-350). */
export function groupBySymbol(open: Position[]): SymbolGroup[] {
  const map = new Map<string, { symbol: string; lots: Position[]; qty: number; cost: number }>()
  for (const p of open) {
    let g = map.get(p.symbol)
    if (!g) {
      g = { symbol: p.symbol, lots: [], qty: 0, cost: 0 }
      map.set(p.symbol, g)
    }
    g.lots.push(p)
    g.qty += p.qty_open
    g.cost += p.qty_open * p.avg_entry_price
  }
  return Array.from(map.values()).map((g) => ({
    symbol: g.symbol,
    lots: g.lots,
    qty: g.qty,
    avg: g.qty ? g.cost / g.qty : 0,
    close: g.lots[0]?.latest_evaluation?.close,
    verdict: worstVerdict(g.lots.map((l) => l.last_verdict)),
  }))
}

export interface StrategyStat {
  key: string
  n: number
  win: number
  pnl: number
}

/** Closed positions grouped by matched strategy (or "Unmatched"), for the "By matched strategy" panel. */
export function groupByStrategy(closed: Position[]): StrategyStat[] {
  const map = new Map<string, StrategyStat>()
  for (const p of closed) {
    const key = p.matched_strategy ?? 'Unmatched'
    let g = map.get(key)
    if (!g) {
      g = { key, n: 0, win: 0, pnl: 0 }
      map.set(key, g)
    }
    g.n++
    if ((p.realized_pnl ?? 0) > 0) g.win++
    g.pnl += p.realized_pnl ?? 0
  }
  return Array.from(map.values())
}

/** Latest `last_evaluated_on` across a set of positions, or null if none evaluated. */
export function maxEvaluatedOn(positions: Position[]): string | null {
  let max: string | null = null
  for (const p of positions) if (p.last_evaluated_on && (max === null || p.last_evaluated_on > max)) max = p.last_evaluated_on
  return max
}

/** ISO date (YYYY-MM-DD) `days` before `dateStr` (also YYYY-MM-DD). Used for the match-candidate window. */
export function subDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Levels to draw on the chart and feed the ladder: entry always; matched lots get stop/T1/T2
 *  (plus trail once it has tightened past the stop); unmatched lots get trail = stop only.
 *  Mirrors the prototype's posLevels (design/prototype/src/app.jsx:307-312). */
export function posLevels(p: Position): ChartLevel[] {
  const e = p.latest_evaluation
  const levels: ChartLevel[] = [{ kind: 'entry', value: p.avg_entry_price, label: 'Entry' }]
  if (!e) return levels
  if (!p.is_unmatched) {
    if (e.stop_level != null) levels.push({ kind: 'stop', value: e.stop_level, label: 'SL' })
    if (e.target_1 != null) levels.push({ kind: 't1', value: e.target_1, label: 'T1' })
    if (e.target_2 != null) levels.push({ kind: 't2', value: e.target_2, label: 'T2' })
    if (e.trail_level != null && e.stop_level != null && e.trail_level > e.stop_level) {
      levels.push({ kind: 'trail', value: e.trail_level, label: 'Trail' })
    }
  } else if (e.trail_level != null) {
    levels.push({ kind: 'trail', value: e.trail_level, label: 'Trail=SL' })
  }
  return levels
}

/** `"{status} · {message}"` for an ApiError, else a plain Error/String message — for inline errors and toasts. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} · ${err.message}`
  return err instanceof Error ? err.message : String(err)
}
