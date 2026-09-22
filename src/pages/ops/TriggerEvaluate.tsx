import { useState } from 'react'
import { useEvaluatePositions } from '../../api/hooks'
import { Button } from '../../components/Button'
import { ApiKeyPrompt } from '../../components/ApiKeyPrompt'
import { useSettings } from '../../lib/settings'
import type { Verdict } from '../../api/types'
import { describeError } from './utils'

export function TriggerEvaluate({ disabled }: { disabled: boolean }) {
  const { settings } = useSettings()
  const [asOf, setAsOf] = useState('')
  const mutation = useEvaluatePositions()

  function submit() {
    mutation.mutate({ as_of: asOf || undefined })
  }

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <h4 className="text-sm font-semibold">Evaluate positions</h4>
      {!settings.apiKey ? (
        <ApiKeyPrompt message="Evaluating positions needs an API key." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              disabled={disabled}
              title="as of (optional, defaults to the last trading day)"
              className="rounded border border-border bg-surface px-2 py-1 text-sm"
            />
            <Button size="sm" onClick={submit} disabled={disabled || mutation.isPending}>
              {mutation.isPending ? 'Evaluating…' : 'Evaluate positions'}
            </Button>
          </div>
          {mutation.isSuccess && (
            <div className="text-xs text-up">
              <p>
                Evaluated {mutation.data.evaluated} position{mutation.data.evaluated === 1 ? '' : 's'} as of{' '}
                {mutation.data.as_of}.
              </p>
              <p className="text-muted">
                {(Object.entries(mutation.data.by_verdict) as [Verdict, number][])
                  .map(([v, n]) => `${v} ${n}`)
                  .join(' · ')}
              </p>
              {mutation.data.errors.length > 0 && (
                <p className="text-down">
                  {mutation.data.errors.length} error(s):{' '}
                  {mutation.data.errors.map((e) => `#${e.position_id} ${e.error}`).join('; ')}
                </p>
              )}
            </div>
          )}
          {mutation.isError && <p className="text-xs text-down">{describeError(mutation.error)}</p>}
        </>
      )}
    </div>
  )
}
