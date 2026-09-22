// Small helpers local to the Today page. Not shared with other pages —
// see the final report for why (page builders only own their own pages/<x>/ folder).

import { istDateKey } from '../../lib/format'
import type { IngestRun, Position, RunMode, Verdict } from '../../api/types'

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

// ---------------------------------------------------------------------------
// Verdict ordering + fallback (BUILD_BRIEF: "last_verdict ?? latest_evaluation.verdict")
// ---------------------------------------------------------------------------

/** EXIT -> PARTIAL -> REVIEW -> HOLD, the order actionable positions/stat tiles read in. */
export const VERDICT_ORDER: Record<Verdict, number> = { EXIT: 0, PARTIAL: 1, REVIEW: 2, HOLD: 3 }

/** A position's effective verdict for grouping/sorting: last_verdict, falling back to the latest evaluation's. */
export function verdictOf(p: Position): Verdict {
  return p.last_verdict ?? p.latest_evaluation?.verdict ?? 'HOLD'
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** Runs are newest-first per the API contract, so the first match per mode set is the latest run for it. */
export function latestForModes(runs: IngestRun[], modes: RunMode[]): IngestRun | undefined {
  return runs.find((r) => modes.includes(r.mode))
}

// ---------------------------------------------------------------------------
// Trading sessions (prototype's sessionsUntil, app.jsx line ~62)
// ---------------------------------------------------------------------------

/** Count of Mon-Fri calendar dates strictly between two YYYY-MM-DD keys (exclusive of `from`, inclusive of `to`). */
export function sessionsUntil(from: string, to: string): number {
  let n = 0
  let key = from
  while (key < to) {
    key = plusDaysKey(key, 1)
    const wd = new Date(`${key}T00:00:00Z`).getUTCDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return n
}
