// app.jsx 66-143 (Today): "Evening brief" — did last night's data run cleanly, what needs action
// and why, and what set up today. Order: banners, verdict stat tiles, then a two-column grid
// (positions needing action | daily job + fresh signals + upcoming ex-dates).

import { useNavigate } from 'react-router'
import { PageHead, StatTile, fmt } from '../../ds'
import { useSignals, usePositions } from '../../api/hooks'
import { istDateKey } from '../../lib/format'
import { useSettings } from '../../lib/settings'
import type { Verdict } from '../../api/types'
import { Banners } from './Banners'
import { PositionsNeedingAction } from './PositionsNeedingAction'
import { PipelineStatus } from './PipelineStatus'
import { FreshSignals } from './FreshSignals'
import { UpcomingCorporateActions } from './UpcomingCorporateActions'
import { todayIstKey, verdictOf } from './utils'

const STAT_VERDICTS: Verdict[] = ['EXIT', 'PARTIAL', 'REVIEW', 'HOLD']

/** Session = IST date of the latest 1d signal, falling back to today while loading or if none exist. */
function useSession(): string {
  const { data } = useSignals({ timeframe: '1d', limit: 1 })
  const latest = data?.[0]
  return (latest ? istDateKey(latest.ts) : null) ?? todayIstKey()
}

function VerdictStats() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const positions = usePositions('open', { enabled: !!settings.apiKey })
  const open = settings.apiKey ? (positions.data ?? []) : []
  if (open.length === 0) return null

  const counts: Record<Verdict, number> = { EXIT: 0, PARTIAL: 0, REVIEW: 0, HOLD: 0 }
  const subs: Record<Verdict, Record<string, number>> = { EXIT: {}, PARTIAL: {}, REVIEW: {}, HOLD: {} }
  for (const p of open) {
    const v = verdictOf(p)
    counts[v]++
    for (const r of (p.latest_evaluation?.reasons ?? []).slice(0, 1)) {
      subs[v][r.code] = (subs[v][r.code] ?? 0) + 1
    }
  }

  return (
    <div className="ss-grid-4">
      {STAT_VERDICTS.map((v) => (
        <StatTile
          key={v}
          verdict={v}
          value={counts[v]}
          sub={
            v === 'HOLD'
              ? counts.HOLD
                ? 'nothing to do'
                : '—'
              : Object.entries(subs[v])
                  .map(([code, n]) => code + (n > 1 ? ` ×${n}` : ''))
                  .join(' · ') || '—'
          }
          onClick={() => navigate(`/positions?verdict=${v}`)}
        />
      ))}
    </div>
  )
}

export default function TodayPage() {
  const session = useSession()
  return (
    <div className="ss-page">
      <PageHead title="Today" sub={`Evening brief · ${fmt.date(session, true)}`} />
      <Banners session={session} />
      <VerdictStats />
      <div className="ss-grid-2">
        <div className="app-col">
          <PositionsNeedingAction session={session} />
        </div>
        <div className="app-col">
          <PipelineStatus session={session} />
          <FreshSignals />
          <UpcomingCorporateActions session={session} />
        </div>
      </div>
    </div>
  )
}
