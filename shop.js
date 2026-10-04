// ============================================================
// RelayFleet — Redesign R1: Dashboard, Work orders, navigation, global
// search, and the work order "control center" summary. Everything reads
// existing tables; the database rules decide what each role sees.
// ============================================================

const shopMoney = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
const shopMoney0 = n => '$' + Math.round(Number(n || 0)).toLocaleString();
const WAITING_SET = ['waiting_approval','waiting_parts'];
let woCache = { active:[], history:[], mechanics:[], metrics:{} };

function goToPanel(target){
  const t = document.querySelector(`.dash-tab[data-target="${target}"]`);
  if(t) t.click();
}

// ---------------- Today ----------------
async function renderTodayTiles(active, mechanics, liveCount){
  const box = document.getElementById('todayTiles');
  if(!box) return;
  const d = document.getElementById('todayDate');
  if(d) d.textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const inShop = active.filter(j => j.job_type === 'inshop').length;
  const roadside = active.filter(j => j.job_type === 'mobile').length;
  const tile = (n, label, sub, group, cls) => `<button type="button" class="today-tile${cls ? ' ' + cls : ''}" data-group="${group || ''}"><b>${n}</b><span>${esc(label)}</span>${sub ? `<em>${sub}</em>` : ''}</button>`;
  const draw = (done, revenue) => {
    box.innerHTML =
      tile(active.length, 'Open work orders', '', 'open') +
      tile(inShop, 'Vehicles in shop', '', 'inshop') +
      tile(roadside, 'Roadside calls', liveCount ? liveCount + ' mechanic' + (liveCount === 1 ? '' : 's') + ' live' : '', 'roadside') +
      tile(active.filter(j => j.status === 'waiting_approval').length, 'Waiting for approval', '', 'waiting', active.some(j => j.status === 'waiting_approval') ? 'attn' : '') +
      tile(active.filter(j => j.status === 'waiting_parts').length, 'Waiting for parts', '', 'waiting', active.some(j => j.status === 'waiting_parts') ? 'attn' : '') +
      tile(done == null ? '…' : done, 'Completed today', '', 'done') +
      (revenue === undefined ? '' : tile(revenue == null ? '…' : shopMoney0(revenue), 'Revenue today', 'invoiced today', '', ''));
    box.querySelectorAll('.today-tile[data-group]').forEach(b => b.onclick = () => {
      if(!b.dataset.group) return;
      const g = document.getElementById('woFilterGroup'); if(g) g.value = b.dataset.group;
      goToPanel('shop-jobs'); renderWorkOrdersList();
    });
  };
  const billing = typeof can !== 'function' || can('billing');
  draw(null, billing ? null : undefined);
  // Exact counts from the database (not limited to the recent list).
  const [doneRes, revRes] = await Promise.all([
    sb.from('jobs').select('id', { count:'exact', head:true }).eq('org_id', session.orgId).gte('completed_at', midnight.toISOString()).in('status', ['complete','invoiced','paid']),
    billing ? sb.from('invoices').select('total').eq('org_id', session.orgId).eq('kind', 'invoice').neq('status', 'draft').gte('created_at', midnight.toISOString()) : Promise.resolve({ data:null })
  ]);
  draw(doneRes.count ?? 0, billing ? (revRes.data || []).reduce((s, r) => s + Number(r.total || 0), 0) : undefined);
}

