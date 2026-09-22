import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  msg: string
}

interface ToastContextValue {
  toast: (msg: string) => void
  toasts: ToastItem[]
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((msg: string) => {
    const id = Math.random()
    setToasts((t) => [...t.slice(-2), { id, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200)
  }, [])

  const value = useMemo(() => ({ toast, toasts }), [toast, toasts])

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

/** Returns a `toast(msg)` function that queues a message in the shell's toast stack. */
export function useToast(): (msg: string) => void {
  return useToastContext().toast
}

/** Internal: the current toast queue, for the Shell to render `.app-toasts`. */
export function useToastList(): ToastItem[] {
  return useToastContext().toasts
}
