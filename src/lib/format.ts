// Formatting helpers. See BUILD_BRIEF.md "Formatting rules (`lib/format.ts`)".
// Never round prices below 2 decimals. All dates/times shown in IST.

const IST_TZ = 'Asia/Kolkata'
const MINUS = '−' // real minus sign, not a hyphen

function isNil(n: unknown): n is null | undefined {
  return n === null || n === undefined || (typeof n === 'number' && Number.isNaN(n))
}

/** ₹1,23,456.78 (Indian digit grouping). Negative values use a real minus sign: −₹1,234.00 */
export function fmtInr(n: number | null | undefined, { decimals = 2 }: { decimals?: number } = {}): string {
  if (isNil(n)) return '—'
  const sign = n < 0 ? MINUS : ''
  const abs = Math.abs(n)
  const body = new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(abs)
  return `${sign}₹${body}`
}

/** en-IN grouped number, no currency symbol. */
export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (isNil(n)) return '—'
  const sign = n < 0 ? MINUS : ''
  const abs = Math.abs(n)
  const body = new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(abs)
  return `${sign}${body}`
}

/** For values already expressed as a percent, e.g. risk_pct (8.92 = 8.92%) -> "8.92%" */
export function fmtPct(p: number | null | undefined, decimals = 2): string {
  if (isNil(p)) return '—'
  return `${p.toFixed(decimals)}%`
}

/** For fractions, e.g. unrealized_pnl_pct / realized_pnl_pct (0.019 = 1.9%) -> "+1.90%" (always signed) */
export function fmtFrac(f: number | null | undefined, decimals = 2): string {
  if (isNil(f)) return '—'
  const pct = f * 100
  const sign = pct < 0 ? MINUS : '+'
  return `${sign}${Math.abs(pct).toFixed(decimals)}%`
}

/** Compact Indian volume units for display, with the exact figure for a tooltip. */
export function fmtVolume(n: number | null | undefined): { compact: string; full: string } {
  if (isNil(n)) return { compact: '—', full: '—' }
  const abs = Math.abs(n)
  let compact: string
  if (abs >= 1e7) compact = `${(n / 1e7).toFixed(2)} Cr`
  else if (abs >= 1e5) compact = `${(n / 1e5).toFixed(2)} L`
  else compact = fmtNum(n, 0)
  return { compact, full: fmtNum(n, 0) }
}

/** Daily candle ts (…T03:45:00Z = 09:15 IST) shown as a date only: "21 Sep 2026" */
export function fmtIstDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST_TZ }).format(d)
}

/** "22 Sep 2026, 09:32 IST" */
export function fmtIstDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST_TZ }).format(d)
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: IST_TZ }).format(d)
  return `${date}, ${time} IST`
}

/** IST calendar date as YYYY-MM-DD, for same-day comparisons (e.g. "did this run finish today?"). */
export function istDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: IST_TZ }).format(d)
}

/** Risk:reward from entry/stop/target_1. null if stop >= entry (invalid for a long). */
export function rr(entry: number, stop: number, t1: number): number | null {
  if (stop >= entry) return null
  return (t1 - entry) / (entry - stop)
}

/** CSS class for a signed number: up/down token colours, empty for zero/null. */
export function signedClass(n: number | null | undefined): string {
  if (isNil(n) || n === 0) return ''
  return n > 0 ? 'text-up' : 'text-down'
}
