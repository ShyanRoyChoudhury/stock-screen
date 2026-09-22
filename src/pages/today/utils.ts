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

/** True when a YYYY-MM-DD calendar date key falls on Mon..Fri. A calendar date's weekday is
 *  timezone-independent, so this is pure integer date math (no Intl call needed). */
function isWeekdayKey(key: string): boolean {
  const [y, m, d] = key.split('-').map(Number)
  const wd = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay() // 0=Sun..6=Sat
  return wd !== 0 && wd !== 6
}

/** Minutes since midnight IST for a given instant, e.g. 16:30 IST -> 990. */
function istMinutesOfDay(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

/**
 * The trading day whose broker sync should already be complete, as of `now`:
 * - today's IST calendar date, when today is Mon–Fri AND the IST clock reads >= 16:30
 *   (market close plus a buffer for the sync job to run), otherwise
 * - the most recent previous weekday (walking back a day at a time, skipping Sat/Sun).
 */
export function expectedSyncDate(now: Date = new Date()): string {
  const todayKey = istDateKey(now.toISOString()) ?? ''
  if (isWeekdayKey(todayKey) && istMinutesOfDay(now) >= 16 * 60 + 30) {
    return todayKey
  }
  let key = plusDaysKey(todayKey, -1)
  while (!isWeekdayKey(key)) key = plusDaysKey(key, -1)
  return key
}
