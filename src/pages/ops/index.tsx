// app.jsx 577-612 (Data & Ops): pipeline runs, manual triggers, corporate actions. Order:
// health dot in the page head, Triggers panel, the (unwrapped) runs table, Corporate actions panel.

import { PageHead } from '../../ds'
import { HealthDot } from './Health'
import { Triggers } from './Triggers'
import { RunsLog } from './RunsLog'
import { CorporateActionsBrowser } from './CorporateActionsBrowser'

export default function OpsPage() {
  return (
    <div className="ss-page">
      <PageHead title="Data & Ops" sub="Pipeline runs, manual triggers and corporate actions">
        <HealthDot />
      </PageHead>
      <Triggers />
      <RunsLog />
      <CorporateActionsBrowser />
    </div>
  )
}
