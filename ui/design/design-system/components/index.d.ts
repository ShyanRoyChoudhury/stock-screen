import type * as React from 'react';

export type Verdict = 'EXIT' | 'PARTIAL' | 'REVIEW' | 'HOLD';
export type Timeframe = '1d' | '4h' | '1h';
export type Strategy = 'PIPELINE' | 'S1_ST_Flip' | 'S2_MACD_Zero' | 'S3_BB_Squeeze' | 'TTM_Squeeze' | 'Confluence';
export type RunStatus = 'ok' | 'completed' | 'running' | 'warning' | 'degraded' | 'failed' | 'error' | 'auth_failed' | 'never' | 'pending' | 'skipped';
export interface Code { code: string; detail?: string | null }
export type IconName = 'today' | 'signals' | 'positions' | 'symbol' | 'trades' | 'brokers' | 'ops' | 'options' | 'settings' | 'upload' | 'sync' | 'search' | 'chevron' | 'external';

/** Formatting helpers. All output uses Indian grouping, U+2212 minus and IST. */
export declare const fmt: {
  inr(n: number | null, decimals?: number): string;
  price(n: number | null, decimals?: number): string;
  qty(n: number | null): string;
  /** n is already a percent (risk_pct 8.92). */
  pct(n: number | null, decimals?: number, signed?: boolean): string;
  /** n is a fraction (unrealized_pnl_pct 0.019 → "+1.90%"). */
  frac(n: number | null, decimals?: number, signed?: boolean): string;
  mult(n: number | null, decimals?: number): string;
  /** (T1 − entry) / (entry − stop), or null. */
  rr(entry: number, stop: number, t1: number): number | null;
  /** "21 Sep 2026" (or "Mon 21 Sep 2026"); accepts YYYY-MM-DD or a UTC ISO timestamp. */
  date(v: string, withDow?: boolean): string;
  /** "16:47 IST" from a UTC ISO timestamp. */
  time(v: string, suffix?: boolean): string;
  dateTime(v: string): string;
  dur(startUtc: string, endUtc: string): string;
};
export declare const labels: {
  verdicts: Record<Verdict, string>;
  reasons: Record<string, [Verdict, string]>;
  warnings: Record<string, string>;
  strategies: Record<Strategy, { type: 'event' | 'state'; label: string }>;
  actions: Record<'dividend' | 'split' | 'bonus' | 'rights' | 'demerger', [string, string]>;
};

export interface IconProps { name: IconName; className?: string; title?: string }
export declare function Icon(props: IconProps): React.ReactElement;
export interface KbdProps { keys?: string | string[]; children?: React.ReactNode }
export declare function Kbd(props: KbdProps): React.ReactElement;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'md' | 'sm'; icon?: IconName; kbd?: string | string[]; loading?: boolean }
export declare function Button(props: ButtonProps): React.ReactElement;

export interface VerdictChipProps { verdict: Verdict; size?: 'md' | 'sm'; title?: string }
export declare function VerdictChip(props: VerdictChipProps): React.ReactElement;
export interface CodeTagProps { code: string; detail?: string | null; kind?: 'reason' | 'warning'; showLabel?: boolean }
export declare function CodeTag(props: CodeTagProps): React.ReactElement;
export interface CodeListProps { reasons?: Code[]; warnings?: Code[]; showLabel?: boolean }
export declare function CodeList(props: CodeListProps): React.ReactElement;
export interface StatusDotProps { status: RunStatus; label?: string; children?: React.ReactNode; bare?: boolean }
export declare function StatusDot(props: StatusDotProps): React.ReactElement;
export interface BadgeProps { tone?: 'neutral' | 'solid' | 'accent' | 'up' | 'down' | 'warn' | 'review'; children?: React.ReactNode; title?: string }
export declare function Badge(props: BadgeProps): React.ReactElement;
export interface StrategyTagProps { strategy: Strategy | string; extra?: React.ReactNode }
export declare function StrategyTag(props: StrategyTagProps): React.ReactElement;
export interface TimeframeBadgeProps { timeframe?: Timeframe }
export declare function TimeframeBadge(props: TimeframeBadgeProps): React.ReactElement;

