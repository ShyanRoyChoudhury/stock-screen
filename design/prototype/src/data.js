/* Sample dataset + the platform's rules, re-implemented client-side so every screen is consistent.
   Shapes follow the API (§10 of the handoff) so an API snapshot can replace any collection. */

export const SESSION = '2026-09-21';

// ── universe (subset of Nifty 500) ──
const U = [
  ['RELIANCE', 'Reliance Industries Ltd.', 'Oil Gas & Consumable Fuels', 1247.4],
  ['BHEL', 'Bharat Heavy Electricals Ltd.', 'Capital Goods', 433.4],
  ['BAJAJ-AUTO', 'Bajaj Auto Ltd.', 'Automobile and Auto Components', 12361],
  ['CARBORUNIV', 'Carborundum Universal Ltd.', 'Capital Goods', 1178.9],
  ['PATANJALI', 'Patanjali Foods Ltd.', 'Fast Moving Consumer Goods', 396.2],
  ['CDSL', 'Central Depository Services (India) Ltd.', 'Financial Services', 1388.9],
  ['USHAMART', 'Usha Martin Ltd.', 'Capital Goods', 533.9],
  ['TATAPOWER', 'Tata Power Co. Ltd.', 'Power', 418],
  ['SIEMENS', 'Siemens Ltd.', 'Capital Goods', 3180],
  ['KPITTECH', 'KPIT Technologies Ltd.', 'Information Technology', 1412],
  ['VEDL', 'Vedanta Ltd.', 'Metals & Mining', 452],
  ['BRIGADE', 'Brigade Enterprises Ltd.', 'Realty', 1095],
  ['HDFCBANK', 'HDFC Bank Ltd.', 'Financial Services', 1712],
  ['ICICIBANK', 'ICICI Bank Ltd.', 'Financial Services', 1388],
  ['SBIN', 'State Bank of India', 'Financial Services', 846],
  ['AXISBANK', 'Axis Bank Ltd.', 'Financial Services', 1162],
  ['KOTAKBANK', 'Kotak Mahindra Bank Ltd.', 'Financial Services', 1920],
  ['BAJFINANCE', 'Bajaj Finance Ltd.', 'Financial Services', 912],
  ['CHOLAFIN', 'Cholamandalam Investment and Finance Co. Ltd.', 'Financial Services', 1488],
  ['MUTHOOTFIN', 'Muthoot Finance Ltd.', 'Financial Services', 2360],
  ['FEDERALBNK', 'Federal Bank Ltd.', 'Financial Services', 204],
  ['INFY', 'Infosys Ltd.', 'Information Technology', 1540],
  ['TCS', 'Tata Consultancy Services Ltd.', 'Information Technology', 3410],
  ['PERSISTENT', 'Persistent Systems Ltd.', 'Information Technology', 5620],
  ['COFORGE', 'Coforge Ltd.', 'Information Technology', 1795],
  ['MPHASIS', 'Mphasis Ltd.', 'Information Technology', 2830],
  ['LT', 'Larsen & Toubro Ltd.', 'Construction', 3620],
  ['ITC', 'ITC Ltd.', 'Fast Moving Consumer Goods', 418],
  ['NESTLEIND', 'Nestle India Ltd.', 'Fast Moving Consumer Goods', 1190],
  ['BRITANNIA', 'Britannia Industries Ltd.', 'Fast Moving Consumer Goods', 5710],
  ['DABUR', 'Dabur India Ltd.', 'Fast Moving Consumer Goods', 512],
  ['MARICO', 'Marico Ltd.', 'Fast Moving Consumer Goods', 705],
  ['TATACONSUM', 'Tata Consumer Products Ltd.', 'Fast Moving Consumer Goods', 1102],
  ['MARUTI', 'Maruti Suzuki India Ltd.', 'Automobile and Auto Components', 12980],
  ['TVSMOTOR', 'TVS Motor Co. Ltd.', 'Automobile and Auto Components', 2940],
  ['EICHERMOT', 'Eicher Motors Ltd.', 'Automobile and Auto Components', 5980],
  ['M&M', 'Mahindra & Mahindra Ltd.', 'Automobile and Auto Components', 3210],
  ['ASHOKLEY', 'Ashok Leyland Ltd.', 'Capital Goods', 128],
  ['MOTHERSON', 'Samvardhana Motherson International Ltd.', 'Automobile and Auto Components', 98],
  ['BHARATFORG', 'Bharat Forge Ltd.', 'Automobile and Auto Components', 1215],
  ['SUNPHARMA', 'Sun Pharmaceutical Industries Ltd.', 'Healthcare', 1655],
  ['CIPLA', 'Cipla Ltd.', 'Healthcare', 1530],
  ['DRREDDY', "Dr. Reddy's Laboratories Ltd.", 'Healthcare', 1266],
  ['LUPIN', 'Lupin Ltd.', 'Healthcare', 1980],
  ['APOLLOHOSP', 'Apollo Hospitals Enterprise Ltd.', 'Healthcare', 7420],
  ['AARTIIND', 'Aarti Industries Ltd.', 'Chemicals', 438],
  ['PIDILITIND', 'Pidilite Industries Ltd.', 'Chemicals', 3050],
  ['ASIANPAINT', 'Asian Paints Ltd.', 'Consumer Durables', 2480],
  ['TITAN', 'Titan Company Ltd.', 'Consumer Durables', 3560],
  ['HAVELLS', 'Havells India Ltd.', 'Consumer Durables', 1580],
  ['VOLTAS', 'Voltas Ltd.', 'Consumer Durables', 1392],
  ['DIXON', 'Dixon Technologies (India) Ltd.', 'Consumer Durables', 16200],
  ['POLYCAB', 'Polycab India Ltd.', 'Capital Goods', 7080],
  ['KEI', 'KEI Industries Ltd.', 'Capital Goods', 4120],
  ['ABB', 'ABB India Ltd.', 'Capital Goods', 5480],
  ['CUMMINSIND', 'Cummins India Ltd.', 'Capital Goods', 3890],
  ['THERMAX', 'Thermax Ltd.', 'Capital Goods', 3420],
  ['HAL', 'Hindustan Aeronautics Ltd.', 'Capital Goods', 4620],
  ['BEL', 'Bharat Electronics Ltd.', 'Capital Goods', 402],
  ['NTPC', 'NTPC Ltd.', 'Power', 342],
  ['POWERGRID', 'Power Grid Corporation of India Ltd.', 'Power', 296],
  ['ONGC', 'Oil & Natural Gas Corporation Ltd.', 'Oil Gas & Consumable Fuels', 242],
  ['COALINDIA', 'Coal India Ltd.', 'Oil Gas & Consumable Fuels', 388],
  ['JSWSTEEL', 'JSW Steel Ltd.', 'Metals & Mining', 1068],
  ['TATASTEEL', 'Tata Steel Ltd.', 'Metals & Mining', 164],
  ['HINDALCO', 'Hindalco Industries Ltd.', 'Metals & Mining', 712],
  ['NMDC', 'NMDC Ltd.', 'Metals & Mining', 74],
  ['ULTRACEMCO', 'UltraTech Cement Ltd.', 'Construction Materials', 12240],
  ['DLF', 'DLF Ltd.', 'Realty', 812],
  ['GODREJPROP', 'Godrej Properties Ltd.', 'Realty', 2210],
  ['OBEROIRLTY', 'Oberoi Realty Ltd.', 'Realty', 1705],
  ['INDHOTEL', 'The Indian Hotels Co. Ltd.', 'Consumer Services', 762],
  ['IRCTC', 'Indian Railway Catering And Tourism Corporation Ltd.', 'Consumer Services', 748],
  ['TRENT', 'Trent Ltd.', 'Consumer Services', 5210],
  ['DMART', 'Avenue Supermarts Ltd.', 'Consumer Services', 4380],
  ['BHARTIARTL', 'Bharti Airtel Ltd.', 'Telecommunication', 1905],
  ['SCI', 'Shipping Corporation of India Ltd.', 'Services', 214],
  ['ABFRL', 'Aditya Birla Fashion and Retail Ltd.', 'Consumer Services', 82],
  ['UBL', 'United Breweries Ltd.', 'Fast Moving Consumer Goods', 1980],
  ['PNB', 'Punjab National Bank', 'Financial Services', 112],
];
export const SYMBOLS = U.map(([symbol, name, industry], i) => ({ id: 100 + i, symbol, name, industry, isin: 'INE' + String(100 + i * 7).padStart(3, '0') + 'A0101' + (i % 10), active: true }));

