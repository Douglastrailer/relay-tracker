// ============================================================
// RelayFleet — Phase 8: analytics.
// Every number comes from shop_analytics() in the database, for the
// whole period selected (replacing the old "last 20 jobs" view).
// ============================================================

let anState = { range:'30', data:null, from:null, to:null };
const anMoney = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
const anMoney0 = n => '$' + Math.round(Number(n || 0)).toLocaleString();
function anMinutes(m){ if(m == null) return '—'; m = Math.round(m); if(m < 60) return m + ' min'; return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; }
function anHours(h){ return h == null ? '—' : Number(h).toLocaleString(undefined, { maximumFractionDigits:1 }) + ' h'; }

// Periods run from local midnight to the end of today (exclusive end).
function anRange(){
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() + 1);
  const r = anState.range;
  if(r === 'custom'){
    const f = document.getElementById('anFrom').value, t = document.getElementById('anTo').value;
    if(!f || !t) return null;
    const from = new Date(f + 'T00:00:00'), to = new Date(t + 'T00:00:00'); to.setDate(to.getDate() + 1);
    return { from, to };
  }
  if(r === 'year') return { from: new Date(today.getFullYear(), 0, 1), to: end };
  const from = new Date(today); from.setDate(from.getDate() - (({ today:0, '7':6, '30':29, '90':89 })[r] || 0));
  return { from, to: end };
}

async function refreshAnalyticsV2(){
  const root = document.getElementById('anRoot');
  if(!root) return;
  document.querySelectorAll('#anRanges [data-r]').forEach(b => b.classList.toggle('active', b.dataset.r === anState.range));
  document.getElementById('anCustom').classList.toggle('hidden', anState.range !== 'custom');
  const rg = anRange();
  const out = document.getElementById('anOut');
  if(!rg){ out.innerHTML = '<p class="meta">Pick a start and end date.</p>'; return; }
  if(rg.to <= rg.from){ out.innerHTML = '<p class="form-error">The end date must be after the start date.</p>'; return; }
  if(!anState.data) out.innerHTML = skelTiles(8) + skelRows(4);   // the layout of the report; an existing report stays while it updates
  anLocationPicker();
  const args = { p_from: rg.from.toISOString(), p_to: rg.to.toISOString() };
  if(anState.loc) args.p_location = anState.loc;   // 'all', or a location id; none = the location being worked in
  // the period just before, of the same length, is asked for at the same time (for the comparison)
  const span = rg.to.getTime() - rg.from.getTime();
  const prevArgs = Object.assign({}, args, { p_from: new Date(rg.from.getTime() - span).toISOString(), p_to: rg.from.toISOString() });
  const [cur, prevRes] = await Promise.all([sb.rpc('shop_analytics', args), sb.rpc('shop_analytics', prevArgs)]);
  const { data, error } = cur;
  anState.prev = prevRes && !prevRes.error && prevRes.data ? prevRes.data : null;
  anState.prevFrom = new Date(rg.from.getTime() - span); anState.prevTo = new Date(rg.from.getTime() - 1);
  if(error || !data || !data.summary){ out.innerHTML = `<p class="form-error">The report couldn't be worked out${error ? ': ' + esc(error.message) : '.'}</p>`; return; }
  anState.data = data; anState.from = rg.from; anState.to = rg.to;
  renderAnalyticsV2();
  if(typeof refreshProfit === 'function') refreshProfit(rg);
}

