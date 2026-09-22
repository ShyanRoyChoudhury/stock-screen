// Handoff §5.7 triggers. "Only one run can be active at a time" — every trigger is disabled
// while any run in the last 20 is `running`, naming which one, even though only
// ingest/indicators/signals actually 409 on the backend (corp-actions load, refresh universe
// and evaluate don't) — the brief calls for disabling all of them uniformly.

import { useRuns } from '../../api/hooks'
import { RUN_MODE_LABELS } from '../../lib/domain'
import { TriggerIngest } from './TriggerIngest'
import { TriggerIndicators } from './TriggerIndicators'
import { TriggerSignals } from './TriggerSignals'
import { TriggerCorporateActions } from './TriggerCorporateActions'
import { TriggerRefreshUniverse } from './TriggerRefreshUniverse'
import { TriggerEvaluate } from './TriggerEvaluate'

export function TriggersSection() {
  const { data: runs } = useRuns(20)
  const busyRun = (runs ?? []).find((r) => r.status === 'running')

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold">Triggers</h3>
      {busyRun && (
        <p className="rounded border border-warn bg-surface-2 px-2 py-1.5 text-xs text-warn">
          Another run is in progress: {RUN_MODE_LABELS[busyRun.mode]} (#{busyRun.id}) — triggers are disabled until it
          finishes.
        </p>
      )}
      <div className="flex flex-col divide-y divide-border">
        <TriggerIngest disabled={!!busyRun} />
        <TriggerIndicators disabled={!!busyRun} />
        <TriggerSignals disabled={!!busyRun} />
        <TriggerCorporateActions disabled={!!busyRun} />
        <TriggerRefreshUniverse disabled={!!busyRun} />
        <TriggerEvaluate disabled={!!busyRun} />
      </div>
    </div>
  )
}
