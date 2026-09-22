// Builds CandleChart markers/price-lines from signals, corporate actions and
// a held position. Kept local to pages/symbol.

import type { CorporateAction, Evaluation, Position, Signal, Strategy, ActionType } from '../../api/types'
import { STRATEGY_BY_KEY } from '../../lib/domain'
import type { CandleChartMarker, CandleChartPriceLine } from '../../charts/CandleChart'
import type { ChartTokens } from '../../charts/colors'

export const SHORT_TAG: Record<Strategy, string> = {
  PIPELINE: 'PIPE',
  S1_ST_Flip: 'S1',
  S2_MACD_Zero: 'S2',
  S3_BB_Squeeze: 'S3',
  TTM_Squeeze: 'TTM',
  Confluence: 'C',
}

export const ACTION_TAG: Record<ActionType, string> = {
  dividend: 'D',
  split: 'S',
  bonus: 'B',
  rights: 'R',
  demerger: 'DM',
}

/** Signal markers: belowBar arrowUp, coloured per strategy, labelled with a short tag. */
export function buildSignalMarkers(signals: Signal[], showConfluence: boolean): CandleChartMarker[] {
  return signals
    .filter((s) => showConfluence || s.strategy !== 'Confluence')
    .map((s) => ({
      ts: s.ts,
      kind: 'signal' as const,
      label: SHORT_TAG[s.strategy] ?? s.strategy,
      color: STRATEGY_BY_KEY[s.strategy]?.colour ?? '#5b6470',
      position: 'belowBar' as const,
      shape: 'arrowUp' as const,
    }))
}

/** Corporate-action markers (1d only, per caller): aboveBar, demergers stand out in warn colour. */
export function buildActionMarkers(actions: CorporateAction[], tokens: ChartTokens): CandleChartMarker[] {
  return actions.map((a) => ({
    ts: `${a.ex_date}T00:00:00Z`,
    kind: 'action' as const,
    label: ACTION_TAG[a.action_type] ?? '?',
    color: a.action_type === 'demerger' ? tokens.warn : tokens.muted,
    position: 'aboveBar' as const,
    shape: a.action_type === 'demerger' ? ('circle' as const) : ('square' as const),
  }))
}

/** Solid entry/stop/T1/T2 price lines for a selected signal. */
export function buildSignalPriceLines(signal: Signal | null, tokens: ChartTokens): CandleChartPriceLine[] {
  if (!signal) return []
  return [
    { price: signal.entry, label: 'Entry', color: tokens.accent, style: 'solid' },
    { price: signal.stop_loss, label: 'Stop', color: tokens.down, style: 'solid' },
    { price: signal.target_1, label: 'T1', color: tokens.up, style: 'solid' },
    { price: signal.target_2, label: 'T2', color: tokens.up, style: 'solid' },
  ]
}

/** Dashed levels for a held position: entry, stop, trail, T1/T2 from the latest evaluation. */
export function buildPositionPriceLines(position: Position | null, evaluation: Evaluation | null | undefined, tokens: ChartTokens): CandleChartPriceLine[] {
  if (!position) return []
  const lines: CandleChartPriceLine[] = [{ price: position.avg_entry_price, label: 'Held entry', color: tokens.accent, style: 'dashed' }]
  if (evaluation?.stop_level != null) lines.push({ price: evaluation.stop_level, label: 'Stop', color: tokens.down, style: 'dashed' })
  if (evaluation?.trail_level != null) lines.push({ price: evaluation.trail_level, label: 'Trail', color: tokens.warn, style: 'dashed' })
  if (evaluation?.target_1 != null) lines.push({ price: evaluation.target_1, label: 'T1', color: tokens.up, style: 'dashed' })
  if (evaluation?.target_2 != null) lines.push({ price: evaluation.target_2, label: 'T2', color: tokens.up, style: 'dashed' })
  return lines
}
