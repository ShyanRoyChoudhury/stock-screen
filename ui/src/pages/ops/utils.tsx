// Small helpers local to the Ops page (mirrors src/pages/today/utils.ts — see the final
// report for why these aren't shared).

import { ApiError } from '../../api/types'

/** Maps a mutation error to the toast message it should show. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return '409 · A run is already active'
    return `${err.status} · ${err.message}`
  }
  if (err instanceof Error) return err.message
  return String(err)
}

/** Flattens an untyped synchronous mutation result (corporate-actions load / refresh universe)
 *  into a short toast string. Both endpoints return `unknown` per BUILD_BRIEF. */
export function summarizeResult(data: unknown): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>)
    if (!entries.length) return 'done'
    return entries.map(([k, v]) => `${k} ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`).join(' · ')
  }
  return String(data)
}
