import type { ReactNode } from 'react'
import { TopNav } from './TopNav'

interface ShellProps {
  children: ReactNode
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="min-h-screen bg-bg text-text">
      <TopNav />
      <main className="px-4 py-4">{children}</main>
    </div>
  )
}
