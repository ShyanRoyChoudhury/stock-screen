import { useParams } from 'react-router'

export default function PositionsPage() {
  const { id } = useParams<{ id: string }>()
  return (
    <div>
      <h1 className="text-lg font-semibold">{id ? `Position #${id}` : 'Positions'}</h1>
      <p className="text-sm text-muted">Manage the book: open lots, verdicts, matched strategy, and fills.</p>
    </div>
  )
}
