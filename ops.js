// ============================================================
// RelayFleet — Redesign R2: shop operations.
// Customer profiles, payments, clock in/out + attendance, shop floor TV
// view with bays. The database enforces every rule (migration 0015).
// ============================================================

const opsMoney = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
const opsH = h => (Math.round(Number(h || 0) * 10) / 10).toLocaleString() + ' h';
const PAY_METHODS = { cash:'Cash', check:'Check', card:'Card', ach:'ACH / bank transfer', other:'Other' };
const canBill = () => typeof can !== 'function' || can('billing');

// ================= Customer profile =================
async function openCustomerProfile(customerId){
  const o = document.getElementById('custModal'), body = document.getElementById('custBody');
  body.innerHTML = '<div class="meta" style="padding:24px;">Loading customer…</div>';
  o.classList.remove('hidden'); document.body.classList.add('modal-open');
  const billing = canBill();
  const [cRes, sRes, kRes, uRes, jRes] = await Promise.all([
    sb.from('customers').select('*').eq('id', customerId).maybeSingle(),
    sb.from('customer_summary').select('*').eq('customer_id', customerId).maybeSingle(),
    sb.from('customer_contacts').select('*').eq('customer_id', customerId).order('is_primary', { ascending:false }).order('name'),
    sb.from('units').select('id, unit_number, unit_type, vin, active').eq('customer_id', customerId).eq('active', true).order('unit_number').limit(200),
    sb.from('jobs').select('id, ro_number, vehicle, complaint, status, created_at, completed_at').eq('customer_id', customerId).order('created_at', { ascending:false }).limit(200)
  ]);
  const c = cRes.data;
  if(!c){ body.innerHTML = '<p class="form-error" style="padding:24px;">This customer could not be loaded.</p>'; return; }
  const jobs = jRes.data || [], jobIds = jobs.map(j => j.id);
  const [dRes, msgRes] = await Promise.all([
    billing && jobIds.length ? sb.from('invoices').select('doc_number, id, job_id, kind, status, total, amount_paid, created_at, due_date').in('job_id', jobIds).neq('status', 'draft').order('created_at', { ascending:false }).limit(100) : Promise.resolve({ data:[] }),
    jobIds.length ? sb.from('notification_outbox').select('event, channel, subject, status, created_at, job_id').in('job_id', jobIds).order('created_at', { ascending:false }).limit(30) : Promise.resolve({ data:[] })
  ]);
  const docs = dRes.data || [];
  const docIds = docs.filter(d => d.kind === 'invoice').map(d => d.id);
  const payRes = billing && docIds.length ? await sb.from('payments').select('id, invoice_id, amount, method, reference, paid_on, note').in('invoice_id', docIds).order('paid_on', { ascending:false }).limit(100) : { data:[] };
  const s = sRes.data || {};
  const open = jobs.filter(j => !isClosedStatus(j.status)), past = jobs.filter(j => isClosedStatus(j.status));
  const roOf = id => (jobs.find(j => j.id === id) || {}).ro_number || '';
  const contacts = kRes.data || [];
  const primary = contacts.find(k => k.is_primary);
  const tile = (label, value, cls) => `<div class="${cls || ''}"><span>${label}</span><b>${value}</b></div>`;
  const woRow = j => `<button type="button" class="rec-order cp-wo" data-job="${j.id}"><span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span><span class="rec-order-main">${esc(j.vehicle || '')}${j.complaint ? ' — ' + esc(j.complaint.slice(0, 60)) : ''}</span><span class="meta">${fmtDate(j.completed_at || j.created_at)}</span>${jobStatusBadge(j.status)}</button>`;
  body.innerHTML = `
    <div class="wo-head"><div class="wo-head-main">
      <div class="wo-head-line"><span class="rec-tag">Customer</span>${c.fleet_profile_id ? '<span class="rec-tag">Fleet portal linked</span>' : ''}${c.active ? '' : '<span class="rec-tag">Inactive</span>'}</div>
      <h2>${esc(c.company_name)}</h2>
      <div class="wo-head-facts">${[primary ? primary.name + (primary.title ? ' (' + primary.title + ')' : '') : c.contact_name, (primary && primary.phone) || c.phone, (primary && primary.email) || c.email].filter(Boolean).map(esc).map(x => `<span>${x}</span>`).join('') || '<span class="meta">No contact details yet</span>'}
        <span class="meta">Terms: ${esc(String(c.payment_terms || 'due_on_receipt').replace(/_/g, ' '))}${c.tax_exempt ? ' · tax exempt' : ''}</span></div>
    </div><div class="wo-actions">
      <button type="button" class="wo-act-primary" id="cpNewWo">+ New work order</button>
      <button type="button" class="ghost-btn" id="cpEdit">Edit customer</button>
    </div></div>
    <div class="wo-summary cp-tiles">
      ${tile('Open work orders', s.open_work_orders ?? open.length)}
      ${tile('Units', s.units ?? (uRes.data || []).length)}
      ${billing ? tile('Spent this year', opsMoney(s.year_spend)) + tile('Lifetime', opsMoney(s.lifetime_spend)) + tile('Balance owed', `<span class="${Number(s.balance) > 0 ? 'neg' : ''}">${opsMoney(s.balance)}</span>`) : ''}
      ${tile('Last visit', s.last_visit ? fmtDate(s.last_visit) : '—')}
    </div>
    <div class="ro-grid">
      <section class="ro-sec"><h4>Contacts</h4><div id="cpContacts"></div></section>
      <section class="ro-sec"><h4>Units (${(uRes.data || []).length})</h4>
        <div class="rec-orders">${(uRes.data || []).map(u => `<button type="button" class="rec-order cp-unit" data-unit="${u.id}"><span class="rec-order-main"><b>${esc(({ truck:'Truck', trailer:'Trailer' })[u.unit_type] || 'Unit')} ${esc(u.unit_number)}</b>${u.vin ? ' <span class="meta">VIN ' + esc(u.vin) + '</span>' : ''}</span></button>`).join('') || '<span class="meta">No units yet.</span>'}</div></section>
    </div>
    <section class="ro-sec"><h4>Open work orders (${open.length})</h4><div class="rec-orders">${open.map(woRow).join('') || '<span class="meta">None open.</span>'}</div></section>
    <section class="ro-sec"><h4>Past work orders (${past.length})</h4><div class="rec-orders">${past.slice(0, 25).map(woRow).join('') || '<span class="meta">None yet.</span>'}${past.length > 25 ? `<p class="meta">Showing the latest 25 of ${past.length}.</p>` : ''}</div></section>
    ${billing ? `<section class="ro-sec"><h4>Estimates &amp; invoices</h4>${docs.length ? docs.map(d => { const bal = d.kind === 'invoice' ? Number(d.total) - Number(d.amount_paid || 0) : 0;
        return `<div class="ro-inv"><button type="button" class="text-btn cp-doc" data-doc="${d.id}">${d.kind === 'estimate' ? 'Estimate' : 'Invoice'} ${esc(docNo(d))}</button><span class="meta">${esc(roOf(d.job_id))} · ${fmtDate(d.created_at)}</span>
          <span class="rec-tag">${esc(d.kind === 'invoice' && d.status !== 'paid' && Number(d.amount_paid) > 0 ? 'partly paid' : String(d.status).replace(/_/g, ' '))}</span><b>${opsMoney(d.total)}</b>${bal > 0.005 && d.status !== 'draft' ? `<span class="neg">${opsMoney(bal)} due</span>` : ''}</div>`; }).join('') : '<p class="meta">None yet.</p>'}</section>
      <section class="ro-sec"><h4>Payments</h4>${(payRes.data || []).length ? (payRes.data || []).map(p => `<div class="ro-inv"><span>${fmtDate(p.paid_on)}</span><span>${esc(PAY_METHODS[p.method] || p.method)}${p.reference ? ' ' + esc(p.reference) : ''}</span><span class="meta">Invoice ${esc(docNo(docs.find(d => d.id === p.invoice_id) || { id: p.invoice_id }))}${p.note ? ' · ' + esc(p.note) : ''}</span><b class="pos">${opsMoney(p.amount)}</b></div>`).join('') : '<p class="meta">No payments yet.</p>'}</section>` : ''}
    <section class="ro-sec"><h4>Notes</h4><p>${c.notes ? esc(c.notes) : '<span class="meta">No notes. Add them with Edit customer.</span>'}</p></section>
    <section class="ro-sec"><h4>Customer updates sent</h4>${(msgRes.data || []).length ? `<div class="comm-list">${(msgRes.data || []).map(m => `<div class="comm-row st-${esc(m.status)}"><div class="comm-main"><b>${esc((typeof EVENT_LABEL !== 'undefined' && EVENT_LABEL[m.event]) || m.event)}</b> <span class="meta">· ${esc(roOf(m.job_id))}</span></div><div class="comm-side"><span class="comm-status">${esc(m.status)}</span><span class="meta">${fmtDateTime(m.created_at)}</span></div></div>`).join('')}</div>` : '<p class="meta">None yet.</p>'}</section>`;
  renderContacts(c, contacts);
  const b = document.getElementById('custBody');
  b.querySelectorAll('.cp-wo').forEach(x => x.onclick = () => openRepairOrder(Number(x.dataset.job)));
  b.querySelectorAll('.cp-unit').forEach(x => x.onclick = () => { if(typeof openUnitHistory === 'function') openUnitHistory(Number(x.dataset.unit)); });
  b.querySelectorAll('.cp-doc').forEach(x => x.onclick = () => openEstimateEditor(Number(x.dataset.doc)));
  document.getElementById('cpEdit').onclick = () => { closeCustomerProfile(); if(typeof openCustomerForm === 'function') openCustomerForm(c.id); };
  document.getElementById('cpNewWo').onclick = () => {
    closeCustomerProfile();
    const t = document.querySelector('.dash-tab[data-target="shop-jobs"]'); if(t) t.click();
    const box = document.getElementById('woCreateBox'), nb = document.getElementById('woNewBtn');
    if(box){ box.classList.remove('hidden'); if(nb) nb.textContent = 'Close'; }
    const f = document.getElementById('njCustomer'); if(f){ f.value = c.company_name; f.dispatchEvent(new Event('input')); }
  };
}
function renderContacts(c, contacts){
  const box = document.getElementById('cpContacts');
  if(!box) return;
  const isShop = session.role === 'shop' || session.role === 'admin';
  box.innerHTML = (contacts.length ? contacts.map(k => `<div class="cp-contact"><div><b>${esc(k.name)}</b>${k.is_primary ? ' <span class="rec-tag">Primary</span>' : ''}${k.gets_invoices ? ' <span class="rec-tag">Gets invoices</span>' : ''}
      <div class="meta">${[k.title, k.phone, k.email].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="cp-contact-act">${k.phone ? `<a class="text-btn" href="tel:${esc(k.phone)}">Call</a>` : ''}${k.email ? `<a class="text-btn" href="mailto:${esc(k.email)}">Email</a>` : ''}${isShop ? `<button type="button" class="text-btn" data-kedit="${k.id}">Edit</button>` : ''}</div></div>`).join('')
    : `<p class="meta">${c.contact_name || c.phone ? 'Main contact: ' + esc([c.contact_name, c.phone, c.email].filter(Boolean).join(' · ')) : 'No contacts yet.'}</p>`)
    + (isShop ? '<button type="button" class="ghost-btn" id="cpAddContact">+ Add contact</button><div id="cpContactForm"></div>' : '');
  const form = (k) => {
    const v = f => k && k[f] ? esc(k[f]) : '';
    document.getElementById('cpContactForm').innerHTML = `<div class="rec-grid cp-cform">
      <div class="field"><label>Name *</label><input id="ckName" maxlength="120" value="${v('name')}"></div>
      <div class="field"><label>Title</label><input id="ckTitle" maxlength="80" value="${v('title')}" placeholder="e.g. Fleet manager"></div>
      <div class="field"><label>Phone</label><input id="ckPhone" maxlength="40" value="${v('phone')}"></div>
      <div class="field"><label>Email</label><input id="ckEmail" type="email" maxlength="200" value="${v('email')}"></div>
      <label class="rec-check"><input type="checkbox" id="ckPrimary" ${k && k.is_primary ? 'checked' : ''}> Primary contact</label>
      <label class="rec-check"><input type="checkbox" id="ckInv" ${k && k.gets_invoices ? 'checked' : ''}> Gets invoices</label>
      </div><p class="form-error" id="ckErr"></p><div class="job-actions"><button type="button" id="ckSave">${k ? 'Save' : 'Add contact'}</button>${k ? '<button type="button" class="text-btn danger" id="ckDel">Remove</button>' : ''}</div>`;
    document.getElementById('ckSave').onclick = async () => {
      const row = { name: document.getElementById('ckName').value.trim(), title: document.getElementById('ckTitle').value.trim() || null, phone: document.getElementById('ckPhone').value.trim() || null,
        email: document.getElementById('ckEmail').value.trim() || null, is_primary: document.getElementById('ckPrimary').checked, gets_invoices: document.getElementById('ckInv').checked };
      if(!row.name){ document.getElementById('ckErr').textContent = 'Enter a name.'; return; }
      // Only one primary: clear the old one first.
      if(row.is_primary){ const cur = contacts.find(x => x.is_primary && (!k || x.id !== k.id)); if(cur) await sb.from('customer_contacts').update({ is_primary:false }).eq('id', cur.id); }
      const res = k ? await sb.from('customer_contacts').update(row).eq('id', k.id) : await sb.from('customer_contacts').insert([{ ...row, customer_id: c.id }]);
      if(res.error){ document.getElementById('ckErr').textContent = res.error.message; return; }
      recordsToast(k ? 'Contact saved' : 'Contact added'); openCustomerProfile(c.id);
    };
    const del = document.getElementById('ckDel');
    if(del) del.onclick = async () => { if(!confirm('Remove this contact?')) return; const { error } = await sb.from('customer_contacts').delete().eq('id', k.id); if(error){ alert(error.message); return; } openCustomerProfile(c.id); };
  };
  const add = document.getElementById('cpAddContact'); if(add) add.onclick = () => form(null);
  box.querySelectorAll('[data-kedit]').forEach(b => b.onclick = () => form(contacts.find(k => k.id === Number(b.dataset.kedit))));
}
function closeCustomerProfile(){
  document.getElementById('custModal').classList.add('hidden');
  const ro = document.getElementById('roModal');
  if(!ro || ro.classList.contains('hidden')) document.body.classList.remove('modal-open');
}

