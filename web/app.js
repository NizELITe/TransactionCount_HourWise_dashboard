(function () {
'use strict';
const D = window.DASH;
if (!D) {
  document.body.innerHTML = '<div style="padding:40px;font:16px sans-serif">No data found. Run <b>run_dashboard.bat</b> (or <code>python dashboard.py</code>) first.</div>';
  return;
}

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PAL = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#17becf'];
const OTHER = '#94a3b8';
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtN = n => nf.format(Math.round(n));
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return fmtN(n);
}
const slotLabel = s => pad(Math.floor(s / 4)) + ':' + pad((s % 4) * 15);
function dateLabel(i) {
  const [y, m, d] = D.dates[i].split('-').map(Number);
  return { short: d + ' ' + MON[m - 1], full: WD[new Date(y, m - 1, d).getDay()] + ' ' + d + ' ' + MON[m - 1] + ' ' + y };
}
const M = () => S.metric;
const fmtV = v => (S.metric === 'count' ? fmtN(v) : compact(v));
const fmtVfull = v => fmtN(v);
const metricName = () => (S.metric === 'count' ? 'transactions' : 'amount');
function niceStep(max, n) {
  const raw = max / n || 1, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/* ---------- state ---------- */
const nDates = D.dates.length;
const DEF = () => ({ d0: 0, d1: nDates - 1, t0: 0, t1: 96, st: new Set(D.statuses.map((_, i) => i)), metric: 'count', topN: 10, gran: 4, mode: 'separate', q: '' });
let S = DEF();
let C = null;

/* ---------- compute ---------- */
function compute() {
  const q = S.q.trim().toLowerCase();
  let okM = null;
  if (q) {
    okM = new Set();
    D.merchants.forEach((m, i) => { if ((m.name + ' ' + m.iban + ' ' + m.id + ' ' + m.city).toLowerCase().includes(q)) okM.add(i); });
  }
  const rows = D.rows.filter(r => r[1] >= S.d0 && r[1] <= S.d1 && r[2] >= S.t0 && r[2] < S.t1 && S.st.has(r[3]) && (!okM || okM.has(r[0])));

  const g = S.gran, b0 = Math.floor(S.t0 / g), b1 = Math.floor((S.t1 - 1) / g), nb = b1 - b0 + 1;
  const nd = S.d1 - S.d0 + 1, sep = S.mode === 'separate';
  const ncols = sep ? nd * nb : nb;
  const colOf = (d, sl) => (sep ? (d - S.d0) * nb : 0) + Math.floor(sl / g) - b0;
  const cols = [];
  for (let i = 0; i < ncols; i++) {
    const di = sep ? S.d0 + Math.floor(i / nb) : -1, b = b0 + (i % nb);
    const s0 = b * g, s1 = Math.min(96, (b + 1) * g);
    cols.push({
      di, s0, s1,
      label: g >= 96 ? (sep ? dateLabel(di).short : 'All') : slotLabel(s0),
      full: (sep ? dateLabel(di).full + ' · ' : '') + (g >= 96 ? 'whole day' : slotLabel(s0) + '–' + (s1 >= 96 ? '24:00' : slotLabel(s1)))
    });
  }

  const tot = new Map(), allC = new Float64Array(ncols), allA = new Float64Array(ncols);
  const byStatus = new Map(), byMode = new Map(), byHour = new Float64Array(24), byDate = new Float64Array(nDates);
  let N = 0, A = 0, OK = 0;
  for (const r of rows) {
    const m = r[0], d = r[1], sl = r[2], s = r[3], mo = r[4], c = r[5], a = r[6], col = colOf(d, sl);
    let t = tot.get(m);
    if (!t) { t = { m, cnt: 0, amt: 0, ok: 0, sc: new Float64Array(ncols), sa: new Float64Array(ncols), st: new Map() }; tot.set(m, t); }
    t.cnt += c; t.amt += a; t.sc[col] += c; t.sa[col] += a; t.st.set(s, (t.st.get(s) || 0) + c);
    if (D.success[s]) { t.ok += c; OK += c; }
    allC[col] += c; allA[col] += a; N += c; A += a;
    byStatus.set(s, (byStatus.get(s) || 0) + c); byMode.set(mo, (byMode.get(mo) || 0) + c);
    const v = S.metric === 'count' ? c : a;
    byHour[sl >> 2] += v; byDate[d] += v;
  }
  const ranked = [...tot.values()].sort((x, y) => S.metric === 'count' ? (y.cnt - x.cnt || y.amt - x.amt) : (y.amt - x.amt || y.cnt - x.cnt));
  ranked.forEach((t, i) => { t.rank = i + 1; });
  return { rows, cols, ncols, nb, nd, sep, tot, ranked, top: ranked.slice(0, S.topN), allC, allA, byStatus, byMode, byHour, byDate, N, A, OK };
}
const val = t => (S.metric === 'count' ? t.cnt : t.amt);
const serKey = () => (S.metric === 'count' ? 'sc' : 'sa');
function argmax(arr) { let b = -1, bi = -1; for (let i = 0; i < arr.length; i++) if (arr[i] > b) { b = arr[i]; bi = i; } return b > 0 ? bi : -1; }

/* ---------- render ---------- */
function render() {
  C = compute();
  renderHero(); renderKPIs(); renderTop(); renderHeat(); renderStack(); renderSide();
}
function selectionText() {
  const d = S.d0 === S.d1 ? dateLabel(S.d0).full : dateLabel(S.d0).short + ' → ' + dateLabel(S.d1).short;
  const t = (S.t0 === 0 && S.t1 === 96) ? 'all day' : slotLabel(S.t0) + '–' + (S.t1 >= 96 ? '24:00' : slotLabel(S.t1));
  return d + ' · ' + t;
}
function renderHero() {
  $('#heroSub').textContent = D.meta.file + '  ·  ' + fmtN(D.meta.transactions) + ' transactions  ·  ' + D.meta.merchants + ' merchants  ·  ' + nDates + ' day' + (nDates > 1 ? 's' : '') + '  ·  built ' + D.meta.generated;
  const w = $('#warn');
  w.hidden = !D.meta.warnings.length;
  w.textContent = D.meta.warnings.join('  ');
  $('#foot').textContent = 'IBAN taken from column "' + D.meta.ibanColumn + '"  ·  Merchants grouped by ' + (D.meta.groupBy === 'name' ? 'Merchant_Name' : 'MerchantIDD') + '  ·  Edit EXCEL_PATH in dashboard.py and re-run to refresh';
}
function kpi(l, v, s, c) { return '<div class="kpi" style="--c:' + c + '"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; }
function renderKPIs() {
  const topSum = C.top.reduce((a, t) => a + val(t), 0), allSum = S.metric === 'count' ? C.N : C.A;
  const pk = argmax(C.allC);
  $('#kpis').innerHTML =
    kpi('Transactions', fmtN(C.N), selectionText(), '#4f46e5') +
    kpi('Total amount', compact(C.A), fmtN(C.A), '#0891b2') +
    kpi('Success rate', C.N ? (C.OK / C.N * 100).toFixed(1) + '%' : '–', fmtN(C.OK) + ' successful', '#16a34a') +
    kpi('Merchants active', fmtN(C.tot.size), 'of ' + D.meta.merchants + ' in file', '#f28e2b') +
    kpi('Avg ticket', C.N ? fmtN(C.A / C.N) : '–', 'amount per transaction', '#b07aa1') +
    kpi('Top ' + C.top.length + ' share', allSum ? (topSum / allSum * 100).toFixed(1) + '%' : '–', 'of all ' + metricName(), '#e15759') +
    kpi('Peak period', pk >= 0 ? C.cols[pk].label + (C.sep && C.cols[pk].di >= 0 ? ' · ' + dateLabel(C.cols[pk].di).short : '') : '–', pk >= 0 ? fmtN(C.allC[pk]) + ' transactions' : '', '#59a14f');
}
function peakOf(t) {
  const i = argmax(t[serKey()]);
  return i < 0 ? null : { i, col: C.cols[i], v: t[serKey()][i] };
}
function spark(arr, w = 96, h = 26) {
  const n = arr.length; if (n < 2) return '';
  const mx = Math.max(...arr) || 1, pts = [];
  for (let i = 0; i < n; i++) pts.push((i / (n - 1) * (w - 2) + 1).toFixed(1) + ',' + (h - 2 - arr[i] / mx * (h - 4)).toFixed(1));
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/></svg>';
}
function rankBadge(n) { return '<span class="rank ' + (n <= 3 ? 'r' + n : '') + '">' + n + '</span>'; }

function renderTop() {
  $('#topTitle').textContent = 'Top ' + C.top.length + ' merchants by ' + metricName();
  $('#topSub').textContent = selectionText() + ' · click a row for details';
  if (!C.top.length) { $('#topTbl').innerHTML = '<tr><td class="empty">No transactions match the current filters.</td></tr>'; return; }
  const total = S.metric === 'count' ? C.N : C.A, mx = val(C.top[0]) || 1;
  let h = '<thead><tr><th>#</th><th>Merchant</th><th>IBAN</th><th>City</th><th class="num">Transactions</th><th class="num">Amount</th><th>Share</th><th class="num">Success</th><th>Peak period</th><th>Trend</th></tr></thead><tbody>';
  C.top.forEach(t => {
    const m = D.merchants[t.m], sr = t.cnt ? t.ok / t.cnt * 100 : 0, pk = peakOf(t);
    h += '<tr class="m" data-m="' + t.m + '"><td>' + rankBadge(t.rank) + '</td>' +
      '<td><div class="mname">' + esc(m.name) + '</div><div class="mid">' + esc(m.id) + (m.mcc ? ' · MCC ' + esc(m.mcc) : '') + '</div></td>' +
      '<td class="iban">' + esc(m.iban || '–') + '</td><td>' + esc(m.city || '–') + '</td>' +
      '<td class="num"><b>' + fmtN(t.cnt) + '</b></td><td class="num">' + fmtN(t.amt) + '</td>' +
      '<td style="min-width:120px"><span>' + (total ? (val(t) / total * 100).toFixed(1) : 0) + '%</span><div class="bar"><b style="width:' + (val(t) / mx * 100).toFixed(1) + '%"></b></div></td>' +
      '<td class="num"><span class="pill ' + (sr >= 90 ? 'g' : sr >= 75 ? 'y' : 'r') + '">' + sr.toFixed(1) + '%</span></td>' +
      '<td class="peak">' + (pk ? esc(pk.col.label) + (C.sep ? ' · ' + esc(dateLabel(pk.col.di).short) : '') + '<small>' + fmtV(pk.v) + ' ' + (S.metric === 'count' ? 'txns' : '') + '</small>' : '–') + '</td>' +
      '<td>' + spark(t[serKey()]) + '</td></tr>';
  });
  $('#topTbl').innerHTML = h + '</tbody>';
}

function renderHeat() {
  const el = $('#heat');
  $('#heatSub').textContent = 'Each cell = ' + metricName() + ' in that period · period size ' + $('#fGran').selectedOptions[0].textContent + (C.sep ? ' · day by day' : ' · days combined');
  if (!C.top.length) { el.innerHTML = '<tr><td class="empty">No data.</td></tr>'; return; }
  const key = serKey();
  let mx = 0; C.top.forEach(t => t[key].forEach(v => { if (v > mx) mx = v; }));
  let head;
  const g = S.gran;
  if (C.sep && g < 96) {
    head = '<tr><th class="sticky" rowspan="2">Merchant · IBAN</th>';
    for (let d = 0; d < C.nd; d++) head += '<th class="dayh" colspan="' + C.nb + '">' + dateLabel(S.d0 + d).full + '</th>';
    head += '<th rowspan="2">Total</th></tr><tr class="h2">';
    C.cols.forEach(c => { head += '<th>' + c.label + '</th>'; });
    head += '</tr>';
  } else {
    head = '<tr><th class="sticky">Merchant · IBAN</th>' + C.cols.map(c => '<th>' + c.label + '</th>').join('') + '<th>Total</th></tr>';
  }
  let body = '';
  C.top.forEach(t => {
    const m = D.merchants[t.m];
    body += '<tr><td class="sticky" data-m="' + t.m + '"><span class="rk">' + t.rank + '</span><span class="mname">' + esc(m.name) + '</span><div class="iban mid" style="padding-left:20px">' + esc(m.iban || '–') + '</div></td>';
    t[key].forEach((v, i) => {
      if (!v) { body += '<td class="z">·</td>'; return; }
      const a = Math.min(1, 0.08 + Math.sqrt(v / mx) * 0.92);
      body += '<td style="background:rgba(var(--accent-rgb),' + a.toFixed(2) + ');color:' + (a > 0.5 ? '#fff' : 'var(--ink)') + '" data-tip="' + esc('<b>' + m.name + '</b><br>' + C.cols[i].full + '<br>' + fmtVfull(v) + ' ' + metricName()) + '">' + fmtV(v) + '</td>';
    });
    body += '<td class="tot">' + fmtV(val(t)) + '</td></tr>';
  });
  el.innerHTML = '<thead>' + head + '</thead><tbody>' + body + '</tbody>';
}

function frame(el, n, minStep) {
  const m = { l: 56, r: 12, t: 10, b: 44 };
  const W = Math.max(320, el.clientWidth - 2, m.l + m.r + n * minStep);
  return { W, m };
}
function yAxis(m, W, H, max) {
  const step = niceStep(max, 4), top = Math.ceil(max / step) * step || 1;
  let s = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = m.t + (H - m.t - m.b) * (1 - v / top);
    s += '<line class="gl" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (m.l - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + compact(v) + '</text>';
  }
  return { svg: s, top };
}
function xLabels(m, W, H, cols, step, every) {
  let s = '';
  cols.forEach((c, i) => {
    if (i % every === 0) s += '<text class="ax" x="' + (m.l + i * step + step / 2) + '" y="' + (H - m.b + 15) + '" text-anchor="middle">' + esc(c.label) + '</text>';
  });
  return s;
}
function dayGroups(m, W, H, step) {
  if (!C.sep || S.gran >= 96) return '';
  let s = '';
  for (let d = 0; d < C.nd; d++) {
    const x0 = m.l + d * C.nb * step, x1 = x0 + C.nb * step;
    if (d > 0) s += '<line x1="' + x0 + '" x2="' + x0 + '" y1="' + m.t + '" y2="' + (H - m.b + 22) + '" stroke="var(--mute)" stroke-dasharray="3 3" opacity=".5"/>';
    s += '<text class="ax" font-weight="600" x="' + ((x0 + x1) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + dateLabel(S.d0 + d).short + '</text>';
  }
  return s;
}

function renderStack() {
  const el = $('#stack'), n = C.ncols, H = 320;
  $('#stackSub').textContent = selectionText() + ' · ' + metricName() + ' per period';
  const key = serKey(), shown = C.top.slice(0, 10), totArr = S.metric === 'count' ? C.allC : C.allA;
  const others = totArr.map((v, i) => Math.max(0, v - shown.reduce((a, t) => a + t[key][i], 0)));
  const series = shown.map((t, i) => ({ name: D.merchants[t.m].name, color: PAL[i % PAL.length], data: t[key] }));
  if (others.some(v => v > 0.5)) series.push({ name: 'Other merchants', color: OTHER, data: others });
  $('#stackLegend').innerHTML = series.map(s => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('');
  if (!C.N) { el.innerHTML = '<div class="empty">No data.</div>'; return; }
  const { W, m } = frame(el, n, 10), iw = W - m.l - m.r, ih = H - m.t - m.b, step = iw / n, bw = Math.max(2, step * 0.8);
  const mx = Math.max(...totArr), ax = yAxis(m, W, H, mx);
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + ax.svg;
  for (let i = 0; i < n; i++) {
    let acc = 0; const x = m.l + i * step + (step - bw) / 2; let tip = '<b>' + C.cols[i].full + '</b><br>';
    const parts = [];
    series.forEach(sr => {
      const v = sr.data[i]; if (!v) return;
      const h = v / ax.top * ih, y = m.t + ih - (acc + v) / ax.top * ih;
      s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0.5, h).toFixed(1) + '" fill="' + sr.color + '"/>';
      acc += v; parts.push([sr, v]);
    });
    parts.sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(p => { tip += '<i style="background:' + p[0].color + '"></i>' + esc(p[0].name) + ': <b>' + fmtVfull(p[1]) + '</b><br>'; });
    tip += 'Total: <b>' + fmtVfull(acc) + '</b>';
    s += '<rect x="' + (m.l + i * step) + '" y="' + m.t + '" width="' + step + '" height="' + ih + '" fill="transparent" data-tip="' + esc(tip) + '"/>';
  }
  s += xLabels(m, W, H, C.cols, step, Math.max(1, Math.ceil(44 / step))) + dayGroups(m, W, H, step) + '</svg>';
  el.innerHTML = s;
}

function barChart(el, items, opt = {}) {
  const H = opt.h || 230;
  if (!items.length || !items.some(i => i.v > 0)) { el.innerHTML = '<div class="empty">No data.</div>'; return; }
  const { W, m } = frame(el, items.length, opt.min || 10), iw = W - m.l - m.r, ih = H - m.t - m.b, step = iw / items.length, bw = Math.max(2, step * 0.7);
  const mx = Math.max(...items.map(i => i.v)), ax = yAxis(m, W, H, mx), best = argmax(items.map(i => i.v));
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + ax.svg;
  items.forEach((it, i) => {
    const h = it.v / ax.top * ih, x = m.l + i * step + (step - bw) / 2;
    s += '<rect x="' + x.toFixed(1) + '" y="' + (m.t + ih - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="3" fill="' + (i === best ? 'var(--accent)' : 'rgba(var(--accent-rgb),.45)') + '"/>';
    s += '<rect x="' + (m.l + i * step) + '" y="' + m.t + '" width="' + step + '" height="' + ih + '" fill="transparent" data-tip="' + esc('<b>' + it.tipL + '</b><br>' + fmtVfull(it.v) + ' ' + metricName()) + '"/>';
  });
  s += xLabels(m, W, H, items, step, Math.max(1, Math.ceil(36 / step))) + '</svg>';
  el.innerHTML = s;
}

function hbars(el, items, fmt) {
  if (!items.length) { el.innerHTML = '<div class="empty">No data.</div>'; return; }
  const mx = Math.max(...items.map(i => i.v)) || 1;
  el.innerHTML = '<div class="hbars">' + items.map(i => '<div class="hb"><span class="k" title="' + esc(i.k) + '">' + esc(i.k) + '</span><span class="t"><b style="width:' + (i.v / mx * 100).toFixed(1) + '%"></b></span><span class="n">' + (fmt ? fmt(i.v) : fmtN(i.v)) + '</span></div>').join('') + '</div>';
}
function donut(el, map, names, flags) {
  let items = [...map.entries()].map(([k, v]) => ({ k: names[k], v, ok: flags ? flags[k] : null })).sort((a, b) => b.v - a.v);
  if (items.length > 6) { const rest = items.slice(5).reduce((a, i) => a + i.v, 0); items = items.slice(0, 5).concat([{ k: 'Other', v: rest }]); }
  const tot = items.reduce((a, i) => a + i.v, 0);
  if (!tot) { el.innerHTML = '<div class="empty">No data.</div>'; return; }
  const r = 50, c = 2 * Math.PI * r; let acc = 0, s = '<svg width="140" height="140" viewBox="0 0 140 140" style="flex:none">';
  const colors = items.map((i, idx) => i.ok === true ? '#16a34a' : (i.ok === false && /fail|declin|revers|error|timeout/i.test(i.k)) ? ['#e15759', '#f28e2b', '#b07aa1', '#9c755f'][idx % 4] : PAL[idx % PAL.length]);
  items.forEach((i, idx) => {
    const d = i.v / tot * c;
    s += '<circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + colors[idx] + '" stroke-width="22" stroke-dasharray="' + d.toFixed(2) + ' ' + (c - d).toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '" transform="rotate(-90 70 70)" data-tip="' + esc('<b>' + i.k + '</b><br>' + fmtN(i.v) + ' (' + (i.v / tot * 100).toFixed(1) + '%)') + '"/>';
    acc += d;
  });
  s += '<text x="70" y="68" text-anchor="middle" font-size="17" font-weight="700" fill="var(--ink)">' + compact(tot) + '</text><text x="70" y="85" text-anchor="middle" font-size="10" fill="var(--mute)">transactions</text></svg>';
  el.innerHTML = '<div class="donut-w">' + s + '<div class="dl">' + items.map((i, idx) => '<div><i style="background:' + colors[idx] + '"></i><span class="k" title="' + esc(i.k) + '">' + esc(i.k) + '</span><span class="p">' + (i.v / tot * 100).toFixed(1) + '% · ' + fmtN(i.v) + '</span></div>').join('') + '</div></div>';
}

function renderSide() {
  // hour of day
  const hrs = []; for (let h = 0; h < 24; h++) hrs.push({ label: pad(h), v: C.byHour[h], tipL: pad(h) + ':00–' + pad(h) + ':59' });
  barChart($('#hourly'), hrs, { h: 230, min: 14 });
  // days
  $('#dailyCard').hidden = nDates < 2;
  const days = []; for (let d = S.d0; d <= S.d1; d++) days.push({ label: dateLabel(d).short, v: C.byDate[d], tipL: dateLabel(d).full });
  if (nDates >= 2) barChart($('#daily'), days, { h: 230, min: 30 });
  // busiest periods (by transactions)
  const order = [...C.allC.keys()].filter(i => C.allC[i] > 0).sort((a, b) => C.allC[b] - C.allC[a]).slice(0, 6);
  $('#busySub').textContent = 'Top periods across all merchants (' + $('#fGran').selectedOptions[0].textContent + ')';
  hbars($('#busy'), order.map(i => ({ k: (C.sep ? dateLabel(C.cols[i].di).short + ' · ' : '') + C.cols[i].full.split(' · ').pop(), v: C.allC[i] })));
  donut($('#donutStatus'), C.byStatus, D.statuses, D.success);
  donut($('#donutMode'), C.byMode, D.modes);
  const cm = new Map(); C.ranked.forEach(t => { const c = D.merchants[t.m].city || '(blank)'; cm.set(c, (cm.get(c) || 0) + val(t)); });
  hbars($('#cities'), [...cm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ k, v })), fmtV);
}

/* ---------- drawer ---------- */
function openDrawer(mi) {
  const t = C.tot.get(mi), m = D.merchants[mi];
  if (!t) return;
  const sr = t.cnt ? t.ok / t.cnt * 100 : 0, pk = peakOf(t);
  const sts = [...t.st.entries()].sort((a, b) => b[1] - a[1]);
  $('#drawer').innerHTML =
    '<button class="x" id="dx" aria-label="Close">×</button><div class="eyebrow muted">Rank #' + t.rank + ' by ' + metricName() + '</div><h3>' + esc(m.name) + '</h3>' +
    '<dl class="kv"><dt>IBAN</dt><dd class="iban">' + esc(m.iban || '–') + '<button class="copy" data-copy="' + esc(m.iban) + '">Copy</button></dd>' +
    '<dt>Merchant ID</dt><dd>' + esc(m.id) + '</dd><dt>MCC</dt><dd>' + esc(m.mcc || '–') + '</dd>' +
    '<dt>Location</dt><dd>' + esc([m.loc, m.city, m.prov].filter(Boolean).join(', ') || '–') + '</dd></dl>' +
    '<div class="dgrid">' + kpi('Transactions', fmtN(t.cnt), selectionText(), '#4f46e5') + kpi('Amount', compact(t.amt), fmtN(t.amt), '#0891b2') +
    kpi('Success rate', sr.toFixed(1) + '%', fmtN(t.ok) + ' successful', '#16a34a') + kpi('Peak period', pk ? esc(pk.col.label) : '–', pk ? esc(pk.col.full) + ' · ' + fmtVfull(pk.v) : '', '#f28e2b') + '</div>' +
    '<h2 style="font-size:15px;margin:6px 0 8px">' + (S.metric === 'count' ? 'Transactions' : 'Amount') + ' by period</h2><div class="scroll" id="dBars"></div>' +
    '<h2 style="font-size:15px;margin:18px 0 6px">Status breakdown</h2><div id="dSt"></div>';
  $('#overlay').hidden = false; $('#drawer').hidden = false;
  barChart($('#dBars'), t[serKey()].map((v, i) => ({ label: C.cols[i].label, v, tipL: m.name + ' · ' + C.cols[i].full })), { h: 200, min: 12 });
  hbars($('#dSt'), sts.map(([s, v]) => ({ k: D.statuses[s], v })));
}
function closeDrawer() { $('#overlay').hidden = true; $('#drawer').hidden = true; }

/* ---------- export ---------- */
function exportCSV() {
  const key = serKey(), q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['Rank', 'Merchant ID', 'Merchant Name', 'IBAN', 'City', 'Province', 'MCC', 'Transactions', 'Amount', 'Success %'].concat(C.cols.map(c => (C.sep ? dateLabel(c.di).short + ' ' : '') + c.full.split(' · ').pop()));
  const lines = [head.map(q).join(',')];
  C.top.forEach(t => {
    const m = D.merchants[t.m];
    lines.push([t.rank, m.id, m.name, m.iban, m.city, m.prov, m.mcc, t.cnt, t.amt.toFixed(2), (t.cnt ? t.ok / t.cnt * 100 : 0).toFixed(1)].map(q).concat(Array.from(t[key])).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'top_merchants_' + D.dates[S.d0] + '_to_' + D.dates[S.d1] + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- controls ---------- */
function timeToSlot(v, up) { const [h, m] = v.split(':').map(Number), mins = (h || 0) * 60 + (m || 0); return up ? Math.min(96, Math.ceil(mins / 15)) : Math.min(95, Math.floor(mins / 15)); }
function slotToTime(s) { return s >= 96 ? '23:59' : slotLabel(s); }
const QUICK = [['All day', 0, 96], ['00–06', 0, 24], ['06–12', 24, 48], ['12–18', 48, 72], ['18–24', 72, 96]];

function syncControls() {
  $('#fD0').value = S.d0; $('#fD1').value = S.d1;
  $('#fT0').value = slotToTime(S.t0); $('#fT1').value = slotToTime(S.t1);
  document.querySelectorAll('#quick .chip').forEach(c => c.classList.toggle('on', +c.dataset.a === S.t0 && +c.dataset.b === S.t1));
  document.querySelectorAll('#statusChips .chip[data-s]').forEach(c => c.classList.toggle('on', S.st.has(+c.dataset.s)));
  document.querySelectorAll('#segMetric button').forEach(b => b.classList.toggle('on', b.dataset.v === S.metric));
  document.querySelectorAll('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.v === S.mode));
  $('#fTop').value = S.topN; $('#fGran').value = S.gran; $('#fQ').value = S.q;
  $('#modeGroup').hidden = S.d0 === S.d1;
}
function update() { syncControls(); render(); }

function init() {
  const opts = D.dates.map((d, i) => '<option value="' + i + '">' + dateLabel(i).full + '</option>').join('');
  $('#fD0').innerHTML = opts; $('#fD1').innerHTML = opts;
  $('#quick').innerHTML = QUICK.map(q => '<span class="chip" data-a="' + q[1] + '" data-b="' + q[2] + '">' + q[0] + '</span>').join('');
  $('#statusChips').innerHTML = D.statuses.map((s, i) => '<span class="chip on" data-s="' + i + '"><i class="' + (D.success[i] ? 'ok' : 'bad') + '"></i>' + esc(s) + '</span>').join('');

  $('#fD0').onchange = e => { S.d0 = +e.target.value; if (S.d0 > S.d1) S.d1 = S.d0; update(); };
  $('#fD1').onchange = e => { S.d1 = +e.target.value; if (S.d1 < S.d0) S.d0 = S.d1; update(); };
  $('#fT0').onchange = e => { S.t0 = timeToSlot(e.target.value, false); if (S.t1 <= S.t0) S.t1 = Math.min(96, S.t0 + 1); update(); };
  $('#fT1').onchange = e => { S.t1 = timeToSlot(e.target.value, true); if (S.t1 <= S.t0) S.t0 = Math.max(0, S.t1 - 1); update(); };
  $('#quick').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; S.t0 = +c.dataset.a; S.t1 = +c.dataset.b; update(); };
  $('#statusChips').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; const i = +c.dataset.s; S.st.has(i) ? S.st.delete(i) : S.st.add(i); update(); };
  $('#segMetric').onclick = e => { const b = e.target.closest('button'); if (b) { S.metric = b.dataset.v; update(); } };
  $('#segMode').onclick = e => { const b = e.target.closest('button'); if (b) { S.mode = b.dataset.v; update(); } };
  $('#fTop').onchange = e => { S.topN = +e.target.value; update(); };
  $('#fGran').onchange = e => { S.gran = +e.target.value; update(); };
  let timer; $('#fQ').oninput = e => { clearTimeout(timer); timer = setTimeout(() => { S.q = e.target.value; render(); }, 180); };
  $('#btnReset').onclick = () => { S = DEF(); update(); };
  $('#btnExport').onclick = exportCSV;

  document.addEventListener('click', e => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const txt = cp.dataset.copy, done = () => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy'; }, 1200); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, () => {});
      else { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (_) {} ta.remove(); }
      return;
    }
    if (e.target.id === 'dx' || e.target.id === 'overlay') return closeDrawer();
    const r = e.target.closest('[data-m]');
    if (r) openDrawer(+r.dataset.m);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t.getAttribute('data-tip'); tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 16 + h > window.innerHeight ? e.clientY - h - 12 : e.clientY + 16) + 'px';
  });

  let theme = null; try { theme = localStorage.getItem('dash-theme'); } catch (_) {}
  if (theme !== 'dark') theme = 'light';
  document.documentElement.dataset.theme = theme;
  $('#btnTheme').onclick = () => {
    theme = theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('dash-theme', theme); } catch (_) {}
  };
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 200); });
  update();
}
init();
})();
