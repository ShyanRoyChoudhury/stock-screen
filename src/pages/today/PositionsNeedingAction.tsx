// Handoff §5.1: "Positions needing action" — counts by verdict, then EXIT/REVIEW/PARTIAL
// positions with their reasons, HOLD collapsed below.

import { Link } from 'react-router'
import { usePositions } from '../../api/hooks'
import { Panel } from '../../components/Panel'
import { Chip } from '../../components/Chip'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { Tooltip } from '../../components/Tooltip'
import { fmtInr, fmtFrac, signedClass } from '../../lib/format'
import { reasonLabel, warningLabel } from '../../lib/domain'
import { useSettings } from '../../lib/settings'
import type { Position, Verdict } from '../../api/types'

// Stat-row and list order per the brief: EXIT, REVIEW, PARTIAL, HOLD (not VERDICT_META's order).
const STAT_ORDER: Verdict[] = ['EXIT', 'REVIEW', 'PARTIAL', 'HOLD']
const LIST_ORDER: Verdict[] = ['EXIT', 'REVIEW', 'PARTIAL']

function verdictOf(p: Position): Verdict {
  return p.latest_evaluation?.verdict ?? p.last_verdict ?? 'HOLD'
}

function PositionsList() {
  const { data: positions, isLoading, isError, error } = usePositions('open')

  if (isLoading) return <Loading label="Loading positions…" />
  if (isError) return <ErrorState error={error} />
  const rows = positions ?? []
  if (rows.length === 0) return <EmptyState title="No open positions" />

  const counts: Record<Verdict, number> = { EXIT: 0, PARTIAL: 0, REVIEW: 0, HOLD: 0 }
  for (const p of rows) counts[verdictOf(p)]++

  const actionable = rows
    .filter((p) => LIST_ORDER.includes(verdictOf(p)))
    .sort((a, b) => LIST_ORDER.indexOf(verdictOf(a)) - LIST_ORDER.indexOf(verdictOf(b)))
  const holdRows = rows.filter((p) => verdictOf(p) === 'HOLD')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-4">
        {STAT_ORDER.map((v) => (
          <div key={v} className={`flex items-center gap-1.5 ${counts[v] === 0 ? 'opacity-50' : ''}`}>
            <Chip variant="verdict" value={v} />
            <span className="num text-sm font-semibold">{counts[v]}</span>
          </div>
        ))}
      </div>

      {actionable.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs action — every open position is HOLD.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {actionable.map((p) => {
            const ev = p.latest_evaluation
            const warnings = ev?.warnings ?? []
            return (
              <li key={p.id} className="flex flex-col gap-0.5 rounded border border-border px-2 py-1.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/positions/${p.id}`} className="font-medium text-accent hover:underline">
                    {p.symbol}
                  </Link>
                  <Chip variant="verdict" value={verdictOf(p)} />
                  {warnings.length > 0 && (
                    <Tooltip text={warnings.map((w) => warningLabel(w.code)).join('; ')}>
                      <span className="text-xs text-muted">
                        {warnings.length} warning{warnings.length === 1 ? '' : 's'}
                      </span>
                    </Tooltip>
                  )}
                </div>
                <div className="num flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>
                    Close {fmtInr(ev?.close)} vs stop {fmtInr(ev?.stop_level)}
                  </span>
                  <span className={signedClass(ev?.unrealized_pnl_pct)}>{fmtFrac(ev?.unrealized_pnl_pct)}</span>
                </div>
                {ev && ev.reasons.length > 0 && (
                  <p className="text-xs text-muted">{ev.reasons.map((r) => reasonLabel(r.code)).join('; ')}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {holdRows.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted">
            {holdRows.length} position{holdRows.length === 1 ? '' : 's'} on HOLD
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {holdRows.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted">
                <Link to={`/positions/${p.id}`} className="text-accent hover:underline">
                  {p.symbol}
                </Link>
                <span className="num">{fmtFrac(p.latest_evaluation?.unrealized_pnl_pct)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export function PositionsNeedingAction() {
  const { settings } = useSettings()
  return (
    <Panel title="Positions needing action">
      {!settings.apiKey ? <ApiKeyPrompt message="Positions need an API key to load." /> : <PositionsList />}
    </Panel>
  )
}
