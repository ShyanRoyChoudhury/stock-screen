// One typed function per endpoint, exactly as listed in BUILD_BRIEF.md.

import { apiFetch } from './client'
import type {
  Symbol,
  Candle,
  IndicatorRow,
  Signal,
  CorporateAction,
  IngestRun,
  User,
  BrokerAccount,
  Trade,
  Position,
  Evaluation,
  SyncResult,
  ImportResult,
  Timeframe,
  Strategy,
  Verdict,
  ActionType,
  Broker,
} from './types'

function qs(params: object): string {
  const search = new URLSearchParams()
  const entries = Object.entries(params) as [string, string | number | boolean | string[] | undefined | null][]
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, String(v))
    } else {
      search.set(key, String(value))
    }
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

// ---------------------------------------------------------------------------
// Public: market data and pipeline
// ---------------------------------------------------------------------------

export function health(): Promise<{ status: string; database: string }> {
  return apiFetch('/health')
}

export function listSymbols(activeOnly = true): Promise<Symbol[]> {
  return apiFetch(`/symbols${qs({ active_only: activeOnly })}`)
}

export function refreshSymbols(): Promise<unknown> {
  return apiFetch('/symbols/refresh', { method: 'POST' })
}

export interface CandleParams {
  timeframe: Timeframe
  start?: string
  end?: string
  limit?: number
}

export function getCandles(symbol: string, params: CandleParams): Promise<Candle[]> {
  return apiFetch(`/candles/${encodeURIComponent(symbol)}${qs(params)}`)
}

export function getIndicators(symbol: string, params: CandleParams): Promise<IndicatorRow[]> {
  return apiFetch(`/indicators/${encodeURIComponent(symbol)}${qs(params)}`)
}

export interface ListSignalsParams {
  symbol?: string
  strategy?: Strategy
  timeframe?: Timeframe
  since?: string
  limit?: number
}

export function listSignals(params: ListSignalsParams = {}): Promise<Signal[]> {
  return apiFetch(`/signals${qs(params)}`)
}

export interface FreshSignalsParams {
  days?: number
  strategy?: Strategy
  timeframe?: Timeframe
}

export function freshSignals(params: FreshSignalsParams = {}): Promise<Signal[]> {
  return apiFetch(`/signals/fresh${qs(params)}`)
}

export interface ListCorporateActionsParams {
  symbol?: string
  action_type?: ActionType
  limit?: number
}

export function listCorporateActions(params: ListCorporateActionsParams = {}): Promise<CorporateAction[]> {
  return apiFetch(`/corporate-actions${qs(params)}`)
}

export function loadCorporateActions(body: { from_date?: string; to_date?: string; symbols?: string[] }): Promise<unknown> {
  return apiFetch('/corporate-actions/load', { method: 'POST', body })
}

export function startIngest(body: { mode: 'backfill' | 'incremental'; timeframes: Timeframe[]; symbols?: string[] }): Promise<IngestRun> {
  return apiFetch('/ingest/run', { method: 'POST', body })
}

export function startIndicators(body: { timeframes?: Timeframe[]; symbols?: string[] } = {}): Promise<IngestRun> {
  return apiFetch('/indicators/run', { method: 'POST', body })
}

export function startSignals(body: { timeframes?: Timeframe[]; symbols?: string[]; strategies?: Strategy[] } = {}): Promise<IngestRun> {
  return apiFetch('/signals/run', { method: 'POST', body })
}

export function listRuns(limit = 20): Promise<IngestRun[]> {
  return apiFetch(`/ingest/runs${qs({ limit })}`)
}

export function getRun(id: number): Promise<IngestRun> {
  return apiFetch(`/ingest/runs/${id}`)
}

// ---------------------------------------------------------------------------
// Authenticated (X-API-Key)
// ---------------------------------------------------------------------------

export function me(): Promise<User> {
  return apiFetch('/me', { auth: true })
}

export function listBrokerAccounts(): Promise<BrokerAccount[]> {
  return apiFetch('/broker-accounts', { auth: true })
}

export function createBrokerAccount(body: { broker: Broker; label: string; api_key: string; totp_secret: string }): Promise<BrokerAccount> {
  return apiFetch('/broker-accounts', { method: 'POST', body, auth: true })
}

export function deactivateBrokerAccount(id: number): Promise<BrokerAccount> {
  return apiFetch(`/broker-accounts/${id}`, { method: 'DELETE', auth: true })
}

export function testBrokerAccount(id: number): Promise<{ ok: boolean; holdings: number }> {
  return apiFetch(`/broker-accounts/${id}/test`, { method: 'POST', auth: true })
}

export function syncBrokerAccount(id: number, body: { day?: string } = {}): Promise<SyncResult> {
  return apiFetch(`/broker-accounts/${id}/sync`, { method: 'POST', body, auth: true })
}

export function syncAllBrokerAccounts(): Promise<{ accounts: number; results: { account_id: number; ok: boolean; result?: SyncResult; error?: string }[] }> {
  return apiFetch('/broker-accounts/sync-all', { method: 'POST', auth: true })
}

export function importTradebook(id: number, file: File): Promise<ImportResult> {
  const form = new FormData()
  form.set('file', file)
  return apiFetch(`/broker-accounts/${id}/import-tradebook`, { method: 'POST', body: form, auth: true })
}

export interface ListTradesParams {
  from_date?: string
  to_date?: string
  symbol?: string
}

export function listTrades(params: ListTradesParams = {}): Promise<Trade[]> {
  return apiFetch(`/broker-accounts/trades${qs(params)}`, { auth: true })
}

export function listPositions(status?: 'open' | 'closed'): Promise<Position[]> {
  return apiFetch(`/positions${qs({ status })}`, { auth: true })
}

export function getPosition(id: number): Promise<Position> {
  return apiFetch(`/positions/${id}`, { auth: true })
}

export function positionEvaluations(id: number): Promise<Evaluation[]> {
  return apiFetch(`/positions/${id}/evaluations`, { auth: true })
}

export function evaluationsForDay(as_of?: string): Promise<Evaluation[]> {
  return apiFetch(`/positions/evaluations${qs({ as_of })}`, { auth: true })
}

export function evaluatePositions(body: { as_of?: string } = {}): Promise<{ as_of: string; evaluated: number; by_verdict: Record<Verdict, number>; errors: { position_id: number; error: string }[] }> {
  return apiFetch('/positions/evaluate', { method: 'POST', body, auth: true })
}

export function matchPosition(id: number, body: { strategy: Strategy; ts: string }): Promise<Position> {
  return apiFetch(`/positions/${id}/match`, { method: 'POST', body, auth: true })
}

export function reattributeSell(sellId: number, body: { allocations: { position_id: number; quantity: number }[] }): Promise<unknown> {
  return apiFetch(`/positions/trades/${sellId}/reattribute`, { method: 'POST', body, auth: true })
}
