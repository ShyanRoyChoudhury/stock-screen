import { buildWorld, evaluate, candidates, indicators as calcInd, DAYS } from './data.js';
import { SymbolChart } from './chart.jsx';

const React = window.React, ReactDOM = window.ReactDOM;
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const S = window.StockScreen;
const { fmt, labels, Button, Kbd, VerdictChip, CodeTag, CodeList, StatusDot, Badge, StrategyTag, TimeframeBadge, Num, Change, RiskPct, DataTable, SymbolCell,
  StatTile, LevelLadder, Scorecard, MiniChart, Banner, EmptyState, NavRail, SessionBar, Tabs, FilterChip, Field, FileDrop, PipelineSteps, VerdictTimeline, BrokerCard, CorpActionMarker, Icon } = S;

const VORDER = { EXIT: 0, PARTIAL: 1, REVIEW: 2, HOLD: 3 };
const store = { get(k, d) { try { const v = localStorage.getItem('ss:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('ss:' + k, JSON.stringify(v)); } catch (e) {} } };
const day = (ts) => (ts || '').slice(0, 10);
const cx = (...a) => a.filter(Boolean).join(' ');

/* ───────── routing ───────── */
function parseHash() {
  const h = (location.hash || '#/today').slice(2).split('/');
  return { page: h[0] || 'today', arg: h[1] ? decodeURIComponent(h[1]) : null, q: Object.fromEntries(new URLSearchParams((location.hash.split('?')[1]) || '')) };
}
const go = (path) => { location.hash = '#/' + path; };

/* ───────── small UI bits local to the app ───────── */
function Menu({ label, value, options, multi, onChange, onClear }) {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { if (!open) return; const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [open]);
  const sel = multi ? value || [] : value;
  const shown = multi ? (sel.length ? sel.join(', ') : null) : options.find((o) => o.value === sel)?.label ?? null;
  return (
    <span className="app-menu" ref={ref}>
      <FilterChip label={label} value={shown} active={shown != null} onClick={() => setOpen((o) => !o)} onClear={shown != null ? onClear : undefined} />
      {open ? (
        <div className="app-pop" role="listbox">
          {options.map((o) => {
            const on = multi ? sel.includes(o.value) : sel === o.value;
            return (
              <button key={String(o.value)} type="button" role="option" aria-selected={on} className={cx('app-pop-item', on && 'on')}
                onClick={() => { if (multi) onChange(on ? sel.filter((x) => x !== o.value) : [...sel, o.value]); else { onChange(o.value); setOpen(false); } }}>
                <span className="app-check">{on ? (multi ? '■' : '●') : ''}</span><span>{o.label}</span>{o.count != null ? <span className="ss-n ss-muted app-pop-count">{o.count}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
function Toggle({ on, onClick, children, color }) {
  return <button type="button" className={cx('app-toggle', on && 'on')} aria-pressed={on} onClick={onClick}>{color ? <span className="app-swatch" style={{ background: 'var(--' + color + ')' }} /> : null}{children}</button>;
}
function Panel({ title, right, children, pad = true, id }) {
  return <section className="ss-panel app-panel" id={id}>{title ? <div className="ss-panel-head"><h2 className="ss-panel-title">{title}</h2><span className="ss-spacer" />{right}</div> : null}<div className={pad ? 'ss-panel-body' : ''}>{children}</div></section>;
}
function KV({ items }) {
  return <dl className="app-kv">{items.filter(Boolean).map(([k, v], i) => <React.Fragment key={i}><dt className="ss-label">{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
}
function PageHead({ title, sub, children }) {
  return <div className="ss-page-head app-page-head"><h1 className="ss-page-title">{title}</h1>{sub ? <span className="ss-muted">{sub}</span> : null}<span className="ss-spacer" />{children}</div>;
}

/* ───────── derived helpers ───────── */
function rrOf(s) { return fmt.rr(s.entry, s.stop_loss, s.target_1); }
function unrlInr(p) { const e = p.latest_evaluation; return e ? p.qty_open * (e.close - p.avg_entry_price) : null; }
function worst(vs) { return vs.slice().sort((a, b) => VORDER[a] - VORDER[b])[0]; }
function sessionsUntil(from, to) { let n = 0; const d = new Date(from + 'T00:00:00Z'); while (d.toISOString().slice(0, 10) < to) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) n++; } return n; }

/* ═════════ TODAY ═════════ */
function Today({ W, symMap }) {
  const open = W.positions.filter((p) => p.status === 'open');
  const counts = { EXIT: 0, PARTIAL: 0, REVIEW: 0, HOLD: 0 }; const subs = { EXIT: {}, PARTIAL: {}, REVIEW: {}, HOLD: {} };
  open.forEach((p) => { const v = p.last_verdict || 'HOLD'; counts[v]++; (p.latest_evaluation?.reasons || []).slice(0, 1).forEach((r) => (subs[v][r.code] = (subs[v][r.code] || 0) + 1)); });
  const act = open.filter((p) => p.last_verdict && p.last_verdict !== 'HOLD').sort((a, b) => VORDER[a.last_verdict] - VORDER[b.last_verdict]);
  const hold = open.filter((p) => !p.last_verdict || p.last_verdict === 'HOLD');
  const [showHold, setShowHold] = useState(false);
  const failedBrokers = W.broker_accounts.filter((a) => a.active && a.broker !== 'zerodha' && (a.last_sync_status === 'auth_failed' || a.last_sync_status === 'error' || a.last_sync_on !== W.session));
  const sessRuns = W.runs.filter((r) => day(r.started_at) === W.session);
  const ingest = sessRuns.find((r) => r.mode === 'incremental' || r.mode === 'backfill');
  const running = W.runs.find((r) => r.status === 'running');
  const fresh = W.signals.filter((s) => s.timeframe === '1d' && day(s.ts) === W.session);
  const byStrat = {}; fresh.forEach((s) => (byStrat[s.strategy] = (byStrat[s.strategy] || 0) + 1));
  const heldSyms = new Set(open.map((p) => p.symbol));
  const upcoming = W.corporate_actions.filter((a) => heldSyms.has(a.symbol) && a.ex_date > W.session && sessionsUntil(W.session, a.ex_date) <= 5);
  const stepFor = (mode, name) => { const r = sessRuns.find((x) => x.mode === mode); if (!r) return { name, status: 'pending', counts: 'not run' }; return { name, status: r.status === 'completed' ? (r.symbols_failed ? 'warning' : 'ok') : r.status, finishedAt: r.finished_at, counts: r.mode === 'evaluate' ? r.symbols_ok + ' evaluated' : r.mode === 'broker_sync' ? r.symbols_ok + '/' + r.symbols_total + ' accounts' : r.symbols_ok + '/' + r.symbols_total, message: r.status === 'failed' || r.symbols_failed ? r.message : null, progress: r.status === 'running' ? r.symbols_ok / r.symbols_total : null }; };
  const cols = [
    { key: 'v', label: 'Verdict', render: (p) => <VerdictChip verdict={p.last_verdict} size="sm" /> },
    { key: 'symbol', label: 'Symbol', render: (p) => <SymbolCell symbol={p.symbol} /> },
    { key: 'qty', label: 'Qty', align: 'right', render: (p) => <Num kind="qty" value={p.qty_open} /> },
    { key: 'close', label: 'Close ₹', align: 'right', render: (p) => <Num value={p.latest_evaluation?.close} /> },
    { key: 'pnl', label: 'Unrl %', align: 'right', render: (p) => <Num kind="frac" value={p.latest_evaluation?.unrealized_pnl_pct} signed tone="auto" /> },
    { key: 'why', label: 'Why', render: (p) => <CodeList reasons={p.latest_evaluation?.reasons || []} warnings={p.latest_evaluation?.warnings || []} showLabel={false} /> },
    { key: 'm', label: 'Matched', render: (p) => (p.is_unmatched ? <Badge>Unmatched</Badge> : <StrategyTag strategy={p.matched_strategy} extra={' ' + Math.round(p.match_confidence * 100) + '%'} />) },
  ];
  return (
    <div className="ss-page">
      <PageHead title="Today" sub={'Evening brief · ' + fmt.date(W.session, true)} />
      {running ? <Banner tone="info" title={'Run #' + running.id + ' · ' + running.mode + ' in progress'} actions={<Button size="sm" onClick={() => go('ops')}>Open Data &amp; Ops</Button>}>{running.symbols_ok}/{running.symbols_total} symbols. Triggers are disabled until it finishes.</Banner> : null}
      {failedBrokers.map((a) => (
        <Banner key={a.id} tone="failed" title={'Broker sync failed · ' + a.label + ' (' + a.broker + ') · ' + (a.last_sync_status || 'stale')}
          actions={<Button variant="danger" size="sm" icon="upload" onClick={() => go('brokers/' + a.id + '?import=1')}>Import tradebook CSV</Button>}>
          {'Last good sync ' + fmt.date(a.last_sync_on, true) + '. Fills from ' + fmt.date(W.session, true) + ' are lost to the API after today — upload the tradebook CSV before tomorrow’s 16:15 IST run.'}
        </Banner>
      ))}
      {ingest && ingest.status === 'failed' ? <Banner tone="degraded" title={'Degraded: candle ingest failed for ' + fmt.date(W.session, true)}>Signals and verdicts below ran on the previous session’s candles.</Banner> : null}
      {open.length ? (
        <div className="ss-grid-4">
          {['EXIT', 'PARTIAL', 'REVIEW', 'HOLD'].map((v) => <StatTile key={v} verdict={v} value={counts[v]} sub={v === 'HOLD' ? (counts.HOLD ? 'nothing to do' : '—') : Object.entries(subs[v]).map(([k, n]) => k + (n > 1 ? ' ×' + n : '')).join(' · ') || '—'} onClick={() => go('positions?verdict=' + v)} />)}
        </div>
      ) : null}
      <div className="ss-grid-2">
        <div className="app-col">
          {!W.broker_accounts.length ? <Panel title="Positions"><EmptyState title="No broker account linked" action={<Button variant="primary" onClick={() => go('brokers?add=1')}>Add Groww account</Button>}>Positions and verdicts start the evening after your first sync. You can also import a tradebook CSV.</EmptyState></Panel>
            : !open.length ? <Panel title="Positions"><EmptyState title="No open positions">Buys you place at the broker appear here after the next 16:15 IST sync.</EmptyState></Panel>
            : (
              <Panel title="Positions needing action" pad={false} right={<Button size="sm" variant="ghost" kbd="g p" onClick={() => go('positions')}>All positions</Button>}>
                {act.length ? <DataTable ariaLabel="Positions needing action" columns={cols} rows={act} rowKey={(p) => p.id} onRowOpen={(p) => go('position/' + p.id)} />
                  : <EmptyState title="Nothing to act on" glyph="· · ·">All {hold.length} open positions say HOLD.</EmptyState>}
                <div className="ss-table-foot"><button type="button" className="app-link" onClick={() => setShowHold((s) => !s)} aria-expanded={showHold}>{showHold ? '▾' : '▸'} {hold.length} HOLD position{hold.length === 1 ? '' : 's'}</button><span className="ss-spacer" /><span>as of close {fmt.date(W.session)}</span></div>
                {showHold ? <DataTable ariaLabel="HOLD positions" columns={cols} rows={hold} rowKey={(p) => p.id} onRowOpen={(p) => go('position/' + p.id)} /> : null}
              </Panel>
            )}
        </div>
        <div className="app-col">
          <Panel title="Daily job" right={<span className="ss-muted ss-n app-small">{fmt.date(W.session)}</span>}>
            <PipelineSteps steps={[stepFor('incremental', 'Ingest candles'), stepFor('indicators', 'Indicators'), stepFor('signals', 'Signals'), stepFor('broker_sync', 'Broker sync'), stepFor('evaluate', 'Evaluate positions')]} />
          </Panel>
          <Panel title="Fresh 1d signals" right={<><span className="ss-muted ss-n app-small">{fresh.length} · {new Set(fresh.map((s) => s.symbol)).size} symbols</span><Button size="sm" variant="ghost" kbd="g s" onClick={() => go('signals')}>Signals</Button></>}>
            <div className="app-strat-grid">
              {Object.keys(labels.strategies).sort((a, b) => (byStrat[b] || 0) - (byStrat[a] || 0)).map((k) => (
                <button type="button" key={k} className="app-strat-row" onClick={() => go('signals?strategy=' + k + '&days=1')}>
                  <StrategyTag strategy={k} /><span className={cx('ss-n', !byStrat[k] && 'ss-faint')}>{byStrat[k] || 0}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Ex-dates on held symbols · next 5 sessions">
            {upcoming.length ? <div className="app-col" style={{ gap: 8 }}>{upcoming.map((a, i) => (
              <div key={i} className="app-row"><button type="button" className="app-link ss-sym" onClick={() => go('symbol/' + a.symbol)}>{a.symbol}</button><CorpActionMarker type={a.action_type} subject={a.subject} exDate={a.ex_date} /></div>
            ))}<span className="ss-muted app-small">The broker may cancel GTT stop orders on the ex-date. Re-place them after.</span></div> : <span className="ss-muted">None.</span>}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ═════════ SIGNALS ═════════ */
function Signals({ W, symMap, prefs, q }) {
  const [tab, setTab] = useState(q.tab || (q.strategy === 'Confluence' ? 'state' : 'event'));
  const [tf, setTf] = useState(prefs.tf || '1d');
  const [days, setDays] = useState(+(q.days || 3));
  const [strats, setStrats] = useState(q.strategy && q.strategy !== 'Confluence' ? [q.strategy] : []);
  const [industry, setIndustry] = useState(null);
  const [maxRisk, setMaxRisk] = useState(null);
  const [minRR, setMinRR] = useState(null);
  const [conv, setConv] = useState(null);
  const [mode, setMode] = useState(null);
  const [limit, setLimit] = useState(100);
  const cutoff = DAYS[Math.max(0, DAYS.indexOf(W.session) - days + 1)] || W.session;
  const inWindow = W.signals.filter((s) => s.timeframe === tf && day(s.ts) >= cutoff);
  const conflSet = useMemo(() => new Set(W.signals.filter((s) => s.strategy === 'Confluence' && s.timeframe === tf).map((s) => s.symbol + day(s.ts))), [W.signals, tf]);
  const rows = inWindow.filter((s) => (tab === 'state' ? s.strategy === 'Confluence' : s.strategy !== 'Confluence'))
    .filter((s) => !strats.length || strats.includes(s.strategy))
    .filter((s) => !industry || symMap[s.symbol]?.industry === industry)
    .filter((s) => maxRisk == null || s.risk_pct <= maxRisk)
    .filter((s) => minRR == null || (rrOf(s) ?? -1) >= minRR)
    .filter((s) => !conv || (s.details.conviction || '').startsWith(conv))
    .filter((s) => !mode || s.entry_mode === mode);
  const nEvent = inWindow.filter((s) => s.strategy !== 'Confluence').length, nState = inWindow.length - nEvent;
  const industries = [...new Set(W.symbols.map((s) => s.industry))].sort();
  const cols = [
    { key: 'symbol', label: 'Symbol', sortable: true, render: (s) => <span className="app-row" style={{ gap: 6 }}><button type="button" className="app-link ss-sym" onClick={(e) => { e.stopPropagation(); go('symbol/' + s.symbol + '?sig=' + s.strategy + '@' + day(s.ts)); }}>{s.symbol}</button>{s.strategy !== 'Confluence' && conflSet.has(s.symbol + day(s.ts)) ? <Badge title="A Confluence state holds on the same bar">+CONF</Badge> : null}</span> },
    { key: 'name', label: 'Name', render: (s) => <span className="ss-muted app-trunc">{symMap[s.symbol]?.name}</span> },
    { key: 'industry', label: 'Industry', sortable: true, sortValue: (s) => symMap[s.symbol]?.industry, render: (s) => <span className="ss-muted app-trunc app-trunc-s">{symMap[s.symbol]?.industry}</span> },
    { key: 'strategy', label: 'Strategy', sortable: true, render: (s) => <StrategyTag strategy={s.strategy} extra={s.entry_mode || (s.details.conviction ? s.details.conviction.replace(' ⚡', '⚡') : null)} /> },
    { key: 'tf', label: 'TF', render: (s) => <TimeframeBadge timeframe={s.timeframe} /> },
    { key: 'ts', label: 'Signal date', sortable: true, render: (s) => <span className="ss-n">{fmt.date(s.ts)}</span> },
    { key: 'entry', label: 'Entry ₹', align: 'right', sortable: true, render: (s) => <Num value={s.entry} /> },
    { key: 'stop_loss', label: 'Stop', align: 'right', render: (s) => <Num value={s.stop_loss} /> },
    { key: 'risk_pct', label: 'Risk %', align: 'right', sortable: true, render: (s) => <RiskPct value={s.risk_pct} /> },
    { key: 'target_1', label: 'T1', align: 'right', render: (s) => <Num value={s.target_1} /> },
    { key: 'target_2', label: 'T2', align: 'right', render: (s) => <Num value={s.target_2} /> },
    { key: 'rr', label: 'R:R', align: 'right', sortable: true, sortValue: rrOf, title: '(T1 − entry) / (entry − stop), computed client-side', render: (s) => <Num kind="rr" value={rrOf(s)} className={rrOf(s) != null && rrOf(s) < 1 ? 'ss-muted' : ''} /> },
  ];
  const clearAll = () => { setStrats([]); setIndustry(null); setMaxRisk(null); setMinRR(null); setConv(null); setMode(null); };
  return (
    <div className="ss-page">
      <PageHead title="Signals" sub={rows.length + ' setups · last ' + days + ' session' + (days > 1 ? 's' : '') + ' · ' + tf}>
        <Tabs variant="segmented" ariaLabel="Timeframe" value={tf} onChange={setTf} items={[{ id: '1d', label: '1d' }].concat(prefs.intraday ? [{ id: '4h', label: '4h', experimental: true }, { id: '1h', label: '1h', experimental: true }] : [])} />
      </PageHead>
      <Tabs value={tab} onChange={setTab} ariaLabel="Signal type" items={[{ id: 'event', label: 'Event signals', count: nEvent }, { id: 'state', label: 'Confluence', count: nState, title: 'A state, not an event: fires on ~23% of daily bars' }]} />
      <div className="app-filters">
        <Menu label="Fresh" value={days} onChange={setDays} options={[1, 3, 5, 10, 20, 30].map((d) => ({ value: d, label: '≤ ' + d + ' session' + (d > 1 ? 's' : '') }))} />
        {tab === 'event' ? <Menu label="Strategy" multi value={strats} onChange={setStrats} onClear={() => setStrats([])} options={Object.keys(labels.strategies).filter((k) => k !== 'Confluence').map((k) => ({ value: k, label: k, count: inWindow.filter((s) => s.strategy === k).length }))} /> : null}
        <Menu label="Industry" value={industry} onChange={setIndustry} onClear={() => setIndustry(null)} options={industries.map((i) => ({ value: i, label: i }))} />
        <Menu label="Max risk" value={maxRisk} onChange={setMaxRisk} onClear={() => setMaxRisk(null)} options={[1, 3, 5, 8, 12].map((v) => ({ value: v, label: '≤ ' + v + '%' }))} />
        <Menu label="Min R:R" value={minRR} onChange={setMinRR} onClear={() => setMinRR(null)} options={[0.5, 1, 1.5, 2].map((v) => ({ value: v, label: '≥ ' + v.toFixed(1) }))} />
        {tab === 'state' ? <Menu label="Conviction" value={conv} onChange={setConv} onClear={() => setConv(null)} options={['HIGH', 'STRONG', 'MODERATE'].map((v) => ({ value: v, label: v }))} /> : null}
        {tab === 'event' && (!strats.length || strats.includes('PIPELINE')) ? <Menu label="Entry mode" value={mode} onChange={setMode} onClear={() => setMode(null)} options={[{ value: 'IMMEDIATE', label: 'IMMEDIATE' }, { value: 'RETEST', label: 'RETEST' }]} /> : null}
        <span className="ss-spacer" />
        <Button size="sm" variant="ghost" onClick={clearAll}>Reset filters</Button>
      </div>
      {tf !== '1d' ? <Banner tone="review" title={tf + ' is experimental'}>The Yahoo hourly feed doesn’t reconcile with daily bars and ~13% of hourly bars have zero volume. Don’t trade these off this feed.</Banner> : null}
      {tf !== '1d' && !rows.length ? <Panel><EmptyState title={'No ' + tf + ' signals in this data'}>The sample carries daily bars only. A snapshot with 4h/1h signals would show them here, badged EXP.</EmptyState></Panel> : (
        <DataTable key={tab + tf} ariaLabel="Signals" density={prefs.density} columns={cols} rows={rows.slice(0, limit)} rowKey={(s) => s.symbol + s.strategy + s.ts}
          initialSort={{ key: 'ts', dir: 'desc' }} rowClassName={(s) => (s.strategy === 'Confluence' && tab !== 'state' ? 'ss-dim' : undefined)}
          renderExpanded={(s) => <SignalDetail s={s} W={W} symMap={symMap} />}
          footer={<><span>{Math.min(limit, rows.length)} of {rows.length} shown</span>{rows.length > limit ? <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 200)}>Show 200 more</Button> : null}<span className="ss-spacer" /><span className="app-hide-sm">R:R computed client-side · ↑↓ / j k move · ↵ expand</span></>} />
      )}
    </div>
  );
}
function SignalDetail({ s, W, symMap }) {
  const c = W.candles[s.symbol] || []; const i = c.findIndex((b) => b.ts === s.ts); const end = i >= 0 ? Math.min(c.length, i + 15) : c.length;
  const bars = c.slice(Math.max(0, end - 70), end).map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
  const mi = i >= 0 ? i - Math.max(0, end - 70) : -1;
  const d = s.details || {};
  return (
    <div className="app-sigd">
      <div className="app-sigd-l">
        {s.strategy === 'Confluence' ? <Scorecard score={d.score} conviction={d.conviction} breakdown={d.breakdown || {}} /> : (
          <KV items={Object.entries(d).map(([k, v]) => [k.replace(/_/g, ' '), <span className="ss-n">{typeof v === 'number' ? (k.includes('ratio') || k === 'rvol' ? fmt.mult(v) : k === 'bandwidth' ? fmt.frac(v, 2, false) : k === 'momentum' ? v.toFixed(4) : fmt.price(v)) : String(v)}</span>])} />
        )}
        {s.strategy === 'PIPELINE' && s.entry_mode === 'RETEST' ? <span className="ss-muted app-small">RETEST logic has a known defect (tests continuation, not a true retest).</span> : null}
        <div className="app-row"><Button size="sm" variant="primary" icon="symbol" onClick={() => go('symbol/' + s.symbol + '?sig=' + s.strategy + '@' + day(s.ts))}>Open chart</Button><span className="ss-muted app-small">{symMap[s.symbol]?.name}</span></div>
      </div>
      {bars.length ? <div className="app-sigd-r"><MiniChart bars={bars} width={440} height={180} levels={[{ kind: 't2', label: 'T2', value: s.target_2 }, { kind: 't1', label: 'T1', value: s.target_1 }, { kind: 'entry', label: 'E', value: s.entry }, { kind: 'stop', label: 'SL', value: s.stop_loss }]} markers={mi >= 0 ? [{ index: mi, kind: 'signal' }] : []} /></div> : null}
    </div>
  );
}

/* ═════════ SYMBOL ═════════ */
function SymbolPage({ W, symMap, sym, q, prefs, themeKey }) {
  const meta = symMap[sym];
  const c = W.candles[sym]; const ind = W.indicators[sym];
  const sigs = W.signals.filter((s) => s.symbol === sym && s.timeframe === '1d');
  const acts = W.corporate_actions.filter((a) => a.symbol === sym);
  const pos = W.positions.filter((p) => p.symbol === sym);
  const [sel, setSel] = useState(q.sig || null);
  const [ov, setOv] = useState(store.get('overlays', { ema50: true, ema200: true, st: true, bb: false, kc: false, macd: true }));
  useEffect(() => store.set('overlays', ov), [ov]);
  const selSig = sigs.find((s) => s.strategy + '@' + day(s.ts) === sel);
  if (!meta) return <div className="ss-page"><EmptyState title={sym + ' is not in the universe'}>Only Nifty 500 symbols are screened.</EmptyState></div>;
  const last = c && c[c.length - 1], prev = c && c[c.length - 2], x = ind && ind[ind.length - 1];
  const openLots = pos.filter((p) => p.status === 'open');
  const dem = acts.find((a) => a.action_type === 'demerger');
  const levels = selSig ? [['entry', selSig.entry, 'Entry'], ['stop', selSig.stop_loss, 'SL'], ['t1', selSig.target_1, 'T1'], ['t2', selSig.target_2, 'T2']]
    : openLots.length === 1 && openLots[0].latest_evaluation ? posLevels(openLots[0]) : [];
  return (
    <div className="ss-page">
      <div className="app-symhead">
        <div>
          <div className="app-row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}><h1 className="ss-page-title app-mono">{sym}</h1><span className="ss-muted">{meta.name}</span></div>
          <div className="app-row ss-muted app-small" style={{ gap: 12, flexWrap: 'wrap' }}><span>{meta.industry}</span><span className="ss-n">{meta.isin}</span>{openLots.length ? <button type="button" className="app-link" onClick={() => go('positions?symbol=' + sym)}>Held · {openLots.length} lot{openLots.length > 1 ? 's' : ''}</button> : null}</div>
        </div>
        {last ? <div className="app-symprice"><span className="ss-label">Close {fmt.date(last.ts)}</span><span className="app-row" style={{ gap: 10, alignItems: 'baseline' }}><span className="ss-n app-num-lg"><span className="ss-muted">₹</span>{fmt.price(last.close)}</span><Change abs={last.close - prev.close} frac={last.close / prev.close - 1} /></span></div> : null}
        {x ? <div className="app-snap">
          <SnapItem k="vs EMA50" v={x.ema_50 == null ? '—' : last.close > x.ema_50 ? 'Above' : 'Below'} tone={x.ema_50 == null ? null : last.close > x.ema_50 ? 'up' : 'down'} sub={x.ema_50 && fmt.price(x.ema_50)} />
          <SnapItem k="vs EMA200" v={x.ema_200 == null ? '—' : last.close > x.ema_200 ? 'Above' : 'Below'} tone={x.ema_200 == null ? null : last.close > x.ema_200 ? 'up' : 'down'} sub={x.ema_200 && fmt.price(x.ema_200)} />
          <SnapItem k="Supertrend" v={x.supertrend_dir === 1 ? '▲ Bull' : '▼ Bear'} tone={x.supertrend_dir === 1 ? 'up' : 'down'} sub={fmt.price(x.supertrend_10_3)} />
          <SnapItem k="ADX 14" v={x.adx_14 == null ? '—' : x.adx_14.toFixed(1)} sub={x.adx_14 > 25 ? 'trending' : 'weak'} />
          <SnapItem k="RVOL 20" v={x.rvol_20 == null ? '—' : fmt.mult(x.rvol_20)} sub={'vol ' + fmt.qty(last.volume)} />
        </div> : null}
      </div>
      {dem ? <Banner tone="review" title={'Demerger ex ' + fmt.date(dem.ex_date) + ' — price history is not demerger-adjusted'}>The drop at the marker is a false cliff. Treat indicators and signals spanning it as suspect.</Banner> : null}
      <div className="app-toolbar">
        <Tabs variant="segmented" ariaLabel="Timeframe" value="1d" items={[{ id: '1d', label: '1d' }].concat(prefs.intraday ? [{ id: '4h', label: '4h', experimental: true, title: 'Not in this data' }, { id: '1h', label: '1h', experimental: true, title: 'Not in this data' }] : [])} />
        <span className="app-sep" />
        <Toggle on={ov.ema50} onClick={() => setOv({ ...ov, ema50: !ov.ema50 })} color="ema-50">EMA 50</Toggle>
        <Toggle on={ov.ema200} onClick={() => setOv({ ...ov, ema200: !ov.ema200 })} color="ema-200">EMA 200</Toggle>
        <Toggle on={ov.st} onClick={() => setOv({ ...ov, st: !ov.st })} color="up">Supertrend</Toggle>
        <Toggle on={ov.bb} onClick={() => setOv({ ...ov, bb: !ov.bb })} color="bb-band">Bollinger</Toggle>
        <Toggle on={ov.kc} onClick={() => setOv({ ...ov, kc: !ov.kc })} color="kc-band">Keltner</Toggle>
        <span className="app-sep" />
        <Toggle on={ov.macd} onClick={() => setOv({ ...ov, macd: !ov.macd })}>MACD pane</Toggle>
        {selSig ? <><span className="ss-spacer" /><Badge tone="accent">{selSig.strategy} · {fmt.date(selSig.ts)}</Badge><Button size="sm" variant="ghost" onClick={() => setSel(null)}>Clear levels</Button></> : null}
      </div>
      {c ? <SymbolChart key={sym + themeKey} candles={c} ind={ind} signals={sigs} actions={acts} positions={pos} overlays={ov} levels={levels} selected={selSig} onPickSignal={(s) => setSel(s.strategy + '@' + day(s.ts))} /> : <Panel><EmptyState title="No candles for this symbol">The loaded snapshot has no 1d candles for {sym}.</EmptyState></Panel>}
      <div className="ss-grid-2">
        <Panel title={'Signals · ' + sym} pad={false} right={<span className="ss-muted app-small">select one to draw its levels</span>}>
          {sigs.length ? <DataTable ariaLabel="Signals for symbol" density="compact" maxHeight={320} columns={[
            { key: 'ts', label: 'Date', render: (s) => <span className="ss-n">{fmt.date(s.ts)}</span> },
            { key: 'strategy', label: 'Strategy', render: (s) => <StrategyTag strategy={s.strategy} extra={s.entry_mode} /> },
            { key: 'entry', label: 'Entry', align: 'right', render: (s) => <Num value={s.entry} /> },
            { key: 'stop', label: 'Stop', align: 'right', render: (s) => <Num value={s.stop_loss} /> },
            { key: 'risk', label: 'Risk', align: 'right', render: (s) => <RiskPct value={s.risk_pct} /> },
            { key: 'rr', label: 'R:R', align: 'right', render: (s) => <Num kind="rr" value={rrOf(s)} /> },
          ]} rows={sigs.filter((s) => s.strategy !== 'Confluence' || s === selSig).concat(sigs.filter((s) => s.strategy === 'Confluence' && s !== selSig).slice(0, 12))} rowKey={(s) => s.strategy + s.ts} onRowOpen={(s) => setSel(s.strategy + '@' + day(s.ts))} rowClassName={(s) => (s === selSig ? 'ss-cursor' : s.strategy === 'Confluence' ? 'ss-dim' : undefined)} />
            : <EmptyState title="No signals">No strategy has fired on this symbol in the loaded range.</EmptyState>}
        </Panel>
        <div className="app-col">
          {pos.length ? <Panel title="Your lots">
            <div className="app-col" style={{ gap: 6 }}>{pos.map((p) => (
              <button type="button" key={p.id} className="app-lot" onClick={() => go('position/' + p.id)}>
                <span className="ss-n">#{p.id}</span><span className="ss-n">{p.status === 'open' ? p.qty_open : p.qty_total} @ {fmt.price(p.avg_entry_price)}</span>
                <span className="ss-muted app-small">{fmt.date(p.opened_on)}{p.closed_on ? ' → ' + fmt.date(p.closed_on) : ''}</span><span className="ss-spacer" />
                {p.status === 'open' ? <VerdictChip verdict={p.last_verdict} size="sm" /> : <Num kind="frac" value={p.realized_pnl_pct} signed tone="auto" />}
              </button>))}</div>
          </Panel> : null}
          <Panel title="Corporate actions">
            {acts.length ? <div className="app-col" style={{ gap: 8 }}>{acts.map((a, i) => <CorpActionMarker key={i} type={a.action_type} subject={a.subject} exDate={a.ex_date} />)}</div> : <span className="ss-muted">None in the loaded range.</span>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
function SnapItem({ k, v, sub, tone }) { return <div className="app-snap-i"><span className="ss-label">{k}</span><span className={cx('ss-n', tone && 'ss-' + tone)}>{v}</span>{sub ? <span className="ss-n ss-faint app-small">{sub}</span> : null}</div>; }
function posLevels(p) {
  const e = p.latest_evaluation; const L = [['entry', p.avg_entry_price, 'Entry']];
  if (!p.is_unmatched) { L.push(['stop', e.stop_level, 'SL'], ['t1', e.target_1, 'T1'], ['t2', e.target_2, 'T2']); if (e.trail_level > e.stop_level) L.push(['trail', e.trail_level, 'Trail']); }
  else L.push(['trail', e.trail_level, 'Trail=SL']);
  return L;
}

/* ═════════ POSITIONS ═════════ */
function Positions({ W, symMap, prefs, q }) {
  const [tab, setTab] = useState(q.tab || (prefs.groupBySymbol ? 'sym' : 'open'));
  const [vf, setVf] = useState(q.verdict || null);
  const [symF, setSymF] = useState(q.symbol || null);
  const open = W.positions.filter((p) => p.status === 'open'), closed = W.positions.filter((p) => p.status === 'closed');
  const rows = open.filter((p) => (!vf || p.last_verdict === vf) && (!symF || p.symbol === symF));
  const openCols = [
    { key: 'symbol', label: 'Symbol', sortable: true, render: (p) => <span><span className="ss-sym">{p.symbol}</span> <span className="ss-faint ss-n app-small">#{p.id}</span></span> },
    { key: 'qty', label: 'Qty', align: 'right', render: (p) => <span className="ss-n">{p.qty_open}<span className="ss-faint">/{p.qty_total}</span></span> },
    { key: 'avg', label: 'Avg entry', align: 'right', title: 'Adjusted terms — comparable to the chart', render: (p) => <Num value={p.avg_entry_price} /> },
    { key: 'raw', label: 'As paid', align: 'right', title: 'What you actually paid; differs only after a split/bonus', render: (p) => <span title={p.structural_factor_applied !== 1 ? 'factor ' + p.structural_factor_applied : undefined}><Num value={p.avg_entry_price_raw} className={p.structural_factor_applied === 1 ? 'ss-muted' : ''} /></span> },
    { key: 'close', label: 'Last', align: 'right', render: (p) => <Num value={p.latest_evaluation?.close} /> },
    { key: 'pnl', label: 'Unrl %', align: 'right', sortable: true, sortValue: (p) => p.latest_evaluation?.unrealized_pnl_pct, render: (p) => <Num kind="frac" value={p.latest_evaluation?.unrealized_pnl_pct} signed tone="auto" /> },
    { key: 'inr', label: 'Unrl ₹', align: 'right', sortable: true, sortValue: unrlInr, render: (p) => <Num kind="inr" value={unrlInr(p)} signed tone="auto" /> },
    { key: 'days', label: 'Days', align: 'right', sortable: true, sortValue: (p) => p.latest_evaluation?.days_held, render: (p) => <Num kind="int" value={p.latest_evaluation?.days_held} /> },
    { key: 'stop', label: 'Stop', align: 'right', render: (p) => <Num value={p.latest_evaluation?.stop_level} /> },
    { key: 'trail', label: 'Trail', align: 'right', render: (p) => <Num value={p.latest_evaluation?.trail_level} className="ss-muted" /> },
    { key: 't1', label: 'T1', align: 'right', render: (p) => (p.is_unmatched ? <span className="ss-faint">—</span> : <Num value={p.frozen_target_1} />) },
    { key: 't2', label: 'T2', align: 'right', render: (p) => (p.is_unmatched ? <span className="ss-faint">—</span> : <Num value={p.frozen_target_2} />) },
    { key: 'verdict', label: 'Verdict', sortable: true, sortValue: (p) => VORDER[p.last_verdict], render: (p) => <VerdictChip verdict={p.last_verdict} size="sm" /> },
    { key: 'why', label: 'Reasons · warnings', render: (p) => <CodeList reasons={p.latest_evaluation?.reasons || []} warnings={p.latest_evaluation?.warnings || []} showLabel={false} /> },
    { key: 'm', label: 'Matched', render: (p) => (p.is_unmatched ? <Badge title="Trailing stop only, no targets">Unmatched</Badge> : <StrategyTag strategy={p.matched_strategy} extra={' ' + Math.round(p.match_confidence * 100) + '%'} />) },
  ];
  const closedCols = [
    { key: 'symbol', label: 'Symbol', sortable: true, render: (p) => <span className="ss-sym">{p.symbol}</span> },
    { key: 'opened_on', label: 'Opened', sortable: true, render: (p) => <span className="ss-n">{fmt.date(p.opened_on)}</span> },
    { key: 'closed_on', label: 'Closed', sortable: true, render: (p) => <span className="ss-n">{fmt.date(p.closed_on)}</span> },
    { key: 'qty_total', label: 'Qty', align: 'right', render: (p) => <Num kind="qty" value={p.qty_total} /> },
    { key: 'avg', label: 'Entry', align: 'right', render: (p) => <Num value={p.avg_entry_price} /> },
    { key: 'realized_pnl', label: 'Realised ₹ (gross)', align: 'right', sortable: true, render: (p) => <Num kind="inr" value={p.realized_pnl} signed tone="auto" /> },
    { key: 'realized_pnl_pct', label: 'Realised %', align: 'right', sortable: true, render: (p) => <Num kind="frac" value={p.realized_pnl_pct} signed tone="auto" /> },
    { key: 'strat', label: 'Strategy', render: (p) => (p.matched_strategy ? <StrategyTag strategy={p.matched_strategy} /> : <Badge>Unmatched</Badge>) },
    { key: 'exit', label: 'Exit on', render: (p) => (p.exit_reason ? <CodeTag code={p.exit_reason} showLabel={false} /> : <span className="ss-faint">—</span>) },
  ];
  const groups = Object.values(open.reduce((m, p) => { const g = (m[p.symbol] = m[p.symbol] || { symbol: p.symbol, lots: [], qty: 0, cost: 0 }); g.lots.push(p); g.qty += p.qty_open; g.cost += p.qty_open * p.avg_entry_price; return m; }, {}))
    .map((g) => ({ ...g, avg: g.cost / g.qty, close: g.lots[0].latest_evaluation?.close, verdict: worst(g.lots.map((l) => l.last_verdict || 'HOLD')) }));
  const totalR = closed.reduce((s, p) => s + (p.realized_pnl || 0), 0);
  const byStrat = Object.values(closed.reduce((m, p) => { const k = p.matched_strategy || 'Unmatched'; const g = (m[k] = m[k] || { k, n: 0, win: 0, pnl: 0 }); g.n++; if (p.realized_pnl > 0) g.win++; g.pnl += p.realized_pnl; return m; }, {}));
  return (
    <div className="ss-page">
      <PageHead title="Positions" sub={open.length + ' open lots · ' + groups.length + ' symbols · as of ' + fmt.date(W.session)} />
      <Tabs value={tab} onChange={setTab} ariaLabel="Positions" items={[{ id: 'open', label: 'Open lots', count: open.length }, { id: 'sym', label: 'By symbol', count: groups.length }, { id: 'closed', label: 'Closed', count: closed.length }]} />
      {tab === 'open' ? <>
        <div className="app-filters">
          <Menu label="Verdict" value={vf} onChange={setVf} onClear={() => setVf(null)} options={['EXIT', 'PARTIAL', 'REVIEW', 'HOLD'].map((v) => ({ value: v, label: v, count: open.filter((p) => p.last_verdict === v).length }))} />
          <Menu label="Symbol" value={symF} onChange={setSymF} onClear={() => setSymF(null)} options={groups.map((g) => ({ value: g.symbol, label: g.symbol, count: g.lots.length }))} />
          <span className="ss-spacer" /><span className="ss-muted app-small">One row per BUY fill (lot). SELLs close lots oldest-first.</span>
        </div>
        {rows.length ? <DataTable ariaLabel="Open positions" density={prefs.density} columns={openCols} rows={rows} rowKey={(p) => p.id} initialSort={{ key: 'verdict', dir: 'asc' }} onRowOpen={(p) => go('position/' + p.id)}
          footer={<><span>{rows.length} lots</span><span className="ss-spacer" /><span>Unrealised total <Num kind="inr" value={rows.reduce((s, p) => s + (unrlInr(p) || 0), 0)} signed tone="auto" /></span></>} />
          : <Panel><EmptyState title="No positions match">Clear the filters to see every open lot.</EmptyState></Panel>}
      </> : null}
      {tab === 'sym' ? <DataTable ariaLabel="Positions by symbol" columns={[
        { key: 'symbol', label: 'Symbol', render: (g) => <span className="ss-sym">{g.symbol}</span> },
        { key: 'lots', label: 'Lots', align: 'right', render: (g) => <Num kind="int" value={g.lots.length} /> },
        { key: 'qty', label: 'Qty', align: 'right', render: (g) => <Num kind="qty" value={g.qty} /> },
        { key: 'avg', label: 'Wtd avg entry', align: 'right', render: (g) => <Num value={g.avg} /> },
        { key: 'close', label: 'Last', align: 'right', render: (g) => <Num value={g.close} /> },
        { key: 'pnl', label: 'Unrl %', align: 'right', render: (g) => <Num kind="frac" value={g.close / g.avg - 1} signed tone="auto" /> },
        { key: 'inr', label: 'Unrl ₹', align: 'right', render: (g) => <Num kind="inr" value={g.qty * (g.close - g.avg)} signed tone="auto" /> },
        { key: 'v', label: 'Worst verdict', render: (g) => <VerdictChip verdict={g.verdict} size="sm" /> },
      ]} rows={groups} rowKey={(g) => g.symbol} onRowOpen={(g) => (g.lots.length === 1 ? go('position/' + g.lots[0].id) : (setSymF(g.symbol), setTab('open')))} /> : null}
      {tab === 'closed' ? <div className="ss-grid-2">
        <DataTable ariaLabel="Closed positions" columns={closedCols} rows={closed} rowKey={(p) => p.id} initialSort={{ key: 'closed_on', dir: 'desc' }}
          footer={<><span>{closed.length} closed</span><span className="ss-spacer" /><span>Realised (gross, before brokerage and taxes) <Num kind="inr" value={totalR} signed tone="auto" /></span></>} />
        <Panel title="By matched strategy" right={<span className="ss-muted app-small">computed client-side</span>}>
          <div className="app-strat-grid app-strat-3">{byStrat.map((g) => <React.Fragment key={g.k}>{g.k === 'Unmatched' ? <Badge>Unmatched</Badge> : <StrategyTag strategy={g.k} />}<span className="ss-n ss-muted">{g.win}/{g.n} won</span><Num kind="inr" value={g.pnl} signed tone="auto" /></React.Fragment>)}</div>
        </Panel>
      </div> : null}
    </div>
  );
}

/* ═════════ POSITION DETAIL ═════════ */
function PositionPage({ W, id, update, toast, themeKey }) {
  const p = W.positions.find((x) => String(x.id) === String(id));
  const [rematch, setRematch] = useState(false);
  const [pick, setPick] = useState(null);
  const [allEv, setAllEv] = useState(false);
  if (!p) return <div className="ss-page"><EmptyState title={'Position #' + id + ' not found'} action={<Button onClick={() => go('positions')}>All positions</Button>} /></div>;
  const ev = W.evaluations[p.id] || []; const e = p.latest_evaluation;
  const fills = W.trades.filter((t) => t.position_id === p.id);
  const buy = fills.find((t) => t.side === 'BUY');
  const cands = buy ? candidates(W.signals, p.symbol, p.opened_on, buy.price) : [];
  const idx = DAYS.indexOf(p.opened_on); const since = DAYS[Math.max(0, idx - 5)];
  const allC = W.signals.filter((s) => s.symbol === p.symbol && s.timeframe === '1d' && day(s.ts) >= since && day(s.ts) <= p.opened_on);
  const doMatch = () => {
    const s = allC.find((x) => x.strategy + x.ts === pick); if (!s) return;
    const np = { ...p, matched_strategy: s.strategy, matched_signal_ts: s.ts, matched_timeframe: '1d', match_confidence: 1, match_reason: 'manual', is_unmatched: false, frozen_entry: s.entry, frozen_stop: s.stop_loss, frozen_target_1: s.target_1, frozen_target_2: s.target_2, frozen_details: s.details };
    const nev = W.candles[p.symbol] ? evaluate(np, W.candles[p.symbol], W.indicators[p.symbol], W.corporate_actions) : ev;
    np.latest_evaluation = nev[0]; np.last_verdict = nev[0]?.verdict;
    update((w) => ({ ...w, positions: w.positions.map((x) => (x.id === p.id ? np : x)), evaluations: { ...w.evaluations, [p.id]: nev } }));
    setRematch(false); toast('Matched #' + p.id + ' to ' + s.strategy + ' @' + day(s.ts) + ' · re-evaluated: ' + (nev[0]?.verdict || '—') + ' (preview only — POST /positions/' + p.id + '/match not sent)');
  };
  return (
    <div className="ss-page">
      <div className="app-crumbs"><button type="button" className="app-link" onClick={() => go('positions')}>Positions</button><span className="ss-faint">/</span><span className="ss-n">#{p.id}</span></div>
      <PageHead title={<span className="app-mono">{p.symbol} <span className="ss-muted ss-n" style={{ fontSize: 14 }}>lot #{p.id}</span></span>} sub={(p.status === 'open' ? p.qty_open + ' of ' + p.qty_total + ' open' : 'Closed ' + fmt.date(p.closed_on)) + ' · opened ' + fmt.date(p.opened_on)}>
        {p.status === 'open' ? <Button size="sm" icon="sync" onClick={() => toast('Re-evaluated #' + p.id + ' as of ' + fmt.date(W.session) + ': ' + p.last_verdict + ' (preview — POST /positions/evaluate not sent)')}>Re-evaluate</Button> : null}
        <Button size="sm" icon="symbol" onClick={() => go('symbol/' + p.symbol)}>Symbol page</Button>
        <Button size="sm" variant="ghost" icon="trades" onClick={() => go('trades?symbol=' + p.symbol)}>Fills &amp; reattribution</Button>
      </PageHead>
      {e ? <div className="app-verdict-line"><VerdictChip verdict={e.verdict} /><CodeList reasons={e.reasons} warnings={e.warnings} /></div> : null}
      {W.candles[p.symbol] ? <SymbolChart key={p.symbol + themeKey + p.match_reason} candles={W.candles[p.symbol]} ind={W.indicators[p.symbol]} signals={W.signals.filter((s) => s.symbol === p.symbol && s.timeframe === '1d' && s.strategy !== 'Confluence')} actions={W.corporate_actions.filter((a) => a.symbol === p.symbol)} positions={[p]} overlays={{ ema50: true, ema200: false, st: true, macd: false }} levels={e ? posLevels(p) : []} height={340} focusFrom={p.opened_on} /> : null}
      {e ? <Panel title="Levels" right={p.is_unmatched ? <Badge>Unmatched: trailing stop only</Badge> : <span className="ss-muted app-small">frozen from the matched signal · chandelier trail = HH − 2.5 × ATR</span>}>
        <LevelLadder entry={p.avg_entry_price} close={e.close} stop={p.is_unmatched ? null : p.frozen_stop} trail={e.trail_level} t1={p.frozen_target_1} t2={p.frozen_target_2} matched={!p.is_unmatched} />
      </Panel> : null}
      <div className="ss-grid-2">
        <Panel title="Verdict history" right={<span className="ss-muted app-small">{ev.length} sessions · newest first</span>}>
          {ev.length ? <><VerdictTimeline entries={allEv ? ev : ev.slice(0, 10)} />{ev.length > 10 ? <button type="button" className="app-link app-small" style={{ marginTop: 8 }} onClick={() => setAllEv((x) => !x)}>{allEv ? 'Show latest 10' : 'Show all ' + ev.length + ' sessions'}</button> : null}</> : <span className="ss-muted">No evaluations stored for this lot.</span>}
        </Panel>
        <div className="app-col">
          <Panel title="Signal match" right={p.status === 'open' ? <Button size="sm" onClick={() => setRematch((r) => !r)}>{p.is_unmatched ? 'Match manually' : 'Re-match'}</Button> : null}>
            {p.is_unmatched ? <p className="ss-muted" style={{ margin: 0 }}>No 1d signal within 5% of the fill in the 5 sessions up to {fmt.date(p.opened_on)} scored ≥ 0.5. Trailing stop only, no targets.</p> : (
              <KV items={[['Strategy', <StrategyTag strategy={p.matched_strategy} />], ['Signal date', <span className="ss-n">{fmt.date(p.matched_signal_ts)}</span>], ['Confidence', <span className="ss-n">{p.match_confidence.toFixed(2)}{p.match_reason === 'manual' ? ' · manual' : ''}</span>], ['Reason', <span className="ss-mono app-small">{p.match_reason}</span>],
                ['Frozen entry', <Num value={p.frozen_entry} />], ['Frozen stop', <Num value={p.frozen_stop} />], ['T1 / T2', <span><Num value={p.frozen_target_1} /> / <Num value={p.frozen_target_2} /></span>]]} />
            )}
            {rematch ? <div className="app-rematch">
              <div className="ss-label">Candidate 1d signals · {fmt.date(since)} → {fmt.date(p.opened_on)}</div>
              {allC.length ? allC.map((s) => { const sc = cands.find((c) => c.signal === s); const k = s.strategy + s.ts; return (
                <label key={k} className={cx('app-cand', pick === k && 'on')}><input type="radio" name="cand" id={'cand-' + k} checked={pick === k} onChange={() => setPick(k)} />
                  <StrategyTag strategy={s.strategy} /><span className="ss-n">{fmt.date(s.ts)}</span><span className="ss-n ss-muted">entry {fmt.price(s.entry)}</span><span className="ss-spacer" /><span className="ss-n">{sc ? 'score ' + sc.score.toFixed(2) : '> 5% from fill'}</span></label>); })
                : <span className="ss-muted">No 1d signals for {p.symbol} in that window.</span>}
              <div className="app-row"><Button size="sm" variant="primary" disabled={!pick} onClick={doMatch}>Match selected</Button><Button size="sm" variant="ghost" onClick={() => setRematch(false)}>Cancel</Button></div>
            </div> : null}
          </Panel>
          <Panel title="Entry price">
            <KV items={[['Avg entry (adjusted)', <Num kind="inr" value={p.avg_entry_price} />], ['Avg entry (as paid)', <Num kind="inr" value={p.avg_entry_price_raw} />], ['Structural factor', <span className="ss-n">{(p.structural_factor_applied ?? 1).toFixed(4)}{p.structural_factor_applied === 1 ? ' · no split/bonus since buy' : ''}</span>]]} />
          </Panel>
          <Panel title="Fills" pad={false}>
            <DataTable ariaLabel="Fills" columns={[
              { key: 'd', label: 'Time (IST)', render: (t) => <span className="ss-n">{fmt.date(t.trade_ts)} {fmt.time(t.trade_ts, false)}</span> },
              { key: 's', label: 'Side', render: (t) => <Badge tone={t.side === 'BUY' ? 'up' : 'down'}>{t.side}</Badge> },
              { key: 'q', label: 'Qty', align: 'right', render: (t) => <Num kind="qty" value={t.quantity} /> },
              { key: 'p', label: 'Price', align: 'right', render: (t) => <Num value={t.price} /> },
            ]} rows={fills} rowKey={(t) => t.id} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ═════════ TRADES ═════════ */
function Trades({ W, q, toast }) {
  const [sym, setSym] = useState(q.symbol || '');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [side, setSide] = useState('all');
  const rows = W.trades.filter((t) => (!sym || (t.tradingsymbol + ' ' + (t.symbol || '')).toUpperCase().includes(sym.toUpperCase())) && (!from || t.trade_date >= from) && (!to || t.trade_date <= to) && (side === 'all' || t.side === side));
  const unm = W.trades.filter((t) => !t.symbol).length;
  return (
    <div className="ss-page">
      <PageHead title="Trades" sub={W.trades.length + ' broker fills · ledger audit'} />
      {unm ? <Banner tone="degraded" title={unm + ' unmapped fill' + (unm > 1 ? 's' : '')}>The broker symbol didn’t resolve to a Nifty 500 symbol, so the ledger skipped it. No position was opened.</Banner> : null}
      <div className="app-filters">
        <div className="app-inline-field"><label className="ss-label" htmlFor="tr-sym">Symbol</label><input id="tr-sym" className="ss-input ss-input-mono" value={sym} onChange={(e) => setSym(e.target.value)} placeholder="Any" /></div>
        <div className="app-inline-field"><label className="ss-label" htmlFor="tr-from">From</label><input id="tr-from" type="date" className="ss-input ss-input-mono" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="app-inline-field"><label className="ss-label" htmlFor="tr-to">To</label><input id="tr-to" type="date" className="ss-input ss-input-mono" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Tabs variant="segmented" ariaLabel="Side" value={side} onChange={setSide} items={[{ id: 'all', label: 'All' }, { id: 'BUY', label: 'BUY' }, { id: 'SELL', label: 'SELL' }]} />
      </div>
      <DataTable ariaLabel="Trades" columns={[
        { key: 'trade_ts', label: 'Date / time (IST)', sortable: true, render: (t) => <span className="ss-n">{fmt.date(t.trade_ts)} <span className="ss-muted">{fmt.time(t.trade_ts, false)}</span></span> },
        { key: 'broker', label: 'Broker', render: (t) => <span className="ss-muted">{t.broker}</span> },
        { key: 'tradingsymbol', label: 'Tradingsymbol', render: (t) => <span className="ss-mono">{t.tradingsymbol}</span> },
        { key: 'symbol', label: 'Mapped', render: (t) => (t.symbol ? <button type="button" className="app-link ss-sym" onClick={(e) => { e.stopPropagation(); go('symbol/' + t.symbol); }}>{t.symbol}</button> : <Badge tone="down">Unmapped</Badge>) },
        { key: 'isin', label: 'ISIN', render: (t) => <span className="ss-n ss-faint">{t.isin}</span> },
        { key: 'side', label: 'Side', render: (t) => <Badge tone={t.side === 'BUY' ? 'up' : 'down'}>{t.side}</Badge> },
        { key: 'quantity', label: 'Qty', align: 'right', render: (t) => <Num kind="qty" value={t.quantity} /> },
        { key: 'price', label: 'Price', align: 'right', render: (t) => <Num value={t.price} /> },
        { key: 'pos', label: 'Position', render: (t) => (t.position_id ? <button type="button" className="app-link ss-n" onClick={(e) => { e.stopPropagation(); go('position/' + t.position_id); }}>#{t.position_id}</button> : <span className="ss-faint">—</span>) },
        { key: 'applied', label: 'Applied', render: (t) => (t.applied_at ? <span className="ss-n ss-muted">✓ {fmt.date(t.applied_at)}</span> : <span className="ss-down app-small">skipped · unmapped</span>) },
      ]} rows={rows} rowKey={(t) => t.id} renderExpanded={(t) => (t.side === 'SELL' && t.symbol ? <Reattribute t={t} W={W} toast={toast} /> : <span className="ss-muted">{t.side === 'BUY' ? (t.position_id ? 'This BUY opened lot #' + t.position_id + '.' : 'Not applied: no Nifty 500 symbol for ' + t.tradingsymbol + '.') : 'Unmapped SELL — nothing to reattribute.'}</span>)}
        footer={<><span>{rows.length} fills</span><span className="ss-spacer" /><span>Expand a SELL to reattribute it across lots</span></>} />
    </div>
  );
}
function Reattribute({ t, W, toast }) {
  const lots = W.positions.filter((p) => p.symbol === t.symbol);
  const [alloc, setAlloc] = useState(() => Object.fromEntries(lots.map((p) => [p.id, p.id === t.position_id ? t.quantity : 0])));
  const sum = Object.values(alloc).reduce((s, v) => s + (+v || 0), 0);
  const over = lots.find((p) => (+alloc[p.id] || 0) > p.qty_total);
  const err = sum !== t.quantity ? 'Allocations sum to ' + sum + '; the SELL is for ' + t.quantity + '.' : over ? 'Lot #' + over.id + ' only has ' + over.qty_total + ' shares.' : null;
  return (
    <div className="app-col" style={{ gap: 10, maxWidth: 560 }}>
      <div className="ss-label">Reattribute SELL #{t.id} · {t.quantity} {t.symbol} @ {fmt.price(t.price)}</div>
      {lots.map((p) => (
        <div key={p.id} className="app-alloc"><span className="ss-n">#{p.id}</span><span className="ss-n ss-muted">{fmt.date(p.opened_on)} · {p.qty_total} @ {fmt.price(p.avg_entry_price)}</span><span className="ss-spacer" />
          <input aria-label={'Quantity from lot ' + p.id} id={'alloc-' + t.id + '-' + p.id} className="ss-input ss-input-mono" style={{ width: 90, textAlign: 'right' }} type="number" min="0" value={alloc[p.id]} onChange={(e) => setAlloc({ ...alloc, [p.id]: e.target.value })} /></div>
      ))}
      <div className="app-row">{err ? <span className="ss-down app-small">422 · {err}</span> : <span className="ss-up app-small">✓ Sums to {t.quantity}</span>}<span className="ss-spacer" />
        <Button size="sm" variant="primary" disabled={!!err} onClick={() => toast('Reattribution ready: ' + Object.entries(alloc).filter(([, v]) => +v).map(([k, v]) => '#' + k + '×' + v).join(', ') + ' (preview — not sent)')}>Submit allocation</Button></div>
    </div>
  );
}

/* ═════════ BROKERS ═════════ */
function Brokers({ W, arg, q, update, toast }) {
  const [importFor, setImportFor] = useState(q.import ? +arg || 1 : null);
  const [adding, setAdding] = useState(!!q.add);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({ label: '', api_key: '', totp: '' });
  const [formErr, setFormErr] = useState(null);
  const csvRef = useRef(null);
  useEffect(() => { if (importFor && csvRef.current) csvRef.current.scrollIntoView({ block: 'start' }); }, [importFor]);
  const onFile = (file) => {
    const rd = new FileReader();
    rd.onload = () => {
      const lines = String(rd.result).split(/\r?\n/).filter((l) => l.trim()); const head = (lines[0] || '').split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
      const col = (...n) => head.findIndex((h) => n.includes(h));
      const iS = col('symbol', 'tradingsymbol', 'stock', 'scrip'), iI = col('isin'), iSide = col('side', 'trade_type', 'type'), iQ = col('quantity', 'qty'), iP = col('price', 'avg_price', 'trade_price'), iD = col('trade_date', 'date');
      const missing = [iD < 0 && 'trade_date | date', iS < 0 && iI < 0 && 'symbol | isin', iSide < 0 && 'side | trade_type', iQ < 0 && 'quantity', iP < 0 && 'price'].filter(Boolean);
      if (missing.length) { setResult({ error: '422 · Missing required column' + (missing.length > 1 ? 's' : '') + ': ' + missing.join(', ') }); return; }
      const syms = new Set(W.symbols.map((s) => s.symbol)); const isins = new Set(W.symbols.map((s) => s.isin));
      let unm = 0, buys = 0, sells = 0, errs = 0; const rows = lines.slice(1).map((l) => l.split(','));
      rows.forEach((r) => { const s = (r[iS] || '').trim().toUpperCase(); const mapped = syms.has(s) || isins.has((r[iI] || '').trim()); if (!mapped) unm++; const sd = (r[iSide] || '').trim().toUpperCase(); if (!(+r[iQ] > 0) || !(+r[iP] > 0)) errs++; else if (mapped && sd.startsWith('B')) buys++; else if (mapped && sd.startsWith('S')) sells++; });
      setResult({ file: file.name, rows: rows.length, upserted: rows.length - errs, unmapped: unm, ledger: { buys_opened: buys, sells_allocated: sells, orphan_sells: 0, skipped_unmapped: unm, errors: errs } });
    };
    rd.readAsText(file);
  };
  const save = () => {
    if (!form.label.trim() || !form.api_key.trim() || !form.totp.trim()) { setFormErr('Label, API key and TOTP secret are all required.'); return; }
    if (W.broker_accounts.some((a) => a.broker === 'groww' && a.label.toLowerCase() === form.label.trim().toLowerCase())) { setFormErr('409 · An account with broker groww and label “' + form.label.trim() + '” already exists.'); return; }
    update((w) => ({ ...w, broker_accounts: [...w.broker_accounts, { id: Math.max(0, ...w.broker_accounts.map((a) => a.id)) + 1, broker: 'groww', label: form.label.trim(), active: true, last_sync_on: null, last_sync_status: null, last_sync_message: null, created_at: new Date().toISOString() }] }));
    setAdding(false); setForm({ label: '', api_key: '', totp: '' }); setFormErr(null); toast('Account added in this preview. Secrets were discarded — nothing left this page.');
  };
  return (
    <div className="ss-page">
      <PageHead title="Brokers" sub="Read-only broker links. The platform never places orders.">
        <Button size="sm" icon="sync" onClick={() => toast('Sync all: Main → 502 broker call failed: auth: token request rejected · Family → 501 no client registered for broker zerodha (preview)')}>Sync all</Button>
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add Groww account</Button>
      </PageHead>
      {adding ? <Panel title="Add Groww account" right={<Button size="sm" variant="ghost" onClick={() => { setAdding(false); setFormErr(null); }}>Cancel</Button>}>
        <div className="app-form">
          <Field id="acc-label" label="Label" placeholder="Main" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} error={formErr && formErr.startsWith('409') ? formErr : null} hint="Unique per broker." />
          <Field id="acc-key" label="API key" secret placeholder="Paste Groww API key" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} hint="Write-only. Stored encrypted; never returned." />
          <Field id="acc-totp" label="TOTP secret" secret placeholder="Base32 secret" value={form.totp} onChange={(e) => setForm({ ...form, totp: e.target.value })} hint="Used to mint session tokens nightly." />
        </div>
        <div className="app-row" style={{ marginTop: 12 }}>{formErr && !formErr.startsWith('409') ? <span className="ss-down app-small">{formErr}</span> : null}<span className="ss-spacer" /><Button variant="primary" onClick={save}>Save account</Button></div>
      </Panel> : null}
      <div className="app-cards">
        {W.broker_accounts.map((a) => (
          <BrokerCard key={a.id} account={a} lastTradingDay={W.session}
            onImport={() => { setImportFor(a.id); setResult(null); }}
            onTest={() => toast(a.label + ': ' + (a.broker === 'zerodha' ? '501 no client registered for broker zerodha' : a.last_sync_status === 'auth_failed' ? '502 broker call failed: auth: token request rejected' : 'ok · 12 holdings') + ' (preview)')}
            onSync={() => toast(a.label + ': sync ' + (a.last_sync_status === 'auth_failed' ? 'failed — 502 auth: token request rejected. Import the tradebook CSV.' : 'ok · 0 trades') + ' (preview)')}
            onDeactivate={() => { update((w) => ({ ...w, broker_accounts: w.broker_accounts.map((x) => (x.id === a.id ? { ...x, active: false } : x)) })); toast(a.label + ' deactivated (soft). Its trades and positions stay.'); }} />
        ))}
      </div>
      {importFor ? <div ref={csvRef}><Panel title={'Import tradebook CSV · ' + (W.broker_accounts.find((a) => a.id === importFor)?.label || '')} right={<Button size="sm" variant="ghost" onClick={() => setImportFor(null)}>Close</Button>}>
        <FileDrop onFile={onFile} result={result && !result.error ? result : null} />
        {result?.error ? <p className="ss-down" style={{ marginBottom: 0 }}>{result.error}</p> : null}
        {result?.file ? <p className="ss-muted app-small" style={{ marginBottom: 0 }}>Parsed {result.file} in your browser against the loaded universe. Nothing was uploaded — the real import is POST /broker-accounts/{importFor}/import-tradebook.</p> : null}
      </Panel></div> : null}
    </div>
  );
}

/* ═════════ DATA & OPS ═════════ */
function Ops({ W, startRun }) {
  const running = W.runs.find((r) => r.status === 'running');
  const [caSym, setCaSym] = useState(''); const [caType, setCaType] = useState(null);
  const trig = [['incremental', 'Ingest · incremental', 'ingest'], ['backfill', 'Ingest · backfill', 'ingest'], ['indicators', 'Compute indicators', 'indicators'], ['signals', 'Generate signals', 'signals'], ['actions', 'Load corporate actions', null], ['universe', 'Refresh universe', null], ['evaluate', 'Evaluate positions', 'evaluate']];
  return (
    <div className="ss-page">
      <PageHead title="Data & Ops" sub="Pipeline runs, manual triggers and corporate actions"><StatusDot status="ok">GET /health · ok · db ok</StatusDot></PageHead>
      <Panel title="Triggers" right={running ? <StatusDot status="running">{'Run #' + running.id + ' ' + running.mode + ' · ' + running.symbols_ok + '/' + running.symbols_total}</StatusDot> : <span className="ss-muted app-small">One run at a time — others return 409</span>}>
        <div className="app-row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {trig.map(([k, lab]) => <Button key={k} size="sm" disabled={!!running} title={running ? 'A run is active: ' + running.mode + ' #' + running.id : undefined} onClick={() => startRun(k)}>{lab}</Button>)}
        </div>
        {running ? <div className="app-progress" aria-label="Run progress"><span style={{ width: (running.symbols_ok / running.symbols_total) * 100 + '%' }} /></div> : null}
        <p className="ss-muted app-small" style={{ margin: '8px 0 0' }}>In this preview a trigger plays a simulated run so you can see the progress and locked states. Full-universe timings: backfill ≈ 20 min, indicators ≈ 16 min, signals ≈ 6.5 min.</p>
      </Panel>
      <DataTable ariaLabel="Runs" columns={[
        { key: 'id', label: 'Run', render: (r) => <span className="ss-n">#{r.id}</span> },
        { key: 'mode', label: 'Mode', render: (r) => <span className="ss-mono">{r.mode}</span> },
        { key: 'status', label: 'Status', render: (r) => <StatusDot status={r.status} /> },
        { key: 'tf', label: 'TF', render: (r) => <span className="app-row" style={{ gap: 4 }}>{(r.timeframes || []).map((t) => <TimeframeBadge key={t} timeframe={t} />)}</span> },
        { key: 'started_at', label: 'Started (IST)', render: (r) => <span className="ss-n">{fmt.date(r.started_at)} {fmt.time(r.started_at, false)}</span> },
        { key: 'dur', label: 'Took', align: 'right', render: (r) => <span className="ss-n">{r.finished_at ? fmt.dur(r.started_at, r.finished_at) : '…'}</span> },
        { key: 'syms', label: 'Symbols ok/total', align: 'right', render: (r) => <span className="ss-n">{r.symbols_ok}/{r.symbols_total}{r.symbols_failed ? <span className="ss-down"> · {r.symbols_failed} failed</span> : ''}</span> },
        { key: 'rows', label: 'Rows written', align: 'right', render: (r) => <Num kind="int" value={r.candles_written} /> },
        { key: 'message', label: 'Message', render: (r) => <span className="ss-muted app-trunc app-trunc-l">{r.message}</span> },
      ]} rows={W.runs} rowKey={(r) => r.id} renderExpanded={(r) => (r.errors?.length ? <div className="app-col" style={{ gap: 4 }}><span className="ss-label">Per-symbol errors</span>{r.errors.map((e, i) => <span key={i} className="ss-mono app-small"><b>{e.symbol}</b> — {e.error}</span>)}</div> : <span className="ss-muted">{r.message || 'No errors.'}</span>)} />
      <Panel title="Corporate actions" pad={false} right={<div className="app-row" style={{ gap: 8 }}><input id="ca-sym" aria-label="Filter by symbol" className="ss-input ss-input-mono" style={{ width: 140 }} placeholder="Symbol" value={caSym} onChange={(e) => setCaSym(e.target.value)} />
        <Menu label="Type" value={caType} onChange={setCaType} onClear={() => setCaType(null)} options={['dividend', 'split', 'bonus', 'rights', 'demerger'].map((t) => ({ value: t, label: t }))} /></div>}>
        <DataTable ariaLabel="Corporate actions" columns={[
          { key: 'ex_date', label: 'Ex-date', sortable: true, render: (a) => <span className="ss-n">{fmt.date(a.ex_date)}</span> },
          { key: 'symbol', label: 'Symbol', sortable: true, render: (a) => <button type="button" className="app-link ss-sym" onClick={(e) => { e.stopPropagation(); go('symbol/' + a.symbol); }}>{a.symbol}</button> },
          { key: 'type', label: 'Type', render: (a) => <CorpActionMarker type={a.action_type} showLabel={false} /> },
          { key: 'record_date', label: 'Record', render: (a) => <span className="ss-n ss-muted">{fmt.date(a.record_date)}</span> },
          { key: 'value', label: 'Value ₹', align: 'right', render: (a) => <Num value={a.value} /> },
          { key: 'ratio', label: 'Ratio', align: 'right', render: (a) => <span className="ss-n">{a.ratio_from ? a.ratio_from + ':' + a.ratio_to : '—'}</span> },
          { key: 'pf', label: 'Price factor', align: 'right', render: (a) => <span className="ss-n">{a.price_factor != null ? a.price_factor.toFixed(4) : '—'}</span> },
          { key: 'x', label: 'Extra', render: (a) => (a.is_extraordinary ? <Badge tone="warn">Extraordinary</Badge> : null) },
          { key: 'subject', label: 'NSE subject', render: (a) => <span className="ss-muted">{a.subject}</span> },
        ]} rows={W.corporate_actions.filter((a) => (!caSym || a.symbol.includes(caSym.toUpperCase())) && (!caType || a.action_type === caType))} rowKey={(a) => a.symbol + a.ex_date + a.action_type} initialSort={{ key: 'ex_date', dir: 'desc' }} />
      </Panel>
    </div>
  );
}

/* ═════════ SETTINGS ═════════ */
const SNAP_SCRIPT = `# Run next to the backend; writes stockscreen-snapshot.json
import json, datetime, requests
B, H = "http://localhost:8000", {"X-API-Key": "sk_..."}   # your key
get = lambda p, auth=False, **q: requests.get(B + p, params=q, headers=H if auth else None, timeout=60).json()
s = {"generated_at": datetime.datetime.utcnow().isoformat() + "Z",
     "symbols": get("/symbols"),
     "signals": get("/signals/fresh", days=30, timeframe="1d"),
     "runs": get("/ingest/runs", limit=50),
     "corporate_actions": get("/corporate-actions", limit=500),
     "broker_accounts": get("/broker-accounts", True),
     "positions": get("/positions", True, status="open") + get("/positions", True, status="closed"),
     "trades": get("/broker-accounts/trades", True)}
syms = {p["symbol"] for p in s["positions"]} | {x["symbol"] for x in s["signals"]}
s["candles"] = {x: get(f"/candles/{x}", timeframe="1d", limit=260) for x in syms}
s["evaluations"] = {p["id"]: get(f"/positions/{p['id']}/evaluations", True) for p in s["positions"]}
json.dump(s, open("stockscreen-snapshot.json", "w"))
print(len(syms), "symbols with candles")`;
function Settings({ W, prefs, setPrefs, loadSnapshot, resetSample, toast }) {
  const [err, setErr] = useState(null);
  const onFile = (f) => { const rd = new FileReader(); rd.onload = () => { try { loadSnapshot(JSON.parse(rd.result), f.name); setErr(null); } catch (e) { setErr('Could not read ' + f.name + ': ' + e.message); } }; rd.readAsText(f); };
  return (
    <div className="ss-page">
      <PageHead title="Settings" />
      <div className="ss-grid-2">
        <div className="app-col">
          <Panel title="Data source" right={<Badge tone={W.source === 'sample' ? 'warn' : 'up'}>{W.source === 'sample' ? 'Sample data' : 'Snapshot'}</Badge>}>
            <p style={{ marginTop: 0 }}>{W.source === 'sample'
              ? 'You are looking at a generated sample: 80 Nifty 500 symbols with synthetic candles, strategies and verdicts computed in the browser, plus the six real signal rows from the handoff. Positions, trades and broker accounts are illustrative.'
              : 'Loaded ' + W.sourceName + (W.generatedAt ? ', generated ' + fmt.dateTime(W.generatedAt) : '') + '. Collections the file didn’t include still show sample data.'}</p>
            <p className="ss-muted">This page can’t call <span className="ss-mono">localhost:8000</span> directly: the hosted page’s sandbox blocks outside network calls, and the API has no CORS yet (§11). Instead, dump the API to a JSON file with the script below and load it here. The file is read in your browser only.</p>
            <div className="app-row" style={{ flexWrap: 'wrap' }}>
              <label className="ss-btn ss-btn-primary" htmlFor="snap-file"><Icon name="upload" />Load API snapshot</label>
              <input id="snap-file" type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
              {W.source !== 'sample' ? <Button onClick={resetSample}>Back to sample</Button> : null}
            </div>
            {err ? <p className="ss-down">{err}</p> : null}
          </Panel>
          <Panel title="Snapshot script" right={<Button size="sm" onClick={() => { try { navigator.clipboard.writeText(SNAP_SCRIPT); toast('Script copied'); } catch (e) { toast('Copy failed — select the text instead'); } }}>Copy</Button>} pad={false}>
            <pre className="app-code">{SNAP_SCRIPT}</pre>
          </Panel>
        </div>
        <div className="app-col">
          <Panel title="Display">
            <div className="app-col" style={{ gap: 14 }}>
              <div className="app-setting"><span>Theme</span><Tabs variant="segmented" ariaLabel="Theme" value={prefs.theme} onChange={(v) => setPrefs({ ...prefs, theme: v })} items={[{ id: 'system', label: 'System' }, { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]} /></div>
              <div className="app-setting"><span>Table density</span><Tabs variant="segmented" ariaLabel="Density" value={prefs.density} onChange={(v) => setPrefs({ ...prefs, density: v })} items={[{ id: 'compact', label: 'Compact' }, { id: 'default', label: 'Default' }]} /></div>
              <div className="app-setting"><span>Show 1h / 4h (experimental)</span><Tabs variant="segmented" ariaLabel="Show intraday" value={prefs.intraday ? 'on' : 'off'} onChange={(v) => setPrefs({ ...prefs, intraday: v === 'on' })} items={[{ id: 'off', label: 'Hidden' }, { id: 'on', label: 'Shown' }]} /></div>
              <div className="app-setting"><span>Positions open on</span><Tabs variant="segmented" ariaLabel="Positions default" value={prefs.groupBySymbol ? 'sym' : 'lot'} onChange={(v) => setPrefs({ ...prefs, groupBySymbol: v === 'sym' })} items={[{ id: 'lot', label: 'Per lot' }, { id: 'sym', label: 'By symbol' }]} /></div>
            </div>
          </Panel>
          <Panel title="Account">
            <KV items={[['Name (GET /me)', 'Shyan'], ['Auth', 'API key in X-API-Key header — no login flow yet'], ['Users', 'Single operator today; the menu stays multi-user ready']]} />
          </Panel>
          <Panel title="Keyboard">
            <div className="app-kbd-grid">{[['g t', 'Today'], ['g s', 'Signals'], ['g p', 'Positions'], ['g r', 'Trades'], ['g b', 'Brokers'], ['g o', 'Data & Ops'], ['/', 'Find symbol'], ['j k / ↑↓', 'Move row cursor (click a table first)'], ['↵', 'Expand / open row'], ['esc', 'Close search']].map(([k, v]) => <React.Fragment key={k}><Kbd keys={k.split(' / ')[0]} /><span className="ss-muted">{v}</span></React.Fragment>)}</div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ═════════ symbol search ═════════ */
function Search({ W, onClose }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0); const ref = useRef(null);
  useEffect(() => { ref.current && ref.current.focus(); }, []);
  const res = W.symbols.filter((s) => !q || s.symbol.includes(q.toUpperCase()) || s.name.toUpperCase().includes(q.toUpperCase())).slice(0, 8);
  const pick = (s) => { onClose(); go('symbol/' + s.symbol); };
  return (
    <div className="app-modal" role="dialog" aria-label="Find symbol" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="app-modal-box">
        <input ref={ref} id="sym-search" className="ss-input ss-input-mono app-search" placeholder="Symbol or company" value={q} onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(res.length - 1, x + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } if (e.key === 'Enter' && res[i]) pick(res[i]); }} />
        <div className="app-search-list">{res.map((s, k) => (
          <button type="button" key={s.symbol} className={cx('app-search-item', k === i && 'on')} onMouseEnter={() => setI(k)} onClick={() => pick(s)}>
            <span className="ss-sym ss-mono">{s.symbol}</span><span className="ss-muted app-trunc">{s.name}</span><span className="ss-spacer" /><span className="ss-faint app-small">{s.industry}</span></button>))}
          {!res.length ? <div className="ss-muted" style={{ padding: 12 }}>No Nifty 500 symbol matches “{q}”.</div> : null}</div>
      </div>
    </div>
  );
}

/* ═════════ APP ═════════ */
function normalizeSnapshot(snap, base) {
  const W = { ...base, source: 'snapshot', generatedAt: snap.generated_at || null };
  if (Array.isArray(snap.symbols)) W.symbols = snap.symbols;
  if (Array.isArray(snap.signals)) W.signals = snap.signals.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
  if (Array.isArray(snap.runs)) W.runs = snap.runs;
  if (Array.isArray(snap.corporate_actions)) W.corporate_actions = snap.corporate_actions;
  if (Array.isArray(snap.broker_accounts)) W.broker_accounts = snap.broker_accounts;
  if (Array.isArray(snap.positions)) W.positions = snap.positions.map((p) => ({ ...p, last_verdict: p.last_verdict || p.latest_evaluation?.verdict || null }));
  if (Array.isArray(snap.trades)) W.trades = snap.trades;
  if (snap.evaluations && typeof snap.evaluations === 'object') W.evaluations = snap.evaluations;
  if (snap.candles && typeof snap.candles === 'object') {
    W.candles = {}; W.indicators = {};
    for (const [sym, arr] of Object.entries(snap.candles)) {
      if (!Array.isArray(arr) || !arr.length) continue;
      const c = arr.map((b) => ({ ...b, ts: b.ts.replace('Z', '+00:00') }));
      W.candles[sym] = c; const I = calcInd(c); const C = c.map((b) => b.close);
      const em = (n) => { const k = 2 / (n + 1); let e; return C.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };
      const e50 = em(50), e200 = em(200); I.forEach((r, i) => { r.ema_50 = i >= 49 ? e50[i] : null; r.ema_200 = i >= 199 ? e200[i] : null; });
      W.indicators[sym] = I;
    }
  }
  const lastDay = [...Object.values(W.candles).map((c) => day(c[c.length - 1].ts)), ...W.signals.map((s) => day(s.ts))].sort().pop();
  if (lastDay) W.session = lastDay;
  return W;
}

function App() {
  const base = useMemo(() => buildWorld(), []);
  const [W, setW] = useState(base);
  const [route, setRoute] = useState(parseHash());
  const [prefs, setPrefsState] = useState(() => ({ theme: 'system', density: 'default', intraday: true, groupBySymbol: false, ...store.get('prefs', {}) }));
  const [toasts, setToasts] = useState([]);
  const [search, setSearch] = useState(false);
  const [themeKey, setThemeKey] = useState(0);
  const setPrefs = (p) => { setPrefsState(p); store.set('prefs', p); };
  const toast = useCallback((msg) => { const id = Math.random(); setToasts((t) => [...t.slice(-2), { id, msg }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200); }, []);

  useEffect(() => { const f = () => { setRoute(parseHash()); const m = document.querySelector('.ss-main'); if (m) m.scrollTop = 0; window.scrollTo(0, 0); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    const el = document.documentElement;
    if (prefs.theme === 'system') { if (el.dataset.ssOwn) { el.removeAttribute('data-theme'); delete el.dataset.ssOwn; } }
    else { el.setAttribute('data-theme', prefs.theme); el.dataset.ssOwn = '1'; }
    setThemeKey((k) => k + 1);
  }, [prefs.theme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)'); const bump = () => setThemeKey((k) => k + 1);
    mq.addEventListener ? mq.addEventListener('change', bump) : mq.addListener(bump);
    const mo = new MutationObserver(bump); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener && mq.removeEventListener('change', bump); mo.disconnect(); };
  }, []);
  // keyboard: g + letter, "/" search
  useEffect(() => {
    let g = 0;
    const onKey = (e) => {
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setSearch(true); return; }
      if (e.key === 'g') { g = Date.now(); return; }
      if (Date.now() - g < 900) { const m = { t: 'today', s: 'signals', p: 'positions', r: 'trades', b: 'brokers', o: 'ops' }[e.key]; if (m) { e.preventDefault(); go(m); } g = 0; }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  // simulated pipeline run
  const startRun = (mode) => {
    if (W.runs.some((r) => r.status === 'running')) { toast('409 · A run is already active'); return; }
    const id = Math.max(...W.runs.map((r) => r.id)) + 1; const total = mode === 'evaluate' ? W.positions.filter((p) => p.status === 'open').length : mode === 'actions' || mode === 'universe' ? 1 : 501;
    const run = { id, mode: mode === 'actions' ? 'corporate_actions' : mode === 'universe' ? 'universe' : mode, status: 'running', timeframes: ['1h', '4h', '1d'], symbols_total: total, symbols_ok: 0, symbols_failed: 0, candles_written: 0, message: '', errors: [], started_at: new Date().toISOString(), finished_at: null };
    setW((w) => ({ ...w, runs: [run, ...w.runs] })); toast('202 · Run #' + id + ' ' + run.mode + ' started (simulated)');
    const step = Math.max(1, Math.round(total / 24));
    const tick = setInterval(() => {
      setW((w) => {
        const r = w.runs.find((x) => x.id === id); if (!r) { clearInterval(tick); return w; }
        const ok = Math.min(total, r.symbols_ok + step); const done = ok >= total;
        if (done) { clearInterval(tick); setTimeout(() => toast('Run #' + id + ' completed · ' + total + '/' + total), 0); }
        return { ...w, runs: w.runs.map((x) => (x.id === id ? { ...x, symbols_ok: ok, candles_written: x.candles_written + step * 9, status: done ? 'completed' : 'running', finished_at: done ? new Date().toISOString() : null, message: done ? ok + '/' + total + ' ok (simulated)' : '' } : x)) };
      });
    }, 450);
  };
  const symMap = useMemo(() => Object.fromEntries(W.symbols.map((s) => [s.symbol, s])), [W.symbols]);
  const open = W.positions.filter((p) => p.status === 'open');
  const needs = open.filter((p) => p.last_verdict && p.last_verdict !== 'HOLD').length;
  const badBrokers = W.broker_accounts.filter((a) => a.active && (a.last_sync_status === 'auth_failed' || a.last_sync_status === 'error')).length;
  const sessRuns = W.runs.filter((r) => day(r.started_at) === W.session);
  const running = W.runs.find((r) => r.status === 'running');
  const pipe = running ? 'running' : sessRuns.some((r) => r.status === 'failed' && (r.mode === 'incremental' || r.mode === 'backfill')) ? 'failed' : sessRuns.some((r) => r.status === 'failed' || r.symbols_failed) ? 'warning' : 'ok';
  const lastFin = sessRuns.map((r) => r.finished_at).filter(Boolean).sort().pop();
  const page = route.page;
  const navCur = page === 'position' ? 'positions' : page === 'symbol' ? null : page;
  const NAVI = window.StockScreen.NAV;
  let body;
  if (page === 'signals') body = <Signals key={location.hash} W={W} symMap={symMap} prefs={prefs} q={route.q} />;
  else if (page === 'symbol') body = <SymbolPage key={route.arg} W={W} symMap={symMap} sym={route.arg} q={route.q} prefs={prefs} themeKey={themeKey} />;
  else if (page === 'positions') body = <Positions key={location.hash} W={W} symMap={symMap} prefs={prefs} q={route.q} />;
  else if (page === 'position') body = <PositionPage key={route.arg} W={W} id={route.arg} update={setW} toast={toast} themeKey={themeKey} />;
  else if (page === 'trades') body = <Trades key={location.hash} W={W} q={route.q} toast={toast} />;
  else if (page === 'brokers') body = <Brokers key={location.hash} W={W} arg={route.arg} q={route.q} update={setW} toast={toast} />;
  else if (page === 'ops') body = <Ops W={W} startRun={startRun} />;
  else if (page === 'settings') body = <Settings W={W} prefs={prefs} setPrefs={setPrefs} toast={toast} loadSnapshot={(snap, name) => { const n = normalizeSnapshot(snap, base); n.sourceName = name; setW(n); toast('Loaded ' + name); go('today'); }} resetSample={() => { setW(base); toast('Back to sample data'); }} />;
  else body = <Today W={W} symMap={symMap} />;
  return (
    <div className="ss ss-app app-shell">
      <div className="app-nav" onClick={(e) => { const b = e.target.closest('.ss-nav-item'); if (!b) return; const txt = b.textContent; if (/Settings/.test(txt)) go('settings'); else if (/Shyan/.test(txt)) go('settings'); }}>
        <NavRail current={navCur} counts={{ positions: needs, brokers: badBrokers }} user={{ name: 'Shyan' }} onNavigate={(id) => go(id)} />
      </div>
      <div className="ss-main">
        <SessionBar session={W.session} pipeline={pipe} pipelineAt={lastFin} dataNote={running ? running.mode + ' ' + running.symbols_ok + '/' + running.symbols_total : '1d candles to ' + fmt.date(W.session).replace(/ \d{4}$/, '')}>
          <button type="button" className="app-srcbadge" onClick={() => go('settings')} title="Data source">{W.source === 'sample' ? <Badge tone="warn">Sample data</Badge> : <Badge tone="up">Snapshot</Badge>}</button>
          <Button size="sm" variant="ghost" icon="search" kbd="/" onClick={() => setSearch(true)}>Symbol</Button>
        </SessionBar>
        <nav className="app-mnav" aria-label="Main (mobile)">
          {NAVI.filter((n) => n.id && !n.disabled).map((n) => <button type="button" key={n.id} aria-current={navCur === n.id ? 'page' : undefined} onClick={() => go(n.id)}><Icon name={n.icon} />{n.label}{n.id === 'positions' && needs ? <span className="ss-nav-count">{needs}</span> : null}</button>)}
          <button type="button" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => go('settings')}><Icon name="settings" />Settings</button>
        </nav>
        <main className="app-body">{body}</main>
      </div>
      {search ? <Search W={W} onClose={() => setSearch(false)} /> : null}
      <div className="app-toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="app-toast">{t.msg}</div>)}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
