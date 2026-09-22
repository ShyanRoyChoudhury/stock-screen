import { ApiError } from './types'
import { getApiKey } from '../lib/settings'
import { mockFetch, isMockRoute } from './mock'

const API_BASE = '/api'

export type ApiInit = Omit<RequestInit, 'body'> & {
  /** When true, sends X-API-Key (from settings, falling back to VITE_DEV_API_KEY). Throws if none is set. */
  auth?: boolean
  /** A plain object is JSON-encoded; FormData is sent as-is (multipart). */
  body?: unknown
}

function isMockMode(): boolean {
  try {
    return import.meta.env.VITE_MOCK === '1'
  } catch {
    return false
  }
}

async function parseErrorMessage(res: Response): Promise<{ message: string; detail?: unknown }> {
  try {
    const data = await res.json()
    const detail = data?.detail
    if (typeof detail === 'string') return { message: detail, detail }
    if (Array.isArray(detail)) {
      const msgs = detail
        .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : String(d)))
        .filter(Boolean)
      if (msgs.length) return { message: msgs.join('; '), detail }
    }
    return { message: `HTTP ${res.status}`, detail }
  } catch {
    return { message: `HTTP ${res.status}` }
  }
}

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { auth, body, headers, ...rest } = init

  if (isMockMode() && isMockRoute(path)) {
    return mockFetch<T>(path, { method: rest.method ?? 'GET', body, auth })
  }

  const finalHeaders = new Headers(headers)
  finalHeaders.set('Accept', 'application/json')

  let finalBody: BodyInit | undefined
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      finalBody = body
    } else {
      finalHeaders.set('Content-Type', 'application/json')
      finalBody = JSON.stringify(body)
    }
  }

  if (auth) {
    const key = getApiKey()
    if (!key) throw new ApiError(401, 'No API key set')
    finalHeaders.set('X-API-Key', key)
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: finalBody,
  })

  if (!res.ok) {
    const { message, detail } = await parseErrorMessage(res)
    throw new ApiError(res.status, message, detail)
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}
