/* Stock Screen design system — components. Built to one classic script: window.StockScreen. */
const React = window.React;
const { useState, useMemo, useRef, useEffect } = React;

const cx = (...a) => a.filter(Boolean).join(' ');

/* ───────────── formatting ───────────── */
const MINUS = '−';
const nf = {};
const numFmt = (d) => (nf[d] = nf[d] || new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (n, s) => (n > 0 ? (s ? '+' : '') : n < 0 ? MINUS : '');
const abs = Math.abs;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const IST_MS = 330 * 60000;
function toIst(v) {
  if (v == null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  return new Date(new Date(v).getTime() + IST_MS);
}
const p2 = (n) => String(n).padStart(2, '0');

export const fmt = {
  /** ₹1,23,456.78 — Indian digit grouping, 2 decimals. */
  inr: (n, d = 2) => (n == null ? '—' : sgn(n) + '₹' + numFmt(d).format(abs(n))),
  /** 1,23,456.78 — a price without the symbol (column header carries ₹). */
  price: (n, d = 2) => (n == null ? '—' : sgn(n) + numFmt(d).format(abs(n))),
  /** 1,200 — quantities. */
  qty: (n) => (n == null ? '—' : sgn(n) + numFmt(0).format(abs(n))),
  /** A PERCENT value (risk_pct 8.92 → "8.92%"). */
  pct: (n, d = 2, signed = false) => (n == null ? '—' : sgn(n, signed) + abs(n).toFixed(d) + '%'),
  /** A FRACTION (unrealized_pnl_pct 0.019 → "+1.90%"). The API's *_pnl_pct fields are fractions. */
  frac: (n, d = 2, signed = true) => (n == null ? '—' : sgn(n, signed) + abs(n * 100).toFixed(d) + '%'),
  /** Multiple of average (rvol 2.05 → "2.05×"). */
  mult: (n, d = 2) => (n == null ? '—' : abs(n).toFixed(d) + '×'),
  /** R:R from levels: (T1 − entry) / (entry − stop). */
  rr: (entry, stop, t1) => (entry == null || stop == null || t1 == null || entry === stop ? null : (t1 - entry) / (entry - stop)),
  /** "21 Sep 2026" for a trading date or a daily candle ts (UTC → IST). */
  date: (v, withDow = false) => { const t = toIst(v); if (!t) return '—'; return (withDow ? DOW[t.getUTCDay()] + ' ' : '') + t.getUTCDate() + ' ' + MON[t.getUTCMonth()] + ' ' + t.getUTCFullYear(); },
  /** "16:47 IST" from a UTC timestamp. */
  time: (v, suffix = true) => { const t = toIst(v); if (!t) return '—'; return p2(t.getUTCHours()) + ':' + p2(t.getUTCMinutes()) + (suffix ? ' IST' : ''); },
  /** "21 Sep 2026, 16:47 IST". */
  dateTime: (v) => fmt.date(v) + ', ' + fmt.time(v),
  /** Duration between two UTC timestamps: "6m 27s". */
  dur: (a, b) => { const s = Math.round((new Date(b) - new Date(a)) / 1000); if (!(s >= 0)) return '—'; const m = Math.floor(s / 60); return m ? m + 'm ' + p2(s % 60) + 's' : s + 's'; },
};

/* ───────────── domain vocabulary ───────────── */
export const labels = {
  verdicts: { EXIT: 'Get out', PARTIAL: 'Book part (T1 reached)', REVIEW: 'Data or logic unsure — look yourself', HOLD: 'Nothing to do' },
  reasons: {
    NO_DATA: ['REVIEW', 'No price data for this symbol/date'],
    DEMERGER_CLIFF: ['REVIEW', 'Demerger while held; levels unreliable'],
    QTY_MISMATCH: ['REVIEW', 'Qty doesn’t divide cleanly after restatement'],
    STOP_HIT: ['EXIT', 'Close below stop'],
    SUPERTREND_FLIP: ['EXIT', 'Supertrend turned bearish'],
    TRAIL_HIT: ['EXIT', 'Close below trailing stop'],
    T2_HIT: ['EXIT', 'Close reached target 2'],
    T1_HIT: ['PARTIAL', 'Close reached target 1'],
  },
  warnings: {
    LOW_BREACH: 'Low pierced stop; close held',
    VOLUME_DIVERGENCE: 'Price up, volume falling (5 bars)',
    UPCOMING_ACTION: 'Corporate action within 5 sessions',
    QTY_DIFFERS_FROM_BROKER: 'Qty differs from broker holdings',
    HORIZON: 'Held > 30 sessions',
    STALE_BAR: 'Latest candle older than evaluation date',
  },
  strategies: {
    PIPELINE: { type: 'event', label: 'Trend-breakout-retest' },
    S1_ST_Flip: { type: 'event', label: 'Supertrend flip' },
    S2_MACD_Zero: { type: 'event', label: 'MACD zero cross' },
    S3_BB_Squeeze: { type: 'event', label: 'Bollinger squeeze break' },
    TTM_Squeeze: { type: 'event', label: 'TTM squeeze fire' },
    Confluence: { type: 'state', label: 'Confluence (state)' },
  },
  actions: { dividend: ['D', 'Dividend'], split: ['S', 'Split'], bonus: ['B', 'Bonus'], rights: ['R', 'Rights'], demerger: ['DM', 'Demerger'] },
};

/* ───────────── icons (own 16px line set) ───────────── */
const ICONS = {
  today: 'M2.5 8h3l1.5-4 2 8 1.5-4h3',
  signals: 'M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M8 8h.01M4.5 4.5l.01.01',
  positions: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h7',
  symbol: 'M4 3v10M3 5.5h2v5H3zM8 2v11M7 4h2v4H7zM12 5v8M11 7h2v4h-2z',
  trades: 'M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13',
  brokers: 'M6.5 9.5l3-3M5 8L3.5 9.5a2.12 2.12 0 003 3L8 11M11 8l1.5-1.5a2.12 2.12 0 00-3-3L8 5',
  ops: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M5 9h2M5 10.5h4',
  options: 'M3 13L13 3M3 3h4M9 13h4M3 3v4M13 13V9',
  settings: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
  upload: 'M8 11V3M5 6l3-3 3 3M3 10.5v2.5h10v-2.5',
  sync: 'M13 6.5A5 5 0 003.6 5M3 9.5a5 5 0 009.4 1.5M3.5 2.5V5H6M12.5 13.5V11H10',
  search: 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.3 10.3l3.2 3.2',
  chevron: 'M6 4l4 4-4 4',
  external: 'M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5',
};
export function Icon({ name, className, title }) {
  const d = ICONS[name] || '';
  return (
    <svg className={cx('ss-ic', className)} viewBox="0 0 16 16" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
Icon.names = Object.keys(ICONS);

/* ───────────── actions ───────────── */
export function Kbd({ keys, children }) {
  const list = keys ? (Array.isArray(keys) ? keys : String(keys).split(' ')) : [children];
  return <span className="ss-kbds">{list.map((k, i) => <kbd key={i} className="ss-kbd">{k}</kbd>)}</span>;
}

export function Button({ variant = 'secondary', size = 'md', icon, kbd, loading, children, className, ...rest }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined}
      className={cx('ss-btn', 'ss-btn-' + variant, size === 'sm' && 'ss-btn-sm', className)}>
      {loading ? <span className="ss-btn-spin" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
      {kbd ? <Kbd keys={kbd} /> : null}
    </button>
  );
}

/* ───────────── status ───────────── */
const VGLYPH = { EXIT: '■', PARTIAL: '◧', REVIEW: '?', HOLD: '·' };
export function VerdictChip({ verdict, size = 'md', title }) {
  const v = String(verdict || 'HOLD').toUpperCase();
  return (
    <span className={cx('ss-verdict', 'ss-verdict-' + v, size === 'sm' && 'ss-verdict-sm')} title={title || labels.verdicts[v]}>
      <span className="ss-verdict-glyph" aria-hidden="true">{VGLYPH[v]}</span>{v}
    </span>
  );
}

export function CodeTag({ code, detail, kind, showLabel = true }) {
  const isWarn = kind === 'warning' || (!kind && labels.warnings[code]);
  const r = labels.reasons[code];
  const text = showLabel ? detail || (isWarn ? labels.warnings[code] : r && r[1]) : null;
  return (
    <span className={cx('ss-code', isWarn ? 'ss-code-warning' : 'ss-code-reason', !isWarn && r && 'ss-code-' + r[0])} title={detail || (isWarn ? labels.warnings[code] : r && r[1]) || code}>
      <span className="ss-code-key">{code}</span>
      {text ? <span className="ss-code-text">{text}</span> : null}
    </span>
  );
}

export function CodeList({ reasons = [], warnings = [], showLabel = true }) {
  if (!reasons.length && !warnings.length) return <span className="ss-faint">—</span>;
  return (
    <span className="ss-codes">
      {reasons.map((r, i) => <CodeTag key={'r' + i} code={r.code} detail={r.detail} kind="reason" showLabel={showLabel} />)}
      {warnings.map((w, i) => <CodeTag key={'w' + i} code={w.code} detail={w.detail} kind="warning" showLabel={showLabel} />)}
    </span>
  );
}

const STATUS_ALIAS = { completed: 'ok', ok: 'ok', running: 'running', warning: 'warning', degraded: 'warning', failed: 'failed', error: 'failed', auth_failed: 'failed', never: 'never', pending: 'never', skipped: 'never' };
const STATUS_TEXT = { ok: 'OK', running: 'Running', warning: 'Warning', failed: 'Failed', never: 'Never run' };
export function StatusDot({ status, label, children, bare }) {
  const s = STATUS_ALIAS[status] || 'never';
  if (bare) return <span className={cx('ss-status', 'ss-status-' + s)} role="img" aria-label={STATUS_TEXT[s]}><span className="ss-dot" /></span>;
  return (
    <span className={cx('ss-status', 'ss-status-' + s)}>
      <span className="ss-dot" aria-hidden="true" />
      {children || label || (status === 'auth_failed' ? 'Auth failed' : status === 'error' ? 'Error' : status === 'completed' ? 'Completed' : STATUS_TEXT[s])}
    </span>
  );
}

export function Badge({ tone = 'neutral', children, title }) {
  return <span className={cx('ss-badge', tone !== 'neutral' && 'ss-badge-' + tone)} title={title}>{children}</span>;
}

export function StrategyTag({ strategy, extra }) {
  const meta = labels.strategies[strategy] || { type: 'event', label: strategy };
  return (
    <span className={cx('ss-strat', meta.type === 'state' && 'ss-strat-state')} title={meta.label + (meta.type === 'state' ? ' — fires while a condition holds' : ' — fires on a discrete change')}>
      <span className="ss-strat-mark" aria-hidden="true" />{strategy}{extra ? <span className="ss-muted">{extra}</span> : null}
    </span>
  );
}

export function TimeframeBadge({ timeframe = '1d' }) {
  const exp = timeframe !== '1d';
  return <span className={cx('ss-tf', exp && 'ss-tf-exp')} title={exp ? 'Experimental: Yahoo hourly feed does not reconcile with daily bars; ~13% zero-volume bars.' : 'Daily — primary, trusted'}>{timeframe}</span>;
}

/* ───────────── numbers ───────────── */
export function Num({ value, kind = 'price', decimals, signed, tone, currency, className }) {
  if (value == null || Number.isNaN(value)) return <span className={cx('ss-n', 'ss-n-null', className)}>—</span>;
  let s;
  switch (kind) {
    case 'inr': s = fmt.price(abs(value), decimals ?? 2); break;
    case 'qty': s = fmt.qty(abs(value)); break;
    case 'pct': s = abs(value).toFixed(decimals ?? 2) + '%'; break;
    case 'frac': s = abs(value * 100).toFixed(decimals ?? 2) + '%'; break;
    case 'mult': s = fmt.mult(value, decimals ?? 2); break;
    case 'rr': s = abs(value).toFixed(decimals ?? 2); break;
    case 'int': s = numFmt(0).format(abs(value)); break;
    default: s = fmt.price(abs(value), decimals ?? 2);
  }
  const sign = value < 0 ? MINUS : signed && value > 0 ? '+' : '';
  const t = tone === 'auto' ? (value > 0 ? 'up' : value < 0 ? 'down' : 'flat') : tone;
  const cur = kind === 'inr' || currency;
  return <span className={cx('ss-n', t && 'ss-' + t, className)}>{sign}{cur ? <span className="ss-n-cur">₹</span> : null}{s}</span>;
}

export function Change({ abs: a, frac, pct, showArrow = true }) {
  const ref = a ?? frac ?? pct ?? 0;
  const t = ref > 0 ? 'up' : ref < 0 ? 'down' : 'flat';
  return (
    <span className={cx('ss-change', 'ss-' + t)}>
      {showArrow ? <span className="ss-change-arrow" aria-hidden="true">{t === 'up' ? '▲' : t === 'down' ? '▼' : '■'}</span> : null}
      {a != null ? <span>{sgn(a, true)}{numFmt(2).format(abs(a))}</span> : null}
      {frac != null ? <span>{fmt.frac(frac)}</span> : null}
      {pct != null ? <span>{fmt.pct(pct, 2, true)}</span> : null}
    </span>
  );
}

/** Risk % with a scale bar. ≤ 3% calm, ≤ 8% caution, > 8% flagged (default thresholds). */
export function RiskPct({ value, caution = 3, high = 8, max = 16 }) {
  if (value == null) return <Num value={null} />;
  const lvl = value > high ? 'high' : value > caution ? 'mid' : 'low';
  return (
    <span className={cx('ss-risk', 'ss-risk-' + lvl)} title={lvl === 'high' ? 'High risk: stop is more than ' + high + '% away' : undefined}>
      {lvl === 'high' ? <span aria-hidden="true">!</span> : null}
      {fmt.pct(value)}
      <span className="ss-risk-bar" aria-hidden="true"><span className="ss-risk-fill" style={{ width: Math.min(100, (value / max) * 100) + '%' }} /></span>
    </span>
  );
}

/* ───────────── data table ───────────── */
export function DataTable({ columns, rows, rowKey = (r, i) => i, density = 'default', initialSort, renderExpanded, onRowOpen, footer, maxHeight, rowClassName, ariaLabel }) {
  const [sort, setSort] = useState(initialSort || null);
  const [cursor, setCursor] = useState(-1);
  const [open, setOpen] = useState({});
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = col && col.sortValue ? col.sortValue : (r) => r[sort.key];
    const out = rows.slice().sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null) return 1; if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === 'asc' ? 1 : -1);
    });
    return out;
  }, [rows, sort, columns]);
  const toggle = (c) => { if (!c.sortable) return; setSort((s) => (s && s.key === c.key ? { key: c.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: c.key, dir: c.align === 'right' ? 'desc' : 'asc' })); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setCursor((c) => Math.min(sorted.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if ((e.key === 'Enter' || e.key === ' ') && cursor >= 0) {
      e.preventDefault(); const r = sorted[cursor]; const k = rowKey(r, cursor);
      if (renderExpanded) setOpen((o) => ({ ...o, [k]: !o[k] })); else if (onRowOpen) onRowOpen(r);
    }
  };
  const alignCls = (c) => (c.align === 'right' ? 'ss-r' : c.align === 'center' ? 'ss-c' : undefined);
  return (
    <div className="ss">
      <div className="ss-table-wrap" tabIndex={0} onKeyDown={onKey} style={maxHeight ? { maxHeight } : undefined} aria-label={ariaLabel}>
        <table className={cx('ss-table', density === 'compact' && 'ss-table-compact')}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cx(alignCls(c), c.sortable && 'ss-sortable')} style={c.width ? { width: c.width } : undefined}
                  aria-sort={sort && sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} onClick={() => toggle(c)} title={c.title}>
                  {c.label}{sort && sort.key === c.key ? <span className="ss-sort">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const k = rowKey(r, i);
              return (
                <React.Fragment key={k}>
                  <tr className={cx(i === cursor && 'ss-cursor', rowClassName && rowClassName(r))} onClick={() => { setCursor(i); if (renderExpanded) setOpen((o) => ({ ...o, [k]: !o[k] })); else if (onRowOpen) onRowOpen(r); }}
                    aria-expanded={renderExpanded ? !!open[k] : undefined}>
                    {columns.map((c) => <td key={c.key} className={alignCls(c)}>{c.render ? c.render(r) : r[c.key]}</td>)}
                  </tr>
                  {renderExpanded && open[k] ? <tr className="ss-expanded-row"><td colSpan={columns.length}>{renderExpanded(r)}</td></tr> : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer ? <div className="ss-table-foot">{footer}</div> : null}
    </div>
  );
}

export function SymbolCell({ symbol, name, sub }) {
  return <span><span className="ss-sym">{symbol}</span>{name ? <span className="ss-sym-name"> {name}</span> : null}{sub ? <div className="ss-sym-name">{sub}</div> : null}</span>;
}

/* ───────────── stat tile ───────────── */
export function StatTile({ label, value, sub, verdict, size = 'lg', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={cx('ss-stat', verdict && 'ss-stat-' + verdict, size === 'sm' && 'ss-stat-sm', value === 0 && 'ss-stat-zero')} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="ss-label">{verdict ? <VerdictChip verdict={verdict} size="sm" /> : label}</span>
      <span className="ss-stat-value">{typeof value === 'number' ? numFmt(0).format(value) : value}</span>
      {sub ? <span className="ss-stat-sub">{sub}</span> : null}
    </Tag>
  );
}

/* ───────────── level ladder ───────────── */
export function LevelLadder({ entry, close, stop, trail, t1, t2, matched = true }) {
  const lv = [];
  if (matched && stop != null) lv.push(['stop', 'Stop', stop]);
  if (trail != null) lv.push(['trail', matched ? 'Trail' : 'Trail = stop', trail]);
  if (entry != null) lv.push(['entry', 'Entry', entry]);
  if (matched && t1 != null) lv.push(['t1', 'T1', t1]);
  if (matched && t2 != null) lv.push(['t2', 'T2', t2]);
  const vals = lv.map((l) => l[2]).concat(close != null ? [close] : []);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pos = (v) => 4 + ((v - lo) / span) * 92;
  const effStop = matched ? Math.max(stop ?? -Infinity, trail ?? -Infinity) : trail;
  return (
    <div className="ss">
      <div className="ss-ladder">
        <div className="ss-ladder-track">
          {effStop != null && entry != null ? <span className="ss-ladder-risk" style={{ left: pos(effStop) + '%', width: Math.max(0, pos(entry) - pos(effStop)) + '%' }} /> : null}
          {matched && t2 != null && entry != null ? <span className="ss-ladder-reward" style={{ left: pos(entry) + '%', width: pos(t2) - pos(entry) + '%' }} /> : null}
          {lv.map(([k, , v]) => <span key={k} className={'ss-ladder-tick ss-lv-' + k} style={{ left: pos(v) + '%' }} />)}
          {close != null ? (
            <span className="ss-ladder-close" style={{ left: pos(close) + '%' }}>
              <span className="ss-ladder-close-tag">{fmt.price(close)}</span><span className="ss-ladder-close-pin" />
            </span>
          ) : null}
          {lv.map(([k, lab, v], i) => (
            <span key={'l' + k} className="ss-ladder-lbl" style={{ left: pos(v) + '%', top: i % 2 ? 44 : 20 }}>
              <span className="ss-label">{lab}</span><Num value={v} />
            </span>
          ))}
        </div>
      </div>
      {!matched ? <div className="ss-ladder-note">Unmatched: trailing stop only, no targets.</div> : null}
    </div>
  );
}

/* ───────────── Confluence scorecard ───────────── */
export function Scorecard({ score, conviction, breakdown = {} }) {
  const rows = [['supertrend', 'Supertrend'], ['macd', 'MACD'], ['bb_position', 'BB position'], ['volume', 'Volume']];
  const conv = conviction || '';
  const tone = /HIGH/.test(conv) ? 'accent' : /STRONG/.test(conv) ? 'up' : 'neutral';
  return (
    <div className="ss ss-score">
      <div className="ss-score-head">
        <span className="ss-score-val">{score}</span>
        <span className="ss-label">checks</span>
        <span className="ss-spacer" />
        {conv ? <Badge tone={tone}>{conv.replace('⚡', '').trim()}{/HIGH/.test(conv) ? ' ⚡' : ''}</Badge> : null}
      </div>
      {rows.map(([k, name]) => {
        const raw = breakdown[k] || '';
        const pass = /✓/.test(raw);
        const detail = raw.replace(/[✓✗]|\sX$/g, '').trim();
        return (
          <div key={k} className={cx('ss-score-row', pass ? 'ss-score-pass' : 'ss-score-fail')}>
            <span className="ss-score-mark" aria-label={pass ? 'pass' : 'fail'}>{pass ? '✓' : '✗'}</span>
            <span className="ss-score-name">{name}</span>
            <span className="ss-score-detail">{detail}</span>
          </div>
        );
      })}
      {breakdown.room_to_upper ? (
        <div className="ss-score-row"><span /><span className="ss-score-name ss-muted">Room to upper band</span><span className="ss-score-detail">{breakdown.room_to_upper}</span></div>
      ) : null}
    </div>
  );
}

/* ───────────── mini chart (SVG, for panels; the full chart uses Lightweight Charts with the same tokens) ───────────── */
export function MiniChart({ bars = [], width = 480, height = 220, levels = [], markers = [], ema50, ema200, volume = true, axis = true }) {
  const padR = axis ? 56 : 8, padT = 8, volH = volume ? Math.round(height * 0.18) : 0, priceH = height - padT - volH - 8;
  const n = bars.length || 1, step = (width - padR - 8) / n, bw = Math.max(1, step * 0.62);
  const all = bars.flatMap((b) => [b.h, b.l]).concat(levels.map((l) => l.value));
  const lo = Math.min(...all), hi = Math.max(...all), sp = hi - lo || 1;
  const y = (v) => padT + (1 - (v - lo) / sp) * priceH;
  const x = (i) => 8 + i * step + step / 2;
  const vmax = Math.max(1, ...bars.map((b) => b.v || 0));
  const line = (arr) => arr && arr.map((v, i) => (v == null ? '' : (i && arr[i - 1] != null ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1))).join(' ');
  const grid = [0.25, 0.5, 0.75].map((f) => lo + sp * f);
  return (
    <svg className="ss-chart" width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} role="img" aria-label="Price chart">
      {grid.map((g, i) => <line key={i} className="grid" x1="8" x2={width - padR} y1={y(g)} y2={y(g)} />)}
      {axis ? grid.filter((g) => !levels.some((l) => Math.abs(y(l.value) - y(g)) < 10)).map((g, i) => <text key={'a' + i} className="axis" x={width - padR + 6} y={y(g) + 3}>{fmt.price(g)}</text>) : null}
      {volume ? bars.map((b, i) => { const h = ((b.v || 0) / vmax) * volH; return <rect key={'v' + i} className={b.c >= b.o ? 'vu' : 'vd'} x={x(i) - bw / 2} y={height - h} width={bw} height={h} />; }) : null}
      {bars.map((b, i) => {
        const up = b.c >= b.o, top = y(Math.max(b.o, b.c)), bot = y(Math.min(b.o, b.c));
        return (
          <g key={i} className={up ? 'cu' : 'cd'}>
            <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} strokeWidth="1" />
            <rect x={x(i) - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} />
          </g>
        );
      })}
      {ema50 ? <path className="ema50" d={line(ema50)} /> : null}
      {ema200 ? <path className="ema200" d={line(ema200)} /> : null}
      {levels.map((l, i) => (
        <g key={'l' + i}>
          <line className={'lv lv-' + l.kind} x1="8" x2={width - padR} y1={y(l.value)} y2={y(l.value)} />
          {axis ? <g><rect className={'lv-tag-bg-' + l.kind} x={width - padR + 2} y={y(l.value) - 7} width={padR - 4} height="14" rx="2" />
            <text className="lv-tag lv-tag-tx" x={width - padR + 6} y={y(l.value) + 3.5}>{(l.label ? l.label + ' ' : '') + Math.round(l.value)}</text></g> : null}
        </g>
      ))}
      {markers.map((m, i) => {
        const b = bars[m.index]; if (!b) return null;
        const below = m.kind === 'signal';
        const cy = below ? y(b.l) + 12 : y(b.h) - 12;
        const cls = m.kind === 'signal' ? 'mk-sig' : m.kind === 'demerger' ? 'mk-dem' : 'mk-act';
        return (
          <g key={'m' + i}>
            {m.kind === 'signal' ? <path className={cls} d={'M' + x(m.index) + ' ' + (cy - 6) + 'l5 8h-10z'} /> : <rect className={cls} x={x(m.index) - 7} y={cy - 7} width="14" height="14" rx="2" />}
            {m.kind !== 'signal' ? <text className="mk-tx" x={x(m.index)} y={cy + 3} textAnchor="middle">{m.glyph || 'D'}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

/* ───────────── feedback ───────────── */
const BICON = { failed: '×', degraded: '!', review: '?', info: 'i' };
export function Banner({ tone = 'info', title, children, actions, role }) {
  return (
    <div className={cx('ss', 'ss-banner', 'ss-banner-' + tone)} role={role || (tone === 'failed' ? 'alert' : 'status')}>
      <span className="ss-banner-icon" aria-hidden="true">{BICON[tone]}</span>
      <div className="ss-banner-body">
        <p className="ss-banner-title">{title}</p>
        {children ? <p className="ss-banner-text">{children}</p> : null}
      </div>
      {actions ? <div className="ss-banner-actions">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action, glyph = '— — —' }) {
  return (
    <div className="ss ss-empty">
      <span className="ss-empty-glyph" aria-hidden="true">{glyph}</span>
      <p className="ss-empty-title">{title}</p>
      {children ? <p className="ss-empty-text">{children}</p> : null}
      {action || null}
    </div>
  );
}

/* ───────────── navigation ───────────── */
export const NAV = [
  { id: 'today', label: 'Today', icon: 'today', kbd: 'g t' },
  { id: 'signals', label: 'Signals', icon: 'signals', kbd: 'g s' },
  { id: 'positions', label: 'Positions', icon: 'positions', kbd: 'g p' },
  { id: 'trades', label: 'Trades', icon: 'trades', kbd: 'g r' },
  { id: 'brokers', label: 'Brokers', icon: 'brokers', kbd: 'g b' },
  { id: 'ops', label: 'Data & Ops', icon: 'ops', kbd: 'g o' },
  { section: 'Derivatives' },
  { id: 'options', label: 'Options', icon: 'options', disabled: true, badge: 'Later' },
];
export function NavRail({ items = NAV, current = 'today', counts = {}, user = { name: 'Shyan' }, collapsed, onNavigate }) {
  return (
    <nav className={cx('ss', 'ss-nav', collapsed && 'ss-nav-collapsed')} aria-label="Main">
      <div className="ss-nav-brand"><span className="ss-nav-brand-mark">▮▯</span>{collapsed ? null : 'STOCK SCREEN'}</div>
      <ul className="ss-nav-list">
        {items.map((it, i) => it.section ? (
          collapsed ? null : <li key={'s' + i} className="ss-nav-sect ss-label">{it.section}</li>
        ) : (
          <li key={it.id}>
            <button type="button" className="ss-nav-item" aria-current={it.id === current ? 'page' : undefined} aria-disabled={it.disabled || undefined}
              onClick={() => !it.disabled && onNavigate && onNavigate(it.id)} title={collapsed ? it.label : undefined}>
              <Icon name={it.icon} />
              {collapsed ? null : it.label}
              {!collapsed && counts[it.id] ? <span className="ss-nav-count">{counts[it.id]}</span> : null}
              {!collapsed && it.badge ? <span style={{ marginLeft: 'auto' }}><Badge>{it.badge}</Badge></span> : null}
              {!collapsed && it.kbd ? <Kbd keys={it.kbd} /> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="ss-nav-foot">
        <button type="button" className="ss-nav-item" aria-haspopup="menu"><Icon name="settings" />{collapsed ? null : 'Settings'}</button>
        <button type="button" className="ss-nav-item" aria-haspopup="menu"><span className="ss-avatar">{(user.name || '?').slice(0, 1)}</span>{collapsed ? null : user.name}</button>
      </div>
    </nav>
  );
}

export function SessionBar({ session, pipeline = 'ok', pipelineAt, dataNote, children }) {
  return (
    <div className="ss ss-session" role="banner">
      <span className="ss-session-item"><span className="ss-label">Session</span><span className="ss-session-date">{fmt.date(session, true)}</span></span>
      <span className="ss-session-sep" />
      <span className="ss-session-item ss-muted">EOD · close 15:30 IST</span>
      <span className="ss-session-sep" />
      <span className="ss-session-item"><span className="ss-label">Daily job</span><StatusDot status={pipeline}>{pipeline === 'running' ? 'Running' : pipeline === 'failed' ? 'Failed' : pipeline === 'warning' ? 'Degraded' : 'OK'}{pipelineAt ? ' · ' + fmt.time(pipelineAt) : ''}</StatusDot></span>
      {dataNote ? <><span className="ss-session-sep" /><span className="ss-session-item ss-muted">{dataNote}</span></> : null}
      <span className="ss-spacer" />
      {children}
    </div>
  );
}

export function Tabs({ items, value, onChange, variant = 'tabs', ariaLabel }) {
  const [v, setV] = useState(value ?? (items[0] && items[0].id));
  const cur = value ?? v;
  return (
    <div className={cx('ss', variant === 'segmented' ? 'ss-seg' : 'ss-tabs')} role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" className="ss-tab" aria-selected={cur === it.id} onClick={() => { setV(it.id); onChange && onChange(it.id); }} title={it.title}>
          {it.label}
          {it.count != null ? <span className="ss-tab-count">{it.count}</span> : null}
          {it.experimental ? <span className="ss-tab-exp">EXP</span> : null}
        </button>
      ))}
    </div>
  );
}

export function FilterChip({ label, value, active, onClear, onClick }) {
  const on = active ?? value != null;
  return (
    <button type="button" className={cx('ss', 'ss-fchip', on && 'ss-fchip-on', !on && 'ss-fchip-plus')} onClick={onClick}>
      <span className="ss-fchip-k">{on ? label : '+ ' + label}</span>
      {on && value != null ? <span className="ss-fchip-v">{value}</span> : null}
      {on && onClear ? <span className="ss-fchip-x" role="button" aria-label={'Clear ' + label} onClick={(e) => { e.stopPropagation(); onClear(); }}>×</span> : null}
    </button>
  );
}

/* ───────────── forms ───────────── */
let fid = 0;
export function Field({ label, hint, error, mono, secret, saved, id, ...input }) {
  const ref = useRef(id || 'ss-f' + ++fid);
  const fieldId = ref.current;
  return (
    <div className={cx('ss', 'ss-field', error && 'ss-field-err')}>
      <label className="ss-label" htmlFor={fieldId}>{label}</label>
      {secret && saved ? (
        <div className="ss-secret-saved" id={fieldId}><span className="ss-secret-dots">••••••••</span>Stored encrypted · write-only, never shown again</div>
      ) : (
        <input id={fieldId} className={cx('ss-input', (mono || secret) && 'ss-input-mono')} type={secret ? 'password' : 'text'} autoComplete={secret ? 'off' : undefined} spellCheck={false} aria-invalid={!!error || undefined} {...input} />
      )}
      {error || hint ? <span className="ss-field-hint">{error || hint}</span> : null}
    </div>
  );
}

const REQ = ['trade_date | date', 'symbol | isin', 'side | trade_type', 'quantity', 'price'];
const OPT = ['exchange', 'segment', 'product', 'time', 'trade_id'];
export function FileDrop({ result, onFile, busy }) {
  const [over, setOver] = useState(false);
  const inp = useRef(null);
  const L = result && result.ledger;
  return (
    <div className={cx('ss', 'ss-drop', over && 'ss-drop-over')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && onFile) onFile(f); }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button icon="upload" variant="primary" loading={busy} onClick={() => inp.current && inp.current.click()}>Choose tradebook CSV</Button>
        <span className="ss-muted">or drop the broker’s tradebook export here</span>
        <input ref={inp} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files[0] && onFile && onFile(e.target.files[0])} />
      </div>
      <div>
        <div className="ss-label" style={{ marginBottom: 4 }}>Required columns</div>
        <div className="ss-drop-cols">{REQ.map((c) => <span key={c} className="ss-drop-col">{c}</span>)}</div>
        <div className="ss-label" style={{ margin: '8px 0 4px' }}>Optional</div>
        <div className="ss-drop-cols">{OPT.map((c) => <span key={c} className="ss-drop-col ss-drop-col-opt">{c}</span>)}</div>
      </div>
      {result ? (
        <div className="ss-drop-result">
          {[['Rows read', result.rows], ['Upserted', result.upserted], ['Unmapped', result.unmapped], ['Buys opened', L && L.buys_opened], ['Sells allocated', L && L.sells_allocated], ['Orphan sells', L && L.orphan_sells], ['Errors', L && (Array.isArray(L.errors) ? L.errors.length : L.errors)]].map(([k, v]) => (
            <div key={k} className="ss-drop-kv"><span className="ss-label">{k}</span><span className={cx('ss-n', (k === 'Unmapped' || k === 'Orphan sells' || k === 'Errors') && v > 0 && 'ss-down')}>{v ?? '—'}</span></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── composites ───────────── */
export function PipelineSteps({ steps }) {
  return (
    <ol className="ss ss-steps">
      {steps.map((s, i) => (
        <li key={i} className={cx('ss-step', 'ss-step-' + (s.status || 'pending'))}>
          <StatusDot status={s.status} bare />
          <span className="ss-step-name">{s.name}{s.message ? <span className="ss-step-msg">{s.message}</span> : null}</span>
          <span className="ss-step-counts">{s.counts || ''}</span>
          <span className="ss-step-time">{s.status === 'running' ? (s.progress != null ? Math.round(s.progress * 100) + '%' : '…') : s.finishedAt ? fmt.time(s.finishedAt, false) : '—'}</span>
        </li>
      ))}
    </ol>
  );
}

export function VerdictTimeline({ entries }) {
  return (
    <ol className="ss ss-tl">
      {entries.map((e, i) => {
        const prev = entries[i + 1];
        const changed = prev && prev.verdict !== e.verdict;
        return (
          <li key={e.as_of} className={cx('ss-tl-row', changed && 'ss-tl-change')}>
            <span className="ss-tl-date"><b>{fmt.date(e.as_of).replace(/ \d{4}$/, '')}</b>{e.days_held != null ? ' · d' + e.days_held : ''}</span>
            <span><VerdictChip verdict={e.verdict} size="sm" /></span>
            <span>
              <span className="ss-tl-levels">
                <span><span className="ss-label">Close</span><Num value={e.close} /></span>
                <span><span className="ss-label">Stop</span><Num value={e.stop_level} /></span>
                {e.trail_level != null && e.trail_level !== e.stop_level ? <span><span className="ss-label">Trail</span><Num value={e.trail_level} /></span> : null}
                {e.unrealized_pnl_pct != null ? <span><span className="ss-label">P&amp;L</span><Num kind="frac" value={e.unrealized_pnl_pct} signed tone="auto" /></span> : null}
              </span>
              {(e.reasons && e.reasons.length) || (e.warnings && e.warnings.length) ? <div className="ss-tl-codes"><CodeList reasons={e.reasons} warnings={e.warnings} /></div> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function BrokerCard({ account, lastTradingDay, onTest, onSync, onImport, onDeactivate, busy }) {
  const a = account;
  const failed = a.last_sync_status === 'auth_failed' || a.last_sync_status === 'error';
  const stale = !failed && a.active && a.last_sync_on && lastTradingDay && a.last_sync_on !== lastTradingDay;
  const noClient = a.broker === 'zerodha';
  return (
    <div className={cx('ss', 'ss-broker', failed && 'ss-broker-failed', stale && 'ss-broker-stale', !a.active && 'ss-broker-inactive')}>
      <div className="ss-broker-head">
        <span className="ss-broker-name">{a.label}</span>
        <Badge tone="solid">{a.broker}</Badge>
        {noClient ? <Badge>CSV import only</Badge> : null}
        {!a.active ? <Badge>Inactive</Badge> : null}
        <span className="ss-spacer" />
        <StatusDot status={a.last_sync_status || 'never'} />
      </div>
      <div className="ss-broker-meta">
        <span className="ss-label">Last sync</span>
        <span className={cx('ss-n', stale && 'ss-down')}>{a.last_sync_on ? fmt.date(a.last_sync_on, true) : 'Never'}{stale ? ' · behind' : ''}</span>
        <span className="ss-label">Linked</span><span className="ss-n ss-muted">{fmt.date(a.created_at)}</span>
      </div>
      {a.last_sync_message ? <div className="ss-broker-msg">{a.last_sync_message}</div> : null}
      {failed || stale ? (
        <div className="ss-broker-urgent"><b>Import today’s tradebook.</b> Groww’s API only returns the current day’s trades — fills from {fmt.date(lastTradingDay || a.last_sync_on)} are lost to sync unless you upload the CSV.</div>
      ) : null}
      <div className="ss-broker-actions">
        {failed || stale ? <Button variant="danger" size="sm" icon="upload" onClick={onImport}>Import tradebook CSV</Button> : null}
        <Button size="sm" icon="sync" onClick={onSync} loading={busy} disabled={noClient || !a.active}>Sync now</Button>
        <Button size="sm" onClick={onTest} disabled={noClient || !a.active}>Test connection</Button>
        {!(failed || stale) ? <Button size="sm" variant="ghost" icon="upload" onClick={onImport}>Import CSV</Button> : null}
        <span className="ss-spacer" />
        {a.active ? <Button size="sm" variant="ghost" onClick={onDeactivate}>Deactivate</Button> : null}
      </div>
    </div>
  );
}

export function CorpActionMarker({ type, exDate, subject, showLabel = true }) {
  const [g, name] = labels.actions[type] || ['?', type];
  return (
    <span className={cx('ss', 'ss-ca', 'ss-ca-' + type)} title={subject || name}>
      <span className="ss-ca-glyph" aria-hidden="true">{g}</span>
      {showLabel ? <span>{subject || name}</span> : null}
      {exDate ? <span className="ss-ca-date">ex {fmt.date(exDate)}</span> : null}
      {type === 'demerger' ? <span className="ss-ca-warn">⚠ Not price-adjusted</span> : null}
    </span>
  );
}
