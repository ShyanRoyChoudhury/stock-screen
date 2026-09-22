import { useEffect, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
}

/** Thin wrapper around the native <dialog> element (modal, Esc-to-close, backdrop). */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="rounded border border-border bg-surface p-0 text-text backdrop:bg-black/50"
    >
      <div className="min-w-[320px] max-w-[90vw]">
        {title && (
          <header className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">
              ✕
            </button>
          </header>
        )}
        <div className="p-3">{children}</div>
      </div>
    </dialog>
  )
}
