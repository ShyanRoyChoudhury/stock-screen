// Domain vocabulary: strategies, verdicts, reason/warning codes, timeframes,
// run modes, action types. See BUILD_BRIEF.md "Domain constants" and
// UI_HANDOFF.md §6 for the source text these labels/descriptions are from.

import type { ActionType, RunMode, Strategy, Symbol as SymbolRow, Verdict } from '../api/types'

// ---------------------------------------------------------------------------
// Strategies (handoff §6.1)
// ---------------------------------------------------------------------------

export interface StrategyMeta {
  key: Strategy
  label: string
  kind: 'event' | 'state'
  colour: string
  description: string
}

export const STRATEGIES: StrategyMeta[] = [
  {
    key: 'PIPELINE',
    label: 'Pipeline (breakout/retest)',
    kind: 'event',
    colour: '#2563eb',
    description: 'Trend breakout after a tight consolidation, confirmed by MACD and volume; entry is immediate or a retest.',
  },
  {
    key: 'S1_ST_Flip',
    label: 'Supertrend flip',
    kind: 'event',
    colour: '#0d9488',
    description: 'Supertrend flips red to green with volume above its 20-bar average.',
  },
  {
    key: 'S2_MACD_Zero',
    label: 'MACD zero-cross',
    kind: 'event',
    colour: '#ca8a04',
    description: 'MACD line crosses above zero while Supertrend is green.',
  },
  {
    key: 'S3_BB_Squeeze',
    label: 'BB squeeze breakout',
    kind: 'event',
    colour: '#db2777',
    description: 'Bollinger bandwidth compresses, then price closes above the upper band on volume over 1.5x average.',
  },
  {
    key: 'TTM_Squeeze',
    label: 'TTM squeeze',
    kind: 'event',
    colour: '#0891b2',
    description: 'TTM squeeze fires (Bollinger exits Keltner) with positive, rising momentum and Supertrend green.',
  },
  {
    key: 'Confluence',
    label: 'Confluence',
    kind: 'state',
    colour: '#9333ea',
    description: 'State signal: scores four bullish checks (Supertrend, MACD, BB position, volume); fires whenever 3 or more of 4 hold.',
  },
]

export const STRATEGY_BY_KEY: Record<Strategy, StrategyMeta> = Object.fromEntries(
  STRATEGIES.map((s) => [s.key, s]),
) as Record<Strategy, StrategyMeta>

// ---------------------------------------------------------------------------
// Verdicts (handoff §6.2)
// ---------------------------------------------------------------------------

export interface VerdictMeta {
  key: Verdict
  colour: string
  meaning: string
}

export const VERDICT_META: VerdictMeta[] = [
  { key: 'EXIT', colour: 'exit', meaning: 'Get out.' },
  { key: 'PARTIAL', colour: 'partial', meaning: 'Book part — target 1 reached.' },
  { key: 'REVIEW', colour: 'review', meaning: "The system can't be trusted here; a human must look. Not a sell signal." },
  { key: 'HOLD', colour: 'hold', meaning: 'Nothing to do.' },
]

export const VERDICT_BY_KEY: Record<Verdict, VerdictMeta> = Object.fromEntries(
  VERDICT_META.map((v) => [v.key, v]),
) as Record<Verdict, VerdictMeta>

/** Alias matching the short name used in BUILD_BRIEF's source-layout summary. */
export const VERDICTS = VERDICT_META

// ---------------------------------------------------------------------------
// Reason / warning codes (handoff §6.2)
// ---------------------------------------------------------------------------

export const REASON_LABELS: Record<string, string> = {
  NO_DATA: 'No price data for this symbol/date',
  DEMERGER_CLIFF: "A demerger happened while held; stored prices aren't demerger-adjusted, so levels are unreliable",
  QTY_MISMATCH: "Quantity doesn't divide cleanly after a split/bonus restatement",
  STOP_HIT: 'Close below stop',
  SUPERTREND_FLIP: 'Supertrend turned bearish',
  TRAIL_HIT: 'Close below the trailing stop',
  T2_HIT: 'Close reached target 2',
  T1_HIT: 'Close reached target 1',
}

export const WARNING_LABELS: Record<string, string> = {
  LOW_BREACH: 'Intraday low went below the stop, but the close held above it',
  VOLUME_DIVERGENCE: 'Price rising while volume declines (last 5 bars)',
  UPCOMING_ACTION: 'Corporate action within 5 sessions — broker may cancel your GTT; re-place the stop after the ex-date',
  QTY_DIFFERS_FROM_BROKER: 'Platform quantity does not match broker holdings',
  HORIZON: 'Held more than 30 sessions (swing horizon exceeded)',
  STALE_BAR: 'Latest candle is older than the evaluation date',
}

/** Plain-language label for a reason code; unknown codes fall back to the code itself. */
export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? code
}

/** Plain-language label for a warning code; unknown codes fall back to the code itself. */
export function warningLabel(code: string): string {
  return WARNING_LABELS[code] ?? code
}

// ---------------------------------------------------------------------------
// Timeframes
// ---------------------------------------------------------------------------

export interface TimeframeMeta {
  key: '1d' | '4h' | '1h'
  label: string
  trusted: boolean
}

export const TIMEFRAMES: TimeframeMeta[] = [
  { key: '1d', label: '1D', trusted: true },
  { key: '4h', label: '4H', trusted: false },
  { key: '1h', label: '1H', trusted: false },
]

// ---------------------------------------------------------------------------
// Run modes / action types
// ---------------------------------------------------------------------------

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  backfill: 'Backfill',
  incremental: 'Incremental ingest',
  indicators: 'Indicators',
  signals: 'Signals',
  broker_sync: 'Broker sync',
  evaluate: 'Evaluate positions',
}

/** Alias matching the short name used in BUILD_BRIEF's source-layout summary. */
export const RUN_MODES = RUN_MODE_LABELS

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  dividend: 'Dividend',
  split: 'Split',
  bonus: 'Bonus',
  rights: 'Rights issue',
  demerger: 'Demerger',
}

/** Alias matching the short name used in BUILD_BRIEF's source-layout summary. */
export const ACTION_TYPES = ACTION_TYPE_LABELS

// ---------------------------------------------------------------------------
// Industries (derived from /symbols at runtime — there is no static list)
// ---------------------------------------------------------------------------

/** Sorted, de-duplicated industry list from a Symbol[] payload (drops nulls). */
export function industriesFrom(symbols: SymbolRow[]): string[] {
  const set = new Set<string>()
  for (const s of symbols) {
    if (s.industry) set.add(s.industry)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}