function renderAnalyticsV2(){
  const d = anState.data; if(!d || !d.summary) return;   // nothing loaded yet
  const s = d.summary;
  const marginPct = Number(s.revenue) > 0 ? Math.round(Number(s.gross_margin) / Number(s.revenue) * 100) : null;
  const ps = (anState.prev && anState.prev.summary) || null;
  // the change against the previous period; for times, lower is better
  const delta = (key, lowerIsBetter) => anDeltaHtml(s[key], ps ? ps[key] : null, lowerIsBetter);
  const tile = (label, value, sub, cls, d) => `<div class="an-tile${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}${d || ''}</div>`;
  const toLabel = new Date(anState.to.getTime() - 1);
  document.getElementById('anOut').innerHTML = `
    <p class="meta an-period">${anState.from.toLocaleDateString()} – ${toLabel.toLocaleDateString()}${d.location && (d.location.all || d.location.name) ? ' · <span>' + esc(d.location.all ? 'All locations' : d.location.name) + '</span>' : ''}</p>
    ${anByLocationHtml(d.by_location)}
    <div class="an-tiles">
      ${tile('Revenue billed', anMoney0(s.revenue), relayFmt(s.invoices === 1 ? '{n} invoice' : '{n} invoices', { n: s.invoices }), '', delta('revenue', false))}
      ${tile('Collected', anMoney0(s.collected), 'payments received in this period', '', delta('collected', false))}
      ${tile('Average work order', anMoney(s.avg_ro), '', '', delta('avg_ro', false))}
      ${tile('Gross margin', anMoney0(s.gross_margin), marginPct == null ? 'after parts cost' : relayFmt('{p}% after {m} parts cost', { p: marginPct, m: anMoney0(s.parts_cost) }), '', delta('gross_margin', false))}
      ${tile('Jobs completed', s.jobs_completed, relayFmt('{n} opened', { n: s.jobs_opened }), '', delta('jobs_completed', false))}
      ${tile('Response time', anMinutes(s.avg_response_minutes), 'request to work started', '', delta('avg_response_minutes', true))}
      ${tile('Roadside arrival', anMinutes(s.avg_roadside_minutes), 'request to on site', '', delta('avg_roadside_minutes', true))}
      ${tile('Repair time', anHours(s.avg_repair_hours), 'opened to completed', '', delta('avg_repair_hours', true))}
      ${tile('Labor hours', anHours(s.labor_hours), 'from mechanics\' timers', '', delta('labor_hours', false))}
      ${tile('Unpaid invoices', anMoney0(s.unpaid_total), `${esc(relayFmt('{n} open', { n: s.unpaid_count }))}${Number(s.overdue_total) ? ` · <b class="neg">${esc(relayFmt('{m} overdue', { m: anMoney0(s.overdue_total) }))}</b>` : ''}`, Number(s.overdue_total) ? 'warn' : '')}
    </div>
    ${anState.prev ? `<p class="meta an-vs">${esc(relayFmt('Compared with {from} – {to}', { from: anState.prevFrom.toLocaleDateString(relayLocale()), to: anState.prevTo.toLocaleDateString(relayLocale()) }))}</p>` : ''}
    <div class="an-csv-row"><button type="button" class="text-btn" data-csv="summary">${esc(relayFmt('Download these figures (CSV)'))}</button></div>
    ${anSplitHtml(d.split, anState.prev && anState.prev.split)}
    <section class="ro-sec"><h4>${esc(relayFmt('Revenue by {b}', { b: relayFmt(d.bucket) }))}</h4>${trendChart(d.trend, d.bucket)}</section>
    ${anTable('Technicians', 'tech', ['Mechanic','Jobs done','Roadside / in-shop','Labor','Drive','Avg completion','Revenue'],
      d.technicians.map(t => [esc(t.name) + (t.active ? '' : ' <span class="meta">(inactive)</span>'), t.jobs_completed, `${t.roadside} / ${t.inshop}`, anHours(t.labor_hours), anHours(t.drive_hours), anHours(t.avg_completion_hours), anMoney(t.revenue)]),
      'No mechanics yet.')}
    ${anTable('Customers', 'cust', ['Customer','Revenue','Invoices','Avg ticket','Jobs opened','Repeat','Owes now'],
      d.customers.map(c => [esc(c.name || '—'), anMoney(c.revenue), c.invoices, anMoney(c.avg_ticket), c.jobs, c.repeat ? 'Yes' : '—', Number(c.outstanding) ? `<b class="neg">${anMoney(c.outstanding)}</b>` : '—']),
      'No billed customers in this period.')}
    ${anTable('Units', 'unit', ['Unit','Customer','Repair cost','Repairs opened','Downtime','Last service'],
      d.units.map(u => [`<button type="button" class="text-btn an-unit" data-unit="${u.unit_id}">${esc(({ truck:'Truck', trailer:'Trailer' })[u.unit_type] || 'Unit')} ${esc(u.unit_number)}</button>`, esc(u.customer || '—'), anMoney(u.cost), u.repairs, anHours(u.downtime_hours), u.last_service ? fmtDate(u.last_service) : '—']),
      'No unit activity in this period.')}`;
  document.querySelectorAll('#anOut [data-csv]').forEach(b => b.onclick = () => downloadAnCsv(b.dataset.csv));
  document.querySelectorAll('#anOut .an-unit').forEach(b => b.onclick = () => { if(typeof openUnitHistory === 'function') openUnitHistory(Number(b.dataset.unit)); });
}