// ---------------- Board cards ----------------
async function fetchBoardMetrics(ids){
  const out = {};
  if(!ids.length) return out;
  ids.forEach(id => out[id] = {});
  const billing = typeof can !== 'function' || can('billing');
  const [t, pts, est, helpers] = await Promise.all([
    sb.from('job_time_summary').select('job_id, labor_minutes').in('job_id', ids),
    sb.from('job_parts').select('job_id, qty, returned_qty, unit_price').in('job_id', ids),
    billing ? sb.from('invoices').select('job_id, kind, status, total, created_at').in('job_id', ids).eq('kind', 'estimate').order('created_at') : Promise.resolve({ data:[] }),
    typeof helperCounts === 'function' ? helperCounts(ids) : Promise.resolve({})
  ]);
  Object.entries(helpers || {}).forEach(([id, n]) => { if(out[id]) out[id].helpers = n; });
  (t.data || []).forEach(r => { if(out[r.job_id]) out[r.job_id].laborH = Number(r.labor_minutes || 0) / 60; });
  (pts.data || []).forEach(r => { if(out[r.job_id]) out[r.job_id].parts = (out[r.job_id].parts || 0) + (Number(r.qty) - Number(r.returned_qty)) * Number(r.unit_price || 0); });
  (est.data || []).forEach(r => { if(out[r.job_id]) { out[r.job_id].estimate = Number(r.total || 0); out[r.job_id].estimateStatus = r.status; } });
  return out;
}
function woCardHtml(j, techName, m){
  m = m || {};
  const facts = [];
  if(m.laborH) facts.push(`<span><em>Labor</em>${m.laborH.toFixed(1)} h</span>`);
  if(m.parts) facts.push(`<span><em>Parts</em>${shopMoney0(m.parts)}</span>`);
  if(m.estimate != null) facts.push(`<span><em>Estimate</em>${shopMoney0(m.estimate)}</span>`);
  return `<div class="job-card wo-card${j.safety_issue ? ' is-safety' : ''}${j.priority === 'urgent' || j.priority === 'high' ? ' is-prio' : ''}" data-job="${j.id}" data-jobtype="${esc(j.job_type)}" data-status="${esc(j.status)}" draggable="${j.status === 'invoiced' ? 'false' : 'true'}" tabindex="0" role="button" aria-label="Open ${esc(j.ro_number || 'work order')}">
      <div class="wo-card-top"><span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span>${j.job_type === 'mobile' ? '<span class="wo-road" title="Roadside">ROAD</span>' : ''}${j.priority && j.priority !== 'normal' ? `<span class="prio-chip prio-${esc(j.priority)}">${esc(PRIORITY_LABELS[j.priority] || j.priority)}</span>` : ''}${j.warranty_claim_status === 'pending_review' ? '<span class="prio-chip prio-high">Warranty?</span>' : ''}</div>
      <div class="wo-card-unit">${esc(j.vehicle || '')}</div>
      ${j.complaint ? `<div class="wo-card-svc">${esc(j.complaint.length > 70 ? j.complaint.slice(0, 68) + '…' : j.complaint)}</div>` : ''}
      <div class="wo-card-meta"><span>${esc(j.customer || '')}</span><span>${esc(techName || 'Unassigned')}${m.helpers ? ' +' + m.helpers : ''}</span></div>
      <div class="wo-card-foot">${jobStatusBadge(j.status)}${facts.length ? `<div class="wo-card-facts">${facts.join('')}</div>` : ''}</div>
    </div>`;
}
// Board cards open their work order (drag still moves them).
document.addEventListener('click', (e) => {
  const c = e.target.closest('#shopKanbanBoard .wo-card, #woList .wo-row:not(.wo-thead), #shopHistoryList .wo-row');
  if(c && !e.target.closest('button, a, select, input')) openRepairOrder(Number(c.dataset.job));
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && e.target.matches && e.target.matches('#shopKanbanBoard .wo-card, #woList .wo-row, #shopHistoryList .wo-row')) openRepairOrder(Number(e.target.dataset.job));
});

