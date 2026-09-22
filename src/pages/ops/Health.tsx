// Handoff §5.7: GET /health, polled every 30s. No hook exists for it in api/hooks.ts
// (only endpoints.ts has it), so the query is defined here per BUILD_BRIEF's instruction.

import { useQuery } from '@tanstack/react-query'
import { health } from '../../api/endpoints'
import { Chip } from '../../components/Chip'
import { Loading } from '../../components/Loading'
import { ErrorState } from '../../components/ErrorState'
import { fmtIstDateTime } from '../../lib/format'

export function HealthStatus() {
  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['ops', 'health'],
    queryFn: () => health(),
    refetchInterval: 30_000,
  })

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold">Health</h3>
      {isLoading && <Loading label="Checking health…" />}
      {isError && <ErrorState error={error} title="Health check failed" />}
      {data && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-muted">API</span>
            <Chip variant="status" value={data.status === 'ok' ? 'ok' : 'error'}>
              {data.status}
            </Chip>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted">Database</span>
            <Chip variant="status" value={data.database === 'ok' ? 'ok' : 'error'}>
              {data.database}
            </Chip>
          </div>
          <span className="text-xs text-muted">Checked {fmtIstDateTime(new Date(dataUpdatedAt).toISOString())}</span>
        </div>
      )}
    </div>
  )
}
