// 16px line icon set, ported from design/design-system/src/index.jsx.

import type { IconName } from './types'

const ICONS: Record<IconName, string> = {
  today: 'M2.5 8h3l1.5-4 2 8 1.5-4h3',
  signals: 'M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M8 8h.01M4.5 4.5l.01.01',
  positions: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h7',
  symbol: 'M4 3v10M3 5.5h2v5H3zM8 2v11M7 4h2v4H7zM12 5v8M11 7h2v4h-2z',
  trades: 'M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13',
  brokers: 'M6.5 9.5l3-3M5 8L3.5 9.5a2.12 2.12 0 003 3L8 11M11 8l1.5-1.5a2.12 2.12 0 00-3-3L8 5',
  ops: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M5 9h2M5 10.5h4',
  options: 'M3 13L13 3M3 3h4M9 13h4M3 3v4M13 13V9',
  settings:
    'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  upload: 'M8 11V3M5 6l3-3 3 3M3 10.5v2.5h10v-2.5',
  sync: 'M13 6.5A5 5 0 003.6 5M3 9.5a5 5 0 009.4 1.5M3.5 2.5V5H6M12.5 13.5V11H10',
  search: 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.3 10.3l3.2 3.2',
  chevron: 'M6 4l4 4-4 4',
  external: 'M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5',
}

export interface IconProps {
  name: IconName
  className?: string
  title?: string
}

export function Icon({ name, className, title }: IconProps) {
  const d = ICONS[name] || ''
  const cls = className ? 'ss-ic ' + className : 'ss-ic'
  return (
    <svg className={cls} viewBox="0 0 16 16" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  )
}

Icon.names = Object.keys(ICONS) as IconName[]