// ── helpers ──
function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const hash = (str) => { let h = 7; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
function tradingDays(endIso, n) {
  const out = []; const d = new Date(endIso + 'T00:00:00Z');
  while (out.length < n) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
}
export const DAYS = tradingDays(SESSION, 260);
export const dayTs = (d) => d + 'T03:45:00+00:00';
export const sessionsBetween = (a, b) => DAYS.indexOf(b) - DAYS.indexOf(a);
const r2 = (x) => Math.round(x * 100) / 100;

// ── corporate actions (sample) ──
export const CORP_ACTIONS = [
  { symbol: 'CARBORUNIV', action_type: 'dividend', ex_date: '2026-09-25', record_date: '2026-09-25', value: 3, ratio_from: null, ratio_to: null, price_factor: 1, is_extraordinary: false, affects_share_count: false, subject: 'Interim Dividend - Rs 3 Per Share' },
  { symbol: 'VEDL', action_type: 'demerger', ex_date: '2026-09-10', record_date: '2026-09-10', value: null, ratio_from: 1, ratio_to: 1, price_factor: null, is_extraordinary: true, affects_share_count: false, subject: 'Demerger (sample)' },
  { symbol: 'BRIGADE', action_type: 'bonus', ex_date: '2026-06-17', record_date: '2026-06-17', value: null, ratio_from: 1, ratio_to: 3, price_factor: 0.75, is_extraordinary: true, affects_share_count: true, subject: 'Bonus 1:3' },
  { symbol: 'TATAPOWER', action_type: 'dividend', ex_date: '2026-07-04', record_date: '2026-07-04', value: 2.25, price_factor: 1, is_extraordinary: false, affects_share_count: false, subject: 'Final Dividend - Rs 2.25 Per Share' },
  { symbol: 'ITC', action_type: 'dividend', ex_date: '2026-09-24', record_date: '2026-09-24', value: 7.85, price_factor: 1, is_extraordinary: false, affects_share_count: false, subject: 'Final Dividend - Rs 7.85 Per Share' },
  { symbol: 'KPITTECH', action_type: 'dividend', ex_date: '2026-08-01', record_date: '2026-08-01', value: 4.6, price_factor: 1, is_extraordinary: false, affects_share_count: false, subject: 'Final Dividend - Rs 4.60 Per Share' },
  { symbol: 'HAL', action_type: 'split', ex_date: '2026-04-12', record_date: '2026-04-12', value: null, ratio_from: 1, ratio_to: 2, price_factor: 0.5, is_extraordinary: false, affects_share_count: true, subject: 'Face Value Split Rs 10 to Rs 5' },
  { symbol: 'RELIANCE', action_type: 'dividend', ex_date: '2026-08-14', record_date: '2026-08-14', value: 5.5, price_factor: 1, is_extraordinary: false, affects_share_count: false, subject: 'Dividend - Rs 5.50 Per Share' },
  { symbol: 'SBIN', action_type: 'rights', ex_date: '2026-05-20', record_date: '2026-05-20', value: 690, ratio_from: 1, ratio_to: 20, price_factor: 0.993, is_extraordinary: false, affects_share_count: true, subject: 'Rights 1:20 @ Rs 690' },
];

// ── candles ──
// Some symbols get a scripted path so the sample positions tell a story.
const SCRIPT = {
  CARBORUNIV: { end: 1204.5, shape: 'flipUp' }, TATAPOWER: { end: 412.3, shape: 'rollover' }, CDSL: { end: 1602.4, shape: 'trend' },
  USHAMART: { end: 579.1, shape: 'trend' }, VEDL: { end: 318.6, shape: 'demerger' }, KPITTECH: { end: 1398.2, shape: 'drift' },
  RELIANCE: { end: 1247.4, shape: 'down' }, BHEL: { end: 433.4, shape: 'trend' }, PATANJALI: { end: 396.2, shape: 'flipUp' },
};
for (const k of ['HAL', 'BEL', 'TRENT', 'LUPIN', 'INFY', 'SBIN', 'ABB', 'POLYCAB', 'IRCTC', 'NMDC', 'DLF', 'TVSMOTOR']) SCRIPT[k] = { shape: 'flipUp' };
for (const k of ['COFORGE', 'KEI', 'MUTHOOTFIN', 'BHARTIARTL', 'CUMMINSIND']) SCRIPT[k] = { shape: 'trend' };
function genCandles(sym, last) {
  const R = rng(hash(sym));
  const sc = SCRIPT[sym] || {};
  const n = DAYS.length; const rets = [];
  const vol = 0.012 + R() * 0.014;
  for (let i = 0; i < n; i++) {
    let mu = (R() - 0.48) * 0.004 + Math.sin(i / (18 + R() * 20)) * 0.004;
    const k = n - i;
    if (sc.shape === 'trend' && k < 40) mu += 0.006;
    if (sc.shape === 'flipUp') mu += k < (4 + (hash(sym) % 5)) ? 0.014 : k < 40 ? -0.004 : 0;
    if (sc.shape === 'rollover') mu += k < 3 ? -0.02 : k < 30 ? 0.005 : 0;
    if (sc.shape === 'down' && k < 60) mu -= 0.002;
    if (sc.shape === 'demerger' && k < 50) mu += 0.004;
    rets.push(mu + (R() - 0.5) * 2 * vol);
  }
  // path ending at `last`
  let p = 1; const closes = rets.map((r) => (p *= 1 + r));
  const f = (sc.end || last) / closes[n - 1];
  let prev = closes[0] * f / (1 + rets[0]);
  const out = [];
  for (let i = 0; i < n; i++) {
    let c = closes[i] * f;
    const o = prev * (1 + (R() - 0.5) * vol * 0.6);
    const h = Math.max(o, c) * (1 + R() * vol * 0.7), l = Math.min(o, c) * (1 - R() * vol * 0.7);
    const v = Math.round((2e5 + R() * 8e5) * (1 + Math.abs(rets[i]) * 25) * (sc.end ? 1.4 : 1));
    out.push({ ts: dayTs(DAYS[i]), timeframe: '1d', open: r2(o), high: r2(h), low: r2(l), close: r2(c), volume: v });
    prev = c;
  }
  if (sc.shape === 'demerger') { // false cliff: prices before ex-date are not demerger-adjusted
    const ex = DAYS.indexOf('2026-09-10');
    for (let i = 0; i < ex; i++) for (const k of ['open', 'high', 'low', 'close']) out[i][k] = r2(out[i][k] * 1.42);
    out[ex].open = r2(out[ex - 1].close * 0.71); out[ex].high = r2(Math.max(out[ex].open, out[ex].close) * 1.01);
  }
  return out;
}

// ── indicators (same parameters as the backend) ──
function ema(a, n) { const k = 2 / (n + 1); let e = null; return a.map((x, i) => (e = i === 0 ? x : x * k + e * (1 - k))); }
function sma(a, n) { let s = 0; return a.map((x, i) => { s += x; if (i >= n) s -= a[i - n]; return i >= n - 1 ? s / n : null; }); }
function stdev(a, n) { return a.map((_, i) => { if (i < n - 1) return null; const w = a.slice(i - n + 1, i + 1); const m = w.reduce((s, x) => s + x, 0) / n; return Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)); }); }
export function indicators(c) {
  const C = c.map((b) => b.close), H = c.map((b) => b.high), L = c.map((b) => b.low), V = c.map((b) => b.volume);
  const tr = c.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - C[i - 1]), Math.abs(b.low - C[i - 1])) : b.high - b.low));
  const atr = []; tr.forEach((t, i) => atr.push(i < 10 ? (i ? (atr[i - 1] * i + t) / (i + 1) : t) : (atr[i - 1] * 9 + t) / 10));
  // supertrend(10,3)
  const st = [], dir = []; let fu = 0, fl = 0;
  for (let i = 0; i < c.length; i++) {
    const hl2 = (H[i] + L[i]) / 2, bu = hl2 + 3 * atr[i], bl = hl2 - 3 * atr[i];
    fu = i && (bu < fu || C[i - 1] > fu) ? bu : i ? fu : bu;
    fl = i && (bl > fl || C[i - 1] < fl) ? bl : i ? fl : bl;
    let d = i ? dir[i - 1] : 1;
    if (d === 1 && C[i] < fl) d = -1; else if (d === -1 && C[i] > fu) d = 1;
    dir.push(d); st.push(d === 1 ? fl : fu);
  }
  const e12 = ema(C, 12), e26 = ema(C, 26), macd = C.map((_, i) => e12[i] - e26[i]), sig = ema(macd, 9);
  const mid = sma(C, 20), sd = stdev(C, 20), e20 = ema(C, 20), atr20 = sma(tr, 20), vma = sma(V, 20);
  // ADX(14) simplified Wilder
  const adx = []; let pdm = 0, ndm = 0, trs = 0, ax = 0;
  for (let i = 0; i < c.length; i++) {
    if (!i) { adx.push(null); continue; }
    const up = H[i] - H[i - 1], dn = L[i - 1] - L[i];
    pdm = pdm - pdm / 14 + (up > dn && up > 0 ? up : 0); ndm = ndm - ndm / 14 + (dn > up && dn > 0 ? dn : 0); trs = trs - trs / 14 + tr[i];
    const pdi = (100 * pdm) / trs, ndi = (100 * ndm) / trs, dx = (100 * Math.abs(pdi - ndi)) / (pdi + ndi || 1);
    ax = i < 28 ? dx : (ax * 13 + dx) / 14; adx.push(i < 28 ? null : ax);
  }
  return c.map((b, i) => {
    const bbu = mid[i] != null ? mid[i] + 2 * sd[i] : null, bbl = mid[i] != null ? mid[i] - 2 * sd[i] : null;
    const kcu = atr20[i] != null ? e20[i] + 1.5 * atr20[i] : null, kcl = atr20[i] != null ? e20[i] - 1.5 * atr20[i] : null;
    const sqOn = bbu != null && kcu != null && bbu < kcu && bbl > kcl;
    return {
      ts: b.ts, timeframe: '1d', atr_10: atr[i], supertrend_10_3: st[i], supertrend_dir: dir[i], macd_12_26: macd[i], macd_signal_9: sig[i], macd_hist: macd[i] - sig[i],
      ema_50: null, ema_200: null, adx_14: adx[i],
      bb_upper_20_2: bbu, bb_middle_20_2: mid[i], bb_lower_20_2: bbl, bb_bandwidth: mid[i] ? (bbu - bbl) / mid[i] : null,
      kc_upper_20_15: kcu, kc_middle_20: e20[i], kc_lower_20_15: kcl, ttm_squeeze_on: sqOn, ttm_squeeze_off: false, ttm_momentum: C[i] - e20[i],
      volume_ma_20: vma[i], rvol_20: vma[i] ? b.volume / vma[i] : null,
    };
  }).map((row, i, arr) => row);
}
function withEmas(c, ind) {
  const C = c.map((b) => b.close), e50 = ema(C, 50), e200 = ema(C, 200);
  ind.forEach((r, i) => { r.ema_50 = i >= 49 ? e50[i] : null; r.ema_200 = i >= 199 ? e200[i] : null; if (i) r.ttm_squeeze_off = ind[i - 1].ttm_squeeze_on && !r.ttm_squeeze_on; });
  return ind;
}