// ================= Payments (invoice editor) =================
async function loadInvoicePayments(doc){
  const box = document.getElementById('estPayments');
  if(!box || doc.kind !== 'invoice' || doc.status === 'draft' || !canBill()) return;
  const { data } = await sb.from('payments').select('id, amount, method, reference, paid_on, note').eq('invoice_id', doc.id).order('paid_on');
  const pays = data || [];
  const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  const bal = Math.max(0, Math.round((Number(doc.total || 0) - paid) * 100) / 100);
  box.innerHTML = `<section class="ro-sec"><h4>Payments</h4>
    <div class="pay-sum"><span>Total <b>${opsMoney(doc.total)}</b></span><span>Paid <b class="pos">${opsMoney(paid)}</b></span><span>Balance <b class="${bal > 0 ? 'neg' : 'pos'}">${opsMoney(bal)}</b></span></div>
    ${pays.map(p => `<div class="ro-inv"><span>${fmtDate(p.paid_on)}</span><span>${esc(PAY_METHODS[p.method] || p.method)}${p.reference ? ' ' + esc(p.reference) : ''}</span><span class="meta">${esc(p.note || '')}</span><b>${opsMoney(p.amount)}</b><button type="button" class="text-btn danger" data-pdel="${p.id}">Delete</button></div>`).join('')}
    ${bal > 0 ? `<div class="pay-form">
      <div class="field"><label>Amount</label><input type="number" id="payAmt" min="0.01" step="0.01" value="${bal.toFixed(2)}"></div>
      <div class="field"><label>Method</label><select id="payMethod">${Object.entries(PAY_METHODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div class="field"><label>Check # / reference</label><input id="payRef" maxlength="80"></div>
      <div class="field"><label>Date</label><input type="date" id="payDate" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}"></div>
      <button type="button" id="payAdd">Record payment</button></div><p class="form-error" id="payErr"></p>` : '<p class="meta">Paid in full.</p>'}
  </section>`;
  const add = document.getElementById('payAdd');
  if(add) add.onclick = async () => {
    const amount = parseFloat(document.getElementById('payAmt').value);
    const err = document.getElementById('payErr');
    if(!(amount > 0)){ err.textContent = 'Enter an amount above 0.'; return; }
    if(amount > bal + 0.005){ err.textContent = `That is more than the balance of ${opsMoney(bal)}.`; return; }
    add.disabled = true;
    const { error } = await sb.from('payments').insert([{ invoice_id: doc.id, amount, method: document.getElementById('payMethod').value,
      reference: document.getElementById('payRef').value.trim() || null, paid_on: document.getElementById('payDate').value || null }]);
    add.disabled = false;
    if(error){ err.textContent = error.message; return; }
    recordsToast(amount >= bal - 0.005 ? 'Paid in full' : 'Payment recorded');
    if(typeof notifyKick === 'function') notifyKick();
    openEstimateEditor(doc.id);
  };
  box.querySelectorAll('[data-pdel]').forEach(b => b.onclick = async () => {
    if(!confirm('Delete this payment? The invoice balance goes back up.')) return;
    const { error } = await sb.from('payments').delete().eq('id', Number(b.dataset.pdel));
    if(error){ alert(error.message); return; }
    openEstimateEditor(doc.id);
  });
}

// ================= Clock in / out (mechanic) =================
let clockTimer = null;
async function renderClockCard(){
  const box = document.getElementById('clockCard');
  if(!box || session.role !== 'mechanic') return;
  const { data } = await sb.from('time_clock').select('id, clock_in').eq('profile_id', session.id).is('clock_out', null).maybeSingle();
  clearInterval(clockTimer);
  if(data){
    const since = new Date(data.clock_in);
    const fmt = () => { const m = Math.max(0, Math.floor((Date.now() - since) / 60000)); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' m'; };
    box.innerHTML = `<div class="clock-on"><div><b>Clocked in</b> since ${since.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}<div class="meta">On shift <span id="clockDur">${fmt()}</span></div></div>
      <button type="button" class="ghost-btn" id="clockOutBtn">Clock out</button></div>`;
    clockTimer = setInterval(() => { const d = document.getElementById('clockDur'); if(d) d.textContent = fmt(); else clearInterval(clockTimer); }, 30000);
    document.getElementById('clockOutBtn').onclick = async () => {
      if(!confirm('Clock out? Any running job timer stops too.')) return;
      const { error } = await sb.rpc('clock_out');
      if(error){ alert(error.message); return; }
      recordsToast('Clocked out'); renderClockCard(); if(typeof renderMechJobs === 'function') renderMechJobs();
    };
  } else {
    box.innerHTML = `<div class="clock-off"><div><b>Not clocked in</b><div class="meta">Clock in when your shift starts. Starting a job also clocks you in.</div></div>
      <button type="button" class="clock-in-btn" id="clockInBtn">Clock in</button></div>`;
    document.getElementById('clockInBtn').onclick = async () => {
      const { error } = await sb.rpc('clock_in');
      if(error){ alert(error.message); return; }
      recordsToast('Clocked in'); renderClockCard();
    };
  }
}
function initClockUI(){
  const view = document.getElementById('mechanicView');
  if(!view || document.getElementById('clockCard')) return renderClockCard();
  const card = document.createElement('div'); card.id = 'clockCard'; card.className = 'card clock-card';
  view.insertBefore(card, view.firstElementChild);
  renderClockCard();
}

// ================= Attendance (Time page) =================
async function renderAttendance(from, to, entries, mechanics){
  const box = document.getElementById('attendanceBox');
  if(!box) return;
  const { data } = await sb.from('time_clock').select('id, profile_id, clock_in, clock_out, source, note, edited_at')
    .eq('org_id', session.orgId).gte('clock_in', from.toISOString()).lte('clock_in', to.toISOString()).order('clock_in', { ascending:false }).limit(1000);
  const shifts = data || [];
  const hrs = (a, b) => ((b ? new Date(b) : new Date()) - new Date(a)) / 3600e3;
  const people = (mechanics || []).filter(m => m.active);
  const rows = people.map(m => {
    const clock = shifts.filter(s => s.profile_id === m.id).reduce((t, s) => t + hrs(s.clock_in, s.clock_out), 0);
    const labor = (entries || []).filter(e => e.mechanic_id === m.id && e.kind === 'labor').reduce((t, e) => t + hrs(e.started_at, e.ended_at), 0);
    const drive = (entries || []).filter(e => e.mechanic_id === m.id && e.kind === 'drive').reduce((t, e) => t + hrs(e.started_at, e.ended_at), 0);
    const onNow = shifts.some(s => s.profile_id === m.id && !s.clock_out);
    return { m, clock, labor, drive, non: Math.max(0, clock - labor - drive), eff: clock > 0 ? Math.round(labor / clock * 100) : null, onNow };
  });
  const admin = typeof can !== 'function' || can('time_admin');
  const name = id => (people.find(m => m.id === id) || (mechanics || []).find(m => m.id === id) || {}).name || 'Staff';
  box.innerHTML = `<div class="section-head"><h2>Attendance</h2>${admin ? '<button type="button" class="ghost-btn" id="attAdd">Add shift</button>' : ''}</div>
    <div class="an-scroll"><table class="an-table att-table"><thead><tr><th>Technician</th><th>On the clock</th><th>Billable (labor)</th><th>Drive</th><th>Non-billable</th><th>Efficiency</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td><b>${esc(r.m.name)}</b>${r.onNow ? ' <span class="rec-tag att-on">Clocked in</span>' : ''}</td><td>${opsH(r.clock)}</td><td>${opsH(r.labor)}</td><td>${opsH(r.drive)}</td><td>${opsH(r.non)}</td>
        <td>${r.eff == null ? '—' : `<b class="${r.eff >= 75 ? 'pos' : r.eff < 50 ? 'neg' : ''}">${r.eff}%</b>`}</td></tr>`).join('') || '<tr><td colspan="6" class="meta">No technicians yet.</td></tr>'}</tbody></table></div>
    <p class="meta">Efficiency = labor hours ÷ hours on the clock. Non-billable = on the clock but not on a job timer.</p>
    <details class="att-shifts"><summary>Shifts (${shifts.length})</summary>${shifts.map(s => `<div class="ro-inv"><span>${esc(name(s.profile_id))}</span><span class="meta">${fmtDateTime(s.clock_in)} → ${s.clock_out ? new Date(s.clock_out).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '<b>now</b>'}</span>
      <span>${opsH(hrs(s.clock_in, s.clock_out))}${s.source === 'auto' ? ' <em class="meta">auto</em>' : ''}${s.edited_at || s.source === 'manual' ? ' <em class="meta">edited</em>' : ''}</span>
      ${admin ? `<button type="button" class="text-btn" data-sedit="${s.id}">Edit</button><button type="button" class="text-btn danger" data-sdel="${s.id}">Delete</button>` : ''}</div>`).join('') || '<p class="meta">No shifts in this period.</p>'}</details>
    <div id="attForm"></div>`;
  const local = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const form = (s) => {
    document.getElementById('attForm').innerHTML = `<div class="card rec-form"><div class="rec-grid">
      <div class="field"><label>Technician</label><select id="atWho" ${s ? 'disabled' : ''}>${people.map(m => `<option value="${m.id}" ${s && s.profile_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Clock in</label><input type="datetime-local" id="atIn" value="${local(s ? s.clock_in : Date.now() - 8 * 3600e3)}"></div>
      <div class="field"><label>Clock out</label><input type="datetime-local" id="atOut" value="${local(s && s.clock_out ? s.clock_out : Date.now())}"></div>
      <div class="field"><label>Note</label><input id="atNote" maxlength="300" value="${s && s.note ? esc(s.note) : ''}" placeholder="Why the change"></div></div>
      <p class="form-error" id="atErr"></p><div class="job-actions"><button type="button" id="atSave">${s ? 'Save' : 'Add shift'}</button></div></div>`;
    document.getElementById('atSave').onclick = async () => {
      const a = new Date(document.getElementById('atIn').value), b = new Date(document.getElementById('atOut').value);
      if(isNaN(a) || isNaN(b) || b <= a){ document.getElementById('atErr').textContent = 'Clock out must be after clock in.'; return; }
      if(b - a > 24 * 3600e3){ document.getElementById('atErr').textContent = 'One shift can be at most 24 hours.'; return; }
      const row = { clock_in: a.toISOString(), clock_out: b.toISOString(), note: document.getElementById('atNote').value.trim() || null };
      const res = s ? await sb.from('time_clock').update(row).eq('id', s.id) : await sb.from('time_clock').insert([{ ...row, profile_id: document.getElementById('atWho').value, source:'manual' }]);
      if(res.error){ document.getElementById('atErr').textContent = res.error.message; return; }
      recordsToast(s ? 'Shift corrected' : 'Shift added'); if(typeof refreshTimePage === 'function') refreshTimePage();
    };
  };
  const add = document.getElementById('attAdd'); if(add) add.onclick = () => form(null);
  box.querySelectorAll('[data-sedit]').forEach(b => b.onclick = () => form(shifts.find(s => s.id === Number(b.dataset.sedit))));
  box.querySelectorAll('[data-sdel]').forEach(b => b.onclick = async () => { if(!confirm('Delete this shift?')) return; const { error } = await sb.from('time_clock').delete().eq('id', Number(b.dataset.sdel)); if(error){ alert(error.message); return; } refreshTimePage(); });
}

