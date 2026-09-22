// Ported from design/design-system/src/index.jsx: Kbd, Button, VerdictChip,
// CodeTag, CodeList, StatusDot, Badge, StrategyTag, TimeframeBadge.

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './icons'
import { labels } from './labels'
import type { Code, IconName, RunStatus, Strategy, Timeframe, Verdict } from './types'

export interface KbdProps {
  keys?: string | string[]
  children?: ReactNode
}

export function Kbd({ keys, children }: KbdProps): ReactElement {
  const list = keys ? (Array.isArray(keys) ? keys : String(keys).split(' ')) : [children]
  return (
    <span className="ss-kbds">
      {list.map((k, i) => (
        <kbd key={i} className="ss-kbd">
          {k}
        </kbd>
      ))}
    </span>
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'md' | 'sm'
  icon?: IconName
  kbd?: string | string[]
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, kbd, loading, children, className, ...rest }: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={cx('ss-btn', 'ss-btn-' + variant, size === 'sm' && 'ss-btn-sm', className)}
    >
      {loading ? <span className="ss-btn-spin" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
      {kbd ? <Kbd keys={kbd} /> : null}
    </button>
  )
}

const VGLYPH: Record<Verdict, string> = { EXIT: '■', PARTIAL: '◧', REVIEW: '?', HOLD: '·' }

export interface VerdictChipProps {
  verdict: Verdict
  size?: 'md' | 'sm'
  title?: string
}

export function VerdictChip({ verdict, size = 'md', title }: VerdictChipProps): ReactElement {
  const v = String(verdict || 'HOLD').toUpperCase() as Verdict
  return (
    <span className={cx('ss-verdict', 'ss-verdict-' + v, size === 'sm' && 'ss-verdict-sm')} title={title || labels.verdicts[v]}>
      <span className="ss-verdict-glyph" aria-hidden="true">
        {VGLYPH[v]}
      </span>
      {v}
    </span>
  )
}

export interface CodeTagProps {
  code: string
  detail?: string | null
  kind?: 'reason' | 'warning'
  showLabel?: boolean
}

export function CodeTag({ code, detail, kind, showLabel = true }: CodeTagProps): ReactElement {
  const isWarn = kind === 'warning' || (!kind && !!labels.warnings[code])
  const r = labels.reasons[code]
  const text = showLabel ? detail || (isWarn ? labels.warnings[code] : r && r[1]) : null
  return (
    <span
      className={cx('ss-code', isWarn ? 'ss-code-warning' : 'ss-code-reason', !isWarn && r && 'ss-code-' + r[0])}
      title={detail || (isWarn ? labels.warnings[code] : r && r[1]) || code}
    >
      <span className="ss-code-key">{code}</span>
      {text ? <span className="ss-code-text">{text}</span> : null}
    </span>
  )
}

export interface CodeListProps {
  reasons?: Code[]
  warnings?: Code[]
  showLabel?: boolean
}

export function CodeList({ reasons = [], warnings = [], showLabel = true }: CodeListProps): ReactElement {
  if (!reasons.length && !warnings.length) return <span className="ss-faint">{'—'}</span>
  return (
    <span className="ss-codes">
      {reasons.map((r, i) => (
        <CodeTag key={'r' + i} code={r.code} detail={r.detail} kind="reason" showLabel={showLabel} />
      ))}
      {warnings.map((w, i) => (
        <CodeTag key={'w' + i} code={w.code} detail={w.detail} kind="warning" showLabel={showLabel} />
      ))}
    </span>
  )
}

const STATUS_ALIAS: Record<string, string> = {
  completed: 'ok',
  ok: 'ok',
  running: 'running',
  warning: 'warning',
  degraded: 'warning',
  failed: 'failed',
  error: 'failed',
  auth_failed: 'failed',
  never: 'never',
  pending: 'never',
  skipped: 'never',
}
const STATUS_TEXT: Record<string, string> = { ok: 'OK', running: 'Running', warning: 'Warning', failed: 'Failed', never: 'Never run' }

export interface StatusDotProps {
  status: RunStatus
  label?: string
  children?: ReactNode
  bare?: boolean
}

export function StatusDot({ status, label, children, bare }: StatusDotProps): ReactElement {
  const s = STATUS_ALIAS[status] || 'never'
  if (bare) {
    return (
      <span className={cx('ss-status', 'ss-status-' + s)} role="img" aria-label={STATUS_TEXT[s]}>
        <span className="ss-dot" />
      </span>
    )
  }
  return (
    <span className={cx('ss-status', 'ss-status-' + s)}>
      <span className="ss-dot" aria-hidden="true" />
      {children || label || (status === 'auth_failed' ? 'Auth failed' : status === 'error' ? 'Error' : status === 'completed' ? 'Completed' : STATUS_TEXT[s])}
    </span>
  )
}

export interface BadgeProps {
  tone?: 'neutral' | 'solid' | 'accent' | 'up' | 'down' | 'warn' | 'review'
  children?: ReactNode
  title?: string
}

export function Badge({ tone = 'neutral', children, title }: BadgeProps): ReactElement {
  return (
    <span className={cx('ss-badge', tone !== 'neutral' && 'ss-badge-' + tone)} title={title}>
      {children}
    </span>
  )
}

export interface StrategyTagProps {
  strategy: Strategy | string
  extra?: ReactNode
}

export function StrategyTag({ strategy, extra }: StrategyTagProps): ReactElement {
  const meta = labels.strategies[strategy as Strategy] || { type: 'event' as const, label: strategy }
  return (
    <span
      className={cx('ss-strat', meta.type === 'state' && 'ss-strat-state')}
      title={meta.label + (meta.type === 'state' ? ' — fires while a condition holds' : ' — fires on a discrete change')}
    >
      <span className="ss-strat-mark" aria-hidden="true" />
      {strategy}
      {extra ? <span className="ss-muted">{extra}</span> : null}
    </span>
  )
}

export interface TimeframeBadgeProps {
  timeframe?: Timeframe
}

export function TimeframeBadge({ timeframe = '1d' }: TimeframeBadgeProps): ReactElement {
  const exp = timeframe !== '1d'
  return (
    <span
      className={cx('ss-tf', exp && 'ss-tf-exp')}
      title={exp ? 'Experimental: Yahoo hourly feed does not reconcile with daily bars; ~13% zero-volume bars.' : 'Daily — primary, trusted'}
    >
      {timeframe}
    </span>
  )
}
