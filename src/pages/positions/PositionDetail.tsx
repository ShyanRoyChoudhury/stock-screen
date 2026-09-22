// Position detail — BUILD_BRIEF "Deliverable 1", mirroring
// design/prototype/src/app.jsx:388-456 (PositionPage).

import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  useCandles,
  useCorporateActions,
  useEvaluatePositions,
  useIndicators,
  useMatchPosition,
  usePosition,
  usePositionEvaluations,
  useSignals,
  useTrades,
} from '../../api/hooks'
import { ApiError } from '../../api/types'
import type { Position, Trade } from '../../api/types'
import { CandleChart } from '../../charts/CandleChart'
import {
  ApiKeyPrompt,
  Badge,
  Button,
  CodeList,
  type Column,
  DataTable,
  type Evaluation as DsEvaluation,
  EmptyState,
  ErrorState,
  KV,
  LevelLadder,
  Loading,
  Num,
  PageHead,
  Panel,
  StrategyTag,
  VerdictChip,
  VerdictTimeline,
  cx,
  fmt,
} from '../../ds'
import { useSettings } from '../../lib/settings'
import { useToast } from '../../lib/toast'
import { errorMessage, posLevels, subDaysIso } from './helpers'

export function PositionDetail({ id }: { id: number }) {
  const { settings } = useSettings()
  const navigate = useNavigate()
  const toast = useToast()

  const { data: position, isLoading, isError, error, refetch: refetchPosition } = usePosition(id)
  const { data: evaluations } = usePositionEvaluations(id)
  const { data: candles } = useCandles(position?.symbol, { timeframe: '1d', limit: 1300 })
  const { data: indicators } = useIndicators(position?.symbol, { timeframe: '1d', limit: 1300 })
  const { data: signals } = useSignals({ symbol: position?.symbol, timeframe: '1d', limit: 5000 })
  const { data: actions } = useCorporateActions({ symbol: position?.symbol })
  const { data: trades } = useTrades({ symbol: position?.symbol })

  const [showAllEval, setShowAllEval] = useState(false)
  const [rematchOpen, setRematchOpen] = useState(false)

  const evaluateMutation = useEvaluatePositions()

  if (!settings.apiKey) return <ApiKeyPrompt message="Position detail needs your API key." />
  if (isLoading) return <Loading label="Loading position…" />
  if (isError) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="ss-page">
          <EmptyState title={`Position #${id} not found`} action={<Button onClick={() => navigate('/positions')}>All positions</Button>} />
        </div>
      )
    }
    return <ErrorState error={error} />
  }
  if (!position) return null

  const e = position.latest_evaluation
  const fills = (trades ?? []).filter((t) => t.position_id === position.id)
  const eventSignals = (signals ?? []).filter((s) => s.strategy !== 'Confluence')
  const levels = posLevels(position)

  async function handleReevaluate() {
    try {
      await evaluateMutation.mutateAsync({})
      const fresh = await refetchPosition()
      const verdict = fresh.data?.last_verdict ?? '—'
      const asOf = fresh.data?.last_evaluated_on
      toast(`Re-evaluated #${id} as of ${asOf ? fmt.date(asOf) : '—'}: ${verdict}`)
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  const fillsColumns: Column<Trade>[] = [
    { key: 'd', label: 'Time (IST)', render: (t) => <span className="ss-n">{fmt.date(t.trade_ts)} {fmt.time(t.trade_ts, false)}</span> },
    { key: 's', label: 'Side', render: (t) => <Badge tone={t.side === 'BUY' ? 'up' : 'down'}>{t.side}</Badge> },
    { key: 'q', label: 'Qty', align: 'right', render: (t) => <Num kind="qty" value={t.quantity} /> },
    { key: 'p', label: 'Price', align: 'right', render: (t) => <Num value={t.price} /> },
  ]

  return (
    <div className="ss-page">
      <div className="app-crumbs">
        <button type="button" className="app-link" onClick={() => navigate('/positions')}>
          Positions
        </button>
        <span className="ss-faint">/</span>
        <span className="ss-n">#{position.id}</span>
      </div>

      <PageHead
        title={
          <span className="app-mono">
            {position.symbol} <span className="ss-muted ss-n" style={{ fontSize: 14 }}>lot #{position.id}</span>
          </span>
        }
        sub={
          (position.status === 'open' ? `${fmt.qty(position.qty_open)} of ${fmt.qty(position.qty_total)} open` : `Closed ${fmt.date(position.closed_on ?? '')}`) +
          ` · opened ${fmt.date(position.opened_on)}`
        }
      >
        {position.status === 'open' ? (
          <Button size="sm" icon="sync" loading={evaluateMutation.isPending} onClick={handleReevaluate}>
            Re-evaluate
          </Button>
        ) : null}
        <Button size="sm" icon="symbol" onClick={() => navigate(`/symbols/${position.symbol}`)}>
          Symbol page
        </Button>
        <Button size="sm" variant="ghost" icon="trades" onClick={() => navigate(`/trades?symbol=${position.symbol}`)}>
          Fills &amp; reattribution
        </Button>
      </PageHead>

      {e ? (
        <div className="app-verdict-line">
          <VerdictChip verdict={e.verdict} />
          {/* min-w-0: a long warning/reason detail renders as a nowrap+ellipsis chip
              (src/ds .ss-code-text); without an explicit min-width:0 on this flex item, the
              ellipsis never engages and the chip pushes the page wider on narrow viewports.
              Neutralised locally rather than editing src/ds — see final report. */}
          <div className="min-w-0">
            <CodeList reasons={e.reasons} warnings={e.warnings} />
          </div>
        </div>
      ) : null}

      <CandleChart
        candles={candles ?? []}
        indicators={indicators ?? []}
        timeframe="1d"
        overlays={{ ema50: true, ema200: false, supertrend: true, bollinger: false, keltner: false }}
        panes={{ macd: false, adx: false, rvol: false, ttm: false }}
        signals={eventSignals}
        actions={actions ?? []}
        positions={[position]}
        levels={levels}
        focusFrom={position.opened_on}
        height={340}
      />

      {e ? (
        <Panel
          title="Levels"
          right={
            position.is_unmatched ? (
              <Badge title="Trailing stop only, no targets">Unmatched</Badge>
            ) : (
              <span className="ss-muted app-small">frozen from the matched signal · chandelier trail = HH − 2.5 × ATR</span>
            )
          }
        >
          <LevelLadder
            entry={position.avg_entry_price}
            close={e.close}
            stop={position.is_unmatched ? undefined : (position.frozen_stop ?? undefined)}
            trail={e.trail_level ?? undefined}
            t1={position.frozen_target_1 ?? undefined}
            t2={position.frozen_target_2 ?? undefined}
            matched={!position.is_unmatched}
          />
        </Panel>
      ) : null}

      {/* min-w-0 on both grid children: src/ds's mobile override of .ss-grid-2 (<720px) drops
          the desktop minmax(0, ...) column clamp, so a wide grid item (the Fills table below)
          reverts to content-based auto sizing and blows out the viewport. Neutralised locally
          (layout-only Tailwind utility) rather than editing src/ds — see final report. */}
      <div className="ss-grid-2">
        <div className="min-w-0">
          <Panel title="Verdict history" right={<span className="ss-muted app-small">{(evaluations ?? []).length} sessions · newest first</span>}>
            {evaluations && evaluations.length ? (
              <>
                <VerdictTimeline entries={(showAllEval ? evaluations : evaluations.slice(0, 10)) as unknown as DsEvaluation[]} />
                {evaluations.length > 10 ? (
                  <button type="button" className="app-link app-small" style={{ marginTop: 8 }} onClick={() => setShowAllEval((x) => !x)}>
                    {showAllEval ? 'Show latest 10' : `Show all ${evaluations.length} sessions`}
                  </button>
                ) : null}
              </>
            ) : (
              <span className="ss-muted">No evaluations stored for this lot.</span>
            )}
          </Panel>
        </div>

        <div className="app-col min-w-0">
          <Panel
            title="Signal match"
            right={
              position.status === 'open' ? (
                <Button size="sm" onClick={() => setRematchOpen((r) => !r)}>
                  {position.is_unmatched ? 'Match manually' : 'Re-match'}
                </Button>
              ) : null
            }
          >
            {position.is_unmatched ? (
              <p className="ss-muted" style={{ margin: 0 }}>
                No 1d signal within 5% of the fill in the 5 sessions up to {fmt.date(position.opened_on)} scored ≥ 0.5. Trailing stop only, no targets.
              </p>
            ) : (
              <KV
                items={[
                  ['Strategy', <StrategyTag key="s" strategy={position.matched_strategy!} />],
                  ['Signal date', <span key="d" className="ss-n">{fmt.date(position.matched_signal_ts ?? '')}</span>],
                  [
                    'Confidence',
                    <span key="c" className="ss-n">
                      {(position.match_confidence ?? 0).toFixed(2)}
                      {position.match_reason === 'manual' ? ' · manual' : ''}
                    </span>,
                  ],
                  ['Reason', <span key="r" className="ss-mono app-small">{position.match_reason}</span>],
                  ['Frozen entry', <Num key="fe" value={position.frozen_entry} />],
                  ['Frozen stop', <Num key="fs" value={position.frozen_stop} />],
                  [
                    'T1 / T2',
                    <span key="t">
                      <Num value={position.frozen_target_1} /> / <Num value={position.frozen_target_2} />
                    </span>,
                  ],
                ]}
              />
            )}
            {rematchOpen ? <RematchPanel position={position} onClose={() => setRematchOpen(false)} /> : null}
          </Panel>

          <Panel title="Entry price">
            <KV
              items={[
                ['Avg entry (adjusted)', <Num key="a" kind="inr" value={position.avg_entry_price} />],
                ['Avg entry (as paid)', <Num key="b" kind="inr" value={position.avg_entry_price_raw} />],
                [
                  'Structural factor',
                  <span key="f" className="ss-n">
                    {(position.structural_factor_applied ?? 1).toFixed(4)}
                    {position.structural_factor_applied === 1 ? ' · no split/bonus since buy' : ''}
                  </span>,
                ],
              ]}
            />
          </Panel>

          <Panel title="Fills" pad={false}>
            <DataTable ariaLabel="Fills" columns={fillsColumns} rows={fills} rowKey={(t) => t.id} />
          </Panel>
        </div>
      </div>
    </div>
  )
}

function RematchPanel({ position, onClose }: { position: Position; onClose: () => void }) {
  const toast = useToast()
  const since = subDaysIso(position.opened_on, 14)
  const { data: signals, isLoading, isError, error } = useSignals({ symbol: position.symbol, timeframe: '1d', since, limit: 200 })
  const [pick, setPick] = useState<string | null>(null)
  const matchMutation = useMatchPosition()

  const candidates = (signals ?? []).filter((s) => s.ts.slice(0, 10) <= position.opened_on)

  function doMatch() {
    const s = candidates.find((x) => x.strategy + x.ts === pick)
    if (!s) return
    matchMutation.mutate(
      { id: position.id, body: { strategy: s.strategy, ts: s.ts } },
      {
        onSuccess: () => {
          toast(`Matched #${position.id} to ${s.strategy} @${fmt.date(s.ts)}`)
          onClose()
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 404) toast('No matching signal found')
          else toast(errorMessage(err))
        },
      },
    )
  }

  return (
    <div className="app-rematch">
      <div className="ss-label">
        Candidate 1d signals · {fmt.date(since)} → {fmt.date(position.opened_on)}
      </div>
      {isLoading ? <Loading label="Loading candidate signals…" /> : null}
      {isError ? <ErrorState error={error} /> : null}
      {!isLoading && !isError ? (
        candidates.length ? (
          candidates.map((s) => {
            const k = s.strategy + s.ts
            return (
              <label key={k} className={cx('app-cand', pick === k && 'on')}>
                <input type="radio" name="cand" checked={pick === k} onChange={() => setPick(k)} />
                <StrategyTag strategy={s.strategy} />
                <span className="ss-n">{fmt.date(s.ts)}</span>
                <span className="ss-n ss-muted">entry {fmt.price(s.entry)}</span>
              </label>
            )
          })
        ) : (
          <span className="ss-muted">No 1d signals for {position.symbol} in that window.</span>
        )
      ) : null}
      <div className="app-row">
        <Button size="sm" variant="primary" disabled={!pick || matchMutation.isPending} onClick={doMatch}>
          Match selected
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