export interface NumProps { value: number | null; kind?: 'price' | 'inr' | 'qty' | 'int' | 'pct' | 'frac' | 'mult' | 'rr'; decimals?: number; signed?: boolean; tone?: 'auto' | 'up' | 'down' | 'flat' | 'muted'; currency?: boolean; className?: string }
export declare function Num(props: NumProps): React.ReactElement;
export interface ChangeProps { abs?: number; frac?: number; pct?: number; showArrow?: boolean }
export declare function Change(props: ChangeProps): React.ReactElement;
export interface RiskPctProps { value: number | null; caution?: number; high?: number; max?: number }
export declare function RiskPct(props: RiskPctProps): React.ReactElement;

export interface Column<R> { key: string; label: React.ReactNode; align?: 'left' | 'right' | 'center'; width?: number | string; sortable?: boolean; sortValue?: (row: R) => unknown; render?: (row: R) => React.ReactNode; title?: string }
export interface DataTableProps<R> { columns: Column<R>[]; rows: R[]; rowKey?: (row: R, i: number) => React.Key; density?: 'compact' | 'default'; initialSort?: { key: string; dir: 'asc' | 'desc' }; renderExpanded?: (row: R) => React.ReactNode; onRowOpen?: (row: R) => void; rowClassName?: (row: R) => string | undefined; footer?: React.ReactNode; maxHeight?: number | string; ariaLabel?: string }
export declare function DataTable<R>(props: DataTableProps<R>): React.ReactElement;
export interface SymbolCellProps { symbol: string; name?: string; sub?: React.ReactNode }
export declare function SymbolCell(props: SymbolCellProps): React.ReactElement;
export interface StatTileProps { label?: React.ReactNode; value: number | string; sub?: React.ReactNode; verdict?: Verdict; size?: 'lg' | 'sm'; onClick?: () => void }
export declare function StatTile(props: StatTileProps): React.ReactElement;
export interface LevelLadderProps { entry: number; close?: number; stop?: number; trail?: number; t1?: number; t2?: number; matched?: boolean }
export declare function LevelLadder(props: LevelLadderProps): React.ReactElement;
export interface ScorecardProps { score: string; conviction?: string; breakdown: { supertrend?: string; macd?: string; bb_position?: string; volume?: string; room_to_upper?: string; high_conviction?: boolean } }
export declare function Scorecard(props: ScorecardProps): React.ReactElement;
export interface Bar { o: number; h: number; l: number; c: number; v?: number }
export interface MiniChartProps { bars: Bar[]; width?: number; height?: number; ema50?: (number | null)[]; ema200?: (number | null)[]; levels?: { kind: 'entry' | 'stop' | 'trail' | 't1' | 't2'; value: number; label?: string }[]; markers?: { index: number; kind: 'signal' | 'action' | 'demerger'; glyph?: string }[]; volume?: boolean; axis?: boolean }
export declare function MiniChart(props: MiniChartProps): React.ReactElement;

export interface BannerProps { tone?: 'failed' | 'degraded' | 'review' | 'info'; title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; role?: string }
export declare function Banner(props: BannerProps): React.ReactElement;
export interface EmptyStateProps { title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; glyph?: string }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

