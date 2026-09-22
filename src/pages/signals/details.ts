// Local helpers for reading a Signal's `details: Record<string, unknown>` bag
// safely (no `any`) and summarising it per strategy. Kept inside pages/signals
// per the ownership rule (this isn't promoted to lib/ since it's signal-detail
// specific).

import type { Signal } from '../../api/types'
import { fmtNum } from '../../lib/format'

export function readStr(d: Record<string, unknown>, key: string): string | undefined {
  const v = d[key]
  return typeof v === 'string' ? v : undefined
}

export function readNum(d: Record<string, unknown>, key: string): number | undefined {
  const v = d[key]
  return typeof v === 'number' ? v : undefined
}

export function readBool(d: Record<string, unknown>, key: string): boolean | undefined {
  const v = d[key]
  return typeof v === 'boolean' ? v : undefined
}

export function readObj(d: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = d[key]
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

/** Human label for a raw `details` key, for the generic key/value grid. Unknown keys fall back to themselves. */
export const DETAIL_LABELS: Record<string, string> = {
  atr: 'ATR',
  rvol: 'RVOL',
  breakout_atr: 'Breakout (× ATR)',
  volume_grade: 'Volume grade',
  vol_ratio: 'Volume ratio',
  supertrend: 'Supertrend level',
  macd: 'MACD',
  upper_bb: 'Upper BB',
  middle_bb: 'Middle BB',
  bandwidth: 'BB bandwidth',
  kc_mid: 'Keltner mid',
  momentum: 'Momentum',
  squeeze_bars: 'Squeeze bars',
}

export function formatDetailValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return fmtNum(v, 2)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

/** One-line "Details summary" table cell per strategy. */
export function detailsSummary(s: Signal): string {
  const d = s.details
  switch (s.strategy) {
    case 'Confluence': {
      const score = readStr(d, 'score') ?? '—'
      const conviction = readStr(d, 'conviction') ?? '—'
      return `${score} · ${conviction}`
    }
    case 'PIPELINE': {
      const grade = readStr(d, 'volume_grade') ?? '—'
      return `${s.entry_mode ?? '—'} · ${grade}`
    }
    case 'S1_ST_Flip':
    case 'S3_BB_Squeeze': {
      const vr = readNum(d, 'vol_ratio')
      return vr !== undefined ? `${vr.toFixed(2)}×` : '—'
    }
    case 'S2_MACD_Zero': {
      const macd = readNum(d, 'macd')
      return macd !== undefined ? `macd ${macd.toFixed(2)}` : '—'
    }
    case 'TTM_Squeeze': {
      const bars = readNum(d, 'squeeze_bars')
      return bars !== undefined ? `${bars} bars` : '—'
    }
    default:
      return '—'
  }
}
