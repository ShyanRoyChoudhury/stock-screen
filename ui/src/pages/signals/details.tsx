// Local helpers for reading a Signal's `details: Record<string, unknown>` bag
// safely (no `any`) and formatting it per app.jsx 220's rules. Kept inside
// pages/signals per the ownership rule.

import type { ReactNode } from 'react'
import { Num, fmt } from '../../ds'

export function readStr(d: Record<string, unknown>, key: string): string | undefined {
  const v = d[key]
  return typeof v === 'string' ? v : undefined
}

export function readObj(d: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = d[key]
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
}

/** One `details` value, formatted per app.jsx 220: ratio/rvol -> fmt.mult, bandwidth ->
 * fmt.frac(v,2,false), momentum -> <Num decimals={4}/>, other numbers -> fmt.price, else String(v). */
export function renderDetailValue(key: string, value: unknown): ReactNode {
  if (typeof value !== 'number') return <span className="ss-n">{String(value)}</span>
  if (key.includes('ratio') || key === 'rvol') return <span className="ss-n">{fmt.mult(value)}</span>
  if (key === 'bandwidth') return <span className="ss-n">{fmt.frac(value, 2, false)}</span>
  if (key === 'momentum') return <Num value={value} decimals={4} />
  return <span className="ss-n">{fmt.price(value)}</span>
}
