// URL search-param encoding for the Signals filter state (app.jsx 146-156's
// local state, made shareable per the task: "all filters round-trip through
// URL search params, useSearchParams, replace").

import type { Strategy, Timeframe } from '../../api/types'

export type SignalTab = 'event' | 'state'

export const EVENT_STRATEGIES: Strategy[] = ['PIPELINE', 'S1_ST_Flip', 'S2_MACD_Zero', 'S3_BB_Squeeze', 'TTM_Squeeze']

export const FRESH_DAY_OPTIONS = [1, 3, 5, 10, 20, 30]
export const MAX_RISK_OPTIONS = [1, 3, 5, 8, 12]
export const MIN_RR_OPTIONS = [0.5, 1, 1.5, 2]
export const CONVICTION_OPTIONS = ['HIGH', 'STRONG', 'MODERATE'] as const

export function parseTab(v: string | null): SignalTab {
  return v === 'state' ? 'state' : 'event'
}

export function parseTimeframe(v: string | null, allowed: Timeframe[], fallback: Timeframe): Timeframe {
  if ((v === '1d' || v === '4h' || v === '1h') && allowed.includes(v)) return v
  return allowed.includes(fallback) ? fallback : '1d'
}

/** Freshness window in sessions; only the fixed Menu options are valid, default 3. */
export function parseDays(v: string | null): number {
  const n = v ? Number.parseInt(v, 10) : 3
  return FRESH_DAY_OPTIONS.includes(n) ? n : 3
}

/** Empty = unfiltered (all event strategies pass), matching app.jsx's `!strats.length || ...`. */
export function parseStrategies(v: string | null): Strategy[] {
  if (!v) return []
  const requested = new Set(v.split(',').filter(Boolean))
  return EVENT_STRATEGIES.filter((s) => requested.has(s))
}

export function parseNumberOption(v: string | null, options: number[]): number | null {
  if (v === null) return null
  const n = Number(v)
  return options.includes(n) ? n : null
}
