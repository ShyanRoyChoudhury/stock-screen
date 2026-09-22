// Handoff §5.7: Data & Ops (admin). Sections as Panels, top to bottom:
// Health & Triggers -> Runs log -> Corporate actions browser.

import { Panel } from '../../components/Panel'
import { HealthStatus } from './Health'
import { TriggersSection } from './Triggers'
import { RunsLog } from './RunsLog'
import { CorporateActionsBrowser } from './CorporateActionsBrowser'

export default function OpsPage() {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-lg font-semibold">Data &amp; Ops</h1>

      <Panel title="Health & Triggers">
        <div className="flex flex-col gap-4">
          <HealthStatus />
          <div className="border-t border-border pt-3">
            <TriggersSection />
          </div>
        </div>
      </Panel>

      <RunsLog />
      <CorporateActionsBrowser />
    </div>
  )
}