// ── strategies (simplified from §6.1; sample only) ──
function detect(sym, c, ind) {
  const out = [];
  const push = (i, strategy, stop, t1p, t2p, details, extra = {}) => {
    const entry = c[i].close; if (!(stop < entry)) return;
    const t1 = t1p.abs ?? entry * (1 + t1p), t2 = t2p.abs ?? entry * (1 + t2p);
    out.push({ symbol: sym, strategy, timeframe: '1d', ts: c[i].ts, entry_mode: extra.entry_mode || null, entry: r2(entry), stop_loss: r2(stop), target_1: r2(t1), target_2: r2(t2),
      risk_pct: r2(((entry - stop) / entry) * 100), rr_ratio: extra.rr ?? null, details });
  };
  for (let i = 30; i < c.length; i++) {
    const x = ind[i], p = ind[i - 1], b = c[i];
    const volOk = x.volume_ma_20 && b.volume > x.volume_ma_20;
    if (p.supertrend_dir === -1 && x.supertrend_dir === 1 && volOk) push(i, 'S1_ST_Flip', x.supertrend_10_3 * 0.995, 0.07, 0.12, { supertrend: r2(x.supertrend_10_3), vol_ratio: r2(b.volume / x.volume_ma_20) });
    if (p.macd_12_26 <= 0 && x.macd_12_26 > 0 && x.supertrend_dir === 1) { const lo = Math.min(...c.slice(i - 9, i + 1).map((k) => k.low)); push(i, 'S2_MACD_Zero', lo * 0.995, 0.07, 0.12, { macd: r2(x.macd_12_26) }); }
    const sq = ind.slice(i - 10, i).some((k) => k.bb_bandwidth != null && k.bb_bandwidth < 0.03);
    if (sq && c[i - 1].close <= p.bb_upper_20_2 && b.close > x.bb_upper_20_2 && b.volume > 1.5 * x.volume_ma_20) push(i, 'S3_BB_Squeeze', x.bb_middle_20_2, 0.08, 0.15, { upper_bb: r2(x.bb_upper_20_2), middle_bb: r2(x.bb_middle_20_2), bandwidth: +x.bb_bandwidth.toFixed(4), vol_ratio: r2(b.volume / x.volume_ma_20) });
    if (x.ttm_squeeze_off && x.ttm_momentum > 0 && x.ttm_momentum > p.ttm_momentum && x.supertrend_dir === 1) {
      let n = 0; for (let k = i - 1; k >= 0 && ind[k].ttm_squeeze_on; k--) n++;
      const stop = x.kc_middle_20 * 0.99; const e = b.close;
      push(i, 'TTM_Squeeze', stop, 0.08, 0.15, { kc_mid: r2(x.kc_middle_20), momentum: +(x.ttm_momentum / e).toFixed(4), squeeze_bars: n }, { rr: r2((e * 0.08) / (e - stop)) });
    }
    if (x.supertrend_dir === 1) {
      const macdB = x.macd_12_26 > x.macd_signal_9, bbB = b.close > x.bb_middle_20_2, vB = volOk;
      const score = 1 + macdB + bbB + vB; const room = (x.bb_upper_20_2 - b.close) / b.close;
      if (score >= 3 && room >= 0.01) {
        const hi = ind.slice(i - 10, i).some((k) => k.macd_12_26 < 0) && macdB;
        const stop = x.supertrend_10_3 * 0.99, e = b.close;
        push(i, 'Confluence', stop, 0.07, 0.12, {
          score: score + '/4', conviction: hi ? 'HIGH ⚡' : score === 4 ? 'STRONG' : 'MODERATE', supertrend: r2(x.supertrend_10_3),
          breakdown: { supertrend: 'GREEN ✓', macd: macdB ? 'Bullish ✓' : 'Bearish ✗', bb_position: bbB ? 'Upper half ✓' : 'Lower half ✗', volume: (b.volume / x.volume_ma_20).toFixed(1) + 'x avg ' + (vB ? '✓' : 'X'), room_to_upper: (room * 100).toFixed(1) + '%', high_conviction: hi },
        }, { rr: r2((e * 0.07) / (e - stop)) });
      }
    }
  }
  return out;
}

