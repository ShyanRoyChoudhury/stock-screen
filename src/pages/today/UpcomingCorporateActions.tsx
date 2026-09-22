// Handoff §5.1: corporate actions on held symbols with ex-date in the next 10 calendar days.
// The broker may cancel GTT stops on the ex-date, so the trader must re-place them.

import { Link } from 'react-router'
import { usePositions, useCorporateActions } from '../../api/hooks'
import { Panel } from '../../components/Panel'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { EmptyState } from '../../components/EmptyState'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { fmtIstDate } from '../../lib/format'
import { ACTION_TYPE_LABELS } from '../../lib/domain'
import { useSettings } from '../../lib/settings'
import { plusDaysKey, todayIstKey } from './utils'

function ActionsList() {
  const positions = usePositions('open')
  const actions = useCorporateActions({ limit: 500 })

  if (positions.isLoading || actions.isLoading) return <Loading label="Loading corporate actions…" />
  if (positions.isError) return <ErrorState error={positions.error} />
  if (actions.isError) return <ErrorState error={actions.error} />

  const heldSymbols = new Set((positions.data ?? []).map((p) => p.symbol))
  const todayKey = todayIstKey()
  const maxKey = plusDaysKey(todayKey, 10)

  const upcoming = (actions.data ?? [])
    .filter((a) => heldSymbols.has(a.symbol) && a.ex_date > todayKey && a.ex_date <= maxKey)
    .sort((a, b) => (a.ex_date < b.ex_date ? -1 : a.ex_date > b.ex_date ? 1 : 0))

  if (upcoming.length === 0) return <EmptyState title="Nothing upcoming on held symbols" />

  return (
    <div className="flex flex-col gap-2">
      <div className="w-full overflow-x-auto">
        <table className="dense">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Type</th>
              <th>Ex-date</th>
              <th>Subject</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((a, i) => (
              <tr key={`${a.symbol}-${a.ex_date}-${i}`}>
                <td>
                  <Link to={`/symbols/${a.symbol}`} className="text-accent hover:underline">
                    {a.symbol}
                  </Link>
                </td>
                <td>{ACTION_TYPE_LABELS[a.action_type]}</td>
                <td className="num">{fmtIstDate(a.ex_date)}</td>
                <td className="max-w-[220px] truncate" title={a.subject}>
                  {a.subject}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">The broker may cancel GTT stops on the ex-date — re-place them.</p>
    </div>
  )
}

export function UpcomingCorporateActions() {
  const { settings } = useSettings()
  return (
    <Panel title="Upcoming corporate actions on held symbols">
      {!settings.apiKey ? (
        <ApiKeyPrompt message="Needs an API key to know which symbols you hold." />
      ) : (
        <ActionsList />
      )}
    </Panel>
  )
}
