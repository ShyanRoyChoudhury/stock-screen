// PageHead's health indicator: GET /health, polled every 30s. No hook exists for it in
// api/hooks.ts (only endpoints.ts has it), so the query is defined here per BUILD_BRIEF.

import { useQuery } from '@tanstack/react-query'
import { StatusDot } from '../../ds'
import { health } from '../../api/endpoints'

export function HealthDot() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ops', 'health'],
    queryFn: () => health(),
    refetchInterval: 30_000,
  })

  if (isLoading) return <StatusDot status="pending">GET /health · checking…</StatusDot>
  if (isError || !data) return <StatusDot status="failed">GET /health · failed</StatusDot>
  return <StatusDot status={data.status === 'ok' ? 'ok' : 'failed'}>{`GET /health · ${data.status} · db ${data.database}`}</StatusDot>
}