// Real signal rows from the handoff (live DB, 21 Sep 2026)
const REAL = [
  { symbol: 'BHEL', strategy: 'Confluence', timeframe: '1d', ts: '2026-09-21T03:45:00+00:00', entry_mode: null, entry: 433.4, stop_loss: 394.72, target_1: 463.74, target_2: 485.41, risk_pct: 8.92, rr_ratio: 0.78, details: { score: '3/4', conviction: 'MODERATE', supertrend: 398.71, breakdown: { supertrend: 'GREEN ✓', macd: 'Bullish ✓', bb_position: 'Upper half ✓', volume: '0.8x avg X', room_to_upper: '2.6%', high_conviction: false } } },
  { symbol: 'BAJAJ-AUTO', strategy: 'PIPELINE', timeframe: '1d', ts: '2026-09-01T03:45:00+00:00', entry_mode: 'IMMEDIATE', entry: 12361, stop_loss: 12237.39, target_1: 12803.72, target_2: 13135.75, risk_pct: 1, rr_ratio: null, details: { atr: 221.36, rvol: 2.05, breakout_atr: 1.04, volume_grade: 'STRONG (>=2x avg)' } },
  { symbol: 'CARBORUNIV', strategy: 'S1_ST_Flip', timeframe: '1d', ts: '2026-09-21T03:45:00+00:00', entry_mode: null, entry: 1178.9, stop_loss: 1032.04, target_1: 1261.42, target_2: 1320.37, risk_pct: 12.46, rr_ratio: null, details: { vol_ratio: 10.37, supertrend: 1037.22 } },
  { symbol: 'PATANJALI', strategy: 'S2_MACD_Zero', timeframe: '1d', ts: '2026-09-21T03:45:00+00:00', entry_mode: null, entry: 396.2, stop_loss: 334.07, target_1: 423.93, target_2: 443.74, risk_pct: 15.68, rr_ratio: null, details: { macd: 3.45 } },
  { symbol: 'CDSL', strategy: 'S3_BB_Squeeze', timeframe: '1d', ts: '2026-08-21T03:45:00+00:00', entry_mode: null, entry: 1388.9, stop_loss: 1340.77, target_1: 1500.01, target_2: 1597.24, risk_pct: 3.47, rr_ratio: null, details: { upper_bb: 1370.06, middle_bb: 1340.77, bandwidth: 0.0437, vol_ratio: 3.31 } },
  { symbol: 'USHAMART', strategy: 'TTM_Squeeze', timeframe: '1d', ts: '2026-08-28T03:45:00+00:00', entry_mode: null, entry: 533.9, stop_loss: 495.11, target_1: 576.61, target_2: 613.99, risk_pct: 7.27, rr_ratio: 1.1, details: { kc_mid: 500.11, momentum: 0.0244, squeeze_bars: 12 } },
];

