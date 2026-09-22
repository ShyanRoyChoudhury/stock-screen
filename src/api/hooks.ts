// react-query v5 hooks wrapping api/endpoints.ts, with stable query keys.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './endpoints'
import type { Broker, Strategy, Timeframe } from './types'
import type { CandleParams, FreshSignalsParams, ListCorporateActionsParams, ListSignalsParams, ListTradesParams } from './endpoints'

const MARKET_STALE_TIME = 60_000
const RUNS_STALE_TIME = 10_000

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  symbols: (activeOnly: boolean) => ['symbols', activeOnly] as const,
  candles: (symbol: string, params: CandleParams) => ['candles', symbol, params] as const,
  indicators: (symbol: string, params: CandleParams) => ['indicators', symbol, params] as const,
  signals: (params: ListSignalsParams) => ['signals', params] as const,
  freshSignals: (params: FreshSignalsParams) => ['signals', 'fresh', params] as const,
  corporateActions: (params: ListCorporateActionsParams) => ['corporate-actions', params] as const,
  runs: (limit: number) => ['runs', limit] as const,
  run: (id: number) => ['runs', id] as const,
  me: () => ['me'] as const,
  brokerAccounts: () => ['broker-accounts'] as const,
  trades: (params: ListTradesParams) => ['trades', params] as const,
  positions: (status?: 'open' | 'closed') => ['positions', status ?? 'all'] as const,
  position: (id: number) => ['positions', id] as const,
  positionEvaluations: (id: number) => ['positions', id, 'evaluations'] as const,
  evaluationsForDay: (asOf?: string) => ['evaluations', asOf ?? 'latest'] as const,
}

// ---------------------------------------------------------------------------
// Public: market data and pipeline
// ---------------------------------------------------------------------------

export function useSymbols(activeOnly = true) {
  return useQuery({
    queryKey: queryKeys.symbols(activeOnly),
    queryFn: () => api.listSymbols(activeOnly),
    staleTime: MARKET_STALE_TIME,
  })
}

export function useCandles(symbol: string | undefined, params: CandleParams) {
  return useQuery({
    queryKey: queryKeys.candles(symbol ?? '', params),
    queryFn: () => api.getCandles(symbol as string, params),
    staleTime: MARKET_STALE_TIME,
    enabled: !!symbol,
  })
}

export function useIndicators(symbol: string | undefined, params: CandleParams) {
  return useQuery({
    queryKey: queryKeys.indicators(symbol ?? '', params),
    queryFn: () => api.getIndicators(symbol as string, params),
    staleTime: MARKET_STALE_TIME,
    enabled: !!symbol,
  })
}

export function useSignals(params: ListSignalsParams = {}) {
  return useQuery({
    queryKey: queryKeys.signals(params),
    queryFn: () => api.listSignals(params),
    staleTime: MARKET_STALE_TIME,
  })
}

export function useFreshSignals(params: FreshSignalsParams = {}) {
  return useQuery({
    queryKey: queryKeys.freshSignals(params),
    queryFn: () => api.freshSignals(params),
    staleTime: MARKET_STALE_TIME,
  })
}

export function useCorporateActions(params: ListCorporateActionsParams = {}) {
  return useQuery({
    queryKey: queryKeys.corporateActions(params),
    queryFn: () => api.listCorporateActions(params),
    staleTime: MARKET_STALE_TIME,
  })
}

export function useRuns(limit = 20) {
  return useQuery({
    queryKey: queryKeys.runs(limit),
    queryFn: () => api.listRuns(limit),
    staleTime: RUNS_STALE_TIME,
  })
}

export function useRun(id: number | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.run(id ?? -1),
    queryFn: () => api.getRun(id as number),
    staleTime: RUNS_STALE_TIME,
    enabled: !!id,
    refetchInterval: opts.poll
      ? (query) => (query.state.data?.status === 'running' ? 3000 : false)
      : undefined,
  })
}

// ---------------------------------------------------------------------------
// Authenticated: queries
// ---------------------------------------------------------------------------

export function useMe(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => api.me(),
    staleTime: MARKET_STALE_TIME,
    retry: false,
    enabled: opts.enabled ?? true,
  })
}

export function useBrokerAccounts(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.brokerAccounts(),
    queryFn: () => api.listBrokerAccounts(),
    staleTime: RUNS_STALE_TIME,
    enabled: opts.enabled ?? true,
  })
}

export function useTrades(params: ListTradesParams = {}) {
  return useQuery({
    queryKey: queryKeys.trades(params),
    queryFn: () => api.listTrades(params),
    staleTime: RUNS_STALE_TIME,
  })
}

export function usePositions(status?: 'open' | 'closed', opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.positions(status),
    queryFn: () => api.listPositions(status),
    staleTime: RUNS_STALE_TIME,
    enabled: opts.enabled ?? true,
  })
}

export function usePosition(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.position(id ?? -1),
    queryFn: () => api.getPosition(id as number),
    staleTime: RUNS_STALE_TIME,
    enabled: !!id,
  })
}

export function usePositionEvaluations(id: number | undefined) {
  return useQuery({
    queryKey: queryKeys.positionEvaluations(id ?? -1),
    queryFn: () => api.positionEvaluations(id as number),
    staleTime: RUNS_STALE_TIME,
    enabled: !!id,
  })
}

export function useEvaluationsForDay(asOf?: string) {
  return useQuery({
    queryKey: queryKeys.evaluationsForDay(asOf),
    queryFn: () => api.evaluationsForDay(asOf),
    staleTime: RUNS_STALE_TIME,
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useRefreshSymbols() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.refreshSymbols(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['symbols'] }),
  })
}

export function useLoadCorporateActions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { from_date?: string; to_date?: string; symbols?: string[] }) => api.loadCorporateActions(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['corporate-actions'] }),
  })
}

export function useStartIngest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { mode: 'backfill' | 'incremental'; timeframes: Timeframe[]; symbols?: string[] }) => api.startIngest(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
}

export function useStartIndicators() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { timeframes?: Timeframe[]; symbols?: string[] } = {}) => api.startIndicators(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
}

export function useStartSignals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { timeframes?: Timeframe[]; symbols?: string[]; strategies?: Strategy[] } = {}) => api.startSignals(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
}

export function useCreateBrokerAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { broker: Broker; label: string; api_key: string; totp_secret: string }) => api.createBrokerAccount(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brokerAccounts() }),
  })
}

export function useDeactivateBrokerAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deactivateBrokerAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.brokerAccounts() }),
  })
}

export function useTestBrokerAccount() {
  return useMutation({
    mutationFn: (id: number) => api.testBrokerAccount(id),
  })
}

export function useSyncBrokerAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body?: { day?: string } }) => api.syncBrokerAccount(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.brokerAccounts() })
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['positions'] })
    },
  })
}

export function useSyncAllBrokerAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.syncAllBrokerAccounts(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.brokerAccounts() })
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['positions'] })
    },
  })
}

export function useImportTradebook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => api.importTradebook(id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.brokerAccounts() })
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['positions'] })
    },
  })
}

export function useEvaluatePositions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { as_of?: string } = {}) => api.evaluatePositions(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['positions'] })
      qc.invalidateQueries({ queryKey: ['evaluations'] })
    },
  })
}

export function useMatchPosition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: { strategy: Strategy; ts: string } }) => api.matchPosition(id, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.position(vars.id) })
      qc.invalidateQueries({ queryKey: ['positions'] })
    },
  })
}

export function useReattributeSell() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sellId, body }: { sellId: number; body: { allocations: { position_id: number; quantity: number }[] } }) =>
      api.reattributeSell(sellId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['positions'] })
    },
  })
}