export interface NavItem { id?: string; label?: string; icon?: IconName; kbd?: string; disabled?: boolean; badge?: string; section?: string }
export declare const NAV: NavItem[];
export interface NavRailProps { items?: NavItem[]; current?: string; counts?: Record<string, number>; user?: { name: string }; collapsed?: boolean; onNavigate?: (id: string) => void }
export declare function NavRail(props: NavRailProps): React.ReactElement;
export interface SessionBarProps { session: string; pipeline?: 'ok' | 'running' | 'warning' | 'failed'; pipelineAt?: string; dataNote?: React.ReactNode; children?: React.ReactNode }
export declare function SessionBar(props: SessionBarProps): React.ReactElement;
export interface TabsProps { items: { id: string; label: React.ReactNode; count?: number; experimental?: boolean; title?: string }[]; value?: string; onChange?: (id: string) => void; variant?: 'tabs' | 'segmented'; ariaLabel?: string }
export declare function Tabs(props: TabsProps): React.ReactElement;
export interface FilterChipProps { label: string; value?: React.ReactNode; active?: boolean; onClear?: () => void; onClick?: () => void }
export declare function FilterChip(props: FilterChipProps): React.ReactElement;

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> { label: string; hint?: React.ReactNode; error?: React.ReactNode; mono?: boolean; secret?: boolean; saved?: boolean }
export declare function Field(props: FieldProps): React.ReactElement;
export interface ImportResult { rows: number; upserted: number; unmapped: number; ledger: { buys_opened: number; sells_allocated: number; orphan_sells: number; skipped_unmapped: number; errors: unknown[] | number } }
export interface FileDropProps { onFile?: (file: File) => void; busy?: boolean; result?: ImportResult }
export declare function FileDrop(props: FileDropProps): React.ReactElement;

export interface Step { name: string; status: RunStatus; finishedAt?: string; counts?: React.ReactNode; message?: React.ReactNode; progress?: number }
export declare function PipelineSteps(props: { steps: Step[] }): React.ReactElement;
export interface Evaluation { as_of: string; verdict: Verdict; close: number; stop_level: number; trail_level?: number; reasons?: Code[]; warnings?: Code[]; unrealized_pnl_pct?: number; days_held?: number }
export declare function VerdictTimeline(props: { entries: Evaluation[] }): React.ReactElement;
export interface BrokerAccount { id: number; broker: 'groww' | 'zerodha' | string; label: string; active: boolean; last_sync_on: string | null; last_sync_status: 'ok' | 'auth_failed' | 'error' | null; last_sync_message: string | null; created_at: string }
export interface BrokerCardProps { account: BrokerAccount; lastTradingDay?: string; onTest?: () => void; onSync?: () => void; onImport?: () => void; onDeactivate?: () => void; busy?: boolean }
export declare function BrokerCard(props: BrokerCardProps): React.ReactElement;
export interface CorpActionMarkerProps { type: 'dividend' | 'split' | 'bonus' | 'rights' | 'demerger'; exDate?: string; subject?: string; showLabel?: boolean }
export declare function CorpActionMarker(props: CorpActionMarkerProps): React.ReactElement;

declare global { interface Window { StockScreen: {
  fmt: typeof fmt; labels: typeof labels; NAV: typeof NAV; Icon: typeof Icon; Kbd: typeof Kbd; Button: typeof Button; VerdictChip: typeof VerdictChip; CodeTag: typeof CodeTag; CodeList: typeof CodeList;
  StatusDot: typeof StatusDot; Badge: typeof Badge; StrategyTag: typeof StrategyTag; TimeframeBadge: typeof TimeframeBadge; Num: typeof Num; Change: typeof Change; RiskPct: typeof RiskPct;
  DataTable: typeof DataTable; SymbolCell: typeof SymbolCell; StatTile: typeof StatTile; LevelLadder: typeof LevelLadder; Scorecard: typeof Scorecard; MiniChart: typeof MiniChart; Banner: typeof Banner;
  EmptyState: typeof EmptyState; NavRail: typeof NavRail; SessionBar: typeof SessionBar; Tabs: typeof Tabs; FilterChip: typeof FilterChip; Field: typeof Field; FileDrop: typeof FileDrop;
  PipelineSteps: typeof PipelineSteps; VerdictTimeline: typeof VerdictTimeline; BrokerCard: typeof BrokerCard; CorpActionMarker: typeof CorpActionMarker;
} } }
