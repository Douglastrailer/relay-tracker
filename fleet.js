// ============================================================
// RelayFleet — Phase 5: fleet customer portal.
// Loaded after script.js and the other phase files. Everything here is
// read-only for fleets; the database limits every query to the fleet's
// own repair orders, units, documents and shops.
// ============================================================

let fleetPortal = { orgs:[], jobs:[], units:[], docs:[], mechNames:{} };
const FLEET_AVG_MPH = 45;   // for a rough arrival estimate on road calls

function fleetMoney(n){ return '$' + (Math.round(Number(n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function fleetOrgName(id){ return (fleetPortal.orgs.find(o => o.id === id) || {}).name || 'Shop'; }
function fleetApproveUrl(token){ return location.origin + '/approve.html?t=' + token; }
function isOverdue(d){ return d.kind === 'invoice' && ['unpaid','sent'].includes(d.status) && d.due_date && new Date(d.due_date + 'T23:59:59') < new Date(); }

function showFleetTab(name){
  document.querySelectorAll('#fleetView .fleet-tab').forEach(b => { const on = b.dataset.ftab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
  document.querySelectorAll('#fleetView .fleet-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'fp-' + name));
  // Maps drawn while their tab was hidden need to re-measure.
  if(name === 'repairs' && typeof fleetMaps === 'object') Object.values(fleetMaps).forEach(e => { try { e.map.invalidateSize(); } catch(_){} });
}

async function refreshFleetPortal(){
  if(!document.getElementById('fleetStats')) return;
  const [orgs, jobsRes, unitsRes, docsRes] = await Promise.all([
    fetchAllOrganizations(),
    sb.from('jobs').select(JOB_COLUMNS).order('created_at', { ascending:false }).limit(500),
    sb.from('units').select('id, org_id, customer_id, unit_number, unit_type, trailer_type, vin, year, make, model, plate, plate_state, odometer, active').eq('active', true).order('unit_number').limit(1000),
    sb.from('invoices').select('id, org_id, job_id, kind, status, total, due_date, created_at, approval_token, unit_number, customer_name, approved_by_name, responded_at').order('created_at', { ascending:false }).limit(300)
  ]);
  fleetPortal.orgs = orgs || [];
  fleetPortal.jobs = jobsRes.data || [];
  fleetPortal.units = unitsRes.data || [];
  fleetPortal.docs = docsRes.data || [];
  renderFleetDashboard();
  renderFleetUnits();
  renderFleetInvoices();
  renderFleetShopActions();
}

function renderFleetDashboard(){
  const { jobs, units, docs } = fleetPortal;
  const active = jobs.filter(j => !isClosedStatus(j.status));
  const year = new Date().getFullYear();
  const toApprove = docs.filter(d => d.kind === 'estimate' && d.status === 'sent' && d.approval_token);
  const unpaid = docs.filter(d => d.kind === 'invoice' && ['unpaid','sent'].includes(d.status));
  const overdue = unpaid.filter(isOverdue);
  const tile = (n, label, sub, tab, cls) => `<button type="button" class="fleet-stat${cls ? ' ' + cls : ''}" data-goto="${tab}"><b>${n}</b><span>${esc(label)}</span>${sub ? `<em>${esc(sub)}</em>` : ''}</button>`;
  document.getElementById('fleetStats').innerHTML =
    tile(units.length, 'Units', '', 'units') +
    tile(active.length, 'Active repairs', '', 'repairs') +
    tile(active.filter(j => j.job_type === 'mobile').length, 'Roadside calls', '', 'repairs') +
    (session.staffRole === 'fleet_user' ? '' : tile(toApprove.length, 'Waiting for your approval', '', 'invoices', toApprove.length ? 'attn' : '')) +
    tile(active.filter(j => j.status === 'waiting_parts').length, 'Waiting for parts', '', 'repairs') +
    tile(jobs.filter(j => DONE_STATUSES.includes(j.status) && j.completed_at && new Date(j.completed_at).getFullYear() === year).length, 'Completed this year', '', 'history') +
    (session.staffRole === 'fleet_user' ? '' : tile(unpaid.length, 'Unpaid invoices', unpaid.length ? fleetMoney(unpaid.reduce((s, d) => s + Number(d.total || 0), 0)) + (overdue.length ? ' · ' + overdue.length + ' overdue' : '') : '', 'invoices', overdue.length ? 'warn' : ''));
  document.querySelectorAll('#fleetStats [data-goto]').forEach(b => b.onclick = () => showFleetTab(b.dataset.goto));
  const jobFor = d => jobs.find(j => j.id === d.job_id) || {};
  const items = [];
  toApprove.forEach(d => { const j = jobFor(d); items.push(`<div class="attn-row attn-approve"><div><b>Estimate #${d.id} needs your approval</b><div class="meta">${esc(fleetOrgName(d.org_id))} · ${esc(j.ro_number || '')} · ${esc(d.unit_number || j.vehicle || '')} · ${fleetMoney(d.total)}</div></div>
      <a class="attn-btn" href="${esc(fleetApproveUrl(d.approval_token))}" target="_blank" rel="noopener">Review &amp; approve</a></div>`); });
  overdue.forEach(d => items.push(`<div class="attn-row attn-overdue"><div><b>Invoice #${d.id} is overdue</b><div class="meta">${esc(fleetOrgName(d.org_id))} · due ${fmtDate(d.due_date)} · ${fleetMoney(d.total)}</div></div>
      <button type="button" class="attn-btn ghost" data-pdf="${d.id}">View invoice</button></div>`));
  active.filter(j => j.status === 'waiting_parts').forEach(j => items.push(`<div class="attn-row"><div><b>${esc(j.vehicle)} is waiting for parts</b><div class="meta">${esc(fleetOrgName(j.org_id))} · ${esc(j.ro_number || '')}</div></div>
      <button type="button" class="attn-btn ghost j-open-ro" data-job="${j.id}">Details</button></div>`));
  document.getElementById('fleetAttention').innerHTML = items.join('') || '<div class="card empty-note">Nothing needs your attention right now.</div>';
  document.querySelectorAll('#fleetAttention [data-pdf]').forEach(b => b.onclick = () => viewInvoicePdf(Number(b.dataset.pdf)));
}

function renderFleetUnits(){
  const box = document.getElementById('fleetUnits');
  if(!box) return;
  const q = (document.getElementById('fleetUnitSearch').value || '').trim().toLowerCase();
  const { units, jobs } = fleetPortal;
  const rows = units.filter(u => !q || [u.unit_number, u.vin, u.plate, u.make, u.model, u.trailer_type, u.unit_type, u.year, fleetOrgName(u.org_id)].some(v => v && String(v).toLowerCase().includes(q)));
  box.innerHTML = rows.length ? rows.map(u => {
    const uj = jobs.filter(j => j.unit_id === u.id);
    const open = uj.find(j => !isClosedStatus(j.status));
    const last = uj.filter(j => j.completed_at).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0];
    return `<button type="button" class="rec-row" data-funit="${u.id}">
      <div class="rec-main"><b>${esc({ truck:'Truck', trailer:'Trailer', other:'Unit' }[u.unit_type] || 'Unit')} ${esc(u.unit_number)}</b>
        <div class="meta">${[fleetOrgName(u.org_id), [u.year, u.make, u.model].filter(Boolean).join(' '), u.trailer_type, u.vin ? 'VIN ' + u.vin : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="rec-side">${open ? jobStatusBadge(open.status) : '<span class="meta">No open repair</span>'}<span class="meta">${last ? 'Last service ' + fmtDate(last.completed_at) : 'No service yet'} · ${uj.length} repair${uj.length === 1 ? '' : 's'}</span></div>
    </button>`;
  }).join('') : `<div class="empty-note">${units.length ? 'No units match your search.' : 'Your shops haven\'t added unit records for you yet. Units appear here as they service your trucks and trailers.'}</div>`;
  box.querySelectorAll('[data-funit]').forEach(b => b.onclick = () => openFleetUnit(Number(b.dataset.funit)));
}

function openFleetUnit(id){
  const u = fleetPortal.units.find(x => x.id === id);
  if(!u) return;
  const uj = fleetPortal.jobs.filter(j => j.unit_id === id);
  const box = document.getElementById('fleetUnitDetail');
  box.innerHTML = `<div class="card rec-form">
    <div class="rec-form-head"><h3>${esc({ truck:'Truck', trailer:'Trailer', other:'Unit' }[u.unit_type] || 'Unit')} ${esc(u.unit_number)}</h3><button type="button" class="ghost" id="fuClose">Close</button></div>
    <p class="meta">${[fleetOrgName(u.org_id), [u.year, u.make, u.model].filter(Boolean).join(' '), u.trailer_type, u.vin ? 'VIN ' + u.vin : '', u.plate ? 'Plate ' + u.plate + (u.plate_state ? ' ' + u.plate_state : '') : '', u.odometer != null ? Number(u.odometer).toLocaleString() + ' mi' : ''].filter(Boolean).map(esc).join(' · ')}</p>
    <div class="time-stats" id="fuCosts"></div>
    ${(() => { const ws = uj.map(j => ({ j, w: typeof warrantyStatus === 'function' ? warrantyStatus(j, u.odometer) : null })).filter(x => x.w && x.w.active);
      return ws.length ? '<h4 class="rec-subhead">Active warranty</h4>' + ws.map(({ j, w }) => `<p class="meta"><b>${esc(j.ro_number || '')}</b> ${esc(j.complaint || '')} — ${esc(warrantyTermsText(j))}${w.until ? ' · until ' + fmtDate(w.until) : ''}</p>`).join('') : ''; })()}
    <h4 class="rec-subhead">Repair history</h4>
    <div class="rec-orders">${uj.length ? uj.map(j => `<button type="button" class="rec-order j-open-ro" data-job="${j.id}"><span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span>
      <span class="rec-order-main">${esc(j.complaint || j.customer)}</span><span class="meta">${fmtDate(j.created_at)}</span>${jobStatusBadge(j.status)}</button>`).join('') : '<span class="meta">No repairs recorded yet.</span>'}</div>
    <p class="meta" style="margin-top:8px;">Open a repair to see its inspection report, photos, estimate and timeline.</p></div>`;
  box.classList.remove('hidden'); box.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('fuClose').onclick = () => { box.innerHTML = ''; box.classList.add('hidden'); };
  sb.from('unit_cost_summary').select('month_cost, year_cost, lifetime_cost').eq('unit_id', id).maybeSingle().then(({ data }) => {
    const c = document.getElementById('fuCosts');
    if(c && data) c.innerHTML = `<div><span>This month</span><b>${fleetMoney(data.month_cost)}</b></div><div><span>This year</span><b>${fleetMoney(data.year_cost)}</b></div><div><span>Lifetime</span><b>${fleetMoney(data.lifetime_cost)}</b></div>`;
  });
}

function renderFleetInvoices(){
  const box = document.getElementById('fleetInvoices');
  if(!box) return;
  const { docs, jobs } = fleetPortal;
  const label = d => d.kind === 'estimate'
    ? ({ sent:'Waiting for your approval', approved:'Approved', declined:'Declined', changes_requested:'Changes requested', converted:'Approved — invoiced' }[d.status] || d.status)
    : (d.status === 'paid' ? 'Paid' : isOverdue(d) ? 'Overdue' : 'Unpaid');
  const cls = d => d.kind === 'estimate' ? (d.status === 'sent' ? 'waiting' : d.status === 'declined' ? 'cancelled' : 'arrived') : (d.status === 'paid' ? 'arrived' : isOverdue(d) ? 'overdue' : 'waiting');
  box.innerHTML = docs.length ? docs.map(d => { const j = jobs.find(x => x.id === d.job_id) || {};
    return `<div class="fleet-doc">
      <div class="rec-main"><b>${d.kind === 'estimate' ? 'Estimate' : 'Invoice'} #${d.id}</b>
        <div class="meta">${[fleetOrgName(d.org_id), j.ro_number, d.unit_number || j.vehicle, fmtDate(d.created_at), d.kind === 'invoice' && d.due_date && d.status !== 'paid' ? 'due ' + fmtDate(d.due_date) : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="fleet-doc-side"><b>${fleetMoney(d.total)}</b><span class="badge ${cls(d)}"><span class="bd"></span>${esc(label(d))}</span>
        ${d.kind === 'estimate' && d.status === 'sent' && d.approval_token ? `<a class="attn-btn" href="${esc(fleetApproveUrl(d.approval_token))}" target="_blank" rel="noopener">Review &amp; approve</a>` : ''}
        <button type="button" class="text-btn" data-pdf="${d.id}">PDF</button></div></div>`; }).join('')
    : '<div class="card empty-note">No estimates or invoices yet.</div>';
  box.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => viewInvoicePdf(Number(b.dataset.pdf)));
}

function renderFleetShopActions(){
  const box = document.getElementById('fleetShopActions');
  if(!box) return;
  box.innerHTML = fleetPortal.orgs.length ? fleetPortal.orgs.map(o => `<div class="fleet-doc"><div class="rec-main"><b>${esc(o.name)}</b></div>
      <div class="fleet-doc-side"><a class="attn-btn" href="${esc(location.origin + '/?request=' + o.id)}" target="_blank" rel="noopener">Request service</a></div></div>`).join('')
    : '<div class="empty-note">Join a shop with its invite code to request service.</div>';
}

// Name of the mechanic on a fleet's own job (the database only reveals those).
async function fleetMechanicNames(ids){
  const need = [...new Set(ids.filter(id => id && !fleetPortal.mechNames[id]))];
  if(need.length){ const { data } = await sb.from('profiles').select('id, name').in('id', need); (data || []).forEach(p => fleetPortal.mechNames[p.id] = p.name); }
  return fleetPortal.mechNames;
}
function fleetEtaText(miles){ const m = Math.max(1, Math.round(miles / FLEET_AVG_MPH * 60)); return m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; }

function initFleetPortal(){
  document.querySelectorAll('#fleetView .fleet-tab').forEach(b => b.onclick = () => showFleetTab(b.dataset.ftab));
  const s = document.getElementById('fleetUnitSearch');
  if(s) s.oninput = renderFleetUnits;
  showFleetTab('dash');
  if(typeof applyRoleUI === 'function') applyRoleUI();
  refreshFleetPortal();
}
