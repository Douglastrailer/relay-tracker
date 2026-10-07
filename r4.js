// ============================================================
// RelayFleet — Redesign R4a: more than one technician per work order,
// and a QuickBooks Online-ready export. The database (migration 0017)
// decides who can add technicians and who can work a job.
// ============================================================

// ================= Technicians on a work order =================
async function loadWoTechs(job){
  const box = document.getElementById('woTechBox');
  if(!box) return;
  const isShop = session.role === 'shop' || session.role === 'admin';
  const [helpRes, mechs] = await Promise.all([
    sb.from('job_technicians').select('profile_id, added_at').eq('job_id', job.id),
    typeof fetchOrgMechanics === 'function' && isShop ? fetchOrgMechanics() : Promise.resolve([])
  ]);
  const helpers = helpRes.data || [];
  const ids = [job.mechanic_id, ...helpers.map(h => h.profile_id)].filter(Boolean);
  const names = {};
  if(ids.length){ (await sb.from('profiles').select('id, name').in('id', ids)).data?.forEach(p => names[p.id] = p.name); }
  const closed = isClosedStatus(job.status);
  const free = mechs.filter(m => m.active && m.id !== job.mechanic_id && !helpers.some(h => h.profile_id === m.id));
  box.innerHTML = `<h4>Technicians</h4>
    <div class="tech-list">
      ${job.mechanic_id ? `<span class="tech-chip lead">${esc(names[job.mechanic_id] || 'Lead')} <em>lead</em></span>` : '<span class="meta">No lead technician</span>'}
      ${helpers.map(h => `<span class="tech-chip">${esc(names[h.profile_id] || 'Technician')}${isShop && !closed ? ` <button type="button" class="tech-x" data-rmtech="${h.profile_id}" aria-label="Remove ${esc(names[h.profile_id] || '')}">×</button>` : ''}</span>`).join('')}
    </div>
    ${isShop && !closed && free.length ? `<div class="ro-status-row tech-add"><select id="woTechAdd" aria-label="Add a technician"><option value="">Add a technician…</option>${free.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button type="button" id="woTechAddBtn">Add</button></div>` : ''}
    <p class="meta">Added technicians can run timers, add parts and do inspections on this work order. Changing the lead is under "Change customer, unit or technician".</p>`;
  const add = document.getElementById('woTechAddBtn');
  if(add) add.onclick = async () => {
    const pid = document.getElementById('woTechAdd').value;
    if(!pid) return;
    const { error } = await sb.from('job_technicians').insert([{ job_id: job.id, profile_id: pid }]);
    if(error){ alert(error.message); return; }
    recordsToast('Technician added'); loadWoTechs(job); if(typeof refreshCurrentView === 'function') refreshCurrentView();
  };
  box.querySelectorAll('[data-rmtech]').forEach(b => b.onclick = async () => {
    if(!confirm('Remove this technician from the work order? Their recorded time stays.')) return;
    const { error } = await sb.from('job_technicians').delete().eq('job_id', job.id).eq('profile_id', b.dataset.rmtech);
    if(error){ alert(error.message); return; }
    loadWoTechs(job); if(typeof refreshCurrentView === 'function') refreshCurrentView();
  });
}
// Jobs where this mechanic is an added technician (shown in their list as "Helping").
async function fetchHelperJobs(){
  if(!session || session.role !== 'mechanic') return [];
  const { data: rows } = await sb.from('job_technicians').select('job_id').eq('profile_id', session.id);
  const ids = (rows || []).map(r => r.job_id);
  if(!ids.length) return [];
  const { data } = await sb.from('jobs').select(JOB_COLUMNS).in('id', ids).not('status', 'in', '(' + CLOSED_STATUSES.join(',') + ')');
  return (data || []).map(j => Object.assign(j, { _helping: true }));
}
async function helperCounts(ids){
  const out = {};
  if(!ids.length) return out;
  const { data } = await sb.from('job_technicians').select('job_id').in('job_id', ids);
  (data || []).forEach(r => out[r.job_id] = (out[r.job_id] || 0) + 1);
  return out;
}

// ================= QuickBooks Online export =================
const QBO_TERMS = { due_on_receipt:'Due on receipt', net_15:'Net 15', net_30:'Net 30', net_45:'Net 45', net_60:'Net 60' };
const QBO_ITEM = { labor:'Labor', part:'Parts', fee:'Fees', mileage:'Mileage', other:'Other' };
const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
const csvOf = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
const qboDate = d => { if(!d) return ''; const x = new Date(String(d).length === 10 ? d + 'T12:00:00' : d); return (x.getMonth() + 1) + '/' + x.getDate() + '/' + x.getFullYear(); };
function downloadCsv(name, rows){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csvOf(rows)], { type:'text/csv' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function qboRange(){
  const r = document.getElementById('qboRange').value, now = new Date();
  if(r === 'custom'){ const f = document.getElementById('qboFrom').value, t = document.getElementById('qboTo').value; if(!f || !t) return null; const to = new Date(t + 'T00:00:00'); to.setDate(to.getDate() + 1); return { from: new Date(f + 'T00:00:00'), to }; }
  if(r === 'last'){ return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) }; }
  if(r === 'year'){ return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1) }; }
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
}
async function loadQboInvoices(rg){
  const { data } = await sb.from('invoices').select('doc_number, id, job_id, customer_name, created_at, due_date, payment_terms, total, tax_amount, discount_amount, status, unit_number, invoice_items(description, quantity, unit_price, item_type, customer_decision), jobs(ro_number, vehicle, completed_at)')
    .eq('org_id', session.orgId).eq('kind', 'invoice').neq('status', 'draft').gte('created_at', rg.from.toISOString()).lt('created_at', rg.to.toISOString()).order('created_at').limit(5000);
  return data || [];
}
function qboInvoiceRows(invs){
  const head = ['InvoiceNo','Customer','InvoiceDate','DueDate','Terms','Memo','Item(Product/Service)','ItemDescription','ItemQuantity','ItemRate','ItemAmount','Service Date'];
  const groups = invs.map(i => {
    const j = i.jobs || {};
    const base = [String(i.doc_number || i.id), i.customer_name || 'Customer', qboDate(i.created_at), qboDate(i.due_date || i.created_at), QBO_TERMS[i.payment_terms] || '',
                  [j.ro_number, i.unit_number || j.vehicle].filter(Boolean).join(' · ')];
    const lines = (i.invoice_items || []).filter(l => l.customer_decision !== 'declined').map(l => base.concat([QBO_ITEM[l.item_type] || 'Other', l.description, Number(l.quantity), Number(l.unit_price),
      (Math.round(Number(l.quantity) * Number(l.unit_price) * 100) / 100).toFixed(2), qboDate(j.completed_at)]));
    if(Number(i.tax_amount) > 0) lines.push(base.concat(['Sales Tax', 'Sales tax', 1, Number(i.tax_amount), Number(i.tax_amount).toFixed(2), qboDate(j.completed_at)]));
    return lines;
  });
  // QuickBooks imports at most 100 invoices and 1,000 rows per file.
  const files = []; let cur = [], count = 0;
  groups.forEach(g => {
    if(cur.length && (count >= 100 || cur.length + g.length > 999)){ files.push(cur); cur = []; count = 0; }
    cur = cur.concat(g); count++;
  });
  if(cur.length) files.push(cur);
  return files.map(f => [head].concat(f));
}
async function qboExport(kind){
  const err = document.getElementById('qboErr'); err.textContent = '';
  const rg = qboRange();
  if(!rg){ err.textContent = 'Pick a start and end date.'; return; }
  const stamp = rg.from.toISOString().slice(0, 7);
  if(kind === 'customers'){
    const { data } = await sb.from('customers').select('company_name, contact_name, email, billing_email, phone, billing_address, payment_terms, notes').eq('org_id', session.orgId).eq('active', true).order('company_name').limit(5000);
    downloadCsv('relay-qbo-customers.csv', [['Name','Company','Email','Phone','Street','Terms','Notes']].concat((data || []).map(c => [c.company_name, c.company_name, c.billing_email || c.email, c.phone, c.billing_address, QBO_TERMS[c.payment_terms] || '', c.notes])));
  } else if(kind === 'items'){
    const { data } = await sb.from('inventory_items').select('name, part_number, description, unit_price, cost, track_stock').eq('org_id', session.orgId).eq('active', true).order('name').limit(5000);
    const base = [['Labor','Service','Labor'], ['Parts','Non-inventory','Parts'], ['Fees','Service','Fees and core charges'], ['Mileage','Service','Mileage / travel'], ['Other','Service','Other charges'], ['Sales Tax','Service','Sales tax (only if QuickBooks sales tax is off)']];
    downloadCsv('relay-qbo-products-services.csv', [['Product/Service Name','Type','Description','Sales Price/Rate','Cost','SKU']]
      .concat(base.map(b => [b[0], b[1], b[2], '', '', '']))
      .concat((data || []).map(i => [i.name, i.track_stock ? 'Non-inventory' : 'Service', i.description, i.unit_price, i.cost, i.part_number])));
  } else if(kind === 'vendors'){
    const { data } = await sb.from('vendors').select('name, contact_name, email, phone, notes').eq('org_id', session.orgId).order('name').limit(5000);
    downloadCsv('relay-qbo-vendors.csv', [['Name','Company','Contact','Email','Phone','Notes']].concat((data || []).map(v => [v.name, v.name, v.contact_name, v.email, v.phone, v.notes])));
  } else if(kind === 'invoices'){
    const invs = await loadQboInvoices(rg);
    if(!invs.length){ err.textContent = 'No invoices in this period.'; return; }
    const files = qboInvoiceRows(invs);
    files.forEach((rows, k) => downloadCsv(`relay-qbo-invoices-${stamp}${files.length > 1 ? '-part' + (k + 1) : ''}.csv`, rows));
    renderQboWarnings(invs, files.length);
  } else if(kind === 'payments'){
    const { data } = await sb.from('payments').select('amount, method, reference, paid_on, note, invoices(id, doc_number, customer_name)').eq('org_id', session.orgId)
      .gte('paid_on', rg.from.toISOString().slice(0, 10)).lt('paid_on', rg.to.toISOString().slice(0, 10)).order('paid_on').limit(5000);
    if(!(data || []).length){ err.textContent = 'No payments in this period.'; return; }
    downloadCsv(`relay-qbo-payments-${stamp}.csv`, [['Date','Invoice No','Customer','Amount','Payment method','Reference','Memo']]
      .concat(data.map(p => [qboDate(p.paid_on), p.invoices ? (p.invoices.doc_number || p.invoices.id) : '', p.invoices ? p.invoices.customer_name : '', Number(p.amount).toFixed(2), ({ cash:'Cash', check:'Check', card:'Credit card', ach:'ACH', other:'Other' })[p.method] || p.method, p.reference, p.note])));
  }
  recordsToast('Downloaded');
}
function renderQboWarnings(invs, nFiles){
  const box = document.getElementById('qboWarn');
  const disc = invs.filter(i => Number(i.discount_amount) > 0), tax = invs.filter(i => Number(i.tax_amount) > 0);
  const notes = [];
  if(nFiles > 1) notes.push(`The invoices were split into <b>${nFiles} files</b> (QuickBooks takes at most 100 invoices or 1,000 rows per file). Import each one.`);
  if(disc.length) notes.push(`<b>${disc.length} invoice${disc.length === 1 ? ' has' : 's have'} a discount</b> (${disc.map(i => docNo(i)).join(', ')}). QuickBooks can't import negative lines, so add those discounts in QuickBooks after importing.`);
  if(tax.length) notes.push(`<b>${tax.length} invoice${tax.length === 1 ? ' includes' : 's include'} sales tax</b> as a "Sales Tax" line. QuickBooks won't import invoices at all if its own sales tax feature is turned on; in that case enter these invoices there instead.`);
  box.innerHTML = notes.length ? `<div class="auth-banner wait">${notes.map(n => `<p>${n}</p>`).join('')}</div>` : '<p class="meta">Ready to import.</p>';
}
function initQboUI(){
  const box = document.getElementById('integrationsBox');
  if(!box) return;
  const t = document.querySelector('.dash-tab[data-target="shop-integrations"]');
  if(t && typeof can === 'function' && !can('billing')) t.classList.add('hidden');
  box.innerHTML = `<div class="card qbo-card">
    <div class="qbo-head"><div><h3>QuickBooks Online</h3><p class="meta">Download files QuickBooks Online can import. A live connection that syncs by itself is planned; until then this is the reliable way to get Relay's numbers into your books.</p></div></div>
    <div class="rec-toolbar"><select id="qboRange" aria-label="Period"><option value="this">This month</option><option value="last">Last month</option><option value="year">This year</option><option value="custom">Custom…</option></select>
      <span id="qboCustom" class="hidden"><input type="date" id="qboFrom" aria-label="From"> – <input type="date" id="qboTo" aria-label="To"></span></div>
    <ol class="qbo-steps">
      <li><b>Products & services</b> — import first, so every invoice line matches an item in QuickBooks. <button type="button" class="ghost-btn" data-qbo="items">Download</button></li>
      <li><b>Customers</b> — import second (or tick "Add new customers" when importing invoices). <button type="button" class="ghost-btn" data-qbo="customers">Download</button></li>
      <li><b>Invoices</b> for the period — one row per line. In QuickBooks turn on <i>Custom transaction numbers</i> to keep Relay's invoice numbers. <button type="button" class="ghost-btn" data-qbo="invoices">Download</button></li>
      <li><b>Payments</b> for the period — QuickBooks can't import payments as such; use this list to record them with <i>Receive payment</i> or to match your bank feed. <button type="button" class="ghost-btn" data-qbo="payments">Download</button></li>
      <li><b>Vendors</b> — optional, for purchase records. <button type="button" class="ghost-btn" data-qbo="vendors">Download</button></li>
    </ol>
    <p class="meta">In QuickBooks: <b>Settings ⚙ → Import data</b> → pick the type → upload the file → check the column matches → Import.</p>
    <p class="form-error" id="qboErr"></p><div id="qboWarn"></div></div>`;
  document.getElementById('qboRange').onchange = () => document.getElementById('qboCustom').classList.toggle('hidden', document.getElementById('qboRange').value !== 'custom');
  box.querySelectorAll('[data-qbo]').forEach(b => b.onclick = () => qboExport(b.dataset.qbo));
}
