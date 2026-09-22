import { Link } from 'react-router'
import type { Candle, IndicatorRow, Position, Symbol as SymbolRow } from '../../api/types'
import { Chip } from '../../components/Chip'
import { Stat } from '../../components/Stat'
import { fmtInr, fmtNum, signedClass } from '../../lib/format'
import { trendState, squeezeState } from './snapshot'

function Badge({ label, tone }: { label: string; tone: 'up' | 'down' | 'muted' }) {
  const cls = tone === 'up' ? 'text-up border-up' : tone === 'down' ? 'text-down border-down' : 'text-muted border-border'
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

interface SymbolHeaderProps {
  symbolInfo: SymbolRow
  lastCandle?: Candle
  prevCandle?: Candle
  lastIndicator?: IndicatorRow
  heldPosition?: Position | null
}

export function SymbolHeader({ symbolInfo, lastCandle, prevCandle, lastIndicator, heldPosition }: SymbolHeaderProps) {
  const change = lastCandle && prevCandle ? lastCandle.close - prevCandle.close : undefined
  const changePct = change !== undefined && prevCandle ? (change / prevCandle.close) * 100 : undefined
  const trend = trendState(lastCandle?.close, lastIndicator)
  const squeeze = squeezeState(lastIndicator)
  const verdict = heldPosition?.latest_evaluation?.verdict ?? heldPosition?.last_verdict ?? null

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{symbolInfo.symbol}</h1>
            {verdict && (
              <>
                <Chip variant="verdict" value={verdict} />
                {heldPosition && (
                  <Link to={`/positions/${heldPosition.id}`} className="text-xs text-accent underline">
                    View position
                  </Link>
                )}
              </>
            )}
          </div>
          <p className="text-sm text-muted">
            {symbolInfo.name ?? '—'} · {symbolInfo.industry ?? '—'} · {symbolInfo.isin ?? '—'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Stat
            label="Last close"
            value={lastCandle ? fmtInr(lastCandle.close) : '—'}
            delta={change !== undefined && changePct !== undefined ? `${change >= 0 ? '+' : ''}${fmtNum(change)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)` : undefined}
            deltaClassName={signedClass(change)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-2 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Trend</span>
          <Badge label={trend} tone={trend === 'Uptrend' ? 'up' : trend === 'Downtrend' ? 'down' : 'muted'} />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Supertrend</span>
          {lastIndicator?.supertrend_dir ? (
            <Badge label={lastIndicator.supertrend_dir === 1 ? 'Bullish' : 'Bearish'} tone={lastIndicator.supertrend_dir === 1 ? 'up' : 'down'} />
          ) : (
            <Badge label="—" tone="muted" />
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted">ADX</span>
          <span className="num">{fmtNum(lastIndicator?.adx_14 ?? null, 1)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted">RVOL</span>
          <span className="num">{lastIndicator?.rvol_20 != null ? `${lastIndicator.rvol_20.toFixed(2)}×` : '—'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Squeeze</span>
          <Badge label={squeeze} tone={squeeze === 'ON' ? 'down' : squeeze === 'OFF' ? 'up' : 'muted'} />
        </span>
      </div>
    </div>
  )
}
