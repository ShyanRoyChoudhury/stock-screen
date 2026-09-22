// Header "indicator snapshot" derivations from the latest indicator row.
// Kept local to pages/symbol (not promoted to lib/) per ownership rules.

import type { IndicatorRow } from '../../api/types'

export type TrendState = 'Uptrend' | 'Downtrend' | 'Mixed' | 'Unknown'

/** close vs EMA50 vs EMA200, per handoff §5.3 header spec. */
export function trendState(close: number | undefined, row: IndicatorRow | undefined): TrendState {
  if (close === undefined || !row || row.ema_50 === null || row.ema_200 === null) return 'Unknown'
  if (close > row.ema_50 && row.ema_50 > row.ema_200) return 'Uptrend'
  if (close < row.ema_50 && row.ema_50 < row.ema_200) return 'Downtrend'
  return 'Mixed'
}

export type SqueezeState = 'ON' | 'OFF' | 'Inactive' | 'Unknown'

export function squeezeState(row: IndicatorRow | undefined): SqueezeState {
  if (!row) return 'Unknown'
  if (row.ttm_squeeze_on) return 'ON'
  if (row.ttm_squeeze_off) return 'OFF'
  return 'Inactive'
}
