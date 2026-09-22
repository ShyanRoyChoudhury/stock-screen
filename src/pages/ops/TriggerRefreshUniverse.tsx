import { useState } from 'react'
import { useRefreshSymbols } from '../../api/hooks'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { KeyValueDump, describeError } from './utils'

export function TriggerRefreshUniverse({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const mutation = useRefreshSymbols()

  function confirm() {
    setOpen(false)
    mutation.mutate()
  }

  return (
    <div className="flex flex-col gap-1.5 py-3">
      <h4 className="text-sm font-semibold">Refresh universe</h4>
      <p className="text-xs text-muted">Re-fetches the Nifty 500 symbol list from NSE.</p>
      <div>
        <Button size="sm" onClick={() => setOpen(true)} disabled={disabled || mutation.isPending}>
          {mutation.isPending ? 'Refreshing…' : 'Refresh universe'}
        </Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Refresh universe?">
        <div className="flex flex-col gap-3">
          <p className="text-sm">This re-fetches the Nifty 500 symbol list from NSE. Continue?</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={confirm}>
              Refresh
            </Button>
          </div>
        </div>
      </Dialog>
      {mutation.isSuccess && <KeyValueDump data={mutation.data} />}
      {mutation.isError && <p className="text-xs text-down">{describeError(mutation.error)}</p>}
    </div>
  )
}
