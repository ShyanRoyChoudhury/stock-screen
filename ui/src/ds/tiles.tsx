// Ported from design/design-system/src/index.jsx: StatTile, LevelLadder, Scorecard, MiniChart.

import type { ReactElement, ReactNode } from 'react'
import { cx } from './cx'
import { fmt } from './fmt'
import { Badge, VerdictChip } from './primitives'
import { Num } from './numbers'
import type { Verdict } from './types'

const nf0 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

export interface StatTileProps {
  label?: ReactNode
  value: number | string
  sub?: ReactNode
  verdict?: Verdict
  size?: 'lg' | 'sm'
  onClick?: () => void
}

export function StatTile({ label, value, sub, verdict, size = 'lg', onClick }: StatTileProps): ReactElement {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      className={cx('ss-stat', verdict && 'ss-stat-' + verdict, size === 'sm' && 'ss-stat-sm', value === 0 && 'ss-stat-zero')}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <span className="ss-label">{verdict ? <VerdictChip verdict={verdict} size="sm" /> : label}</span>
      <span className="ss-stat-value">{typeof value === 'number' ? nf0.format(value) : value}</span>
      {sub ? <span className="ss-stat-sub">{sub}</span> : null}
    </Tag>
  )
}

export interface LevelLadderProps {
  entry: number
  close?: number
  stop?: number
  trail?: number
  t1?: number
  t2?: number
  matched?: boolean
}

export function LevelLadder({ entry, close, stop, trail, t1, t2, matched = true }: LevelLadderProps): ReactElement {
  const lv: [string, string, number][] = []
  if (matched && stop != null) lv.push(['stop', 'Stop', stop])
  if (trail != null) lv.push(['trail', matched ? 'Trail' : 'Trail = stop', trail])
  if (entry != null) lv.push(['entry', 'Entry', entry])
  if (matched && t1 != null) lv.push(['t1', 'T1', t1])
  if (matched && t2 != null) lv.push(['t2', 'T2', t2])
  const vals = lv.map((l) => l[2]).concat(close != null ? [close] : [])
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const span = hi - lo || 1
  const pos = (v: number) => 4 + ((v - lo) / span) * 92
  const effStop = matched ? Math.max(stop ?? -Infinity, trail ?? -Infinity) : trail
  return (
    <div className="ss">
      <div className="ss-ladder">
        <div className="ss-ladder-track">
          {effStop != null && entry != null ? (
            <span className="ss-ladder-risk" style={{ left: pos(effStop) + '%', width: Math.max(0, pos(entry) - pos(effStop)) + '%' }} />
          ) : null}
          {matched && t2 != null && entry != null ? (
            <span className="ss-ladder-reward" style={{ left: pos(entry) + '%', width: pos(t2) - pos(entry) + '%' }} />
          ) : null}
          {lv.map(([k, , v]) => (
            <span key={k} className={'ss-ladder-tick ss-lv-' + k} style={{ left: pos(v) + '%' }} />
          ))}
          {close != null ? (
            <span className="ss-ladder-close" style={{ left: pos(close) + '%' }}>
              <span className="ss-ladder-close-tag">{fmt.price(close)}</span>
              <span className="ss-ladder-close-pin" />
            </span>
          ) : null}
          {lv.map(([k, lab, v], i) => (
            <span key={'l' + k} className="ss-ladder-lbl" style={{ left: pos(v) + '%', top: i % 2 ? 44 : 20 }}>
              <span className="ss-label">{lab}</span>
              <Num value={v} />
            </span>
          ))}
        </div>
      </div>
      {!matched ? <div className="ss-ladder-note">Unmatched: trailing stop only, no targets.</div> : null}
    </div>
  )
}

export interface ScorecardBreakdown {
  supertrend?: string
  macd?: string
  bb_position?: string
  volume?: string
  room_to_upper?: string
  high_conviction?: boolean
}

export interface ScorecardProps {
  score: string
  conviction?: string
  breakdown: ScorecardBreakdown
}

export function Scorecard({ score, conviction, breakdown = {} }: ScorecardProps): ReactElement {
  const rows: [keyof ScorecardBreakdown, string][] = [
    ['supertrend', 'Supertrend'],
    ['macd', 'MACD'],
    ['bb_position', 'BB position'],
    ['volume', 'Volume'],
  ]
  const conv = conviction || ''
  const tone = /HIGH/.test(conv) ? 'accent' : /STRONG/.test(conv) ? 'up' : 'neutral'
  return (
    <div className="ss ss-score">
      <div className="ss-score-head">
        <span className="ss-score-val">{score}</span>
        <span className="ss-label">checks</span>
        <span className="ss-spacer" />
        {conv ? (
          <Badge tone={tone}>
            {conv.replace('⚡', '').trim()}
            {/HIGH/.test(conv) ? ' ⚡' : ''}
          </Badge>
        ) : null}
      </div>
      {rows.map(([k, name]) => {
        const raw = (breakdown[k] as string) || ''
        const pass = /✓/.test(raw)
        const detail = raw.replace(/[✓✗]|\sX$/g, '').trim()
        return (
          <div key={k} className={cx('ss-score-row', pass ? 'ss-score-pass' : 'ss-score-fail')}>
            <span className="ss-score-mark" aria-label={pass ? 'pass' : 'fail'}>
              {pass ? '✓' : '✗'}
            </span>
            <span className="ss-score-name">{name}</span>
            <span className="ss-score-detail">{detail}</span>
          </div>
        )
      })}
      {breakdown.room_to_upper ? (
        <div className="ss-score-row">
          <span />
          <span className="ss-score-name ss-muted">Room to upper band</span>
          <span className="ss-score-detail">{breakdown.room_to_upper}</span>
        </div>
      ) : null}
    </div>
  )
}

