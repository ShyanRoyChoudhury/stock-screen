import { EmptyState, PageHead } from '../../ds'

export default function OptionsPage() {
  return (
    <div className="ss-page">
      <PageHead title="Options" />
      <EmptyState title="Options — later">Reserved for a later phase. The app never places orders.</EmptyState>
    </div>
  )
}
