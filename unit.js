// ============================================================
// RelayFleet — Phase 6: unit history and warranty.
// Loaded after the other phase files. Costs come from the database
// (unit_cost_summary); warranty flags and decisions are enforced there.
// ============================================================

const UNIT_TYPE_NAME = { truck:'Truck', trailer:'Trailer', other:'Unit' };
let unitHistCurrent = null;

function unitMoney(n){ return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function addMonths(d, m){ const x = new Date(d); x.setMonth(x.getMonth() + m); return x; }
// Same "whichever comes first" rule as the database's find_active_warranty().
function warrantyStatus(job, unitOdometer){
  if(!job.completed_at || !['complete','invoiced','paid'].includes(job.status)) return null;
  const months = Number(job.warranty_months || 0), miles = Number(job.warranty_miles || 0);
  if(!months && !miles) return null;
  const until = months ? addMonths(job.completed_at, months) : null;
  const milesLeft = miles && job.odometer != null && unitOdometer != null ? miles - (unitOdometer - job.odometer) : null;
  const active = (!until || until > new Date()) && (milesLeft == null || milesLeft > 0);
  return { active, until, milesLeft, untilMiles: miles && job.odometer != null ? job.odometer + miles : null };
}
function warrantyTermsText(j){
  const parts = [];
  if(j.warranty_months) parts.push(j.warranty_months + ' month' + (j.warranty_months === 1 ? '' : 's'));
  if(j.warranty_miles) parts.push(Number(j.warranty_miles).toLocaleString() + ' miles');
  return parts.join(' / ') + (parts.length > 1 ? ', whichever comes first' : '') + (j.warranty_terms ? ' — ' + j.warranty_terms : '');
}

// ---------------- Unit History page ----------------
async function openUnitHistory(unitId){
  const o = document.getElementById('unitModal'), body = document.getElementById('unitBody');
  body.innerHTML = '<div class="meta" style="padding:24px;">Loading unit history…</div>';
  o.classList.remove('hidden'); document.body.classList.add('modal-open');
  const [uRes, sumRes, jobsRes, inspRes] = await Promise.all([
    sb.from('units').select('*').eq('id', unitId).maybeSingle(),
    sb.from('unit_cost_summary').select('*').eq('unit_id', unitId).maybeSingle(),
    sb.from('jobs').select(JOB_COLUMNS).eq('unit_id', unitId).order('created_at', { ascending:false }).limit(200),
    sb.from('inspections').select('id, job_id, template_name, status, completed_at, started_at, inspection_items(result)').eq('unit_id', unitId).order('started_at', { ascending:false }).limit(100)
  ]);
  const u = uRes.data;
  if(!u){ body.innerHTML = '<p class="form-error" style="padding:24px;">This unit could not be loaded.</p>'; return; }
  const jobs = jobsRes.data || [];
  const jobIds = jobs.map(j => j.id);
  const [custRes, invRes, photoRes] = await Promise.all([
    u.customer_id ? sb.from('customers').select('company_name').eq('id', u.customer_id).maybeSingle() : Promise.resolve({ data:null }),
    jobIds.length ? sb.from('invoices').select('doc_number, id, job_id, kind, status, total, created_at, due_date, invoice_items(description, quantity, unit_price, item_type, customer_decision)').in('job_id', jobIds).neq('status', 'draft').order('created_at', { ascending:false }) : Promise.resolve({ data:[] }),
    jobIds.length ? sb.from('job_attachments').select('id, job_id, file_path, file_name, file_type, created_at').in('job_id', jobIds).order('created_at', { ascending:false }).limit(40) : Promise.resolve({ data:[] })
  ]);
  unitHistCurrent = { u, sum: sumRes.data || {}, jobs, insps: inspRes.data || [], docs: invRes.data || [], photos: (photoRes.data || []).filter(p => /^image\//.test(p.file_type || '') || /\.(jpe?g|png|webp|gif)$/i.test(p.file_name || '')), customer: custRes.data ? custRes.data.company_name : '' };
  renderUnitHistory();
}

function serviceDueHtml(u, lastJob){
  if(!u.service_interval_days && !u.service_interval_miles) return '<span class="meta">No service interval set.</span>';
  if(!lastJob) return '<span class="meta">Due now — no service on record yet.</span>';
  const bits = []; let overdue = false;
  if(u.service_interval_days){
    const due = new Date(lastJob.completed_at); due.setDate(due.getDate() + u.service_interval_days);
    const days = Math.round((due - new Date()) / 864e5);
    if(days < 0){ overdue = true; bits.push(`overdue by ${-days} day${days === -1 ? '' : 's'} (was due ${fmtDate(due)})`); }
    else bits.push(`due ${fmtDate(due)} (in ${days} day${days === 1 ? '' : 's'})`);
  }
  if(u.service_interval_miles && lastJob.odometer != null && u.odometer != null){
    const left = lastJob.odometer + u.service_interval_miles - u.odometer;
    if(left < 0){ overdue = true; bits.push(`${(-left).toLocaleString()} miles over`); }
    else bits.push(`${left.toLocaleString()} miles left`);
  }
  return `<span class="${overdue ? 'svc-overdue' : 'svc-ok'}">Next service ${bits.join(' · ')}</span>`;
}

function renderUnitHistory(){
  const { u, sum, jobs, insps, docs, photos, customer } = unitHistCurrent;
  const isShop = session.role === 'shop' || session.role === 'admin';
  const open = jobs.find(j => !isClosedStatus(j.status));
  const done = jobs.filter(j => j.completed_at && DONE_STATUSES.includes(j.status)).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
  const last = done[0];
  const warranties = done.map(j => ({ j, w: warrantyStatus(j, u.odometer) })).filter(x => x.w && x.w.active);
  const invByJob = {}; docs.filter(d => d.kind === 'invoice').forEach(d => { invByJob[d.job_id] = (invByJob[d.job_id] || 0) + Number(d.total || 0); });
  const lines = docs.filter(d => d.kind === 'invoice').flatMap(d => (d.invoice_items || []).filter(i => i.customer_decision !== 'declined').map(i => ({ ...i, date: d.created_at })));
  const partsTotal = lines.filter(l => l.item_type === 'part').reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const laborTotal = lines.filter(l => l.item_type === 'labor').reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const laborHours = lines.filter(l => l.item_type === 'labor').reduce((s, l) => s + Number(l.quantity), 0);
  document.getElementById('unitBody').innerHTML = `
    <div class="ro-head"><div>
      <div class="ro-head-num">${esc(UNIT_TYPE_NAME[u.unit_type] || 'Unit').toUpperCase()} ${esc(u.unit_number)}</div>
      <h2>${esc(customer || 'No customer')}${u.trailer_type ? ' · ' + esc(u.trailer_type) : ''}</h2>
      <div class="meta">${[[u.year, u.make, u.model].filter(Boolean).join(' '), u.vin ? 'VIN ' + u.vin : '', u.plate ? 'Plate ' + u.plate + (u.plate_state ? ' ' + u.plate_state : '') : '', u.odometer != null ? Number(u.odometer).toLocaleString() + ' mi' : ''].filter(Boolean).map(esc).join(' · ') || 'No details yet'}</div>
    </div><div class="uh-head-side">${open ? jobStatusBadge(open.status) : '<span class="rec-tag">No open repair</span>'}${isShop ? '<button type="button" class="ghost-btn" id="uhEdit">Edit unit</button>' : ''}</div></div>

    <div class="time-stats uh-costs">
      <div><span>This month</span><b>${unitMoney(sum.month_cost)}</b></div>
      <div><span>This year</span><b>${unitMoney(sum.year_cost)}</b></div>
      <div><span>Lifetime</span><b>${unitMoney(sum.lifetime_cost)}</b></div>
      <div><span>Repairs</span><b>${sum.repairs || jobs.length}</b></div>
    </div>

    <div class="ro-grid">
      <section class="ro-sec"><h4>Service</h4>
        <p>${last ? `Last service <b>${fmtDate(last.completed_at)}</b>${last.odometer != null ? ' at ' + Number(last.odometer).toLocaleString() + ' mi' : ''} · ${esc(last.ro_number || '')}` : '<span class="meta">No completed service yet.</span>'}</p>
        <p>${serviceDueHtml(u, last)}</p>
        ${isShop ? `<div class="uh-interval"><label>Every <input type="number" id="uhDays" min="1" max="3650" value="${u.service_interval_days || ''}" placeholder="days"> days</label>
          <label>or <input type="number" id="uhMiles" min="1" max="1000000" value="${u.service_interval_miles || ''}" placeholder="miles"> miles</label>
          <button type="button" class="ghost-btn" id="uhSaveInterval">Save</button></div>` : ''}
      </section>
      <section class="ro-sec"><h4>Warranty</h4>
        ${warranties.length ? warranties.map(({ j, w }) => `<div class="uh-warranty"><b>${esc(j.ro_number || '')}</b> ${esc(j.complaint || '')}
          <div class="meta">${esc(warrantyTermsText(j))}</div>
          <div class="meta">Covered${w.until ? ' until ' + fmtDate(w.until) : ''}${w.untilMiles ? (w.until ? ' or ' : ' up to ') + w.untilMiles.toLocaleString() + ' mi' : ''}${w.milesLeft != null ? ' · ' + w.milesLeft.toLocaleString() + ' mi left' : ''}</div></div>`).join('')
          : '<p class="meta">No active warranty on this unit.</p>'}
      </section>
    </div>

    <section class="ro-sec"><h4>Repairs (${jobs.length})</h4>
      <div class="rec-orders">${jobs.length ? jobs.map(j => `<button type="button" class="rec-order j-open-ro" data-job="${j.id}">
        <span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span>
        <span class="rec-order-main">${esc(j.complaint || j.vehicle)}${j.warranty_claim_status === 'pending_review' ? ' <span class="prio-chip prio-high">Warranty?</span>' : j.warranty_claim_status === 'warranty' ? ' <span class="prio-chip prio-low">Warranty</span>' : ''}</span>
        <span class="meta">${fmtDate(j.completed_at || j.created_at)}${invByJob[j.id] ? ' · ' + unitMoney(invByJob[j.id]) : ''}</span>${jobStatusBadge(j.status)}</button>`).join('') : '<span class="meta">No repairs yet.</span>'}</div>
    </section>

    <section class="ro-sec"><h4>Inspections (${insps.length})</h4>
      ${insps.length ? insps.map(i => { const c = { repair:0, monitor:0 }; (i.inspection_items || []).forEach(x => { if(c[x.result] != null) c[x.result]++; });
        return `<div class="insp-row"><div class="insp-row-main"><b>${esc(i.template_name)}</b><div class="meta">${i.status === 'completed' ? fmtDate(i.completed_at) : 'In progress'} · ${c.repair} repair · ${c.monitor} monitor</div></div>
          <button type="button" class="ghost-btn uh-insp" data-insp="${i.id}">${i.status === 'completed' ? 'View report' : 'Open'}</button></div>`; }).join('') : '<p class="meta">No inspections yet.</p>'}
    </section>

    <section class="ro-sec"><h4>Invoices &amp; estimates (${docs.length})</h4>
      ${docs.length ? docs.map(d => `<div class="ro-inv"><span>${d.kind === 'estimate' ? 'Estimate' : 'Invoice'} ${esc(docNo(d))}</span><span class="meta">${fmtDate(d.created_at)}</span>
        <span class="rec-tag">${esc(String(d.status).replace(/_/g, ' '))}</span><b>${unitMoney(d.total)}</b><button type="button" class="text-btn" data-pdf="${d.id}">PDF</button></div>`).join('') : '<p class="meta">None yet.</p>'}
    </section>

    <section class="ro-sec"><h4>Parts &amp; labor</h4>
      <div class="time-stats"><div><span>Parts</span><b>${unitMoney(partsTotal)}</b></div><div><span>Labor</span><b>${unitMoney(laborTotal)}</b></div><div><span>Labor hours</span><b>${laborHours.toLocaleString(undefined, { maximumFractionDigits:2 })}</b></div></div>
      ${lines.length ? `<div class="uh-lines">${lines.filter(l => l.item_type === 'part' || l.item_type === 'labor').slice(0, 40).map(l => `<div><span class="rec-tag">${esc(l.item_type === 'part' ? 'Part' : 'Labor')}</span><span>${esc(l.description)}</span><span class="meta">${fmtDate(l.date)}</span><b>${unitMoney(l.quantity * l.unit_price)}</b></div>`).join('')}</div>` : '<p class="meta">No billed parts or labor yet.</p>'}
    </section>

    <section class="ro-sec"><h4>Photos (${photos.length})</h4>
      <div class="uh-photos" id="uhPhotos">${photos.length ? '<span class="meta">Loading photos…</span>' : '<span class="meta">No photos yet.</span>'}</div>
    </section>`;
  const body = document.getElementById('unitBody');
  const edit = document.getElementById('uhEdit');
  if(edit) edit.onclick = async () => {
    closeUnitHistory();
    const tab = document.querySelector('.dash-tab[data-target="shop-units"]');
    if(tab) tab.click();
    if(typeof refreshUnitsPage === 'function') await refreshUnitsPage();
    if(typeof openUnitForm === 'function') openUnitForm(u.id);
  };
  const si = document.getElementById('uhSaveInterval');
  if(si) si.onclick = async () => {
    const d = parseInt(document.getElementById('uhDays').value, 10), m = parseInt(document.getElementById('uhMiles').value, 10);
    const row = { service_interval_days: Number.isFinite(d) && d > 0 ? d : null, service_interval_miles: Number.isFinite(m) && m > 0 ? m : null };
    const { error } = await sb.from('units').update(row).eq('id', u.id);
    if(error){ alert('Could not save: ' + error.message); return; }
    Object.assign(u, row); recordsToast('Service interval saved'); renderUnitHistory();
  };
  body.querySelectorAll('.uh-insp').forEach(b => b.onclick = () => openInspection(Number(b.dataset.insp)));
  body.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => viewInvoicePdf(Number(b.dataset.pdf)));
  if(photos.length) loadUnitPhotos(photos);
}

async function loadUnitPhotos(photos){
  const { data } = await sb.storage.from('job-attachments').createSignedUrls(photos.map(p => p.file_path), 3600);
  const box = document.getElementById('uhPhotos');
  if(!box) return;
  const url = {}; (data || []).forEach(d => { if(d && d.signedUrl) url[d.path] = d.signedUrl; });
  box.innerHTML = photos.filter(p => url[p.file_path]).map(p => `<a class="uh-photo" href="${esc(url[p.file_path])}" target="_blank" rel="noopener" title="${esc(p.file_name)} · ${fmtDate(p.created_at)}"><img src="${esc(url[p.file_path])}" alt="${esc(p.file_name)}" loading="lazy"></a>`).join('') || '<span class="meta">Photos could not be loaded.</span>';
}

function closeUnitHistory(){
  document.getElementById('unitModal').classList.add('hidden');
  const ro = document.getElementById('roModal');
  if(!ro || ro.classList.contains('hidden')) document.body.classList.remove('modal-open');
  unitHistCurrent = null;
}

// ---------------- Repair Order: warranty ----------------
async function loadRoWarranty(job, opts){
  const box = document.getElementById('roWarranty');
  if(!box) return;
  const isShop = opts.isShop;
  let flag = '';
  if(job.warranty_claim_status){
    const src = job.warranty_source_job_id ? (await sb.from('jobs').select('id, ro_number, complaint, completed_at, odometer, warranty_months, warranty_miles, warranty_terms, status').eq('id', job.warranty_source_job_id).maybeSingle()).data : null;
    const srcText = src ? `${esc(src.ro_number || '')} — ${esc(src.complaint || '')}, completed ${fmtDate(src.completed_at)}. ${esc(warrantyTermsText(src))}` : 'An earlier repair on this unit';
    if(job.warranty_claim_status === 'pending_review') flag = `<div class="auth-banner wait"><div><b>Potential warranty repair.</b> This unit had an earlier repair that may still be under warranty:</div><div>${srcText}</div>
        ${isShop && (typeof can !== 'function' || can('warranty')) ? '<button type="button" class="ghost-btn" id="wDecideYes">Warranty claim</button><button type="button" class="ghost-btn" id="wDecideNo">Not warranty</button>' : '<div class="meta">The shop owner or service advisor will decide whether this is covered.</div>'}</div>`;
    else flag = `<div class="auth-banner ${job.warranty_claim_status === 'warranty' ? 'ok' : 'warn'}"><div><b>${job.warranty_claim_status === 'warranty' ? 'Warranty claim' : 'Not a warranty repair'}</b>${job.warranty_decided_at ? ' · decided ' + fmtDateTime(job.warranty_decided_at) : ''}</div>
        <div class="meta">${srcText}</div>${job.warranty_decision_note ? `<div class="meta">“${esc(job.warranty_decision_note)}”</div>` : ''}</div>`;
  }
  const hasTerms = job.warranty_months || job.warranty_miles || job.warranty_terms;
  if(!isShop && !flag && !hasTerms){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<h4>Warranty</h4>${flag}
    ${isShop ? `<p class="meta">Warranty on this repair (shown to the customer and used to flag returns):</p>
      <div class="rec-grid w-grid">
        <div class="field"><label>Months</label><input type="number" id="wMonths" min="0" max="120" value="${job.warranty_months || ''}" placeholder="e.g. 12"></div>
        <div class="field"><label>Miles</label><input type="number" id="wMiles" min="0" max="1000000" value="${job.warranty_miles || ''}" placeholder="e.g. 12000"></div>
        <div class="field rec-span"><label>Terms</label><input id="wTerms" maxlength="500" value="${esc(job.warranty_terms || '')}" placeholder="e.g. Parts and labor"></div>
      </div><div class="job-actions"><button type="button" class="ghost-btn" id="wSave">Save warranty</button></div>`
      : hasTerms ? `<p>${esc(warrantyTermsText(job))}</p>` : ''}`;
  const decide = async (decision) => {
    const note = prompt(decision === 'warranty' ? 'Note (optional): why it is covered' : 'Note (optional): why it is not covered');
    if(note === null) return;
    const { error } = await sb.rpc('decide_warranty', { p_job: job.id, p_decision: decision, p_note: note });
    if(error){ alert(error.message); return; }
    recordsToast(decision === 'warranty' ? 'Marked as warranty claim' : 'Marked not warranty');
    openRepairOrder(job.id);
  };
  const y = document.getElementById('wDecideYes'), n = document.getElementById('wDecideNo');
  if(y) y.onclick = () => decide('warranty');
  if(n) n.onclick = () => decide('not_warranty');
  const save = document.getElementById('wSave');
  if(save) save.onclick = async () => {
    const m = parseInt(document.getElementById('wMonths').value, 10), mi = parseInt(document.getElementById('wMiles').value, 10);
    if((Number.isFinite(m) && (m < 0 || m > 120)) || (Number.isFinite(mi) && (mi < 0 || mi > 1000000))){ alert('Months must be 0–120 and miles 0–1,000,000.'); return; }
    const { error } = await sb.from('jobs').update({ warranty_months: Number.isFinite(m) && m > 0 ? m : null, warranty_miles: Number.isFinite(mi) && mi > 0 ? mi : null,
      warranty_terms: document.getElementById('wTerms').value.trim() || null }).eq('id', job.id);
    if(error){ alert('Could not save: ' + error.message); return; }
    recordsToast('Warranty saved');
  };
}

// ---------------- Units search by RO or invoice number ----------------
let unitSearchExtraIds = [];
let unitSearchTimer = null;
async function lookupUnitsByDocNumber(q){
  unitSearchExtraIds = [];
  const roMatch = q.match(/^(?:ro|wo)-?0*(\d+)$/i), numMatch = q.match(/^#?(\d+)$/);
  if(!roMatch && !numMatch) return;
  const ids = new Set();
  if(roMatch){
    const { data } = await sb.from('jobs').select('unit_id').eq('org_id', session.orgId).in('ro_number', ['WO-' + roMatch[1].padStart(6, '0'), 'RO-' + roMatch[1].padStart(6, '0')]);
    (data || []).forEach(j => j.unit_id && ids.add(j.unit_id));
  }
  if(numMatch){
    const { data } = await sb.from('invoices').select('doc_number, job_id, jobs(unit_id)').eq('org_id', session.orgId).eq('id', Number(numMatch[1]));
    (data || []).forEach(d => d.jobs && d.jobs.unit_id && ids.add(d.jobs.unit_id));
    const { data: ro } = await sb.from('jobs').select('unit_id').eq('org_id', session.orgId).in('ro_number', ['WO-' + numMatch[1].padStart(6, '0'), 'RO-' + numMatch[1].padStart(6, '0')]);
    (ro || []).forEach(j => j.unit_id && ids.add(j.unit_id));
  }
  unitSearchExtraIds = [...ids];
}
function initUnitHistoryUI(){
  const s = document.getElementById('unitsSearch');
  if(s) s.addEventListener('input', () => {
    clearTimeout(unitSearchTimer);
    unitSearchTimer = setTimeout(async () => { await lookupUnitsByDocNumber(s.value.trim()); if(typeof renderUnitsList === 'function') renderUnitsList(); }, 300);
  });
}

document.addEventListener('click', (e) => {
  if(e.target.id === 'unitModal' || e.target.closest('#unitClose')) closeUnitHistory();
});
document.addEventListener('keydown', (e) => {
  const o = document.getElementById('unitModal');
  if(e.key === 'Escape' && o && !o.classList.contains('hidden')){
    // A repair order or inspection opened on top closes first.
    const top = ['inspModal','estModal','roModal'].find(id => { const x = document.getElementById(id); return x && !x.classList.contains('hidden'); });
    if(top) return;
    e.stopImmediatePropagation(); closeUnitHistory();
  }
}, true);
