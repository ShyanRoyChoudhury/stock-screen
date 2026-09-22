// app.jsx 134-138: "Ex-dates on held symbols · next 5 sessions" — corporate actions on symbols
// with an open position, ex-date within the next 5 trading sessions (prototype's `sessionsUntil`,
// kept in ./utils). The broker may cancel GTT stops on the ex-date, so the trader must re-place them.

import { useNavigate } from 'react-router'
import { CorpActionMarker, ErrorState, Loading, Panel } from '../../ds'
import { useCorporateActions, usePositions } from '../../api/hooks'
import { useSettings } from '../../lib/settings'
import { sessionsUntil } from './utils'

const TITLE = 'Ex-dates on held symbols · next 5 sessions'

function ActionsList({ session }: { session: string }) {
  const navigate = useNavigate()
  const positions = usePositions('open')
  const actions = useCorporateActions({ limit: 500 })

  if (positions.isLoading || actions.isLoading) return <Loading label="Loading corporate actions…" />
  if (positions.isError) return <ErrorState error={positions.error} />
  if (actions.isError) return <ErrorState error={actions.error} />

  const heldSymbols = new Set((positions.data ?? []).map((p) => p.symbol))
  const upcoming = (actions.data ?? [])
    .filter((a) => heldSymbols.has(a.symbol) && a.ex_date > session && sessionsUntil(session, a.ex_date) <= 5)
    .sort((a, b) => (a.ex_date < b.ex_date ? -1 : a.ex_date > b.ex_date ? 1 : 0))

  if (!upcoming.length) return <span className="ss-muted">None.</span>

  return (
    <div className="app-col" style={{ gap: 8 }}>
      {upcoming.map((a, i) => (
        <div key={i} className="app-row">
          <button type="button" className="app-link ss-sym" onClick={() => navigate(`/symbols/${a.symbol}`)}>
            {a.symbol}
          </button>
          <CorpActionMarker type={a.action_type} subject={a.subject} exDate={a.ex_date} />
        </div>
      ))}
      <span className="ss-muted app-small">The broker may cancel GTT stop orders on the ex-date. Re-place them after.</span>
    </div>
  )
}

export function UpcomingCorporateActions({ session }: { session: string }) {
  const { settings } = useSettings()
  return <Panel title={TITLE}>{settings.apiKey ? <ActionsList session={session} /> : <span className="ss-muted">None.</span>}</Panel>
}
