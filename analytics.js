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
  out.innerHTML = '<p class="meta">Calculating…</p>';
  const { data, error } = await sb.rpc('shop_analytics', { p_from: rg.from.toISOString(), p_to: rg.to.toISOString() });
  if(error){ out.innerHTML = `<p class="form-error">${esc(error.message)}</p>`; return; }
  anState.data = data; anState.from = rg.from; anState.to = rg.to;
  renderAnalyticsV2();
}

function renderAnalyticsV2(){
  const d = anState.data, s = d.summary;
  const marginPct = Number(s.revenue) > 0 ? Math.round(Number(s.gross_margin) / Number(s.revenue) * 100) : null;
  const tile = (label, value, sub, cls) => `<div class="an-tile${cls ? ' ' + cls : ''}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const toLabel = new Date(anState.to.getTime() - 1);
  document.getElementById('anOut').innerHTML = `
    <p class="meta an-period">${anState.from.toLocaleDateString()} – ${toLabel.toLocaleDateString()}</p>
    <div class="an-tiles">
      ${tile('Revenue billed', anMoney0(s.revenue), `${s.invoices} invoice${s.invoices === 1 ? '' : 's'}`)}
      ${tile('Collected', anMoney0(s.collected), 'payments received in this period')}
      ${tile('Average work order', anMoney(s.avg_ro), '')}
      ${tile('Gross margin', anMoney0(s.gross_margin), marginPct == null ? 'after parts cost' : `${marginPct}% after ${anMoney0(s.parts_cost)} parts cost`)}
      ${tile('Jobs completed', s.jobs_completed, `${s.jobs_opened} opened`)}
      ${tile('Response time', anMinutes(s.avg_response_minutes), 'request to work started')}
      ${tile('Roadside arrival', anMinutes(s.avg_roadside_minutes), 'request to on site')}
      ${tile('Repair time', anHours(s.avg_repair_hours), 'opened to completed')}
      ${tile('Labor hours', anHours(s.labor_hours), 'from mechanics\' timers')}
      ${tile('Unpaid invoices', anMoney0(s.unpaid_total), `${s.unpaid_count} open${Number(s.overdue_total) ? ` · <b class="neg">${anMoney0(s.overdue_total)} overdue</b>` : ''}`, Number(s.overdue_total) ? 'warn' : '')}
    </div>
    <section class="ro-sec"><h4>Revenue by ${esc(d.bucket)}</h4>${trendChart(d.trend, d.bucket)}</section>
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
  const [head, rows] = sets[key];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([[head, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type:'text/csv' }));
  a.download = `relay-${key === 'tech' ? 'technicians' : key === 'cust' ? 'customers' : 'units'}-${anState.from.toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}

function initAnalyticsV2(){
  const root = document.getElementById('anRoot');
  if(!root) return;
  root.querySelectorAll('#anRanges [data-r]').forEach(b => b.onclick = () => { anState.range = b.dataset.r; refreshAnalyticsV2(); });
  document.getElementById('anApply').onclick = refreshAnalyticsV2;
  document.querySelectorAll('.dash-tab[data-target="shop-analytics"]').forEach(t => t.addEventListener('click', refreshAnalyticsV2));
}