// ── verdict engine (§6.2) ──
export function evaluate(pos, c, ind, actions) {
  const start = c.findIndex((b) => b.ts.slice(0, 10) >= pos.opened_on);
  if (start < 0) return [];
  const evals = []; let trail = -Infinity, hh = -Infinity; const matched = !pos.is_unmatched;
  const dem = actions.find((a) => a.symbol === pos.symbol && a.action_type === 'demerger' && a.ex_date >= pos.opened_on);
  for (let i = start; i < c.length; i++) {
    const b = c[i], x = ind[i], asOf = b.ts.slice(0, 10);
    hh = Math.max(hh, b.high); trail = Math.max(trail, hh - 2.5 * x.atr_10);
    const stop = matched ? pos.frozen_stop : trail;
    const reasons = [], warnings = [];
    if (dem && asOf >= dem.ex_date) reasons.push({ code: 'DEMERGER_CLIFF', detail: 'demerger ex ' + dem.ex_date + '; stored prices are not demerger-adjusted' });
    if (b.close < stop) reasons.push({ code: 'STOP_HIT', detail: 'close ' + b.close.toFixed(2) + ' < stop ' + stop.toFixed(2) });
    if (x.supertrend_dir === -1 && i > start) reasons.push({ code: 'SUPERTREND_FLIP', detail: null });
    if (matched && trail > pos.frozen_stop && b.close < trail) reasons.push({ code: 'TRAIL_HIT', detail: 'close ' + b.close.toFixed(2) + ' < trail ' + trail.toFixed(2) });
    if (matched && b.close >= pos.frozen_target_2) reasons.push({ code: 'T2_HIT', detail: 'close ' + b.close.toFixed(2) + ' ≥ T2 ' + pos.frozen_target_2.toFixed(2) });
    else if (matched && b.close >= pos.frozen_target_1) reasons.push({ code: 'T1_HIT', detail: 'close ' + b.close.toFixed(2) + ' ≥ T1 ' + pos.frozen_target_1.toFixed(2) });
    if (b.low < stop && b.close >= stop) warnings.push({ code: 'LOW_BREACH', detail: 'low ' + b.low.toFixed(2) + ' < stop ' + stop.toFixed(2) });
    if (i >= 5 && b.close > c[i - 5].close && c.slice(i - 4, i + 1).every((k, j, a) => !j || k.volume < a[j - 1].volume * 1.05) && b.volume < c[i - 5].volume) warnings.push({ code: 'VOLUME_DIVERGENCE', detail: null });
    const next = actions.find((a) => a.symbol === pos.symbol && a.action_type !== 'demerger' && a.ex_date > asOf && sessionsAhead(asOf, a.ex_date) <= 5);
    if (next) warnings.push({ code: 'UPCOMING_ACTION', detail: next.action_type + ' ex ' + next.ex_date + ': ' + next.subject + '; broker may cancel your GTT; re-place the stop after the ex-date' });
    if (i - start > 30) warnings.push({ code: 'HORIZON', detail: 'held ' + (i - start) + ' sessions' });
    const order = ['NO_DATA', 'DEMERGER_CLIFF', 'QTY_MISMATCH', 'STOP_HIT', 'SUPERTREND_FLIP', 'TRAIL_HIT', 'T2_HIT', 'T1_HIT'];
    reasons.sort((a, z) => order.indexOf(a.code) - order.indexOf(z.code));
    const top = reasons[0] && reasons[0].code;
    const verdict = !top ? 'HOLD' : ['NO_DATA', 'DEMERGER_CLIFF', 'QTY_MISMATCH'].includes(top) ? 'REVIEW' : top === 'T1_HIT' ? 'PARTIAL' : 'EXIT';
    evals.push({ position_id: pos.id, as_of: asOf, bar_ts: b.ts, close: b.close, high: b.high, low: b.low, stop_level: r2(stop), trail_level: r2(trail),
      target_1: matched ? pos.frozen_target_1 : null, target_2: matched ? pos.frozen_target_2 : null, supertrend_dir: x.supertrend_dir, atr: r2(x.atr_10),
      verdict, reasons, warnings, unrealized_pnl_pct: +(b.close / pos.avg_entry_price - 1).toFixed(4), days_held: i - start });
  }
  return evals.reverse();
}
function sessionsAhead(a, b) { let n = 0; const d = new Date(a + 'T00:00:00Z'); while (d.toISOString().slice(0, 10) < b) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) n++; } return n; }

