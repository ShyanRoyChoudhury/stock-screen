// Mock fixtures + router, used only when VITE_MOCK === '1'.
// Serves the authenticated routes (/me, /broker-accounts*, /positions*) so
// position/broker screens can be designed before the real DB has any rows.
// See BUILD_BRIEF.md "Mock mode".

import { ApiError } from './types'
import type {
  User,
  BrokerAccount,
  Trade,
  Position,
  Evaluation,
  SyncResult,
  ImportResult,
} from './types'

const MOCK_PREFIXES = ['/me', '/broker-accounts', '/positions']

export function isMockRoute(path: string): boolean {
  const pathname = path.split('?')[0]
  return MOCK_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ME: User = { id: 59, name: 'ui-dev', email: 'ui-dev@local.invalid', created_at: '2026-01-05T09:00:00Z' }

const BROKER_ACCOUNTS: BrokerAccount[] = [
  {
    id: 1,
    broker: 'groww',
    label: 'Main',
    active: true,
    last_sync_on: '2026-09-21',
    last_sync_status: 'ok',
    last_sync_message: '2 trades synced, 0 unmapped',
    created_at: '2026-01-05T09:05:00Z',
  },
  {
    id: 2,
    broker: 'groww',
    label: 'Secondary',
    active: true,
    last_sync_on: '2026-09-19',
    last_sync_status: 'auth_failed',
    last_sync_message: 'auth: token request rejected',
    created_at: '2026-02-11T09:05:00Z',
  },
]

const TRADES: Trade[] = [
  { id: 1, broker: 'groww', tradingsymbol: 'CARBORUNIV', symbol: 'CARBORUNIV', isin: 'INE120A01034', side: 'BUY', quantity: 40, price: 1182.0, trade_ts: '2026-09-15T04:02:11+00:00', trade_date: '2026-09-15', position_id: 1, applied_at: '2026-09-15T10:50:00Z' },
  { id: 2, broker: 'groww', tradingsymbol: 'RELIANCE', symbol: 'RELIANCE', isin: 'INE002A01018', side: 'BUY', quantity: 50, price: 1230.1, trade_ts: '2026-09-08T04:05:00+00:00', trade_date: '2026-09-08', position_id: 2, applied_at: '2026-09-08T10:50:00Z' },
  { id: 3, broker: 'groww', tradingsymbol: 'BHEL', symbol: 'BHEL', isin: 'INE257A01026', side: 'BUY', quantity: 100, price: 210.4, trade_ts: '2026-08-25T04:10:00+00:00', trade_date: '2026-08-25', position_id: 3, applied_at: '2026-08-25T10:50:00Z' },
  { id: 4, broker: 'groww', tradingsymbol: 'PATANJALI', symbol: 'PATANJALI', isin: 'INE619A01035', side: 'BUY', quantity: 60, price: 396.2, trade_ts: '2026-09-01T04:03:00+00:00', trade_date: '2026-09-01', position_id: 4, applied_at: '2026-09-01T10:50:00Z' },
  { id: 5, broker: 'groww', tradingsymbol: 'USHAMART', symbol: 'USHAMART', isin: 'INE805B01021', side: 'BUY', quantity: 30, price: 533.9, trade_ts: '2026-09-18T04:07:00+00:00', trade_date: '2026-09-18', position_id: 5, applied_at: '2026-09-18T10:50:00Z' },
  { id: 6, broker: 'groww', tradingsymbol: 'CDSL', symbol: 'CDSL', isin: 'INE736A01011', side: 'BUY', quantity: 20, price: 1388.9, trade_ts: '2026-07-01T04:12:00+00:00', trade_date: '2026-07-01', position_id: 6, applied_at: '2026-07-01T10:50:00Z' },
  { id: 7, broker: 'groww', tradingsymbol: 'CDSL', symbol: 'CDSL', isin: 'INE736A01011', side: 'SELL', quantity: 20, price: 1560.5, trade_ts: '2026-08-20T05:45:00+00:00', trade_date: '2026-08-20', position_id: 6, applied_at: '2026-08-20T10:50:00Z' },
  { id: 8, broker: 'groww', tradingsymbol: 'SGBSEP29VI', symbol: null, isin: null, side: 'SELL', quantity: 10, price: 6200.0, trade_ts: '2026-09-20T05:20:00+00:00', trade_date: '2026-09-20', position_id: null, applied_at: null },
]

const POSITIONS: Position[] = [
  {
    id: 1,
    user_id: 59,
    broker_account_id: 1,
    symbol_id: 106,
    symbol: 'CARBORUNIV',
    status: 'open',
    opened_on: '2026-09-15',
    entry_trade_id: 1,
    qty_open: 40,
    qty_total: 40,
    avg_entry_price: 1182.0,
    avg_entry_price_raw: 1182.0,
    structural_factor_applied: 1.0,
    last_restated_on: null,
    matched_strategy: 'S1_ST_Flip',
    matched_signal_ts: '2026-09-14T03:45:00+00:00',
    matched_timeframe: '1d',
    match_confidence: 0.9337,
    match_reason: 'S1_ST_Flip @2026-09-14, fill 0.3% from entry',
    is_unmatched: false,
    frozen_entry: 1178.9,
    frozen_stop: 1032.04,
    frozen_target_1: 1261.42,
    frozen_target_2: 1320.37,
    frozen_details: { vol_ratio: 10.37, supertrend: 1037.22 },
    closed_on: null,
    exit_trade_id: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    last_evaluated_on: '2026-09-21',
    last_verdict: 'HOLD',
    created_at: '2026-09-15T10:50:00Z',
    updated_at: '2026-09-21T10:50:00Z',
    latest_evaluation: {
      position_id: 1,
      as_of: '2026-09-21',
      bar_ts: '2026-09-21T03:45:00+00:00',
      close: 1204.5,
      high: 1211.0,
      low: 1190.2,
      stop_level: 1032.04,
      trail_level: 1158.3,
      target_1: 1261.42,
      target_2: 1320.37,
      supertrend_dir: 1,
      atr: 21.1,
      verdict: 'HOLD',
      reasons: [],
      warnings: [
        { code: 'UPCOMING_ACTION', detail: 'dividend ex 2026-09-29: Interim Dividend - Rs 3 Per Share; broker may cancel your GTT; re-place the stop after the ex-date' },
      ],
      unrealized_pnl_pct: 0.019,
      days_held: 6,
    },
  },
  {
    id: 2,
    user_id: 59,
    broker_account_id: 1,
    symbol_id: 396,
    symbol: 'RELIANCE',
    status: 'open',
    opened_on: '2026-09-08',
    entry_trade_id: 2,
    qty_open: 50,
    qty_total: 50,
    avg_entry_price: 1230.1,
    avg_entry_price_raw: 1230.1,
    structural_factor_applied: 1.0,
    last_restated_on: null,
    matched_strategy: 'Confluence',
    matched_signal_ts: '2026-09-07T03:45:00+00:00',
    matched_timeframe: '1d',
    match_confidence: 0.71,
    match_reason: 'Confluence @2026-09-07, fill 0.6% from entry',
    is_unmatched: false,
    frozen_entry: 1228.5,
    frozen_stop: 1195.3,
    frozen_target_1: 1272.0,
    frozen_target_2: 1310.0,
    frozen_details: { score: '3/4', conviction: 'MODERATE' },
    closed_on: null,
    exit_trade_id: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    last_evaluated_on: '2026-09-21',
    last_verdict: 'PARTIAL',
    created_at: '2026-09-08T10:50:00Z',
    updated_at: '2026-09-21T10:50:00Z',
    latest_evaluation: {
      position_id: 2,
      as_of: '2026-09-21',
      bar_ts: '2026-09-21T03:45:00+00:00',
      close: 1274.8,
      high: 1280.0,
      low: 1265.0,
      stop_level: 1195.3,
      trail_level: 1240.1,
      target_1: 1272.0,
      target_2: 1310.0,
      supertrend_dir: 1,
      atr: 18.4,
      verdict: 'PARTIAL',
      reasons: [{ code: 'T1_HIT', detail: 'close 1274.8 >= target_1 1272.0' }],
      warnings: [],
      unrealized_pnl_pct: 0.0362,
      days_held: 13,
    },
  },
  {
    id: 3,
    user_id: 59,
    broker_account_id: 1,
    symbol_id: 90,
    symbol: 'BHEL',
    status: 'open',
    opened_on: '2026-08-25',
    entry_trade_id: 3,
    qty_open: 100,
    qty_total: 100,
    avg_entry_price: 210.4,
    avg_entry_price_raw: 210.4,
    structural_factor_applied: 1.0,
    last_restated_on: null,
    matched_strategy: 'S2_MACD_Zero',
    matched_signal_ts: '2026-08-24T03:45:00+00:00',
    matched_timeframe: '1d',
    match_confidence: 0.88,
    match_reason: 'S2_MACD_Zero @2026-08-24, fill 0.2% from entry',
    is_unmatched: false,
    frozen_entry: 210.0,
    frozen_stop: 200.5,
    frozen_target_1: 224.7,
    frozen_target_2: 235.2,
    frozen_details: { macd: 1.12 },
    closed_on: null,
    exit_trade_id: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    last_evaluated_on: '2026-09-21',
    last_verdict: 'EXIT',
    created_at: '2026-08-25T10:50:00Z',
    updated_at: '2026-09-21T10:50:00Z',
    latest_evaluation: {
      position_id: 3,
      as_of: '2026-09-21',
      bar_ts: '2026-09-21T03:45:00+00:00',
      close: 197.3,
      high: 201.0,
      low: 195.8,
      stop_level: 200.5,
      trail_level: 200.5,
      target_1: 224.7,
      target_2: 235.2,
      supertrend_dir: -1,
      atr: 4.9,
      verdict: 'EXIT',
      reasons: [
        { code: 'STOP_HIT', detail: 'close 197.3 < stop 200.5' },
        { code: 'SUPERTREND_FLIP', detail: null },
      ],
      warnings: [{ code: 'VOLUME_DIVERGENCE', detail: null }],
      unrealized_pnl_pct: -0.0623,
      days_held: 27,
    },
  },
  {
    id: 4,
    user_id: 59,
    broker_account_id: 1,
    symbol_id: 320,
    symbol: 'PATANJALI',
    status: 'open',
    opened_on: '2026-09-01',
    entry_trade_id: 4,
    qty_open: 60,
    qty_total: 60,
    avg_entry_price: 396.2,
    avg_entry_price_raw: 396.2,
    structural_factor_applied: 1.0,
    last_restated_on: null,
    matched_strategy: 'S3_BB_Squeeze',
    matched_signal_ts: '2026-08-31T03:45:00+00:00',
    matched_timeframe: '1d',
    match_confidence: 0.65,
    match_reason: 'S3_BB_Squeeze @2026-08-31, fill 0.4% from entry',
    is_unmatched: false,
    frozen_entry: 394.5,
    frozen_stop: 340.8,
    frozen_target_1: 426.1,
    frozen_target_2: 453.7,
    frozen_details: { bandwidth: 0.029, vol_ratio: 1.8 },
    closed_on: null,
    exit_trade_id: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    last_evaluated_on: '2026-09-21',
    last_verdict: 'REVIEW',
    created_at: '2026-09-01T10:50:00Z',
    updated_at: '2026-09-21T10:50:00Z',
    latest_evaluation: {
      position_id: 4,
      as_of: '2026-09-21',
      bar_ts: '2026-09-21T03:45:00+00:00',
      close: 402.1,
      high: 408.0,
      low: 398.0,
      stop_level: 340.8,
      trail_level: 375.2,
      target_1: 426.1,
      target_2: 453.7,
      supertrend_dir: 1,
      atr: 9.6,
      verdict: 'REVIEW',
      reasons: [{ code: 'DEMERGER_CLIFF', detail: 'demerger ex 2026-09-18: stored prices are not demerger-adjusted; levels may be unreliable' }],
      warnings: [],
      unrealized_pnl_pct: 0.0149,
      days_held: 20,
    },
  },
  {
    id: 5,
    user_id: 59,
    broker_account_id: 1,
    symbol_id: 470,
    symbol: 'USHAMART',
    status: 'open',
    opened_on: '2026-09-18',
    entry_trade_id: 5,
    qty_open: 30,
    qty_total: 30,
    avg_entry_price: 533.9,
    avg_entry_price_raw: 533.9,
    structural_factor_applied: 1.0,
    last_restated_on: null,
    matched_strategy: null,
    matched_signal_ts: null,
    matched_timeframe: '1d',
    match_confidence: null,
    match_reason: null,
    is_unmatched: true,
    frozen_entry: null,
    frozen_stop: null,
    frozen_target_1: null,
    frozen_target_2: null,
    frozen_details: {},
    closed_on: null,
    exit_trade_id: null,
    realized_pnl: null,
    realized_pnl_pct: null,
    last_evaluated_on: '2026-09-21',
    last_verdict: 'HOLD',
    created_at: '2026-09-18T10:50:00Z',
    updated_at: '2026-09-21T10:50:00Z',
    latest_evaluation: {
      position_id: 5,
      as_of: '2026-09-21',
      bar_ts: '2026-09-21T03:45:00+00:00',
      close: 541.2,
      high: 545.0,
      low: 535.0,
      stop_level: 495.1,
      trail_level: 495.1,
      target_1: null,
      target_2: null,
      supertrend_dir: 1,
      atr: 12.3,
      verdict: 'HOLD',
      reasons: [],
      warnings: [{ code: 'QTY_DIFFERS_FROM_BROKER', detail: 'platform qty 30 vs broker holdings 28' }],
      unrealized_pnl_pct: 0.0137,
      days_held: 3,
    },
  },
  {
    id: 6,
    user_id: 59,
    broker_account_id: 1,
    symbol_id: 172,
    symbol: 'CDSL',
    status: 'closed',
    opened_on: '2026-07-01',
    entry_trade_id: 6,
    qty_open: 0,
    qty_total: 20,
    avg_entry_price: 1388.9,
    avg_entry_price_raw: 1388.9,
    structural_factor_applied: 1.0,
    last_restated_on: null,
    matched_strategy: 'TTM_Squeeze',
    matched_signal_ts: '2026-06-30T03:45:00+00:00',
    matched_timeframe: '1d',
    match_confidence: 0.81,
    match_reason: 'TTM_Squeeze @2026-06-30, fill 0.1% from entry',
    is_unmatched: false,
    frozen_entry: 1387.5,
    frozen_stop: 1340.77,
    frozen_target_1: 1500.01,
    frozen_target_2: 1597.24,
    frozen_details: { kc_mid: 1350.1, momentum: 0.021, squeeze_bars: 9 },
    closed_on: '2026-08-20',
    exit_trade_id: 7,
    realized_pnl: 3432.0,
    realized_pnl_pct: 0.1236,
    last_evaluated_on: '2026-08-20',
    last_verdict: 'EXIT',
    created_at: '2026-07-01T10:50:00Z',
    updated_at: '2026-08-20T10:50:00Z',
    latest_evaluation: null,
  },
]

const EVALUATIONS_POSITION_1: Evaluation[] = [
  POSITIONS[0].latest_evaluation as Evaluation,
  {
    position_id: 1, as_of: '2026-09-18', bar_ts: '2026-09-18T03:45:00+00:00',
    close: 1196.2, high: 1203.0, low: 1188.0, stop_level: 1032.04, trail_level: 1140.6,
    target_1: 1261.42, target_2: 1320.37, supertrend_dir: 1, atr: 20.5,
    verdict: 'HOLD', reasons: [], warnings: [],
    unrealized_pnl_pct: 0.0121, days_held: 3,
  },
  {
    position_id: 1, as_of: '2026-09-17', bar_ts: '2026-09-17T03:45:00+00:00',
    close: 1188.9, high: 1195.0, low: 1180.1, stop_level: 1032.04, trail_level: 1125.9,
    target_1: 1261.42, target_2: 1320.37, supertrend_dir: 1, atr: 20.1,
    verdict: 'HOLD', reasons: [], warnings: [{ code: 'LOW_BREACH', detail: null }],
    unrealized_pnl_pct: 0.0059, days_held: 2,
  },
  {
    position_id: 1, as_of: '2026-09-16', bar_ts: '2026-09-16T03:45:00+00:00',
    close: 1179.4, high: 1186.0, low: 1170.5, stop_level: 1032.04, trail_level: 1112.7,
    target_1: 1261.42, target_2: 1320.37, supertrend_dir: 1, atr: 19.8,
    verdict: 'HOLD', reasons: [], warnings: [],
    unrealized_pnl_pct: -0.0022, days_held: 1,
  },
  {
    position_id: 1, as_of: '2026-09-15', bar_ts: '2026-09-15T03:45:00+00:00',
    close: 1178.9, high: 1182.0, low: 1170.0, stop_level: 1032.04, trail_level: 1102.1,
    target_1: 1261.42, target_2: 1320.37, supertrend_dir: 1, atr: 19.6,
    verdict: 'HOLD', reasons: [], warnings: [],
    unrealized_pnl_pct: -0.0026, days_held: 0,
  },
]

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

interface MockRequest {
  method: string
  body?: unknown
  auth?: boolean
}

function ok<T>(data: T): T {
  return data
}

function nextId(existingIds: number[]): number {
  return existingIds.length ? Math.max(...existingIds) + 1 : 1
}

export async function mockFetch<T>(rawPath: string, req: MockRequest): Promise<T> {
  await delay(150)

  const url = new URL(rawPath, 'http://mock.local')
  const pathname = url.pathname
  const qp = url.searchParams
  const method = (req.method || 'GET').toUpperCase()
  const body = (req.body ?? {}) as Record<string, unknown>

  // --- /me ---------------------------------------------------------------
  if (pathname === '/me' && method === 'GET') return ok(ME) as T

  // --- /broker-accounts ----------------------------------------------------
  if (pathname === '/broker-accounts' && method === 'GET') return ok(BROKER_ACCOUNTS) as T

  if (pathname === '/broker-accounts' && method === 'POST') {
    const created: BrokerAccount = {
      id: nextId(BROKER_ACCOUNTS.map((a) => a.id)),
      broker: (body.broker as BrokerAccount['broker']) ?? 'groww',
      label: (body.label as string) ?? 'New account',
      active: true,
      last_sync_on: null,
      last_sync_status: null,
      last_sync_message: null,
      created_at: new Date().toISOString(),
    }
    return ok(created) as T
  }

  if (pathname === '/broker-accounts/trades' && method === 'GET') {
    let rows = TRADES
    const symbol = qp.get('symbol')
    const fromDate = qp.get('from_date')
    const toDate = qp.get('to_date')
    if (symbol) rows = rows.filter((t) => t.symbol === symbol)
    if (fromDate) rows = rows.filter((t) => t.trade_date >= fromDate)
    if (toDate) rows = rows.filter((t) => t.trade_date <= toDate)
    return ok([...rows].sort((a, b) => (a.trade_ts < b.trade_ts ? 1 : -1))) as T
  }

  if (pathname === '/broker-accounts/sync-all' && method === 'POST') {
    return ok({
      accounts: BROKER_ACCOUNTS.length,
      results: BROKER_ACCOUNTS.map((a) => ({
        account_id: a.id,
        ok: a.last_sync_status !== 'auth_failed',
        result: a.last_sync_status !== 'auth_failed' ? mockSyncResult() : undefined,
        error: a.last_sync_status === 'auth_failed' ? a.last_sync_message ?? undefined : undefined,
      })),
    }) as T
  }

  const accountMatch = pathname.match(/^\/broker-accounts\/(\d+)(?:\/(.+))?$/)
  if (accountMatch) {
    const id = Number(accountMatch[1])
    const sub = accountMatch[2]
    const account = BROKER_ACCOUNTS.find((a) => a.id === id)

    if (!sub && method === 'DELETE') {
      if (!account) throw new ApiError(404, `Broker account ${id} not found`)
      return ok({ ...account, active: false }) as T
    }
    if (sub === 'test' && method === 'POST') {
      if (!account) throw new ApiError(404, `Broker account ${id} not found`)
      return ok({ ok: true, holdings: 12 }) as T
    }
    if (sub === 'sync' && method === 'POST') {
      if (!account) throw new ApiError(404, `Broker account ${id} not found`)
      return ok(mockSyncResult()) as T
    }
    if (sub === 'import-tradebook' && method === 'POST') {
      if (!account) throw new ApiError(404, `Broker account ${id} not found`)
      const result: ImportResult = {
        rows: 10,
        upserted: 9,
        unmapped: 1,
        ledger: { buys_opened: 4, sells_allocated: 3, orphan_sells: [], skipped_unmapped: 1, errors: [] },
      }
      return ok(result) as T
    }
  }

  // --- /positions ----------------------------------------------------------
  if (pathname === '/positions' && method === 'GET') {
    const status = qp.get('status')
    const rows = status ? POSITIONS.filter((p) => p.status === status) : POSITIONS
    return ok(rows) as T
  }

  if (pathname === '/positions/evaluations' && method === 'GET') {
    const rows = POSITIONS.map((p) => p.latest_evaluation).filter((e): e is Evaluation => e !== null)
    return ok(rows) as T
  }

  if (pathname === '/positions/evaluate' && method === 'POST') {
    const openPositions = POSITIONS.filter((p) => p.status === 'open')
    const byVerdict: Record<string, number> = { HOLD: 0, PARTIAL: 0, EXIT: 0, REVIEW: 0 }
    for (const p of openPositions) {
      const v = p.latest_evaluation?.verdict ?? 'HOLD'
      byVerdict[v] = (byVerdict[v] ?? 0) + 1
    }
    return ok({
      as_of: (body.as_of as string) ?? '2026-09-21',
      evaluated: openPositions.length,
      by_verdict: byVerdict,
      errors: [],
    }) as T
  }

  const reattributeMatch = pathname.match(/^\/positions\/trades\/(\d+)\/reattribute$/)
  if (reattributeMatch && method === 'POST') {
    return ok({ ok: true, message: 'Reattributed (mock)' }) as T
  }

  const positionMatch = pathname.match(/^\/positions\/(\d+)(?:\/(.+))?$/)
  if (positionMatch) {
    const id = Number(positionMatch[1])
    const sub = positionMatch[2]
    const position = POSITIONS.find((p) => p.id === id)

    if (!sub && method === 'GET') {
      if (!position) throw new ApiError(404, `Position ${id} not found`)
      return ok(position) as T
    }
    if (sub === 'evaluations' && method === 'GET') {
      if (!position) throw new ApiError(404, `Position ${id} not found`)
      if (id === 1) return ok(EVALUATIONS_POSITION_1) as T
      return ok(position.latest_evaluation ? [position.latest_evaluation] : []) as T
    }
    if (sub === 'match' && method === 'POST') {
      if (!position) throw new ApiError(404, `Position ${id} not found`)
      const updated: Position = {
        ...position,
        matched_strategy: (body.strategy as Position['matched_strategy']) ?? position.matched_strategy,
        matched_signal_ts: (body.ts as string) ?? position.matched_signal_ts,
        matched_timeframe: '1d',
        match_confidence: 1.0,
        match_reason: 'manual',
        is_unmatched: false,
      }
      return ok(updated) as T
    }
  }

  throw new ApiError(404, `No mock handler for ${method} ${pathname}`)
}

function mockSyncResult(): SyncResult {
  return {
    trades: { received: 2, upserted: 2, unmapped: 0 },
    holdings: 14,
    ledger: { buys_opened: 1, sells_allocated: 1, orphan_sells: [], skipped_unmapped: 0, errors: [] },
  }
}
