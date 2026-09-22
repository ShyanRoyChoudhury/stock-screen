// URL search-param encoding for the Signals filter state, so a filtered view
// is shareable (handoff §5.2 / task requirement).

import { STRATEGIES } from '../../lib/domain'
import type { Strategy, Timeframe } from '../../api/types'

export type SignalMode = 'event' | 'confluence' | 'all'

export const EVENT_STRATEGIES: Strategy[] = ['PIPELINE', 'S1_ST_Flip', 'S2_MACD_Zero', 'S3_BB_Squeeze', 'TTM_Squeeze']
export const ALL_STRATEGY_KEYS: Strategy[] = STRATEGIES.map((s) => s.key)

export function strategiesForMode(mode: SignalMode): Strategy[] {
  if (mode === 'event') return EVENT_STRATEGIES
  if (mode === 'confluence') return ['Confluence']
  return ALL_STRATEGY_KEYS
}

export function parseMode(v: string | null): SignalMode {
  return v === 'confluence' || v === 'all' ? v : 'event'
}

export function parseTimeframe(v: string | null, allowed: Timeframe[], fallback: Timeframe): Timeframe {
  if (v === '1d' || v === '4h' || v === '1h') {
    if (allowed.includes(v)) return v
  }
  return allowed.includes(fallback) ? fallback : '1d'
}

export function parseDays(v: string | null): number {
  const n = v ? Number.parseInt(v, 10) : 3
  if (!Number.isFinite(n)) return 3
  return Math.min(30, Math.max(1, n))
}

export function parseStrategies(v: string | null, allowed: Strategy[]): Strategy[] {
  if (!v) return allowed
  const requested = new Set(v.split(',').filter(Boolean))
  const filtered = allowed.filter((s) => requested.has(s))
  return filtered.length ? filtered : allowed
}

export function serializeStrategies(selected: Strategy[], allowed: Strategy[]): string | null {
  // Omit the param entirely when it matches "all strategies for this mode" (the default).
  if (selected.length === allowed.length && allowed.every((s) => selected.includes(s))) return null
  return selected.join(',')
}