// ---------------- Work orders list ----------------
function renderWorkOrdersList(active, history, mechanics, metrics){
  if(active) woCache = { active, history: history || [], mechanics: mechanics || [], metrics: metrics || {} };
  const box = document.getElementById('woList');
  if(!box) return;
  const techSel = document.getElementById('woFilterTech');
  if(techSel && techSel.options.length <= 1 && woCache.mechanics.length){
    techSel.insertAdjacentHTML('beforeend', woCache.mechanics.filter(m => m.active).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join(''));
  }
  const group = (document.getElementById('woFilterGroup') || {}).value || 'open';
  const tech = techSel ? techSel.value : '';
  const q = ((document.getElementById('woFilterText') || {}).value || '').trim().toLowerCase();
  let rows = group === 'done' ? woCache.history : group === 'all' ? woCache.active.concat(woCache.history) : woCache.active;
  if(group === 'waiting') rows = rows.filter(j => WAITING_SET.includes(j.status));
  if(group === 'roadside') rows = rows.filter(j => j.job_type === 'mobile');
  if(group === 'inshop') rows = rows.filter(j => j.job_type === 'inshop');
  if(tech) rows = rows.filter(j => j.mechanic_id === tech);
  if(q) rows = rows.filter(j => [j.ro_number, j.ro_number && j.ro_number.replace(/^WO-0*/, ''), j.customer, j.vehicle, j.complaint].some(v => v && String(v).toLowerCase().includes(q)));
  rows = rows.slice().sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  const name = id => (woCache.mechanics.find(m => m.id === id) || {}).name || 'Unassigned';
  box.innerHTML = rows.length ? `<div class="wo-table">
      <div class="wo-row wo-thead" aria-hidden="true"><span>Work order</span><span>Customer · Unit</span><span>Service</span><span>Technician</span><span>Status</span><span>Updated</span></div>
      ${rows.map(j => `<div class="wo-row" data-job="${j.id}" tabindex="0" role="button" aria-label="Open ${esc(j.ro_number || 'work order')}">
        <span><span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span>${j.job_type === 'mobile' ? ' <span class="wo-road">ROAD</span>' : ''}${j.priority === 'urgent' || j.priority === 'high' ? ` <span class="prio-chip prio-${esc(j.priority)}">${esc(PRIORITY_LABELS[j.priority])}</span>` : ''}</span>
        <span><b>${esc(j.customer || '')}</b><span class="meta"> · ${esc(j.vehicle || '')}</span></span>
        <span class="wo-svc">${esc(j.complaint || '—')}</span>
        <span>${esc(name(j.mechanic_id))}</span>
        <span>${jobStatusBadge(j.status)}</span>
        <span class="meta">${fmtDateTime(j.updated_at || j.created_at)}</span>
      </div>`).join('')}</div>`
    : `<div class="empty-note">${woCache.active.length || woCache.history.length ? 'No work orders match these filters.' : 'No work orders yet. Click "+ New work order" to create the first one.'}</div>`;
  // Recently completed: the last 10, in the same compact rows.
  const hb = document.getElementById('shopHistoryList');
  if(hb){
    const recent = woCache.history.slice().sort((a, b) => new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at)).slice(0, 10);
    hb.className = 'wo-list';
    hb.innerHTML = recent.length ? `<div class="wo-table">${recent.map(j => `<div class="wo-row" data-job="${j.id}" tabindex="0" role="button" aria-label="Open ${esc(j.ro_number || 'work order')}">
        <span><span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span></span>
        <span><b>${esc(j.customer || '')}</b><span class="meta"> · ${esc(j.vehicle || '')}</span></span>
        <span class="wo-svc">${esc(j.complaint || '—')}</span>
        <span>${esc(name(j.mechanic_id))}</span>
        <span>${jobStatusBadge(j.status)}</span>
        <span class="meta">${fmtDateTime(j.completed_at || j.updated_at)}</span></div>`).join('')}</div>`
      : '<div class="empty-note">Nothing completed yet.</div>';
  }
}
async function refreshRequestCount(){
  const el = document.getElementById('woReqCount');
  if(!el) return;
  const { count } = await sb.from('work_requests').select('id', { count:'exact', head:true }).eq('org_id', session.orgId).eq('status', 'pending');
  el.textContent = count ? String(count) : '';
  el.classList.toggle('has', !!count);
}

