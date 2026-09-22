// Copied from src/pages/today/utils.ts (BUILD_BRIEF: "copy the helper... you
// don't own that folder"). Keep in sync manually if the Today page's version
// changes; do not import across page folders.

import { istDateKey } from '../../lib/format'
import { ApiError } from '../../api/types'

/** Adds whole calendar days to a YYYY-MM-DD key. Pure date arithmetic, no timezone conversion. */
function plusDaysKey(key: string, days: number): string {
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

/** `"{status} · {message}"` for an ApiError, else a plain Error/String message — for inline errors and toasts. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} · ${err.message}`
  return err instanceof Error ? err.message : String(err)
}