// ================= Shop floor (TV) =================
async function refreshShopFloor(){
  const box = document.getElementById('floorBoard');
  if(!box) return;
  const [bRes, jRes, mechs, runRes] = await Promise.all([
    (typeof locFilter === 'function' ? locFilter : (q => q))(sb.from('shop_bays').select('id, name, position').eq('org_id', session.orgId).eq('active', true)).order('position').order('name'),
    (typeof locFilter === 'function' ? locFilter : (q => q))(sb.from('jobs').select('id, ro_number, customer, vehicle, complaint, status, job_type, mechanic_id, bay_id, dest_lat, dest_lng, priority').eq('org_id', session.orgId)).not('status', 'in', '(' + CLOSED_STATUSES.join(',') + ')').limit(300),
    fetchOrgMechanics(),
    sb.from('time_entries').select('job_id, mechanic_id, started_at, kind').eq('org_id', session.orgId).is('ended_at', null)
  ]);
  const bays = bRes.data || [], jobs = jRes.data || [], running = runRes.data || [];
  const name = id => (mechs.find(m => m.id === id) || {}).name || 'Unassigned';
  const roadJobs = jobs.filter(j => j.job_type === 'mobile');
  const locs = typeof fetchLocationsFor === 'function' ? await fetchLocationsFor([...new Set(roadJobs.map(j => j.mechanic_id).filter(Boolean))]) : {};
  const timer = jobId => { const r = running.find(x => x.job_id === jobId); if(!r) return ''; const m = Math.floor((Date.now() - new Date(r.started_at)) / 60000); return `<span class="floor-timer">${r.kind === 'drive' ? 'Driving' : 'Working'} ${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}</span>`; };
  const tile = (title, j, extra) => `<div class="floor-tile${j ? ' busy st-' + esc(j.status) : ' free'}"${j ? ` data-job="${j.id}"` : ''}>
      <div class="floor-tile-head"><span>${esc(title)}</span>${j ? jobStatusBadge(j.status) : '<span class="floor-free">Available</span>'}</div>
      ${j ? `<div class="floor-tech">${esc(name(j.mechanic_id))}</div><div class="floor-unit">${esc(j.vehicle || '')} <span class="floor-ro">${esc(j.ro_number || '')}</span></div>
        <div class="floor-svc">${esc((j.complaint || '').slice(0, 60))}</div><div class="floor-foot">${timer(j.id)}${extra || ''}</div>` : ''}</div>`;
  const inBay = id => jobs.find(j => j.bay_id === id);
  const unbayed = jobs.filter(j => j.job_type === 'inshop' && !j.bay_id && WORKING_STATUSES.concat(['waiting_parts','waiting_approval']).includes(j.status));
  box.innerHTML = `
    <div class="floor-grid">${bays.map(b => tile(b.name, inBay(b.id))).join('') || '<div class="floor-empty">No bays set up yet. Add them in More → Settings → Shop bays.</div>'}</div>
    ${unbayed.length ? `<h3 class="floor-h">In the shop, no bay</h3><div class="floor-grid">${unbayed.map(j => tile('No bay', j)).join('')}</div>` : ''}
    <h3 class="floor-h">Road calls</h3>
    <div class="floor-grid">${roadJobs.map(j => { const l = locs[j.mechanic_id];
        const mi = l && j.dest_lat ? milesBetween(l.lat, l.lng, j.dest_lat, j.dest_lng) : null;
        const eta = mi != null && j.status === 'en_route' ? ` · ETA ${typeof fleetEtaText === 'function' ? fleetEtaText(mi).replace('about ', '') : Math.round(mi / 45 * 60) + ' min'}` : '';
        return tile('Road call', j, mi != null ? `<span class="floor-dist">${mi.toFixed(1)} mi${eta}</span>` : ''); }).join('') || '<div class="floor-empty">No road calls right now.</div>'}</div>`;
  const stamp = document.getElementById('floorUpdated'); if(stamp) stamp.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
}
function toggleTvMode(){
  const on = !document.body.classList.contains('tv-mode');
  document.body.classList.toggle('tv-mode', on);
  const el = document.documentElement;
  try { if(on && el.requestFullscreen) el.requestFullscreen(); else if(!on && document.fullscreenElement) document.exitFullscreen(); } catch(_){}
  document.getElementById('floorTvBtn').textContent = on ? 'Exit TV mode' : 'TV mode';
}

