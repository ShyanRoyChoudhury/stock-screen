// Ported from design/design-system/src/index.jsx: DataTable, SymbolCell.

import { Fragment, useMemo, useState, type Key, type KeyboardEventHandler, type ReactElement, type ReactNode } from 'react'
import { cx } from './cx'

export interface Column<R> {
  key: string
  label: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: number | string
  sortable?: boolean
  sortValue?: (row: R) => unknown
  render?: (row: R) => ReactNode
  title?: string
}

export interface DataTableProps<R> {
  columns: Column<R>[]
  rows: R[]
  rowKey?: (row: R, i: number) => Key
  density?: 'compact' | 'default'
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  renderExpanded?: (row: R) => ReactNode
  onRowOpen?: (row: R) => void
  rowClassName?: (row: R) => string | undefined
  footer?: ReactNode
  maxHeight?: number | string
  ariaLabel?: string
}

export function DataTable<R>({
  columns,
  rows,
  rowKey = (_r, i) => i,
  density = 'default',
  initialSort,
  renderExpanded,
  onRowOpen,
  footer,
  maxHeight,
  rowClassName,
  ariaLabel,
}: DataTableProps<R>): ReactElement {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort || null)
  const [cursor, setCursor] = useState(-1)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    const get = col && col.sortValue ? col.sortValue : (r: R) => (r as Record<string, unknown>)[sort.key]
    const out = rows.slice().sort((a, b) => {
      const x = get(a) as never
      const y = get(b) as never
      if (x == null) return 1
      if (y == null) return -1
      return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'asc' ? 1 : -1)
    })
    return out
  }, [rows, sort, columns])

  const toggle = (c: Column<R>) => {
    if (!c.sortable) return
    setSort((s) => (s && s.key === c.key ? { key: c.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: c.align === 'right' ? 'desc' : 'asc' }))
  }

  const onKey: KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      setCursor((c) => Math.min(sorted.length - 1, c + 1))
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor >= 0) {
      e.preventDefault()
      const r = sorted[cursor]
      const k = String(rowKey(r, cursor))
      if (renderExpanded) setOpen((o) => ({ ...o, [k]: !o[k] }))
      else if (onRowOpen) onRowOpen(r)
    }
  }

  const alignCls = (c: Column<R>) => (c.align === 'right' ? 'ss-r' : c.align === 'center' ? 'ss-c' : undefined)

  return (
    <div className="ss">
      <div className="ss-table-wrap" tabIndex={0} onKeyDown={onKey} style={maxHeight ? { maxHeight } : undefined} aria-label={ariaLabel}>
        <table className={cx('ss-table', density === 'compact' && 'ss-table-compact')}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cx(alignCls(c), c.sortable && 'ss-sortable')}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={sort && sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={() => toggle(c)}
                  title={c.title}
                >
                  {c.label}
                  {sort && sort.key === c.key ? <span className="ss-sort">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const rk = rowKey(r, i)
              const k = String(rk)
              return (
                <Fragment key={rk}>
                  <tr
                    className={cx(i === cursor && 'ss-cursor', rowClassName && rowClassName(r))}
                    onClick={() => {
                      setCursor(i)
                      if (renderExpanded) setOpen((o) => ({ ...o, [k]: !o[k] }))
                      else if (onRowOpen) onRowOpen(r)
                    }}
                    aria-expanded={renderExpanded ? !!open[k] : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={alignCls(c)}>
                        {c.render ? c.render(r) : (r as Record<string, ReactNode>)[c.key]}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && open[k] ? (
                    <tr className="ss-expanded-row">
                      <td colSpan={columns.length}>{renderExpanded(r)}</td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {footer ? <div className="ss-table-foot">{footer}</div> : null}
    </div>
  )
}

export interface SymbolCellProps {
  symbol: string
  name?: string
  sub?: ReactNode
}

export function SymbolCell({ symbol, name, sub }: SymbolCellProps): ReactElement {
  return (
    <span>
      <span className="ss-sym">{symbol}</span>
      {name ? <span className="ss-sym-name"> {name}</span> : null}
      {sub ? <div className="ss-sym-name">{sub}</div> : null}
    </span>
  )
}
