import { Link } from 'react-router'

interface ApiKeyPromptProps {
  message?: string
}

export function ApiKeyPrompt({ message = 'This needs an API key to load your data.' }: ApiKeyPromptProps) {
  return (
    <div className="flex flex-col items-start gap-2 rounded border border-border bg-surface-2 px-3 py-3 text-sm">
      <p className="text-muted">{message}</p>
      <Link to="/settings" className="text-accent underline">
        Set API key in Settings
      </Link>
    </div>
  )
}
