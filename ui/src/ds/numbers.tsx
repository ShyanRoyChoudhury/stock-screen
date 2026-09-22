// Ported from design/design-system/src/index.jsx: Num, Change, RiskPct.

import type { ReactElement } from 'react'
import { cx } from './cx'
import { fmt } from './fmt'

const MINUS = '−'
const nf: Record<number, Intl.NumberFormat> = {}
function numFmt(d: number): Intl.NumberFormat {
  return (nf[d] ??= new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }))
}
function sgn(n: number, signed?: boolean): string {
  return n > 0 ? (signed ? '+' : '') : n < 0 ? MINUS : ''
}
const abs = Math.abs

export interface NumProps {
  value: number | null
  kind?: 'price' | 'inr' | 'qty' | 'int' | 'pct' | 'frac' | 'mult' | 'rr'
  decimals?: number
  signed?: boolean
  tone?: 'auto' | 'up' | 'down' | 'flat' | 'muted'
  currency?: boolean
  className?: string
}

export function Num({ value, kind = 'price', decimals, signed, tone, currency, className }: NumProps): ReactElement {
  if (value == null || Number.isNaN(value)) {
    return <span className={cx('ss-n', 'ss-n-null', className)}>{'—'}</span>
  }
  let s: string
  switch (kind) {
    case 'inr':
      s = fmt.price(abs(value), decimals ?? 2)
      break
    case 'qty':
      s = fmt.qty(abs(value))
      break
    case 'pct':
      s = abs(value).toFixed(decimals ?? 2) + '%'
      break
    case 'frac':
      s = abs(value * 100).toFixed(decimals ?? 2) + '%'
      break
    case 'mult':
      s = fmt.mult(value, decimals ?? 2)
      break
    case 'rr':
      s = abs(value).toFixed(decimals ?? 2)
      break
    case 'int':
      s = numFmt(0).format(abs(value))
      break
    default:
      s = fmt.price(abs(value), decimals ?? 2)
  }
  const sign = value < 0 ? MINUS : signed && value > 0 ? '+' : ''
  const t = tone === 'auto' ? (value > 0 ? 'up' : value < 0 ? 'down' : 'flat') : tone
  const cur = kind === 'inr' || currency
  return (
    <span className={cx('ss-n', t && 'ss-' + t, className)}>
      {sign}
      {cur ? <span className="ss-n-cur">{'₹'}</span> : null}
      {s}
    </span>
  )
}

export interface ChangeProps {
  abs?: number
  frac?: number
  pct?: number
  showArrow?: boolean
}

export function Change({ abs: a, frac, pct, showArrow = true }: ChangeProps): ReactElement {
  const ref = a ?? frac ?? pct ?? 0
  const t = ref > 0 ? 'up' : ref < 0 ? 'down' : 'flat'
  return (
    <span className={cx('ss-change', 'ss-' + t)}>
      {showArrow ? (
        <span className="ss-change-arrow" aria-hidden="true">
          {t === 'up' ? '▲' : t === 'down' ? '▼' : '■'}
        </span>
      ) : null}
      {a != null ? (
        <span>
          {sgn(a, true)}
          {numFmt(2).format(abs(a))}
        </span>
      ) : null}
      {frac != null ? <span>{fmt.frac(frac)}</span> : null}
      {pct != null ? <span>{fmt.pct(pct, 2, true)}</span> : null}
    </span>
  )
}

export interface RiskPctProps {
  value: number | null
  caution?: number
  high?: number
  max?: number
}

/** Risk % with a scale bar. ≤ 3% calm, ≤ 8% caution, > 8% flagged (default thresholds). */
export function RiskPct({ value, caution = 3, high = 8, max = 16 }: RiskPctProps): ReactElement {
  if (value == null) return <Num value={null} />
  const lvl = value > high ? 'high' : value > caution ? 'mid' : 'low'
  return (
    <span className={cx('ss-risk', 'ss-risk-' + lvl)} title={lvl === 'high' ? 'High risk: stop is more than ' + high + '% away' : undefined}>
      {lvl === 'high' ? <span aria-hidden="true">!</span> : null}
      {fmt.pct(value)}
      <span className="ss-risk-bar" aria-hidden="true">
        <span className="ss-risk-fill" style={{ width: Math.min(100, (value / max) * 100) + '%' }} />
      </span>
    </span>
  )
}
