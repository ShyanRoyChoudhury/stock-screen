// TypeScript port of `labels` and `NAV` from design/design-system/src/index.jsx.

import type { IconName, NavItem, Strategy, Verdict } from './types'

export const labels = {
  verdicts: {
    EXIT: 'Get out',
    PARTIAL: 'Book part (T1 reached)',
    REVIEW: 'Data or logic unsure — look yourself',
    HOLD: 'Nothing to do',
  } satisfies Record<Verdict, string>,
  reasons: {
    NO_DATA: ['REVIEW', 'No price data for this symbol/date'],
    DEMERGER_CLIFF: ['REVIEW', 'Demerger while held; levels unreliable'],
    QTY_MISMATCH: ['REVIEW', 'Qty doesn’t divide cleanly after restatement'],
    STOP_HIT: ['EXIT', 'Close below stop'],
    SUPERTREND_FLIP: ['EXIT', 'Supertrend turned bearish'],
    TRAIL_HIT: ['EXIT', 'Close below trailing stop'],
    T2_HIT: ['EXIT', 'Close reached target 2'],
    T1_HIT: ['PARTIAL', 'Close reached target 1'],
  } as Record<string, [Verdict, string]>,
  warnings: {
    LOW_BREACH: 'Low pierced stop; close held',
    VOLUME_DIVERGENCE: 'Price up, volume falling (5 bars)',
    UPCOMING_ACTION: 'Corporate action within 5 sessions',
    QTY_DIFFERS_FROM_BROKER: 'Qty differs from broker holdings',
    HORIZON: 'Held > 30 sessions',
    STALE_BAR: 'Latest candle older than evaluation date',
  } as Record<string, string>,
  strategies: {
    PIPELINE: { type: 'event', label: 'Trend-breakout-retest' },
    S1_ST_Flip: { type: 'event', label: 'Supertrend flip' },
    S2_MACD_Zero: { type: 'event', label: 'MACD zero cross' },
    S3_BB_Squeeze: { type: 'event', label: 'Bollinger squeeze break' },
    TTM_Squeeze: { type: 'event', label: 'TTM squeeze fire' },
    Confluence: { type: 'state', label: 'Confluence (state)' },
  } satisfies Record<Strategy, { type: 'event' | 'state'; label: string }>,
  actions: {
    dividend: ['D', 'Dividend'],
    split: ['S', 'Split'],
    bonus: ['B', 'Bonus'],
    rights: ['R', 'Rights'],
    demerger: ['DM', 'Demerger'],
  } satisfies Record<'dividend' | 'split' | 'bonus' | 'rights' | 'demerger', [string, string]>,
}

export const NAV: NavItem[] = [
  { id: 'today', label: 'Today', icon: 'today' as IconName, kbd: 'g t' },
  { id: 'signals', label: 'Signals', icon: 'signals' as IconName, kbd: 'g s' },
  { id: 'positions', label: 'Positions', icon: 'positions' as IconName, kbd: 'g p' },
  { id: 'trades', label: 'Trades', icon: 'trades' as IconName, kbd: 'g r' },
  { id: 'brokers', label: 'Brokers', icon: 'brokers' as IconName, kbd: 'g b' },
  { id: 'ops', label: 'Data & Ops', icon: 'ops' as IconName, kbd: 'g o' },
  { section: 'Derivatives' },
  { id: 'options', label: 'Options', icon: 'options' as IconName, disabled: true, badge: 'Later' },
]
