import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useFyersCompleteLogin } from '../../api/hooks'
import { ApiError } from '../../api/types'
import { fmt, Panel, PageHead } from '../../ds'

export default function FyersCallbackPage() {
  const [params] = useSearchParams()
  const s = params.get('s')
  const authCode = params.get('auth_code')
  const state = params.get('state')
  const complete = useFyersCompleteLogin()
  const started = useRef(false)

  const paramError = s !== 'ok' ? `Fyers reported a problem (s=${s ?? 'missing'}).` : !authCode || !state ? 'The redirect is missing the auth code or state.' : null

  useEffect(() => {
    // The auth code is single-use; guard against StrictMode's double effect.
    if (started.current || paramError || !authCode || !state) return
    started.current = true
    complete.mutate({ auth_code: authCode, state })
  }, [paramError, authCode, state, complete])

  return (
    <div className="ss-page">
      <PageHead title="Fyers login" />
      <Panel>
        <div className="app-col" style={{ gap: 12 }}>
          {paramError ? (
            <p className="ss-down">{paramError}</p>
          ) : complete.isError ? (
            <p className="ss-down">Login failed: {complete.error instanceof ApiError ? complete.error.message : 'could not reach the API.'}</p>
          ) : complete.isSuccess ? (
            <p className="ss-up">
              Connected to Fyers{complete.data.expires_at ? ` — valid until ${fmt.dateTime(complete.data.expires_at)}` : ''}.
            </p>
          ) : (
            <p className="ss-muted">Completing login…</p>
          )}
          <div>
            <Link to="/admin">Back to Admin</Link>
          </div>
        </div>
      </Panel>
    </div>
  )
}