function anTable(title, key, heads, rows, empty){
  return `<section class="ro-sec an-table-sec"><div class="an-table-head"><h4>${esc(title)}</h4>${rows.length ? `<button type="button" class="text-btn" data-csv="${key}">Download CSV</button>` : ''}</div>
    ${rows.length ? `<div class="an-scroll"><table class="an-table"><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="meta">${esc(empty)}</p>`}</section>`;
}

// Simple bar chart, drawn as SVG; colors follow the page theme.
function trendChart(trend, bucket){
  if(!trend.length) return '<p class="meta">No data.</p>';
  const W = 900, H = 220, pad = { l:56, r:10, t:10, b:34 };
  const max = Math.max(1, ...trend.map(t => Number(t.revenue)));
  const nice = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / nice) * nice;
  const bw = (W - pad.l - pad.r) / trend.length;
  const fmt = p => { const d = new Date(p); return bucket === 'month' ? d.toLocaleDateString(undefined, { month:'short' }) : d.toLocaleDateString(undefined, { month:'short', day:'numeric' }); };
  const every = Math.ceil(trend.length / 10);
  const total = trend.reduce((s, t) => s + Number(t.revenue), 0);
  return `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue by ${esc(bucket)}, total ${anMoney0(total)}">
    ${[0, 0.5, 1].map(f => { const y = pad.t + (H - pad.t - pad.b) * (1 - f); return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="an-grid"/><text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" class="an-axis">${anMoney0(top * f)}</text>`; }).join('')}
    ${trend.map((t, i) => { const h = (H - pad.t - pad.b) * Number(t.revenue) / top; const x = pad.l + i * bw;
      return `<rect x="${(x + bw * 0.15).toFixed(1)}" y="${(H - pad.b - h).toFixed(1)}" width="${Math.max(1, bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="an-bar"><title>${fmt(t.period)}: ${anMoney(t.revenue)} · ${t.jobs_completed} job${t.jobs_completed === 1 ? '' : 's'} completed</title></rect>
        ${i % every === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="an-axis">${esc(fmt(t.period))}</text>` : ''}`; }).join('')}
  </svg>`;
}

function downloadAnCsv(key){
  const d = anState.data, q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const sets = {
    tech: [['Mechanic','Jobs completed','Roadside','In-shop','Labor hours','Drive hours','Avg completion hours','Revenue'], d.technicians.map(t => [t.name, t.jobs_completed, t.roadside, t.inshop, t.labor_hours, t.drive_hours, t.avg_completion_hours, t.revenue])],
    cust: [['Customer','Revenue','Invoices','Avg ticket','Jobs opened','Repeat','Owes now'], d.customers.map(c => [c.name, c.revenue, c.invoices, c.avg_ticket, c.jobs, c.repeat ? 'yes' : 'no', c.outstanding])],
    unit: [['Unit','Type','Customer','Repair cost','Repairs opened','Downtime hours','Last service'], d.units.map(u => [u.unit_number, u.unit_type, u.customer, u.cost, u.repairs, u.downtime_hours, u.last_service ? new Date(u.last_service).toLocaleDateString() : ''])]
  };
  const pv = (anState.prev && anState.prev.summary) || {}, sp = d.split || {}, ppv = (anState.prev && anState.prev.split) || {};
  const ch = (a, b) => (b == null || Number(b) === 0 || a == null) ? '' : Math.round((Number(a) - Number(b)) / Math.abs(Number(b)) * 1000) / 10 + '%';
  const figs = [['Revenue billed', 'revenue'], ['Invoices', 'invoices'], ['Collected', 'collected'], ['Average work order', 'avg_ro'], ['Gross margin', 'gross_margin'], ['Parts cost', 'parts_cost'],
    ['Jobs opened', 'jobs_opened'], ['Jobs completed', 'jobs_completed'], ['Response time (minutes)', 'avg_response_minutes'], ['Roadside arrival (minutes)', 'avg_roadside_minutes'],
    ['Repair time (hours)', 'avg_repair_hours'], ['Labor hours', 'labor_hours'], ['Unpaid invoices', 'unpaid_total'], ['Overdue', 'overdue_total']];
  sets.summary = [['Figure', 'This period', 'Previous period', 'Change'], figs.map(([l, k]) => [l, d.summary[k], pv[k], ch(d.summary[k], pv[k])])];
  const parts = [['Labor', 'labor'], ['Labor hours billed', 'labor_hours'], ['Parts', 'parts'], ['Parts cost', 'parts_cost'], ['Parts margin', 'parts_margin'], ['Fees and mileage', 'fees'], ['Other', 'other'], ['Tax and adjustments', 'tax_and_adjustments']];
  sets.split = [['Part of revenue', 'This period', 'Previous period', 'Change'], parts.map(([l, k]) => [l, sp[k], ppv[k], ch(sp[k], ppv[k])])];
  const [head, rows] = sets[key];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([[head, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type:'text/csv' }));
  a.download = `relay-${({ tech: 'technicians', cust: 'customers', unit: 'units', summary: 'figures', split: 'revenue-split' })[key]}-${anState.from.toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

function initAnalyticsV2(){
  const root = document.getElementById('anRoot');
  if(!root) return;
  root.querySelectorAll('#anRanges [data-r]').forEach(b => b.onclick = () => { anState.range = b.dataset.r; refreshAnalyticsV2(); });
  document.getElementById('anApply').onclick = refreshAnalyticsV2;
  document.querySelectorAll('.dash-tab[data-target="shop-analytics"]').forEach(t => t.addEventListener('click', refreshAnalyticsV2));
}


// ---- Reports by location (migration 0048) ----
// The owner chooses: the location being worked in (default), any other location, or All locations,
// which adds a side-by-side comparison. Office staff always see their own location (the database decides).
function anLocationPicker(){
  const host = document.getElementById('anRanges'); if(!host) return;
  let box = document.getElementById('anLocBox');
  const locs = (typeof relayLocations !== 'undefined' ? relayLocations : []) || [];
  const owner = typeof session !== 'undefined' && session && session.staffRole === 'owner';
  if(!owner || locs.length < 2){ if(box) box.remove(); anState.loc = null; return; }
  if(box) return;
  box = document.createElement('label'); box.id = 'anLocBox'; box.className = 'an-loc';
  const cur = typeof currentLocationId === 'function' ? currentLocationId() : null;
  box.innerHTML = `<span>Location</span><select id="anLocSel" aria-label="Location for these reports">
      <option value="">${cur && typeof chosenLocation === 'function' && chosenLocation() ? esc(relayFmt('This location ({name})', { name: locDisplayName(chosenLocation()) })) : esc(relayFmt('This location'))}</option>
      ${locs.filter(l => l.id !== cur).map(l => `<option value="${l.id}">${esc(l.display_name || l.name)}</option>`).join('')}
      <option value="all">All locations — compare side by side</option></select>`;
  host.after(box);
  box.querySelector('#anLocSel').onchange = (e) => { anState.loc = e.target.value || null; refreshAnalyticsV2(); };
}
function anByLocationHtml(rows){
  if(!rows || !rows.length) return '';
  const head = ['Location', 'Revenue', 'Invoices', 'Collected', 'Opened', 'Completed', 'Unpaid', 'Overdue'];
  return `<div class="an-byloc"><h3>Locations side by side</h3><div class="an-table-wrap"><table class="an-table">
    <thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${anMoney0(r.revenue)}</td><td>${Number(r.invoices || 0)}</td><td>${anMoney0(r.collected)}</td><td>${Number(r.jobs_opened || 0)}</td><td>${Number(r.jobs_completed || 0)}</td><td>${anMoney0(r.unpaid_total)}</td><td class="${Number(r.overdue_total) > 0 ? 'an-over' : ''}">${anMoney0(r.overdue_total)}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}


// ---- comparison with the previous period ----
function anDeltaHtml(cur, prev, lowerIsBetter, neutral){
  if(cur == null || prev == null || Number(prev) === 0) return '';
  const pct = (Number(cur) - Number(prev)) / Math.abs(Number(prev)) * 100;
  if(!isFinite(pct)) return '';
  const r = Math.round(pct);
  if(r === 0) return `<small class="an-delta">${esc(relayFmt('Same as previous period'))}</small>`;
  const better = lowerIsBetter ? r < 0 : r > 0;
  return `<small class="an-delta${neutral ? '' : better ? ' is-up' : ' is-down'}">${r > 0 ? '▲' : '▼'} ${esc(relayFmt('{p}% vs previous period', { p: Math.abs(r) }))}</small>`;
}

// ---- what revenue is made of ----
function anSplitHtml(sp, prev){
  if(!sp) return '';
  const total = ['labor', 'parts', 'fees', 'other', 'tax_and_adjustments'].reduce((a, k) => a + Math.max(0, Number(sp[k] || 0)), 0);
  if(!total) return '';
  const pct = v => Math.max(0, Number(v || 0)) / total * 100;
  const rows = [['labor', 'Labor'], ['parts', 'Parts'], ['fees', 'Fees and mileage'], ['other', 'Other'], ['tax_and_adjustments', 'Tax and adjustments']];
  const rate = Number(sp.labor_hours) ? Number(sp.labor) / Number(sp.labor_hours) : null;
  const pm = Number(sp.parts) ? Math.round(Number(sp.parts_margin) / Number(sp.parts) * 100) : null;
  const extra = { labor: rate != null ? relayFmt('{h} h billed · {r} per hour', { h: Math.round(Number(sp.labor_hours) * 10) / 10, r: anMoney(rate) }) : '',
                  parts: relayFmt('cost {c} · margin {m}', { c: anMoney0(sp.parts_cost), m: anMoney0(sp.parts_margin) }) + (pm != null ? ' (' + pm + '%)' : '') };
  return `<section class="ro-sec an-split"><div class="an-split-head"><h4>${esc(relayFmt('What revenue is made of'))}</h4><button type="button" class="text-btn" data-csv="split">${esc(relayFmt('Download CSV'))}</button></div>
    <div class="an-split-bar" role="img" aria-label="${esc(rows.map(([k, l]) => relayFmt(l) + ' ' + Math.round(pct(sp[k])) + '%').join(', '))}">${rows.map(([k]) => pct(sp[k]) > 0 ? `<span class="an-seg an-seg-${k}" style="width:${pct(sp[k]).toFixed(2)}%"></span>` : '').join('')}</div>
    <div class="an-split-rows">${rows.map(([k, l]) => `<div class="an-split-row"><i class="an-dot an-seg-${k}" aria-hidden="true"></i><span class="an-split-label">${esc(relayFmt(l))}</span>
      <b>${anMoney0(sp[k])}</b><span class="meta">${Math.round(pct(sp[k]))}%${extra[k] ? ' · ' + esc(extra[k]) : ''}</span>${anDeltaHtml(sp[k], prev ? prev[k] : null, false, k === 'tax_and_adjustments')}</div>`).join('')}</div></section>`;
}
