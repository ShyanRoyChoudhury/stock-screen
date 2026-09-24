/* Symbol chart on TradingView Lightweight Charts, coloured from the design-system tokens. */
const React = window.React;
const { useEffect, useRef, useState } = React;
const { fmt } = window.StockScreen;

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim();
const day = (ts) => ts.slice(0, 10);
const GLYPH = { dividend: 'D', split: 'S', bonus: 'B', rights: 'R', demerger: 'DM' };
const SHORT = { PIPELINE: 'PIPE', S1_ST_Flip: 'S1', S2_MACD_Zero: 'S2', S3_BB_Squeeze: 'S3', TTM_Squeeze: 'TTM', Confluence: 'C' };

function alpha(hex, a) { const h = hex.replace('#', ''); if (h.length < 6) return hex; const n = parseInt(h.slice(0, 6), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; }

export function SymbolChart({ candles, ind, signals = [], actions = [], positions = [], overlays = {}, levels = [], selected, onPickSignal, height = 420, focusFrom }) {
  const box = useRef(null), sub = useRef(null);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const LWC = window.LightweightCharts; if (!LWC || !box.current) return;
    const C = { bg: css('surface-sunken'), grid: css('chart-grid'), text: css('ink-muted'), line: css('line'), up: css('candle-up'), down: css('candle-down'), vu: css('volume-up'), vd: css('volume-down'),
      e50: css('ema-50'), e200: css('ema-200'), bb: css('bb-band'), kc: css('kc-band'), macd: css('macd-line'), sig: css('macd-signal'), accent: css('accent'), act: css('marker-action'), dem: css('marker-demerger'),
      entry: css('level-entry'), stop: css('level-stop'), trail: css('level-trail'), target: css('level-target'), ink: css('ink') };
    const common = {
      layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line }, timeScale: { borderColor: C.line, rightOffset: 4, barSpacing: 7 },
      crosshair: { mode: 0, vertLine: { color: C.text, labelBackgroundColor: C.ink }, horzLine: { color: C.text, labelBackgroundColor: C.ink } },
      localization: { priceFormatter: (p) => fmt.price(p), locale: 'en-IN' }, autoSize: true,
    };
    const chart = LWC.createChart(box.current, common);
    const cs = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down, priceLineColor: C.text, priceLineStyle: 2,
      autoscaleInfoProvider: (orig) => { const r = orig(); const lv = levels.map((l) => l[1]).filter((v) => v != null); if (!r || !lv.length) return r; return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...lv), maxValue: Math.max(r.priceRange.maxValue, ...lv) } }; } });
    cs.setData(candles.map((b) => ({ time: day(b.ts), open: b.open, high: b.high, low: b.low, close: b.close })));
    const vs = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    vs.setData(candles.map((b) => ({ time: day(b.ts), value: b.volume, color: b.close >= b.open ? C.vu : C.vd })));
    const line = (key, color, style = 0, width = 1) => { const s = chart.addLineSeries({ color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); s.setData(ind.map((r, i) => (r[key] == null ? { time: day(candles[i].ts) } : { time: day(candles[i].ts), value: r[key] }))); return s; };
    if (overlays.bb) { line('bb_upper_20_2', C.bb); line('bb_middle_20_2', C.bb, 2); line('bb_lower_20_2', C.bb); }
    if (overlays.kc) { line('kc_upper_20_15', C.kc, 1); line('kc_middle_20', C.kc, 1); line('kc_lower_20_15', C.kc, 1); }
    if (overlays.ema200) line('ema_200', C.e200, 0, 2);
    if (overlays.ema50) line('ema_50', C.e50, 0, 2);
    if (overlays.st) {
      const s = chart.addLineSeries({ lineWidth: 1, lineStyle: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(ind.map((r, i) => ({ time: day(candles[i].ts), value: r.supertrend_10_3, color: r.supertrend_dir === 1 ? C.up : C.down })));
    }
    // markers: signals (below), corporate actions (above), fills
    const have = new Set(candles.map((b) => day(b.ts)));
    const mk = [];
    const evs = signals.filter((s) => s.strategy !== 'Confluence' || s === selected);
    evs.forEach((s) => have.has(day(s.ts)) && mk.push({ time: day(s.ts), position: 'belowBar', color: s === selected ? C.ink : C.accent, shape: 'arrowUp', text: SHORT[s.strategy] + (s === selected ? ' ◆' : ''), id: 'sig:' + s.strategy + day(s.ts) }));
    actions.forEach((a) => { if (have.has(a.ex_date)) mk.push({ time: a.ex_date, position: 'aboveBar', color: a.action_type === 'demerger' ? C.dem : C.act, shape: 'square', text: GLYPH[a.action_type] + (a.action_type === 'demerger' ? ' ⚠' : '') }); });
    positions.forEach((p) => { if (have.has(p.opened_on)) mk.push({ time: p.opened_on, position: 'belowBar', color: C.ink, shape: 'circle', text: 'BUY #' + p.id }); if (p.closed_on && have.has(p.closed_on)) mk.push({ time: p.closed_on, position: 'aboveBar', color: C.ink, shape: 'arrowDown', text: 'SELL #' + p.id }); });
    mk.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    cs.setMarkers(mk);
    const col = { entry: C.entry, stop: C.stop, trail: C.trail, t1: C.target, t2: C.target };
    levels.forEach(([k, v, t]) => v != null && cs.createPriceLine({ price: v, color: col[k], lineWidth: 1, lineStyle: k === 'stop' || k === 'entry' ? 0 : 2, axisLabelVisible: true, title: t }));
    // sub-pane
    let chart2 = null;
    if (overlays.macd && sub.current) {
      chart2 = LWC.createChart(sub.current, { ...common, timeScale: { ...common.timeScale, visible: true }, rightPriceScale: { borderColor: C.line, minimumWidth: 72 } });
      const h = chart2.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      h.setData(ind.map((r, i) => ({ time: day(candles[i].ts), value: r.macd_hist, color: r.macd_hist >= 0 ? alpha(C.up, 0.55) : alpha(C.down, 0.55) })));
      const l1 = chart2.addLineSeries({ color: C.macd, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      l1.setData(ind.map((r, i) => ({ time: day(candles[i].ts), value: r.macd_12_26 })));
      const l2 = chart2.addLineSeries({ color: C.sig, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      l2.setData(ind.map((r, i) => ({ time: day(candles[i].ts), value: r.macd_signal_9 })));
      chart.applyOptions({ timeScale: { visible: false }, rightPriceScale: { minimumWidth: 72 } });
      let lock = false;
      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (lock || !r) return; lock = true; chart2.timeScale().setVisibleLogicalRange(r); lock = false; });
      chart2.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (lock || !r) return; lock = true; chart.timeScale().setVisibleLogicalRange(r); lock = false; });
    }
    const n = candles.length;
    let from = n - 130;
    if (focusFrom) { const i = candles.findIndex((b) => day(b.ts) >= focusFrom); if (i > 0) from = Math.max(0, Math.min(from, i - 40)); }
    if (selected) { const i = candles.findIndex((b) => b.ts === selected.ts); if (i > 0) from = Math.max(0, Math.min(from, i - 60)); }
    chart.timeScale().setVisibleLogicalRange({ from, to: n + 3 });
    const byTime = new Map(candles.map((b, i) => [day(b.ts), i]));
    chart.subscribeCrosshairMove((pr) => { if (!pr.time) { setHover(null); return; } const i = byTime.get(typeof pr.time === 'string' ? pr.time : pr.time.year + '-' + String(pr.time.month).padStart(2, '0') + '-' + String(pr.time.day).padStart(2, '0')); setHover(i == null ? null : i); });
    chart.subscribeClick((pr) => { if (!pr.time || !onPickSignal) return; const t = typeof pr.time === 'string' ? pr.time : null; const s = evs.find((x) => day(x.ts) === t) || signals.find((x) => day(x.ts) === t && x.strategy !== 'Confluence'); if (s) onPickSignal(s); });
    return () => { chart.remove(); chart2 && chart2.remove(); };
  }, [candles, ind, signals, actions, positions, JSON.stringify(overlays), JSON.stringify(levels), selected]);
  const i = hover ?? candles.length - 1; const b = candles[i], r = ind[i], pb = candles[i - 1];
  return (
    <div className="app-chart">
      <div className="app-chart-legend">
        <span className="ss-n ss-muted">{fmt.date(b.ts, true)}</span>
        <span className="ss-n">O <b>{fmt.price(b.open)}</b></span><span className="ss-n">H <b>{fmt.price(b.high)}</b></span><span className="ss-n">L <b>{fmt.price(b.low)}</b></span><span className="ss-n">C <b className={pb && b.close >= pb.close ? 'ss-up' : 'ss-down'}>{fmt.price(b.close)}</b></span>
        <span className="ss-n ss-muted">V {fmt.qty(b.volume)}</span>
        {overlays.ema50 && r.ema_50 != null ? <span className="ss-n" style={{ color: 'var(--ema-50)' }}>EMA50 {fmt.price(r.ema_50)}</span> : null}
        {overlays.ema200 && r.ema_200 != null ? <span className="ss-n" style={{ color: 'var(--ema-200)' }}>EMA200 {fmt.price(r.ema_200)}</span> : null}
        {overlays.st ? <span className={'ss-n ' + (r.supertrend_dir === 1 ? 'ss-up' : 'ss-down')}>ST {fmt.price(r.supertrend_10_3)} {r.supertrend_dir === 1 ? '▲' : '▼'}</span> : null}
        {r.rvol_20 != null ? <span className="ss-n ss-muted">RVOL {fmt.mult(r.rvol_20)}</span> : null}
      </div>
      <div ref={box} className="app-chart-main" style={{ height }} />
      {overlays.macd ? <><div className="app-chart-sublabel ss-n"><span style={{ color: 'var(--macd-line)' }}>MACD {r.macd_12_26?.toFixed(2)}</span> <span style={{ color: 'var(--macd-signal)' }}>signal {r.macd_signal_9?.toFixed(2)}</span> <span className={r.macd_hist >= 0 ? 'ss-up' : 'ss-down'}>hist {r.macd_hist?.toFixed(2)}</span></div><div ref={sub} className="app-chart-sub" /></> : null}
      <div className="app-chart-foot ss-muted"><span>1d · split/bonus-adjusted, dividends left in · ▲ event signals (click to draw levels) · ■ corporate actions · ● your fills</span></div>
    </div>
  );
}
