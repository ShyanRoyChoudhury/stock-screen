// Copied verbatim from BUILD_BRIEF.md "Types (`api/types.ts`)".
// Extend only if the API proves different from this contract.

export type Timeframe = '1h' | '4h' | '1d'
export type Strategy = 'PIPELINE' | 'S1_ST_Flip' | 'S2_MACD_Zero' | 'S3_BB_Squeeze' | 'TTM_Squeeze' | 'Confluence'
export type Verdict = 'HOLD' | 'PARTIAL' | 'EXIT' | 'REVIEW'
export type RunMode = 'backfill' | 'incremental' | 'indicators' | 'signals' | 'broker_sync' | 'evaluate'
export type RunStatus = 'running' | 'completed' | 'failed'
export type ActionType = 'dividend' | 'split' | 'bonus' | 'rights' | 'demerger'
export type Broker = 'groww' | 'zerodha'
export type SyncStatus = 'ok' | 'auth_failed' | 'error'

export interface Symbol { id: number; symbol: string; name: string | null; industry: string | null; isin: string | null; active: boolean }
export interface Candle { ts: string; timeframe: Timeframe; open: number; high: number; low: number; close: number; volume: number }
export interface IndicatorRow {
  ts: string; timeframe: Timeframe
  atr_10: number | null; supertrend_10_3: number | null; supertrend_dir: 1 | -1 | null
  macd_12_26: number | null; macd_signal_9: number | null; macd_hist: number | null
  ema_50: number | null; ema_200: number | null; adx_14: number | null
  bb_upper_20_2: number | null; bb_middle_20_2: number | null; bb_lower_20_2: number | null; bb_bandwidth: number | null
  volume_ma_20: number | null
  kc_upper_20_15: number | null; kc_middle_20: number | null; kc_lower_20_15: number | null
  ttm_squeeze_on: boolean | null; ttm_squeeze_off: boolean | null; ttm_momentum: number | null
  rvol_20: number | null; computed_at: string
}
export interface Signal {
  symbol: string; strategy: Strategy; timeframe: Timeframe; ts: string
  entry_mode: 'IMMEDIATE' | 'RETEST' | null
  entry: number; stop_loss: number; target_1: number; target_2: number
  risk_pct: number | null // PERCENT (8.92 = 8.92%)
  rr_ratio: number | null // only Confluence and TTM_Squeeze fill this; compute client-side otherwise
  details: Record<string, unknown>
}
export interface CorporateAction {
  symbol: string; action_type: ActionType; ex_date: string; record_date: string | null
  value: number | null; ratio_from: number | null; ratio_to: number | null; price_factor: number | null
  is_extraordinary: boolean; affects_share_count: boolean; subject: string
}
export interface IngestRun {
  id: number; mode: RunMode; status: RunStatus; timeframes: string[]
  symbols_total: number; symbols_ok: number; symbols_failed: number
  candles_written: number // generic "rows written" for every mode
  message: string | null; errors: { symbol?: string; position_id?: number; error: string }[]
  started_at: string; finished_at: string | null
}
export interface User { id: number; name: string; email: string | null; created_at: string }
export interface BrokerAccount {
  id: number; broker: Broker; label: string; active: boolean
  last_sync_on: string | null; last_sync_status: SyncStatus | null; last_sync_message: string | null; created_at: string
}
export interface Trade {
  id: number; broker: string; tradingsymbol: string; symbol: string | null; isin: string | null
  side: 'BUY' | 'SELL'; quantity: number; price: number; trade_ts: string; trade_date: string
  position_id: number | null; applied_at: string | null
}
export interface ReasonCode { code: string; detail: string | null }
export interface Evaluation {
  position_id: number; as_of: string; bar_ts: string; close: number; high: number; low: number
  stop_level: number | null; trail_level: number | null; target_1: number | null; target_2: number | null
  supertrend_dir: 1 | -1 | null; atr: number | null; verdict: Verdict
  reasons: ReasonCode[]; warnings: ReasonCode[]
  unrealized_pnl_pct: number // FRACTION (0.019 = 1.9%)
  days_held: number
}
export interface Position {
  id: number; user_id: number; broker_account_id: number; symbol_id: number; symbol: string
  status: 'open' | 'closed'; opened_on: string; entry_trade_id: number
  qty_open: number; qty_total: number
  avg_entry_price: number // adjusted (comparable to chart)
  avg_entry_price_raw: number // as paid
  structural_factor_applied: number; last_restated_on: string | null
  matched_strategy: Strategy | null; matched_signal_ts: string | null; matched_timeframe: Timeframe
  match_confidence: number | null; match_reason: string | null; is_unmatched: boolean
  frozen_entry: number | null; frozen_stop: number | null; frozen_target_1: number | null; frozen_target_2: number | null
  frozen_details: Record<string, unknown>
  closed_on: string | null; exit_trade_id: number | null
  realized_pnl: number | null // ₹ gross
  realized_pnl_pct: number | null // FRACTION
  last_evaluated_on: string | null; last_verdict: Verdict | null
  created_at: string; updated_at: string
  latest_evaluation: Evaluation | null
}
export interface LedgerResult { buys_opened: number; sells_allocated: number; orphan_sells: { trade_id: number; leftover: number }[]; skipped_unmapped: number; errors: { trade_id: number; error: string }[] }
export interface SyncResult { trades: { received: number; upserted: number; unmapped: number }; holdings: number; ledger: LedgerResult | null }
export interface ImportResult { rows: number; upserted: number; unmapped: number; ledger: LedgerResult | null }
export class ApiError extends Error { constructor(public status: number, message: string, public detail?: unknown) { super(message) } }