export interface Bar {
  o: number
  h: number
  l: number
  c: number
  v?: number
}

export interface MiniChartLevel {
  kind: 'entry' | 'stop' | 'trail' | 't1' | 't2'
  value: number
  label?: string
}

export interface MiniChartMarker {
  index: number
  kind: 'signal' | 'action' | 'demerger'
  glyph?: string
}

export interface MiniChartProps {
  bars: Bar[]
  width?: number
  height?: number
  ema50?: (number | null)[]
  ema200?: (number | null)[]
  levels?: MiniChartLevel[]
  markers?: MiniChartMarker[]
  volume?: boolean
  axis?: boolean
}

/** SVG mini chart for panels; the full chart uses Lightweight Charts with the same tokens. */
export function MiniChart({ bars = [], width = 480, height = 220, levels = [], markers = [], ema50, ema200, volume = true, axis = true }: MiniChartProps): ReactElement {
  const padR = axis ? 56 : 8
  const padT = 8
  const volH = volume ? Math.round(height * 0.18) : 0
  const priceH = height - padT - volH - 8
  const n = bars.length || 1
  const step = (width - padR - 8) / n
  const bw = Math.max(1, step * 0.62)
  const all = bars.flatMap((b) => [b.h, b.l]).concat(levels.map((l) => l.value))
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const sp = hi - lo || 1
  const y = (v: number) => padT + (1 - (v - lo) / sp) * priceH
  const x = (i: number) => 8 + i * step + step / 2
  const vmax = Math.max(1, ...bars.map((b) => b.v || 0))
  const line = (arr?: (number | null)[]) =>
    arr && arr.map((v, i) => (v == null ? '' : (i && arr[i - 1] != null ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1))).join(' ')
  const grid = [0.25, 0.5, 0.75].map((f) => lo + sp * f)
  return (
    <svg className="ss-chart" width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Price chart">
      {grid.map((g, i) => (
        <line key={i} className="grid" x1="8" x2={width - padR} y1={y(g)} y2={y(g)} />
      ))}
      {axis
        ? grid
            .filter((g) => !levels.some((l) => Math.abs(y(l.value) - y(g)) < 10))
            .map((g, i) => (
              <text key={'a' + i} className="axis" x={width - padR + 6} y={y(g) + 3}>
                {fmt.price(g)}
              </text>
            ))
        : null}
      {volume
        ? bars.map((b, i) => {
            const h = ((b.v || 0) / vmax) * volH
            return <rect key={'v' + i} className={b.c >= b.o ? 'vu' : 'vd'} x={x(i) - bw / 2} y={height - h} width={bw} height={h} />
          })
        : null}
      {bars.map((b, i) => {
        const up = b.c >= b.o
        const top = y(Math.max(b.o, b.c))
        const bot = y(Math.min(b.o, b.c))
        return (
          <g key={i} className={up ? 'cu' : 'cd'}>
            <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} strokeWidth="1" />
            <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} />
          </g>
        )
      })}
      {ema50 ? <path className="ema50" d={line(ema50)} /> : null}
      {ema200 ? <path className="ema200" d={line(ema200)} /> : null}
      {levels.map((l, i) => (
        <g key={'l' + i}>
          <line className={'lv lv-' + l.kind} x1="8" x2={width - padR} y1={y(l.value)} y2={y(l.value)} />
          {axis ? (
            <g>
              <rect className={'lv-tag-bg-' + l.kind} x={width - padR + 2} y={y(l.value) - 7} width={padR - 4} height="14" rx="2" />
              <text className="lv-tag lv-tag-tx" x={width - padR + 6} y={y(l.value) + 3.5}>
                {(l.label ? l.label + ' ' : '') + Math.round(l.value)}
              </text>
            </g>
          ) : null}
        </g>
      ))}
      {markers.map((m, i) => {
        const b = bars[m.index]
        if (!b) return null
        const below = m.kind === 'signal'
        const cy = below ? y(b.l) + 12 : y(b.h) - 12
        const cls = m.kind === 'signal' ? 'mk-sig' : m.kind === 'demerger' ? 'mk-dem' : 'mk-act'
        return (
          <g key={'m' + i}>
            {m.kind === 'signal' ? (
              <path className={cls} d={'M' + x(m.index) + ' ' + (cy - 6) + 'l5 8h-10z'} />
            ) : (
              <rect className={cls} x={x(m.index) - 7} y={cy - 7} width="14" height="14" rx="2" />
            )}
            {m.kind !== 'signal' ? (
              <text className="mk-tx" x={x(m.index)} y={cy + 3} textAnchor="middle">
                {m.glyph || 'D'}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
