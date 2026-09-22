// Small helpers local to the Today page. Not shared with other pages —
// see the final report for why (page builders only own their own pages/<x>/ folder).

import { istDateKey } from '../../lib/format'

/** m:ss duration between two ISO timestamps. '—' when not finished or invalid. */
export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—'
  const start = new Date(startedAt).getTime()
  const end = new Date(finishedAt).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return '—'
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Today's IST calendar date as YYYY-MM-DD. */
export function todayIstKey(): string {
  return istDateKey(new Date().toISOString()) ?? ''
}

/** True when today (IST) is Monday..Friday. */
export function isIstWeekday(): boolean {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date())
  return wd !== 'Sat' && wd !== 'Sun'
}

/** Adds whole calendar days to a YYYY-MM-DD key. Pure date arithmetic, no timezone conversion. */
export function plusDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
