import { useParams } from 'react-router'

export default function SymbolPage() {
  const { symbol } = useParams<{ symbol: string }>()
  return (
    <div>
      <h1 className="text-lg font-semibold">Symbol detail{symbol ? `: ${symbol}` : ''}</h1>
      <p className="text-sm text-muted">Everything about one stock on one screen — it's where decisions get made.</p>
    </div>
  )
}
