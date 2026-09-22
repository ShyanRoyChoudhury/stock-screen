// Shared types for the design system port. Mirrors design/design-system/components/index.d.ts.

export type Verdict = 'EXIT' | 'PARTIAL' | 'REVIEW' | 'HOLD'
export type Timeframe = '1d' | '4h' | '1h'
export type Strategy = 'PIPELINE' | 'S1_ST_Flip' | 'S2_MACD_Zero' | 'S3_BB_Squeeze' | 'TTM_Squeeze' | 'Confluence'
export type RunStatus =
  | 'ok'
  | 'completed'
  | 'running'
  | 'warning'
  | 'degraded'
  | 'failed'
  | 'error'
  | 'auth_failed'
  | 'never'
  | 'pending'
  | 'skipped'

export interface Code {
  code: string
  detail?: string | null
}

export type IconName =
  | 'today'
  | 'signals'
  | 'positions'
  | 'symbol'
  | 'trades'
  | 'brokers'
  | 'ops'
  | 'options'
  | 'settings'
  | 'upload'
  | 'sync'
  | 'search'
  | 'chevron'
  | 'external'

export interface NavItem {
  id?: string
  label?: string
  icon?: IconName
  kbd?: string
  disabled?: boolean
  badge?: string
  section?: string
}