// ================= Bays: settings + work order =================
async function renderBaySettings(){
  const box = document.getElementById('baySettings');
  if(!box || !(typeof can !== 'function' || can('settings'))) return;
  const { data } = await sb.from('shop_bays').select('id, name, position, active').eq('org_id', session.orgId).order('position').order('name');
  const bays = data || [];
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Shop bays</h2></div><div class="card new-job-form" style="max-width:640px;">
    <p class="meta" style="margin-top:0;">Bays show on the Shop floor screen. Put a work order in a bay from its Overview tab.</p>
    ${bays.map(b => `<div class="ro-inv"><b>${esc(b.name)}</b>${b.active ? '' : '<span class="rec-tag">Hidden</span>'}<button type="button" class="text-btn" data-btog="${b.id}" data-on="${b.active}">${b.active ? 'Hide' : 'Show'}</button></div>`).join('')}
    <div class="insp-start"><input id="bayName" maxlength="40" placeholder="e.g. Bay 3"><button type="button" id="bayAdd">Add bay</button></div><p class="form-error" id="bayErr"></p></div>`;
  document.getElementById('bayAdd').onclick = async () => {
    const n = document.getElementById('bayName').value.trim();
    if(!n){ document.getElementById('bayErr').textContent = 'Enter a name.'; return; }
    const { error } = await sb.from('shop_bays').insert([{ org_id: session.orgId, name: n, position: bays.length + 1, location_id: (typeof currentLocationId === 'function' && currentLocationId()) || undefined }]);
    if(error){ document.getElementById('bayErr').textContent = error.code === '23505' ? 'You already have a bay with that name.' : error.message; return; }
    renderBaySettings();
  };
  box.querySelectorAll('[data-btog]').forEach(b => b.onclick = async () => { await sb.from('shop_bays').update({ active: b.dataset.on !== 'true' }).eq('id', Number(b.dataset.btog)); renderBaySettings(); });
}
async function loadWoBay(job){
  const box = document.getElementById('woBayBox');
  if(!box) return;
  if(job.job_type !== 'inshop' || isClosedStatus(job.status)){ box.classList.add('hidden'); return; }
  const { data } = await sb.from('shop_bays').select('id, name').eq('org_id', job.org_id).eq('active', true).order('position').order('name');
  const bays = data || [];
  if(!bays.length){ box.classList.add('hidden'); return; }
  const isShop = session.role === 'shop' || session.role === 'admin';
  box.classList.remove('hidden');
  box.innerHTML = `<h4>Bay</h4>${isShop ? `<div class="ro-status-row"><select id="woBay"><option value="">No bay</option>${bays.map(b => `<option value="${b.id}" ${job.bay_id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select><button type="button" id="woBaySave">Save bay</button></div>`
    : `<p>${esc((bays.find(b => b.id === job.bay_id) || {}).name || 'No bay')}</p>`}`;
  const s = document.getElementById('woBaySave');
  if(s) s.onclick = async () => {
    const { error } = await sb.from('jobs').update({ bay_id: Number(document.getElementById('woBay').value) || null }).eq('id', job.id);
    if(error){ alert(error.message); return; }
    recordsToast('Bay saved');
  };
}

function initOpsUI(){
  const fl = document.querySelector('.dash-tab[data-target="shop-floor"]');
  if(fl) fl.addEventListener('click', refreshShopFloor);
  const tv = document.getElementById('floorTvBtn'); if(tv) tv.onclick = toggleTvMode;
  document.addEventListener('fullscreenchange', () => { if(!document.fullscreenElement && document.body.classList.contains('tv-mode')) toggleTvMode(); });
  if(typeof everyWhileVisible === 'function') everyWhileVisible(() => { if(typeof panelVisible === 'function' && panelVisible('shop-floor')) refreshShopFloor(); }, 30000);
  document.querySelectorAll('.dash-tab[data-target="shop-billing"]').forEach(t => t.addEventListener('click', renderBaySettings));
  renderBaySettings();
}
document.addEventListener('click', (e) => {
  if(e.target.id === 'custModal' || e.target.closest('#custClose')) closeCustomerProfile();
  const t = e.target.closest('#floorBoard .floor-tile[data-job]');
  if(t && !document.body.classList.contains('tv-mode')) openRepairOrder(Number(t.dataset.job));
});
