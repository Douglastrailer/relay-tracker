// ============================================================
// RelayFleet — Phase 1: Customers, Units, and the Repair Order window.
// Loaded after script.js and uses its helpers (sb, session, esc, icon,
// statusLabel, jobStatusBadge, roChipsHtml, JOB_COLUMNS, ...).
// Every write is also enforced by the database security rules; the
// role checks here only decide which controls to show.
// ============================================================

const TERMS_LABELS = { due_on_receipt:'Due on receipt', net_15:'Net 15', net_30:'Net 30', net_45:'Net 45', net_60:'Net 60' };
const UNIT_TYPE_LABELS = { truck:'Truck', trailer:'Trailer', other:'Other' };
let recordsCustomers = [];
let recordsUnits = [];

function fmtDate(d){ return d ? new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : ''; }
function fmtDateTime(d){ return d ? new Date(d).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : ''; }
function nullIfBlank(v){ v = (v == null ? '' : String(v)).trim(); return v === '' ? null : v; }
function intOrNull(v){ v = nullIfBlank(v); if(v === null) return null; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function recordsToast(msg){
  let t = document.getElementById('recordsToast');
  if(!t){ t = document.createElement('div'); t.id = 'recordsToast'; t.className = 'records-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------- data ----------------
async function fetchCustomers(){
  const { data, error } = await sb.from('customers')
    .select('id, company_name, contact_name, phone, email, billing_email, billing_address, payment_terms, tax_exempt, fleet_profile_id, notes, active, created_at, notify_email, notify_sms')
    .eq('org_id', session.orgId).order('company_name').limit(1000);
  if(error){ console.error('fetchCustomers', error); return []; }
  return data || [];
}
async function fetchUnits(){
  const { data, error } = await sb.from('units')
    .select('id, customer_id, unit_number, vin, year, make, model, plate, plate_state, unit_type, trailer_type, odometer, engine_hours, notes, active, created_at')
    .eq('org_id', session.orgId).order('unit_number').limit(2000);
  if(error){ console.error('fetchUnits', error); return []; }
  return data || [];
}
function customerName(id){ const c = recordsCustomers.find(x => x.id === id); return c ? c.company_name : ''; }

// ---------------- Customers page ----------------
async function refreshCustomersPage(){
  const box = document.getElementById('customersList');
  if(!box) return;
  [recordsCustomers, recordsUnits] = await Promise.all([fetchCustomers(), fetchUnits()]);
  renderCustomersList();
}
function renderCustomersList(){
  const box = document.getElementById('customersList');
  const q = (document.getElementById('customersSearch').value || '').trim().toLowerCase();
  const showInactive = document.getElementById('customersShowInactive').checked;
  const rows = recordsCustomers.filter(c => (showInactive || c.active) &&
    (!q || [c.company_name, c.contact_name, c.phone, c.email].some(v => v && v.toLowerCase().includes(q))));
  document.getElementById('customersCount').textContent = rows.length + (rows.length === 1 ? ' customer' : ' customers');
  if(rows.length === 0){
    box.innerHTML = `<div class="empty-note">${recordsCustomers.length ? 'No customers match your search.' : 'No customers yet. They are added automatically when you create a job, or add one here.'}</div>`;
    return;
  }
  box.innerHTML = rows.map(c => {
    const unitCount = recordsUnits.filter(u => u.customer_id === c.id && u.active).length;
    return `<button type="button" class="rec-row${c.active ? '' : ' is-inactive'}" data-customer="${c.id}">
      <div class="rec-main"><b>${esc(c.company_name)}</b>
        <div class="meta">${[c.contact_name, c.phone, c.email].filter(Boolean).map(esc).join(' · ') || 'No contact details yet'}</div></div>
      <div class="rec-side">
        <span class="rec-tag">${esc(TERMS_LABELS[c.payment_terms] || c.payment_terms)}</span>
        ${c.tax_exempt ? '<span class="rec-tag">Tax exempt</span>' : ''}
        ${c.fleet_profile_id ? '<span class="rec-tag rec-tag-fleet">Fleet portal</span>' : ''}
        <span class="meta">${unitCount} unit${unitCount === 1 ? '' : 's'}</span>
        ${c.active ? '' : '<span class="rec-tag">Inactive</span>'}
      </div></button>`;
  }).join('');
  box.querySelectorAll('[data-customer]').forEach(b => b.onclick = () => (typeof openCustomerProfile === 'function' ? openCustomerProfile : openCustomerForm)(Number(b.dataset.customer)));
}

async function openCustomerForm(id){
  const c = id ? recordsCustomers.find(x => x.id === id) : null;
  const fleets = await fetchLinkedFleets();
  const panel = document.getElementById('customerFormBox');
  panel.innerHTML = `
    <div class="card rec-form">
      <div class="rec-form-head"><h3>${c ? esc(c.company_name) : 'New customer'}</h3><button type="button" class="ghost" id="cfClose">Close</button></div>
      <div class="rec-grid">
        <div class="field"><label>Company name *</label><input id="cfName" maxlength="160" value="${c ? esc(c.company_name) : ''}"></div>
        <div class="field"><label>Contact person</label><input id="cfContact" maxlength="120" value="${c ? esc(c.contact_name || '') : ''}"></div>
        <div class="field"><label>Phone</label><input id="cfPhone" type="tel" maxlength="40" value="${c ? esc(c.phone || '') : ''}"></div>
        <div class="field"><label>Email</label><input id="cfEmail" type="email" maxlength="200" value="${c ? esc(c.email || '') : ''}"></div>
        <div class="field"><label>Billing email (invoices go here)</label><input id="cfBillEmail" type="email" maxlength="200" value="${c ? esc(c.billing_email || '') : ''}"></div>
        <div class="field"><label>Payment terms</label><select id="cfTerms">${Object.keys(TERMS_LABELS).map(k => `<option value="${k}" ${c && c.payment_terms === k ? 'selected' : ''}>${TERMS_LABELS[k]}</option>`).join('')}</select></div>
        <div class="field rec-span"><label>Billing address</label><textarea id="cfAddress" rows="2" maxlength="400">${c ? esc(c.billing_address || '') : ''}</textarea></div>
        <div class="field rec-span"><label>Fleet portal account</label>
          <select id="cfFleet">${fleetOptionsHtml(fleets, c ? c.fleet_profile_id : null)}</select>
          <p class="meta" style="margin-top:4px;">When linked, this fleet account can see all of this customer's work orders and units. Only fleets that joined your shop are listed.</p></div>
        <div class="field rec-span"><label>Notes</label><textarea id="cfNotes" rows="2" maxlength="2000">${c ? esc(c.notes || '') : ''}</textarea></div>
        <label class="rec-check"><input type="checkbox" id="cfTaxExempt" ${c && c.tax_exempt ? 'checked' : ''}> Tax exempt</label>
        <label class="rec-check"><input type="checkbox" id="cfNotifyEmail" ${!c || c.notify_email !== false ? 'checked' : ''}> Email updates on repairs</label>
        <label class="rec-check"><input type="checkbox" id="cfNotifySms" ${c && c.notify_sms ? 'checked' : ''}> Text updates (to the phone above, once texting is set up)</label>
        ${c ? `<label class="rec-check"><input type="checkbox" id="cfActive" ${c.active ? 'checked' : ''}> Active</label>` : ''}
      </div>
      <p class="form-error" id="cfError"></p>
      <div class="job-actions"><button type="button" id="cfSave">${c ? 'Save changes' : 'Add customer'}</button></div>
      ${c ? `<h4 class="rec-subhead">Units</h4><div class="rec-mini">${recordsUnits.filter(u => u.customer_id === c.id).map(u => `<span class="rec-tag">${esc(UNIT_TYPE_LABELS[u.unit_type] || '')} ${esc(u.unit_number)}</span>`).join('') || '<span class="meta">No units yet.</span>'}</div>
      <h4 class="rec-subhead">Work orders</h4><div id="cfOrders" class="rec-orders"><span class="meta">Loading…</span></div>` : ''}
    </div>`;
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('cfClose').onclick = () => { panel.innerHTML = ''; panel.classList.add('hidden'); };
  document.getElementById('cfSave').onclick = () => saveCustomer(c);
  if(c) loadOrdersInto('cfOrders', 'customer_id', c.id);
}

async function saveCustomer(existing){
  const err = document.getElementById('cfError'); err.textContent = '';
  const name = nullIfBlank(document.getElementById('cfName').value);
  if(!name){ err.textContent = 'Company name is required.'; return; }
  const row = {
    company_name: name,
    contact_name: nullIfBlank(document.getElementById('cfContact').value),
    phone: nullIfBlank(document.getElementById('cfPhone').value),
    email: nullIfBlank(document.getElementById('cfEmail').value),
    billing_email: nullIfBlank(document.getElementById('cfBillEmail').value),
    billing_address: nullIfBlank(document.getElementById('cfAddress').value),
    payment_terms: document.getElementById('cfTerms').value,
    tax_exempt: document.getElementById('cfTaxExempt').checked,
    fleet_profile_id: document.getElementById('cfFleet').value || null,
    notes: nullIfBlank(document.getElementById('cfNotes').value),
    notify_email: document.getElementById('cfNotifyEmail').checked,
    notify_sms: document.getElementById('cfNotifySms').checked
  };
  if(existing) row.active = document.getElementById('cfActive').checked;
  const btn = document.getElementById('cfSave'); btn.disabled = true;
  const res = existing
    ? await sb.from('customers').update(row).eq('id', existing.id).select('id')
    : await sb.from('customers').insert([{ ...row, org_id: session.orgId }]).select('id');
  btn.disabled = false;
  if(res.error){
    err.textContent = res.error.code === '23505' ? 'A customer with that name already exists.' : 'Could not save: ' + res.error.message;
    return;
  }
  recordsToast(existing ? 'Customer saved' : 'Customer added');
  await refreshCustomersPage();
  if(typeof populateCompanyList === 'function') populateCompanyList();
  openCustomerForm(res.data[0].id);
}

// ---------------- Units page ----------------
async function refreshUnitsPage(){
  const box = document.getElementById('unitsList');
  if(!box) return;
  [recordsCustomers, recordsUnits] = await Promise.all([fetchCustomers(), fetchUnits()]);
  renderUnitsList();
}
function renderUnitsList(){
  const box = document.getElementById('unitsList');
  const q = (document.getElementById('unitsSearch').value || '').trim().toLowerCase();
  const showInactive = document.getElementById('unitsShowInactive').checked;
  const rows = recordsUnits.filter(u => (showInactive || u.active) &&
    (!q || [u.unit_number, u.vin, u.plate, u.make, u.model, u.trailer_type, customerName(u.customer_id)].some(v => v && String(v).toLowerCase().includes(q))
        || (typeof unitSearchExtraIds !== 'undefined' && unitSearchExtraIds.includes(u.id))));
  document.getElementById('unitsCount').textContent = rows.length + (rows.length === 1 ? ' unit' : ' units');
  if(rows.length === 0){
    box.innerHTML = `<div class="empty-note">${recordsUnits.length ? 'No units match your search.' : 'No units yet. They are added automatically when you create a job, or add one here.'}</div>`;
    return;
  }
  box.innerHTML = rows.map(u => `<button type="button" class="rec-row${u.active ? '' : ' is-inactive'}" data-unit="${u.id}">
      <div class="rec-main"><b>${esc(UNIT_TYPE_LABELS[u.unit_type] || '')} ${esc(u.unit_number)}</b>
        <div class="meta">${[customerName(u.customer_id) || 'No customer', [u.year, u.make, u.model].filter(Boolean).join(' '), u.trailer_type].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="rec-side">${u.vin ? `<span class="rec-tag mono">${esc(u.vin)}</span>` : '<span class="meta">No VIN</span>'}${u.active ? '' : '<span class="rec-tag">Inactive</span>'}</div>
    </button>`).join('');
  // A unit opens its full history (Phase 6); Edit is on that page.
  box.querySelectorAll('[data-unit]').forEach(b => b.onclick = () => (typeof openUnitHistory === 'function' ? openUnitHistory : openUnitForm)(Number(b.dataset.unit)));
}

function openUnitForm(id){
  const u = id ? recordsUnits.find(x => x.id === id) : null;
  const panel = document.getElementById('unitFormBox');
  const val = (k) => u && u[k] != null ? esc(String(u[k])) : '';
  panel.innerHTML = `
    <div class="card rec-form">
      <div class="rec-form-head"><h3>${u ? esc((UNIT_TYPE_LABELS[u.unit_type] || '') + ' ' + u.unit_number) : 'New unit'}</h3><button type="button" class="ghost" id="ufClose">Close</button></div>
      <div class="rec-grid">
        <div class="field"><label>Unit number *</label><input id="ufNumber" maxlength="60" value="${val('unit_number')}" placeholder="e.g. 7790"></div>
        <div class="field"><label>Type</label><select id="ufType">${Object.keys(UNIT_TYPE_LABELS).map(k => `<option value="${k}" ${(u ? u.unit_type : 'trailer') === k ? 'selected' : ''}>${UNIT_TYPE_LABELS[k]}</option>`).join('')}</select></div>
        <div class="field rec-span"><label>Customer</label><select id="ufCustomer"><option value="">No customer</option>${recordsCustomers.filter(c => c.active || (u && c.id === u.customer_id)).map(c => `<option value="${c.id}" ${u && u.customer_id === c.id ? 'selected' : ''}>${esc(c.company_name)}</option>`).join('')}</select></div>
        <div class="field"><label>VIN</label><input id="ufVin" maxlength="17" class="mono" value="${val('vin')}" placeholder="17 characters"></div>
        <div class="field"><label>Trailer type</label><input id="ufTrailerType" maxlength="60" value="${val('trailer_type')}" placeholder="e.g. Dry van, Reefer, Flatbed"></div>
        <div class="field"><label>Year</label><input id="ufYear" type="number" min="1950" max="2100" value="${val('year')}"></div>
        <div class="field"><label>Make</label><input id="ufMake" maxlength="60" value="${val('make')}"></div>
        <div class="field"><label>Model</label><input id="ufModel" maxlength="60" value="${val('model')}"></div>
        <div class="field"><label>Plate</label><input id="ufPlate" maxlength="20" value="${val('plate')}"></div>
        <div class="field"><label>Plate state</label><input id="ufPlateState" maxlength="20" value="${val('plate_state')}"></div>
        <div class="field"><label>Odometer (miles)</label><input id="ufOdo" type="number" min="0" value="${val('odometer')}"></div>
        <div class="field"><label>Engine hours</label><input id="ufHours" type="number" min="0" value="${val('engine_hours')}"></div>
        <div class="field rec-span"><label>Notes</label><textarea id="ufNotes" rows="2" maxlength="2000">${u ? esc(u.notes || '') : ''}</textarea></div>
        ${u ? `<label class="rec-check"><input type="checkbox" id="ufActive" ${u.active ? 'checked' : ''}> Active</label>` : ''}
      </div>
      <p class="form-error" id="ufError"></p>
      <div class="job-actions"><button type="button" id="ufSave">${u ? 'Save changes' : 'Add unit'}</button></div>
      ${u ? `<h4 class="rec-subhead">Work orders for this unit</h4><div id="ufOrders" class="rec-orders"><span class="meta">Loading…</span></div>` : ''}
    </div>`;
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('ufClose').onclick = () => { panel.innerHTML = ''; panel.classList.add('hidden'); };
  document.getElementById('ufSave').onclick = () => saveUnit(u);
  if(u) loadOrdersInto('ufOrders', 'unit_id', u.id);
}

async function saveUnit(existing){
  const err = document.getElementById('ufError'); err.textContent = '';
  const number = nullIfBlank(document.getElementById('ufNumber').value);
  if(!number){ err.textContent = 'Unit number is required.'; return; }
  const vin = nullIfBlank(document.getElementById('ufVin').value);
  if(vin && vin.length !== 17 && !confirm('A VIN is normally exactly 17 characters. Save "' + vin + '" anyway?')) return;
  const row = {
    unit_number: number,
    unit_type: document.getElementById('ufType').value,
    customer_id: intOrNull(document.getElementById('ufCustomer').value),
    vin: vin ? vin.toUpperCase() : null,
    trailer_type: nullIfBlank(document.getElementById('ufTrailerType').value),
    year: intOrNull(document.getElementById('ufYear').value),
    make: nullIfBlank(document.getElementById('ufMake').value),
    model: nullIfBlank(document.getElementById('ufModel').value),
    plate: nullIfBlank(document.getElementById('ufPlate').value),
    plate_state: nullIfBlank(document.getElementById('ufPlateState').value),
    odometer: intOrNull(document.getElementById('ufOdo').value),
    engine_hours: intOrNull(document.getElementById('ufHours').value),
    notes: nullIfBlank(document.getElementById('ufNotes').value)
  };
  if(existing) row.active = document.getElementById('ufActive').checked;
  const btn = document.getElementById('ufSave'); btn.disabled = true;
  const res = existing
    ? await sb.from('units').update(row).eq('id', existing.id).select('id')
    : await sb.from('units').insert([{ ...row, org_id: session.orgId }]).select('id');
  btn.disabled = false;
  if(res.error){
    const m = res.error.message || '';
    err.textContent = res.error.code === '23505' ? 'A unit with that number already exists.'
      : m.includes('year') ? 'Year must be between 1950 and 2100.'
      : m.includes('vin') ? 'VIN can be at most 17 characters.'
      : 'Could not save: ' + m;
    return;
  }
  recordsToast(existing ? 'Unit saved' : 'Unit added');
  await refreshUnitsPage();
  if(typeof populateUnitList === 'function') populateUnitList();
  openUnitForm(res.data[0].id);
}

// Repair orders for a customer or unit (most recent first).
async function loadOrdersInto(boxId, column, id){
  const box = document.getElementById(boxId);
  const { data, error } = await sb.from('jobs').select('id, ro_number, status, vehicle, customer, created_at, completed_at, complaint')
    .eq(column, id).order('created_at', { ascending:false }).limit(100);
  if(!box) return;
  if(error){ box.innerHTML = '<span class="meta">Could not load work orders.</span>'; return; }
  box.innerHTML = (data || []).length === 0 ? '<span class="meta">No work orders yet.</span>'
    : data.map(j => `<button type="button" class="rec-order j-open-ro" data-job="${j.id}">
        <span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span>
        <span class="rec-order-main">${esc(column === 'unit_id' ? j.customer : j.vehicle)}${j.complaint ? ' — ' + esc(j.complaint.slice(0, 80)) : ''}</span>
        <span class="meta">${fmtDate(j.created_at)}</span>${jobStatusBadge(j.status)}</button>`).join('');
}

// ---------------- Repair Order window ----------------
let roCurrentJob = null;

let roLastJobId = null;
async function openRepairOrder(jobId){
  const overlay = document.getElementById('roModal');
  const body = document.getElementById('roBody');
  if(!overlay || !body) return;
  body.innerHTML = '<div class="meta" style="padding:24px;">Loading work order…</div>';
  overlay.classList.remove('hidden');
  document.body.classList.add('modal-open');

  const { data: job, error } = await sb.from('jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle();
  if(error || !job){ body.innerHTML = '<div class="form-error" style="padding:24px;">This work order could not be loaded. It may have been deleted, or you may not have access to it.</div>'; return; }
  roCurrentJob = job;
  const isShop = session.role === 'shop' || session.role === 'admin';
  const isAssignedMech = session.role === 'mechanic' && job.mechanic_id === session.id;

  const [cust, unit, hist, invs, audit] = await Promise.all([
    job.customer_id ? sb.from('customers').select('company_name, contact_name, phone, email, payment_terms').eq('id', job.customer_id).maybeSingle() : Promise.resolve({ data:null }),
    job.unit_id ? sb.from('units').select('unit_number, unit_type, vin, year, make, model, trailer_type, plate, plate_state, odometer').eq('id', job.unit_id).maybeSingle() : Promise.resolve({ data:null }),
    sb.from('job_status_history').select('from_status, to_status, changed_by, changed_at').eq('job_id', jobId).order('changed_at', { ascending:true }).limit(200),
    Promise.resolve({ data:[] }),   // estimates and invoices are loaded by est.js
    isShop ? sb.from('audit_log').select('action, details, actor_id, created_at').eq('entity', 'job').eq('entity_id', String(jobId)).order('created_at', { ascending:true }).limit(200) : Promise.resolve({ data:[] })
  ]);
  const c = cust.data, u = unit.data;
  // Names for the timeline ("who did it"), in one small lookup.
  const actorIds = [...new Set([job.mechanic_id, ...(hist.data || []).map(h => h.changed_by), ...(audit.data || []).flatMap(a => [a.actor_id, a.details && a.details.to])].filter(Boolean))];
  const names = {};
  if(actorIds.length){
    const { data: ppl } = await sb.from('profiles').select('id, name').in('id', actorIds);
    (ppl || []).forEach(p => names[p.id] = p.name);
  }
  const statusOptions = isShop ? STATUS_ORDER : (isAssignedMech ? MECHANIC_STATUSES.concat(MECHANIC_STATUSES.includes(job.status) ? [] : [job.status]) : [job.status]);
  const canEditRequest = isShop;
  const canEditDiagnosis = isShop || isAssignedMech;

  const unitLine = u ? [UNIT_TYPE_LABELS[u.unit_type], u.unit_number].filter(Boolean).join(' ') : job.vehicle;
  const unitDetail = u ? [[u.year, u.make, u.model].filter(Boolean).join(' '), u.trailer_type, u.vin ? 'VIN ' + u.vin : '', u.plate ? 'Plate ' + u.plate + (u.plate_state ? ' ' + u.plate_state : '') : '', u.odometer != null ? u.odometer.toLocaleString() + ' mi' : ''].filter(Boolean).join(' · ') : '';

  const billing = isShop && (typeof can !== 'function' || can('billing'));
  const closed = isClosedStatus(job.status);
  const techName = job.mechanic_id ? (names[job.mechanic_id] || 'Assigned') : 'Unassigned';
  const service = job.complaint ? (job.complaint.length > 90 ? job.complaint.slice(0, 88) + '…' : job.complaint) : 'No complaint recorded';
  const tabs = [['overview','Overview'], ['diagnosis','Diagnosis'], ['billing', billing ? 'Estimate & invoice' : 'Approval'], ['labor','Labor'], ['parts','Parts'],
                ['inspection','Inspection'], ['photos','Photos'], ['messages','Messages'], ['history','History']];
  body.innerHTML = `
    <div class="wo-head">
      <div class="wo-head-main">
        <div class="wo-head-line"><span class="wo-num">${esc(job.ro_number || 'Work order #' + job.id)}</span>${jobStatusBadge(job.status)}${roChipsHtml(Object.assign({}, job, { ro_number: null }))}</div>
        <h2>${esc(c ? c.company_name : job.customer)}</h2>
        <div class="wo-head-unit"><b>${esc(unitLine)}</b>${u && u.vin ? ` <span class="meta">VIN ${esc(u.vin)}</span>` : ''}</div>
        <div class="wo-head-facts"><span>${esc(service)}</span><span>Technician: <b>${esc(techName)}</b></span><span>${job.job_type === 'inshop' ? 'In shop' : 'Roadside'}</span><span class="meta">Opened ${fmtDateTime(job.created_at)}${job.completed_at ? ' · completed ' + fmtDateTime(job.completed_at) : ''}</span></div>
      </div>
      <div class="wo-actions">
        ${isAssignedMech && !closed ? `<button type="button" class="work-open wo-act-primary" data-job="${job.id}">Open work screen</button>` : ''}
        ${isShop ? `<button type="button" class="ghost-btn" id="woActUpdate">Send update</button>` : ''}
        ${(isShop || isAssignedMech) && !closed && job.status !== 'complete' ? `<button type="button" class="ghost-btn" id="woActComplete">Complete job</button>` : ''}
        ${billing && !closed && !['complete'].includes(job.status) ? `<button type="button" class="ghost-btn" id="woActEstimate">Create estimate</button>` : ''}
        ${billing && ['complete','invoiced','paid'].includes(job.status) ? `<button type="button" class="wo-act-primary" id="woActInvoice">${job.status === 'complete' ? 'Create invoice' : 'Open invoice'}</button>` : ''}
        ${isShop ? `<button type="button" class="text-btn danger" id="woActDelete">Delete</button>` : ''}
      </div>
    </div>
    <div class="wo-summary" id="woSummary"></div>
    <nav class="wo-tabs" role="tablist" aria-label="Work order sections">${tabs.map(([k, l]) => `<button type="button" class="wo-tab" role="tab" data-tab="${k}">${l}<span class="wo-tab-n"></span></button>`).join('')}</nav>

    <div class="wo-pane" data-pane="overview">
      <div class="ro-grid">
        <section class="ro-sec">
          <h4>Customer</h4>
          <p><b>${esc(c ? c.company_name : job.customer)}</b></p>
          ${c ? `<p class="meta">${[c.contact_name, c.phone, c.email].filter(Boolean).map(esc).join(' · ') || 'No contact details on file'}</p>` : '<p class="meta">No customer record linked.</p>'}
          ${c && c.phone ? `<a class="ro-call" href="tel:${esc(c.phone)}">Call ${esc(c.contact_name || 'customer')}</a>` : ''}
        </section>
        <section class="ro-sec">
          <h4>Unit</h4>
          <p><b>${esc(unitLine)}</b>${job.unit_id && typeof openUnitHistory === 'function' ? ` <button type="button" class="text-btn" id="woUnitHist">Unit history</button>` : ''}</p>
          <p class="meta">${esc(unitDetail) || (u ? 'No details on file yet' : 'No unit record linked.')}</p>
        </section>
      </div>
      <section class="ro-sec">
        <h4>Status</h4>
        <div class="ro-status-row">
          ${statusOptions.length > 1 ? `<select id="roStatus">${statusOptions.map(s => `<option value="${s}" ${s === job.status ? 'selected' : ''}>${esc(statusLabel(s))}</option>`).join('')}</select>
          <button type="button" id="roStatusSave">Update status</button>` : `<span>${esc(statusLabel(job.status))}</span>`}
        </div>
      </section>
      <section class="ro-sec">
        <h4>Service request</h4>
        ${canEditRequest ? `
          <div class="field"><label>Customer complaint</label><textarea id="roComplaint" rows="2" maxlength="4000">${esc(job.complaint || '')}</textarea></div>
          <div class="rec-grid">
            <div class="field"><label>Priority</label><select id="roPriority">${Object.keys(PRIORITY_LABELS).map(k => `<option value="${k}" ${job.priority === k ? 'selected' : ''}>${PRIORITY_LABELS[k]}</option>`).join('')}</select></div>
            <div class="field"><label>Drivable?</label><select id="roDrivable"><option value="" ${job.drivable == null ? 'selected' : ''}>Unknown</option><option value="yes" ${job.drivable === true ? 'selected' : ''}>Yes</option><option value="no" ${job.drivable === false ? 'selected' : ''}>No</option></select></div>
            <label class="rec-check"><input type="checkbox" id="roSafety" ${job.safety_issue ? 'checked' : ''}> Safety issue</label>
          </div>` : `
          <p>${job.complaint ? esc(job.complaint) : '<span class="meta">No complaint recorded.</span>'}</p>
          <p class="meta">Priority: ${esc(PRIORITY_LABELS[job.priority] || 'Normal')} · Drivable: ${job.drivable == null ? 'Unknown' : job.drivable ? 'Yes' : 'No'}${job.safety_issue ? ' · Safety issue' : ''}</p>`}
      </section>
      ${isShop ? `<section class="ro-sec"><h4>Customer, unit and technician</h4><div id="woEditBox"><button type="button" class="ghost-btn" id="woEditBtn">Change customer, unit or technician</button></div></section>` : ''}
      <section class="ro-sec hidden" id="woBayBox"></section>
      <section class="ro-sec hidden" id="roWarranty"></section>
    </div>

    <div class="wo-pane" data-pane="diagnosis">
      <section class="ro-sec">
        <h4>Diagnosis</h4>
        ${canEditDiagnosis ? `
          <div class="field"><label>Technician findings</label><textarea id="roDiagnosis" rows="4" maxlength="4000" placeholder="Symptoms, cause, what you found">${esc(job.diagnosis || '')}</textarea></div>
          <div class="field"><label>Fault codes</label><input id="roFaultCodes" maxlength="1000" value="${esc(job.fault_codes || '')}" placeholder="e.g. SPN 521 FMI 2"></div>` : `
          <p>${job.diagnosis ? esc(job.diagnosis) : '<span class="meta">No diagnosis yet.</span>'}</p>
          ${job.fault_codes ? `<p class="meta">Fault codes: ${esc(job.fault_codes)}</p>` : ''}`}
      </section>
      <section class="ro-sec" id="roRecommended"></section>
    </div>

    <div class="wo-pane" data-pane="overview diagnosis">
      ${(canEditRequest || canEditDiagnosis) ? `<p class="form-error" id="roError"></p><div class="job-actions"><button type="button" id="roSave">Save work order</button></div>` : ''}
    </div>

    <div class="wo-pane" data-pane="billing">
      <section class="ro-sec${isShop ? '' : ' hidden'}" id="roEstimates">${isShop ? '<h4>Estimates &amp; invoices</h4><p class="meta">Loading…</p>' : ''}</section>
    </div>
    <div class="wo-pane" data-pane="labor"><section class="ro-sec hidden" id="roTime"></section></div>
    <div class="wo-pane" data-pane="parts"><section class="ro-sec hidden" id="roParts"></section></div>
    <div class="wo-pane" data-pane="inspection"><section class="ro-sec" id="roInspections"><h4>Inspections</h4><p class="meta">Loading…</p></section></div>
    <div class="wo-pane" data-pane="photos"><section class="ro-sec ro-comms">${attachmentsBlockHtml(job.id)}</section></div>
    <div class="wo-pane" data-pane="messages">
      <section class="ro-sec hidden" id="roComms2"></section>
      <section class="ro-sec ro-comms"><h4>Shop chat</h4>${commentsBlockHtml(job.id)}</section>
    </div>
    <div class="wo-pane" data-pane="history">
      <section class="ro-sec">
        <h4>History</h4>
        <ol class="ro-timeline">${roTimelineHtml(hist.data || [], audit.data || [], names)}</ol>
      </section>
    </div>`;

  document.querySelectorAll('#roBody .wo-tab').forEach(t => t.onclick = () => showWoTab(t.dataset.tab));
  if(typeof showWoTab === 'function') showWoTab(roLastJobId === job.id ? woLastTab : 'overview');
  roLastJobId = job.id;
  if(typeof loadWoSummary === 'function') loadWoSummary(job, { billing });
  wireWoActions(job, { isShop, billing });
  if(typeof loadWoBay === 'function') loadWoBay(job);

  wireCommentToggles(body);
  wireAttachmentToggles(body);
  if(typeof loadRoInspections === 'function') loadRoInspections(job, { canWork: canEditDiagnosis, isShop });
  if(typeof loadRoEstimates === 'function') loadRoEstimates(job, { isShop: isShop && (typeof can !== 'function' || can('billing')) });
  if(typeof loadRoTime === 'function') loadRoTime(job, { canWork: canEditDiagnosis });
  if(typeof loadRoWarranty === 'function') loadRoWarranty(job, { isShop });
  if(typeof loadRoParts === 'function') loadRoParts(job, { canWork: canEditDiagnosis });
  if(typeof loadRoComms === 'function') loadRoComms(job, { isShop });
  const saveStatus = document.getElementById('roStatusSave');
  if(saveStatus) saveStatus.onclick = () => roUpdateStatus(job);
  const saveBtn = document.getElementById('roSave');
  if(saveBtn) saveBtn.onclick = () => roSave(job, canEditRequest, canEditDiagnosis);
}

function roTimelineHtml(hist, audit, names){
  names = Object.assign({}, names || {});
  if(session) names[session.id] = session.name + ' (you)';
  const who = (id) => id ? (names[id] || 'Team member') : 'System';
  const items = hist.map(h => ({ at: h.changed_at, text: h.from_status ? `${esc(statusLabel(h.from_status))} → <b>${esc(statusLabel(h.to_status))}</b>` : `Opened as <b>${esc(statusLabel(h.to_status))}</b>`, by: who(h.changed_by) }));
  audit.filter(a => a.action !== 'status_changed' && a.action !== 'created').forEach(a => {
    const t = a.action === 'mechanic_assigned' ? `Mechanic changed to <b>${esc(who(a.details && a.details.to))}</b>`
      : a.action === 'customer_or_unit_changed' ? `Customer/unit set to <b>${esc((a.details && a.details.customer) || '')} ${esc((a.details && a.details.unit) || '')}</b>`
      : a.action === 'inspection_started' ? `Inspection started: <b>${esc((a.details && a.details.template) || '')}</b>`
      : a.action === 'inspection_completed' ? `Inspection completed: <b>${esc((a.details && a.details.template) || '')}</b>`
      : a.action === 'inspection_reopened' ? `Inspection reopened: <b>${esc((a.details && a.details.template) || '')}</b>`
      : esc(a.action.replace(/_/g, ' '));
    items.push({ at: a.created_at, text: t, by: who(a.actor_id) });
  });
  items.sort((x, y) => new Date(x.at) - new Date(y.at));
  return items.length ? items.map(i => `<li><span class="ro-tl-time">${fmtDateTime(i.at)}</span><span>${i.text}</span><span class="meta">${esc(i.by)}</span></li>`).join('') : '<li class="meta">No history yet.</li>';
}

async function roUpdateStatus(job){
  const sel = document.getElementById('roStatus');
  const status = sel.value;
  if(status === job.status) return;
  if(status === 'en_route' && job.job_type === 'inshop'){ alert('In-shop jobs don\'t travel, so they can\'t be "Heading there".'); return; }
  if(status === 'cancelled' && !confirm('Cancel this work order? It will leave the board.')) return;
  const btn = document.getElementById('roStatusSave'); btn.disabled = true;
  const { error } = await sb.from('jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', job.id);
  btn.disabled = false;
  if(error){ alert('Could not update the status: ' + error.message); return; }
  recordsToast('Status updated to ' + statusLabel(status));
  if(typeof notifyKick === 'function') notifyKick();
  if(status === 'complete' && typeof showCompleteToast === 'function' && session.role === 'mechanic') showCompleteToast(job);
  await openRepairOrder(job.id);
  if(typeof refreshCurrentView === 'function') refreshCurrentView();
}

async function roSave(job, canEditRequest, canEditDiagnosis){
  const err = document.getElementById('roError'); err.textContent = '';
  const upd = { updated_at: new Date().toISOString() };
  if(canEditRequest){
    const d = document.getElementById('roDrivable').value;
    upd.complaint = nullIfBlank(document.getElementById('roComplaint').value);
    upd.priority = document.getElementById('roPriority').value;
    upd.drivable = d === 'yes' ? true : d === 'no' ? false : null;
    upd.safety_issue = document.getElementById('roSafety').checked;
  }
  if(canEditDiagnosis){
    upd.diagnosis = nullIfBlank(document.getElementById('roDiagnosis').value);
    upd.fault_codes = nullIfBlank(document.getElementById('roFaultCodes').value);
  }
  const btn = document.getElementById('roSave'); btn.disabled = true;
  const { error } = await sb.from('jobs').update(upd).eq('id', job.id);
  btn.disabled = false;
  if(error){ err.textContent = 'Could not save: ' + error.message; return; }
  recordsToast('Work order saved');
  if(typeof refreshCurrentView === 'function') refreshCurrentView();
}

function closeRepairOrder(){
  const overlay = document.getElementById('roModal');
  if(overlay) overlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  roCurrentJob = null;
}

// ---------------- wiring ----------------
function initRecordsUI(){
  const cs = document.getElementById('customersSearch');
  if(cs){
    cs.oninput = renderCustomersList;
    document.getElementById('customersShowInactive').onchange = renderCustomersList;
    document.getElementById('addCustomerBtn').onclick = () => openCustomerForm(null);
    refreshCustomersPage();
  }
  const us = document.getElementById('unitsSearch');
  if(us){
    us.oninput = renderUnitsList;
    document.getElementById('unitsShowInactive').onchange = renderUnitsList;
    document.getElementById('addUnitBtn').onclick = () => openUnitForm(null);
    refreshUnitsPage();
  }
  const nc = document.getElementById('njCustomer');
  if(nc) nc.addEventListener('change', () => { if(typeof populateUnitList === 'function') populateUnitList(); });
  // Refresh the lists whenever their tab is opened, so records created from the job form show up.
  document.querySelectorAll('.dash-tab[data-target="shop-customers"]').forEach(t => t.addEventListener('click', refreshCustomersPage));
  document.querySelectorAll('.dash-tab[data-target="shop-units"]').forEach(t => t.addEventListener('click', refreshUnitsPage));
}

// Open buttons anywhere in the app (board, history, mechanic, fleet, customer/unit pages).
document.addEventListener('click', (e) => {
  const b = e.target.closest('.j-open-ro');
  if(b && b.dataset.job){ e.preventDefault(); openRepairOrder(Number(b.dataset.job)); return; }
  if(e.target.id === 'roModal' || e.target.closest('#roClose')) closeRepairOrder();
});
document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && document.getElementById('roModal') && !document.getElementById('roModal').classList.contains('hidden')) closeRepairOrder(); });


// ---------------- Work order actions (Redesign R1) ----------------
function wireWoActions(job, opts){
  const on = (id, fn) => { const el = document.getElementById(id); if(el) el.onclick = fn; };
  on('woUnitHist', () => openUnitHistory(job.unit_id));
  on('woActUpdate', () => { showWoTab('messages'); const d = document.querySelector('#roComms2 details.comm-compose'); if(d){ d.open = true; const sub = document.getElementById('commSubject'); if(sub) sub.focus(); } });
  on('woActComplete', async () => {
    if(!confirm('Mark this work order complete?')) return;
    const { error } = await sb.from('jobs').update({ status: 'complete', updated_at: new Date().toISOString() }).eq('id', job.id);
    if(error){ alert(error.message); return; }
    if(typeof notifyKick === 'function') notifyKick();
    recordsToast('Work order completed');
    openRepairOrder(job.id); if(typeof refreshCurrentView === 'function') refreshCurrentView();
  });
  on('woActEstimate', () => { showWoTab('billing'); if(typeof newEstimateForJob === 'function') newEstimateForJob(job); });
  on('woActInvoice', () => { if(typeof generateInvoiceFromWork === 'function') generateInvoiceFromWork(job); });
  on('woActDelete', async () => {
    if(!confirm(`Delete ${job.ro_number || 'this work order'}? This cannot be undone.`)) return;
    const { error } = await sb.from('jobs').delete().eq('id', job.id);
    if(error){ alert('Could not delete: ' + error.message); return; }
    closeRepairOrder(); if(typeof refreshCurrentView === 'function') refreshCurrentView();
  });
  on('woEditBtn', async () => {
    const box = document.getElementById('woEditBox');
    const [mechanics, fleets] = await Promise.all([fetchOrgMechanics(), fetchLinkedFleets()]);
    box.innerHTML = jobEditRowHtml(job, mechanics, fleets);
    box.querySelector('.ej-cancel').onclick = () => openRepairOrder(job.id);
    box.querySelector('.ej-save').onclick = async () => {
      const customer = box.querySelector('.ej-customer').value.trim(), vehicle = box.querySelector('.ej-vehicle').value.trim();
      const mechanic_id = box.querySelector('.ej-mechanic').value;
      const fleetSel = box.querySelector('.ej-fleet'); const fleet_profile_id = fleetSel && fleetSel.value ? fleetSel.value : null;
      if(!customer || !vehicle || !mechanic_id){ alert('Customer, unit and technician are required.'); return; }
      const rec = await resolveCustomerAndUnit(customer, vehicle, null);
      if(rec.error){ alert(rec.error); return; }
      const { error } = await sb.from('jobs').update({ customer, vehicle, customer_id: rec.customerId, unit_id: rec.unitId, mechanic_id, fleet_profile_id, updated_at: new Date().toISOString() }).eq('id', job.id);
      if(error){ alert('Could not save: ' + error.message); return; }
      if(typeof notifyKick === 'function') notifyKick();
      recordsToast('Work order updated');
      openRepairOrder(job.id); if(typeof refreshCurrentView === 'function') refreshCurrentView();
    };
  });
}