// ── matcher (§6.3) ──
export function candidates(signals, symbol, fillDate, fillPrice) {
  const idx = DAYS.indexOf(fillDate);
  const win = new Set(DAYS.slice(Math.max(0, idx - 5), idx + 1));
  return signals.filter((s) => s.symbol === symbol && s.timeframe === '1d' && win.has(s.ts.slice(0, 10)))
    .map((s) => {
      const prox = Math.abs(fillPrice - s.entry) / s.entry; if (prox > 0.05) return null;
      const rec = 1 - (idx - DAYS.indexOf(s.ts.slice(0, 10))) / 5;
      const score = 0.5 * (1 - prox / 0.05) + 0.3 * (s.strategy === 'Confluence' ? 0.5 : 1) + 0.2 * rec;
      return { signal: s, score: +score.toFixed(4), prox };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
}

// ── build the whole sample world ──
export function buildWorld() {
  const candles = {}, ind = {};
  const sigs = [];
  for (const [sym, , , last] of U) {
    const c = genCandles(sym, last); candles[sym] = c; ind[sym] = withEmas(c, indicators(c));
    sigs.push(...detect(sym, c, ind[sym]));
  }
  // real rows replace generated same-day duplicates
  for (const r of REAL) { const k = sigs.findIndex((s) => s.symbol === r.symbol && s.strategy === r.strategy && s.ts === r.ts); if (k >= 0) sigs.splice(k, 1); sigs.push(r); }
  sigs.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  // positions: [symbol, opened_on, qty, fill, matchTo]
  const P = [
    ['CARBORUNIV', '2026-09-22', 40, 1182.0], ['TATAPOWER', DAYS[DAYS.length - 10], 120, null], ['CDSL', '2026-08-24', 30, 1391.2], ['USHAMART', '2026-08-31', 80, 535.0],
    ['VEDL', '2026-08-20', 150, null], ['KPITTECH', DAYS[DAYS.length - 12], 25, null], ['RELIANCE', DAYS[DAYS.length - 25], 20, null], ['RELIANCE', DAYS[DAYS.length - 8], 15, null],
    ['BHEL', DAYS[DAYS.length - 4], 200, null],
  ];
  const positions = [], evaluations = {}, trades = [];
  let tid = 1;
  P.forEach(([sym, opened, qty, fill], k) => {
    const c = candles[sym];
    let od = opened; if (od > SESSION) od = SESSION; // CARBORUNIV sample opens tomorrow in the handoff; pin to session
    const bi = DAYS.indexOf(od) >= 0 ? DAYS.indexOf(od) : DAYS.length - 1;
    const px = fill || r2(c[bi].open * 1.002);
    const cands = candidates(sigs, sym, DAYS[bi], px);
    const best = sym === 'VEDL' || sym === 'KPITTECH' ? null : cands.find((x) => x.score >= 0.5) || (sym === 'CDSL' ? { signal: REAL[4], score: 0.88 } : sym === 'USHAMART' ? { signal: REAL[5], score: 0.91 } : sym === 'CARBORUNIV' ? { signal: REAL[2], score: 0.9337 } : null);
    const s = best && best.signal;
    const id = k + 1;
    const pos = {
      id, user_id: 1, broker_account_id: 1, symbol_id: SYMBOLS.find((x) => x.symbol === sym).id, symbol: sym, status: 'open', opened_on: DAYS[bi], entry_trade_id: tid,
      qty_open: qty, qty_total: qty, avg_entry_price: px, avg_entry_price_raw: px, structural_factor_applied: 1.0, last_restated_on: DAYS[bi],
      matched_strategy: s ? s.strategy : null, matched_signal_ts: s ? s.ts : null, matched_timeframe: s ? '1d' : null, match_confidence: best ? best.score : null,
      match_reason: s ? s.strategy + ' @' + s.ts.slice(0, 10) + ', fill ' + ((Math.abs(px - s.entry) / s.entry) * 100).toFixed(1) + '% from entry' : null, is_unmatched: !s,
      frozen_entry: s ? s.entry : null, frozen_stop: s ? s.stop_loss : null, frozen_target_1: s ? s.target_1 : null, frozen_target_2: s ? s.target_2 : null, frozen_details: s ? s.details : null,
      closed_on: null, exit_trade_id: null, realized_pnl: null, realized_pnl_pct: null,
    };
    trades.push({ id: tid++, broker: 'groww', tradingsymbol: sym, symbol: sym, isin: SYMBOLS.find((x) => x.symbol === sym).isin, side: 'BUY', quantity: qty, price: px, trade_ts: DAYS[bi] + 'T04:0' + (k % 9) + ':1' + k + '+00:00', trade_date: DAYS[bi], position_id: id, applied_at: DAYS[bi] + 'T10:50:00Z' });
    const ev = evaluate(pos, c, ind[sym], CORP_ACTIONS);
    pos.latest_evaluation = ev[0] || null; pos.last_verdict = ev[0] ? ev[0].verdict : null; pos.last_evaluated_on = ev[0] ? ev[0].as_of : null;
    evaluations[id] = ev; positions.push(pos);
  });
  // closed positions (history)
  const closed = [['HAL', 40, 21, 0.064, 'T2_HIT', 'S1_ST_Flip'], ['DIXON', 60, 38, -0.031, 'STOP_HIT', 'Confluence'], ['TRENT', 70, 55, 0.042, 'TRAIL_HIT', 'TTM_Squeeze'], ['COFORGE', 90, 72, 0.118, 'T2_HIT', 'S2_MACD_Zero'], ['DLF', 110, 101, -0.052, 'SUPERTREND_FLIP', null]];
  closed.forEach(([sym, a, b, pnl, why, strat], k) => {
    const c = candles[sym]; const i0 = DAYS.length - a, i1 = DAYS.length - b; const qty = [10, 3, 8, 25, 60][k];
    const px = r2(c[i0].open), out = r2(px * (1 + pnl)); const id = 100 + k;
    positions.push({ id, symbol: sym, status: 'closed', opened_on: DAYS[i0], closed_on: DAYS[i1], qty_open: 0, qty_total: qty, avg_entry_price: px, avg_entry_price_raw: px, structural_factor_applied: 1,
      matched_strategy: strat, match_confidence: strat ? 0.8 + k * 0.03 : null, is_unmatched: !strat, realized_pnl: r2((out - px) * qty), realized_pnl_pct: pnl, last_verdict: 'EXIT', exit_reason: why, latest_evaluation: null });
    trades.push({ id: tid++, broker: 'groww', tradingsymbol: sym, symbol: sym, isin: SYMBOLS.find((x) => x.symbol === sym).isin, side: 'BUY', quantity: qty, price: px, trade_ts: DAYS[i0] + 'T04:1' + k + ':00+00:00', trade_date: DAYS[i0], position_id: id, applied_at: DAYS[i0] + 'T10:50:00Z' });
    trades.push({ id: tid++, broker: 'groww', tradingsymbol: sym, symbol: sym, isin: SYMBOLS.find((x) => x.symbol === sym).isin, side: 'SELL', quantity: qty, price: out, trade_ts: DAYS[i1] + 'T04:2' + k + ':00+00:00', trade_date: DAYS[i1], position_id: id, applied_at: DAYS[i1] + 'T10:50:00Z' });
  });
  trades.push({ id: tid++, broker: 'groww', tradingsymbol: 'GOLDBEES', symbol: null, isin: 'INF204KB17I5', side: 'BUY', quantity: 200, price: 78.42, trade_ts: DAYS[DAYS.length - 3] + 'T05:11:00+00:00', trade_date: DAYS[DAYS.length - 3], position_id: null, applied_at: null });
  trades.sort((a, b) => (a.trade_ts < b.trade_ts ? 1 : -1));

  const broker_accounts = [
    { id: 1, broker: 'groww', label: 'Main', active: true, last_sync_on: DAYS[DAYS.length - 2], last_sync_status: 'auth_failed', last_sync_message: 'auth: token request rejected', created_at: '2026-06-02T09:00:00Z' },
    { id: 2, broker: 'zerodha', label: 'Family', active: true, last_sync_on: null, last_sync_status: null, last_sync_message: 'No client registered for broker zerodha — use tradebook CSV import', created_at: '2026-07-11T12:30:00Z' },
  ];
  const fresh1d = sigs.filter((s) => s.ts.slice(0, 10) === SESSION).length;
  const R = (id, mode, st, a, b, extra) => ({ id, mode, status: st, timeframes: ['1d'], symbols_total: 501, symbols_ok: 501, symbols_failed: 0, candles_written: 0, message: '', errors: [], started_at: a, finished_at: b, ...extra });
  const runs = [
    R(218, 'evaluate', 'completed', '2026-09-21T11:15:31Z', '2026-09-21T11:15:41Z', { symbols_total: 9, symbols_ok: 9, candles_written: 9, message: '9 positions evaluated' }),
    R(217, 'broker_sync', 'failed', '2026-09-21T11:15:12Z', '2026-09-21T11:15:30Z', { symbols_total: 2, symbols_ok: 0, symbols_failed: 2, message: 'Main (groww): auth: token request rejected · Family (zerodha): no client registered', errors: [{ symbol: 'Main', error: 'auth: token request rejected' }, { symbol: 'Family', error: '501 no client registered for broker zerodha' }] }),
    R(216, 'signals', 'completed', '2026-09-21T11:08:46Z', '2026-09-21T11:15:11Z', { timeframes: ['1h', '4h', '1d'], candles_written: 554875, message: '501/501 symbols ok, 554875 signals written (' + fresh1d + ' fresh 1d in sample)' }),
    R(215, 'indicators', 'completed', '2026-09-21T10:52:31Z', '2026-09-21T11:08:44Z', { timeframes: ['1h', '4h', '1d'], candles_written: 2683114, message: '501/501 symbols ok' }),
    R(214, 'incremental', 'completed', '2026-09-21T10:45:04Z', '2026-09-21T10:52:29Z', { timeframes: ['1h', '4h', '1d'], symbols_ok: 499, symbols_failed: 2, candles_written: 4509, message: '499/501 symbols ok', errors: [{ symbol: 'GVT&D', error: 'yahoo: no data for 1h' }, { symbol: 'NIVABUPA', error: 'yahoo: timeout after 30s' }] }),
    R(213, 'evaluate', 'completed', '2026-09-18T11:14:10Z', '2026-09-18T11:14:19Z', { symbols_total: 8, symbols_ok: 8, candles_written: 8, message: '8 positions evaluated' }),
    R(212, 'broker_sync', 'completed', '2026-09-18T11:13:40Z', '2026-09-18T11:14:08Z', { symbols_total: 1, symbols_ok: 1, candles_written: 3, message: 'Main: 3 trades received, 3 upserted, 0 unmapped' }),
    R(211, 'signals', 'completed', '2026-09-18T11:07:02Z', '2026-09-18T11:13:38Z', { timeframes: ['1h', '4h', '1d'], candles_written: 554102, message: '501/501 symbols ok' }),
  ];
  return { symbols: SYMBOLS, candles, indicators: ind, signals: sigs, positions, evaluations, trades, broker_accounts, runs, corporate_actions: CORP_ACTIONS, session: SESSION, source: 'sample' };
}
