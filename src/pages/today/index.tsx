// Handoff §5.1: the evening brief. "Is everything OK, and what needs my attention?"
// Order top-to-bottom / left-to-right: Pipeline status, Positions needing action,
// Broker sync alerts, Fresh signals, Upcoming corporate actions on held symbols.

import { PipelineStatus } from './PipelineStatus'
import { PositionsNeedingAction } from './PositionsNeedingAction'
import { BrokerSyncAlerts } from './BrokerSyncAlerts'
import { FreshSignals } from './FreshSignals'
import { UpcomingCorporateActions } from './UpcomingCorporateActions'

export default function TodayPage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">Today</h1>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PipelineStatus />
        <PositionsNeedingAction />
        <BrokerSyncAlerts />
        <FreshSignals />
        <div className="lg:col-span-2">
          <UpcomingCorporateActions />
        </div>
      </div>
    </div>
  )
}
