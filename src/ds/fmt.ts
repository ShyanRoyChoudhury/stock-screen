// TypeScript port of the `fmt` object from design/design-system/src/index.jsx.
// Same IST semantics: input is a UTC ISO timestamp or a `YYYY-MM-DD` trading
// date; output is IST. U+2212 minus, en-IN digit grouping.

const MINUS = '−'
const nf: Record<number, Intl.NumberFormat> = {}
function numFmt(d: number): Intl.NumberFormat {
  return (nf[d] ??= new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }))
}
function sgn(n: number, signed?: boolean): string {
  return n > 0 ? (signed ? '+' : '') : n < 0 ? MINUS : ''
}
const abs = Math.abs
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const IST_MS = 330 * 60000

function toIst(v: string | null | undefined): Date | null {
  if (v == null) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d))
  }
  const t = new Date(v)
  if (Number.isNaN(t.getTime())) return null
  return new Date(t.getTime() + IST_MS)
}

const p2 = (n: number) => String(n).padStart(2, '0')

export const fmt = {
  /** ₹1,23,456.78 — Indian digit grouping, 2 decimals. */
  inr(n: number | null, d = 2): string {
    return n == null ? '—' : sgn(n) + '₹' + numFmt(d).format(abs(n))
  },
  /** 1,23,456.78 — a price without the symbol (column header carries ₹). */
  price(n: number | null, d = 2): string {
    return n == null ? '—' : sgn(n) + numFmt(d).format(abs(n))
  },
  /** 1,200 — quantities. */
  qty(n: number | null): string {
    return n == null ? '—' : sgn(n) + numFmt(0).format(abs(n))
  },
  /** n is already a percent (risk_pct 8.92 -> "8.92%"). */
  pct(n: number | null, d = 2, signed = false): string {
    return n == null ? '—' : sgn(n, signed) + abs(n).toFixed(d) + '%'
  },
  /** n is a fraction (unrealized_pnl_pct 0.019 -> "+1.90%"). */
  frac(n: number | null, d = 2, signed = true): string {
    return n == null ? '—' : sgn(n, signed) + abs(n * 100).toFixed(d) + '%'
  },
  /** Multiple of average (rvol 2.05 -> "2.05×"). */
  mult(n: number | null, d = 2): string {
    return n == null ? '—' : abs(n).toFixed(d) + '×'
  },
  /** (T1 − entry) / (entry − stop), or null. */
  rr(entry: number, stop: number, t1: number): number | null {
    return entry == null || stop == null || t1 == null || entry === stop ? null : (t1 - entry) / (entry - stop)
  },
  /** "21 Sep 2026" (or "Mon 21 Sep 2026"); accepts YYYY-MM-DD or a UTC ISO timestamp. */
  date(v: string, withDow = false): string {
    const t = toIst(v)
    if (!t) return '—'
    return (withDow ? DOW[t.getUTCDay()] + ' ' : '') + t.getUTCDate() + ' ' + MON[t.getUTCMonth()] + ' ' + t.getUTCFullYear()
  },
  /** "16:47 IST" from a UTC ISO timestamp. */
  time(v: string, suffix = true): string {
    const t = toIst(v)
    if (!t) return '—'
    return p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes()) + (suffix ? ' IST' : '')
  },
  /** "21 Sep 2026, 16:47 IST". */
  dateTime(v: string): string {
    return fmt.date(v) + ', ' + fmt.time(v)
  },
  /** Duration between two UTC timestamps: "6m 27s". */
  dur(a: string, b: string): string {
    const s = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000)
    if (!(s >= 0)) return '—'
    const m = Math.floor(s / 60)
    return m ? m + 'm ' + p2(s % 60) + 's' : s + 's'
  },
}
