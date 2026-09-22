// App.tsx routes both `/positions` and `/positions/:id` to this same lazy
// default export. We branch on the :id param to render the list or detail.

import { useParams } from 'react-router'
import { PositionsList } from './PositionsList'
import { PositionDetail } from './PositionDetail'

export default function PositionsPage() {
  const { id } = useParams<{ id: string }>()

  if (id) {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) {
      return <p className="text-sm text-exit">Invalid position id "{id}".</p>
    }
    return <PositionDetail id={numericId} />
  }

  return <PositionsList />
}
