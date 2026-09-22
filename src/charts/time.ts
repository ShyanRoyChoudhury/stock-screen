// Time mapping for lightweight-charts: candle/indicator/signal `ts` (ISO-8601 UTC)
// -> a chart Time value, per BUILD_BRIEF/task rules.
//
// 1d: business-day string "YYYY-MM-DD" computed in IST (the daily bar's ts is
//     03:45Z = 09:15 IST on that date; we want the calendar date it belongs to).
// 1h/4h: UTC seconds + 19800 (5.5h), so the chart's UTC-based axis prints IST wall time.

import type { Time, UTCTimestamp } from 'lightweight-charts'
import type { Timeframe } from '../api/types'

const IST_OFFSET_SECONDS = 19800 // 5.5 hours

const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Maps an ISO timestamp to the Time value to plot it at, for the given timeframe. */
export function toChartTime(ts: string, timeframe: Timeframe): Time {
  const d = new Date(ts)
  if (timeframe === '1d') {
    return istDateFormatter.format(d) as Time
  }
  const utcSeconds = Math.floor(d.getTime() / 1000)
  return (utcSeconds + IST_OFFSET_SECONDS) as UTCTimestamp
}

/** Epoch-millisecond join key for matching candles to indicator rows by instant,
 * independent of how each endpoint formats its `ts` suffix ("Z" vs "+00:00"). */
export function tsKey(ts: string): number {
  return new Date(ts).getTime()
}
