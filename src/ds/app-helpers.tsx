// Ported from design/prototype/src/app.jsx (app-local UI helpers, lines 22-58):
// Menu, Toggle, Panel, KV, PageHead. Styled by the `app-*` classes in app.css.

import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { cx } from './cx'
import { FilterChip } from './nav'

export interface MenuOption<V> {
  value: V
  label: string
  count?: number
}

interface MenuPropsSingle<V> {
  label: string
  value: V | null | undefined
  options: MenuOption<V>[]
  multi?: false
  onChange: (value: V) => void
  onClear?: () => void
}

interface MenuPropsMulti<V> {
  label: string
  value: V[] | null | undefined
  options: MenuOption<V>[]
  multi: true
  onChange: (value: V[]) => void
  onClear?: () => void
}

export type MenuProps<V> = MenuPropsSingle<V> | MenuPropsMulti<V>

export function Menu<V extends string | number>(props: MenuProps<V>): ReactElement {
  const { label, options, onClear } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [open])

  const sel = props.multi ? props.value || [] : props.value
  const shown = props.multi
    ? (sel as V[]).length
      ? (sel as V[]).join(', ')
      : null
    : (options.find((o) => o.value === sel)?.label ?? null)

  return (
    <span className="app-menu" ref={ref}>
      <FilterChip label={label} value={shown} active={shown != null} onClick={() => setOpen((o) => !o)} onClear={shown != null ? onClear : undefined} />
      {open ? (
        <div className="app-pop" role="listbox">
          {options.map((o) => {
            const on = props.multi ? (sel as V[]).includes(o.value) : sel === o.value
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={on}
                className={cx('app-pop-item', on && 'on')}
                onClick={() => {
                  if (props.multi) {
                    const arr = sel as V[]
                    props.onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])
                  } else {
                    ;(props.onChange as (v: V) => void)(o.value)
                    setOpen(false)
                  }
                }}
              >
                <span className="app-check">{on ? (props.multi ? '■' : '●') : ''}</span>
                <span>{o.label}</span>
                {o.count != null ? <span className="ss-n ss-muted app-pop-count">{o.count}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </span>
  )
}

export interface ToggleProps {
  on: boolean
  onClick?: () => void
  children?: ReactNode
  color?: string
}

export function Toggle({ on, onClick, children, color }: ToggleProps): ReactElement {
  return (
    <button type="button" className={cx('app-toggle', on && 'on')} aria-pressed={on} onClick={onClick}>
      {color ? <span className="app-swatch" style={{ background: 'var(--' + color + ')' }} /> : null}
      {children}
    </button>
  )
}

export interface PanelProps {
  title?: ReactNode
  right?: ReactNode
  children?: ReactNode
  pad?: boolean
  id?: string
}

export function Panel({ title, right, children, pad = true, id }: PanelProps): ReactElement {
  return (
    <section className="ss-panel app-panel" id={id}>
      {title ? (
        <div className="ss-panel-head">
          <h2 className="ss-panel-title">{title}</h2>
          <span className="ss-spacer" />
          {right}
        </div>
      ) : null}
      <div className={pad ? 'ss-panel-body' : ''}>{children}</div>
    </section>
  )
}

export function KV({ items }: { items: (readonly [ReactNode, ReactNode] | null | undefined | false)[] }): ReactElement {
  return (
    <dl className="app-kv">
      {items.filter(Boolean).map((item, i) => {
        const [k, v] = item as readonly [ReactNode, ReactNode]
        return (
          <Fragment key={i}>
            <dt className="ss-label">{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        )
      })}
    </dl>
  )
}

export interface PageHeadProps {
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
}

export function PageHead({ title, sub, children }: PageHeadProps): ReactElement {
  return (
    <div className="ss-page-head app-page-head">
      <h1 className="ss-page-title">{title}</h1>
      {sub ? <span className="ss-muted">{sub}</span> : null}
      <span className="ss-spacer" />
      {children}
    </div>
  )
}