// ---------------- Navigation ----------------
function initNavMore(){
  const t = document.getElementById('navMoreToggle'), more = document.getElementById('navMore');
  if(!t || !more) return;
  const set = (open) => { more.classList.toggle('open', open); t.setAttribute('aria-expanded', String(open)); };
  let saved = null; try { saved = localStorage.getItem('relay.navMore'); } catch(_){}
  set(saved === '1' || !!more.querySelector('.dash-tab.active'));
  t.onclick = () => { const open = !more.classList.contains('open'); set(open); try { localStorage.setItem('relay.navMore', open ? '1' : '0'); } catch(_){} };
  more.querySelectorAll('.dash-tab').forEach(b => b.addEventListener('click', () => set(true)));
}

// ---------------- Global search ----------------
let gsTimer = null, gsSeq = 0;
function likeEsc(s){ return s.replace(/[\\%_]/g, c => '\\' + c); }
async function runGlobalSearch(qRaw){
  const out = document.getElementById('gSearchResults');
  // Commas, brackets and quotes have meaning in the database's filter syntax: drop them.
  const q = qRaw.replace(/[,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if(q.length < 2){ out.classList.add('hidden'); out.innerHTML = ''; return; }
  const seq = ++gsSeq;
  const like = `%${likeEsc(q)}%`;
  const num = (q.match(/^(?:wo|ro|inv|est)?[-#\s]*0*(\d{1,9})$/i) || [])[1];
  const billing = typeof can !== 'function' || can('billing');
  const org = session.orgId;
  const [units, jobs, custs, docs, parts] = await Promise.all([
    sb.from('units').select('id, unit_number, unit_type, vin, plate, customers(company_name)').eq('org_id', org).or(`unit_number.ilike.${like},vin.ilike.${like},plate.ilike.${like}`).limit(6),
    sb.from('jobs').select('id, ro_number, customer, vehicle, complaint, status, created_at').eq('org_id', org)
      .or(num ? `ro_number.in.(WO-${num.padStart(6, '0')},RO-${num.padStart(6, '0')}),vehicle.ilike.${like},customer.ilike.${like}` : `ro_number.ilike.${like},vehicle.ilike.${like},customer.ilike.${like},complaint.ilike.${like}`)
      .order('created_at', { ascending:false }).limit(8),
    sb.from('customers').select('id, company_name, contact_name, phone').eq('org_id', org).or(`company_name.ilike.${like},contact_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(5),
    billing && num ? sb.from('invoices').select('id, kind, status, total, customer_name').eq('org_id', org).eq('id', Number(num)).limit(2) : Promise.resolve({ data:[] }),
    sb.from('inventory_items').select('id, name, part_number, brand').eq('org_id', org).eq('active', true).or(`part_number.ilike.${like},name.ilike.${like},brand.ilike.${like},cross_ref.ilike.${like}`).limit(5)
  ]);
  if(seq !== gsSeq) return;   // a newer search finished first
  const sec = (title, items) => items.length ? `<div class="gs-sec"><div class="gs-title">${title}</div>${items.join('')}</div>` : '';
  const item = (attrs, main, sub) => `<button type="button" class="gs-item" ${attrs}><b>${main}</b><span>${sub}</span></button>`;
  const html =
    sec('Units', (units.data || []).map(u => item(`data-gs="unit" data-id="${u.id}"`, esc(({ truck:'Truck', trailer:'Trailer' })[u.unit_type] || 'Unit') + ' ' + esc(u.unit_number), [u.customers && u.customers.company_name, u.vin && 'VIN ' + u.vin, u.plate].filter(Boolean).map(esc).join(' · ')))) +
    sec('Work orders', (jobs.data || []).map(j => item(`data-gs="job" data-id="${j.id}"`, esc(j.ro_number || '#' + j.id) + ' · ' + esc(j.vehicle || ''), esc(j.customer || '') + ' · ' + esc(statusLabel(j.status)) + (j.complaint ? ' · ' + esc(j.complaint.slice(0, 50)) : '')))) +
    sec('Customers', (custs.data || []).map(c => item(`data-gs="customer" data-id="${c.id}"`, esc(c.company_name), [c.contact_name, c.phone].filter(Boolean).map(esc).join(' · ')))) +
    sec('Estimates & invoices', (docs.data || []).map(d => item(`data-gs="doc" data-id="${d.id}"`, (d.kind === 'estimate' ? 'Estimate' : 'Invoice') + ' #' + d.id, esc(d.customer_name || '') + ' · ' + shopMoney(d.total) + ' · ' + esc(String(d.status).replace(/_/g, ' '))))) +
    sec('Parts', (parts.data || []).map(p => item(`data-gs="part" data-id="${p.id}"`, esc(p.name), [p.part_number, p.brand].filter(Boolean).map(esc).join(' · '))));
  out.innerHTML = html || `<div class="gs-empty">Nothing found for “${esc(q)}”.</div>`;
  out.classList.remove('hidden');
}
async function openSearchResult(kind, id){
  closeGlobalSearch();
  if(kind === 'job') return openRepairOrder(id);
  if(kind === 'unit' && typeof openUnitHistory === 'function') return openUnitHistory(id);
  if(kind === 'doc' && typeof openEstimateEditor === 'function') return openEstimateEditor(id);
  if(kind === 'customer'){ goToPanel('shop-customers'); if(typeof refreshCustomersPage === 'function') await refreshCustomersPage(); if(typeof openCustomerForm === 'function') openCustomerForm(id); return; }
  if(kind === 'part'){ goToPanel('shop-inventory'); const s = document.getElementById('invSearch'); if(s){ const it = await sb.from('inventory_items').select('name').eq('id', id).maybeSingle(); s.value = it.data ? it.data.name : ''; s.dispatchEvent(new Event('input')); } }
}
function closeGlobalSearch(){ const o = document.getElementById('gSearchResults'); if(o){ o.classList.add('hidden'); } }
function initGlobalSearch(){
  const wrap = document.getElementById('gSearchWrap'), input = document.getElementById('gSearch'), out = document.getElementById('gSearchResults');
  if(!wrap || !input) return;
  if(!['shop','admin'].includes(session.role) || !session.orgId){ wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  input.addEventListener('input', () => { clearTimeout(gsTimer); gsTimer = setTimeout(() => runGlobalSearch(input.value), 250); });
  input.addEventListener('focus', () => { if(out.innerHTML) out.classList.remove('hidden'); });
  input.addEventListener('keydown', (e) => {
    const items = [...out.querySelectorAll('.gs-item')];
    const i = items.indexOf(document.activeElement);
    if(e.key === 'ArrowDown' && items.length){ e.preventDefault(); items[0].focus(); }
    if(e.key === 'Escape'){ closeGlobalSearch(); input.blur(); }
  });
  out.addEventListener('keydown', (e) => {
    const items = [...out.querySelectorAll('.gs-item')]; const i = items.indexOf(document.activeElement);
    if(e.key === 'ArrowDown'){ e.preventDefault(); (items[i + 1] || items[i]).focus(); }
    if(e.key === 'ArrowUp'){ e.preventDefault(); (items[i - 1] || input).focus(); }
    if(e.key === 'Escape'){ closeGlobalSearch(); input.focus(); }
  });
  out.addEventListener('click', (e) => { const b = e.target.closest('.gs-item'); if(b) openSearchResult(b.dataset.gs, Number(b.dataset.id)); });
  document.addEventListener('click', (e) => { if(!e.target.closest('#gSearchWrap')) closeGlobalSearch(); });
  document.addEventListener('keydown', (e) => { if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); input.focus(); input.select(); } });
}

// ---------------- Work order control center: summary ----------------
async function loadWoSummary(job, opts){
  const box = document.getElementById('woSummary');
  if(!box) return;
  const billing = opts.billing;
  const [t, pts, est, insp] = await Promise.all([
    sb.from('job_time_summary').select('labor_minutes, drive_minutes').eq('job_id', job.id).maybeSingle(),
    sb.from('job_parts').select('qty, returned_qty, unit_price').eq('job_id', job.id),
    billing ? sb.from('invoices').select('id, kind, status, total').eq('job_id', job.id).order('created_at') : Promise.resolve({ data:[] }),
    sb.from('inspections').select('id, status, inspection_items(result)').eq('job_id', job.id)
  ]);
  const laborH = t.data ? Number(t.data.labor_minutes || 0) / 60 : 0;
  const partsRows = pts.data || [];
  const parts = partsRows.reduce((s, r) => s + (Number(r.qty) - Number(r.returned_qty)) * Number(r.unit_price || 0), 0);
  const docs = est.data || [];
  const lastEst = docs.filter(d => d.kind === 'estimate').pop(), lastInv = docs.filter(d => d.kind === 'invoice').pop();
  const items = (insp.data || []).flatMap(i => i.inspection_items || []);
  const attn = items.filter(x => x.result === 'monitor').length, crit = items.filter(x => x.result === 'repair').length;
  const approval = job.authorized_at || (lastEst && ['approved','converted'].includes(lastEst.status)) ? '<b class="pos">Approved</b>' : job.authorization_override_at ? '<b>Overridden</b>'
    : job.status === 'waiting_approval' || (lastEst && lastEst.status === 'sent') ? '<b class="warn-t">Waiting</b>' : lastEst && lastEst.status === 'declined' ? '<b class="neg">Declined</b>' : '<span class="meta">—</span>';
  const cell = (label, value, tab) => `<button type="button" class="wo-sum-cell" data-go="${tab}"><span>${label}</span>${value}</button>`;
  box.innerHTML =
    cell('Labor', `<b>${laborH.toFixed(1)} h</b>`, 'labor') +
    cell('Parts', `<b>${partsRows.length ? shopMoney(parts) : '—'}</b>`, 'parts') +
    cell('Inspection', items.length ? `<b>${items.length} checked</b><em>${crit ? crit + ' critical' : ''}${crit && attn ? ' · ' : ''}${attn ? attn + ' attention' : ''}${!crit && !attn ? 'all good' : ''}</em>` : '<span class="meta">Not started</span>', 'inspection') +
    (billing ? cell('Estimate', lastEst ? `<b>${shopMoney(lastEst.total)}</b>` : '<span class="meta">None yet</span>', 'billing') : '') +
    cell('Approval', approval, 'billing') +
    (billing ? cell('Invoice', lastInv ? `<b>${shopMoney(lastInv.total)}</b><em>${esc(String(lastInv.status).replace(/_/g, ' '))}</em>` : '<span class="meta">Not invoiced</span>', 'billing') : '');
  box.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showWoTab(b.dataset.go));
  const counts = { parts: partsRows.length, photos: null };
  Object.entries(counts).forEach(([k, n]) => { const c = document.querySelector(`.wo-tab[data-tab="${k}"] .wo-tab-n`); if(c && n != null) c.textContent = n ? String(n) : ''; });
}
let woLastTab = 'overview';
function showWoTab(tab){
  const tabs = document.querySelectorAll('#roBody .wo-tab');
  if(![...tabs].some(t => t.dataset.tab === tab)) tab = 'overview';
  woLastTab = tab;
  tabs.forEach(t => { const on = t.dataset.tab === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
  document.querySelectorAll('#roBody .wo-pane').forEach(p => p.classList.toggle('hidden', !p.dataset.pane.split(' ').includes(tab)));
}

function initShopRedesign(){
  initNavMore();
  initGlobalSearch();
  const nb = document.getElementById('woNewBtn'), cb = document.getElementById('woCreateBox');
  if(nb && cb) nb.onclick = () => { cb.classList.toggle('hidden'); nb.textContent = cb.classList.contains('hidden') ? '+ New work order' : 'Close'; if(!cb.classList.contains('hidden')){ const f = cb.querySelector('input, select'); if(f) f.focus(); } };
  ['woFilterGroup','woFilterTech'].forEach(id => { const el = document.getElementById(id); if(el) el.onchange = () => renderWorkOrdersList(); });
  const ft = document.getElementById('woFilterText'); if(ft) ft.oninput = () => renderWorkOrdersList();
  const rb = document.getElementById('woRequestsBtn'); if(rb) rb.onclick = () => goToPanel('shop-requests');
  const back = document.getElementById('reqBackBtn'); if(back) back.onclick = () => goToPanel('shop-jobs');
  refreshRequestCount();
  document.querySelectorAll('.dash-tab[data-target="shop-jobs"]').forEach(t => t.addEventListener('click', refreshRequestCount));
}

// ---------------- Create the invoice from the work ----------------
// Approved estimate → becomes the invoice (approved lines only). Otherwise a
// draft invoice is filled from the parts used and the tracked labor.
async function generateInvoiceFromWork(job){
  const { data: docs } = await sb.from('invoices').select('id, kind, status').eq('job_id', job.id).order('created_at');
  const existing = (docs || []).find(d => d.kind === 'invoice');
  if(existing){ openEstimateEditor(existing.id); return; }
  const approved = (docs || []).filter(d => d.kind === 'estimate' && d.status === 'approved').pop();
  if(approved){
    const { data, error } = await sb.rpc('convert_estimate_to_invoice', { p_estimate: approved.id });
    if(error){ alert('Could not create the invoice: ' + error.message); return; }
    if(typeof notifyKick === 'function') notifyKick();
    openEstimateEditor(Number(data) || approved.id);
    return;
  }
  const [custRes, orgRes, partsRes, timeRes] = await Promise.all([
    job.customer_id ? sb.from('customers').select('company_name, email, billing_email, billing_address, payment_terms, tax_exempt').eq('id', job.customer_id).maybeSingle() : Promise.resolve({ data:null }),
    sb.from('organizations').select('default_tax_rate, labor_rate').eq('id', session.orgId).maybeSingle(),
    sb.from('job_parts').select('qty, returned_qty, unit_price, inventory_items(name, part_number, core_charge)').eq('job_id', job.id),
    sb.from('job_time_summary').select('labor_minutes').eq('job_id', job.id).maybeSingle()
  ]);
  const c = custRes.data || {}, o = orgRes.data || {};
  const { data: inv, error } = await sb.from('invoices').insert([{
    org_id: session.orgId, job_id: job.id, kind: 'invoice', status: 'draft', created_by: session.id,
    customer_name: c.company_name || job.customer, customer_email: c.billing_email || c.email || null,
    customer_address: c.billing_address || null, unit_number: job.vehicle || null,
    payment_terms: c.payment_terms || 'due_on_receipt',
    tax_rate: c.tax_exempt ? 0 : Number(o.default_tax_rate || 0)
  }]).select('id').single();
  if(error){ alert('Could not create the invoice: ' + error.message); return; }
  const lines = [];
  const laborH = timeRes.data ? Math.round(Number(timeRes.data.labor_minutes || 0) / 15) / 4 : 0;
  if(laborH > 0) lines.push({ invoice_id: inv.id, item_type: 'labor', description: 'Labor' + (job.complaint ? ' — ' + job.complaint.slice(0, 80) : ''), quantity: laborH, unit_price: Number(o.labor_rate || 0), taxable: false });
  (partsRes.data || []).forEach(p => {
    const net = Number(p.qty) - Number(p.returned_qty);
    if(net > 0){ const n = p.inventory_items || {}; lines.push({ invoice_id: inv.id, item_type: 'part', description: (n.name || 'Part') + (n.part_number ? ' (' + n.part_number + ')' : ''), quantity: net, unit_price: Number(p.unit_price || 0), taxable: true });
      if(Number(n.core_charge) > 0) lines.push({ invoice_id: inv.id, item_type: 'fee', description: 'Core charge — ' + (n.name || 'Part'), quantity: net, unit_price: Number(n.core_charge), taxable: false }); }
  });
  if(lines.length){
    const { error: e2 } = await sb.from('invoice_items').insert(lines);
    if(e2) alert('The invoice was created, but its lines could not be added: ' + e2.message);
  }
  openEstimateEditor(inv.id);
}
