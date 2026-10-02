// ============================================================
// RelayFleet — Phase 3: estimates, customer approval, invoices.
// Loaded after script.js, ro.js and insp.js. Totals are always calculated
// by the database; the numbers shown while typing are a preview that uses
// the same formula. Locks (sent / approved / paid) are enforced there too.
// ============================================================

const LINE_TYPES = { labor:'Labor', part:'Part', fee:'Fee', mileage:'Mileage', other:'Other' };
const TERMS = { due_on_receipt:'Due on receipt', net_15:'Net 15', net_30:'Net 30', net_45:'Net 45', net_60:'Net 60' };
const DOC_STATUS = { draft:'Draft', sent:'Sent — waiting for customer', approved:'Approved', declined:'Declined', changes_requested:'Changes requested',
                     converted:'Turned into invoice', unpaid:'Unpaid', paid:'Paid' };
let estCurrent = null;   // { doc, lines, job, org, recs, priceList }

function money2(n){ return '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2); }
function approvalLink(token){ return location.origin + '/approve.html?t=' + token; }
// Same formula as the database (invoice_amounts).
function previewTotals(lines, taxRate, discount){
  const live = lines.filter(l => l.customer_decision !== 'declined');
  const sub = live.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const txb = live.filter(l => l.taxable).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const disc = Math.min(Number(discount) || 0, sub);
  const tax = Math.round(Math.max(txb - (sub > 0 ? disc * txb / sub : 0), 0) * (Number(taxRate) || 0)) / 100;
  return { subtotal: Math.round(sub * 100) / 100, discount: disc, tax: Math.round(tax * 100) / 100, total: Math.round((sub - disc) * 100) / 100 + Math.round(tax * 100) / 100 };
}
function docEditable(doc){
  return doc.kind === 'estimate' ? ['draft','changes_requested'].includes(doc.status) : ['draft','unpaid'].includes(doc.status) && doc.status === 'draft';
}

// ---------------- Repair Order: estimates, invoices, approval ----------------
async function loadRoEstimates(job, opts){
  const box = document.getElementById('roEstimates');
  if(!box) return;
  const isShop = opts.isShop;
  const docs = isShop ? ((await sb.from('invoices').select('id, kind, status, total, created_at, responded_at, approved_by_name').eq('job_id', job.id).order('created_at')).data || []) : [];
  let auth = '';
  if(job.requires_authorization){
    if(job.authorized_at) auth = `<div class="auth-banner ok">Approved by <b>${esc(job.authorized_by_name || 'customer')}</b> · ${fmtDateTime(job.authorized_at)}</div>`;
    else if(job.authorization_override_at) auth = `<div class="auth-banner warn">Approval overridden by the shop · ${fmtDateTime(job.authorization_override_at)}<br><span class="meta">${esc(job.authorization_override_reason || '')}</span></div>`;
    else auth = `<div class="auth-banner wait">Waiting for customer approval. Repair can't start until the estimate is approved${isShop ? ' or overridden' : ''}.
      ${isShop ? '<button type="button" class="ghost-btn" id="authOverrideBtn">Override…</button>' : ''}</div>`;
  }
  if(!isShop){
    // Mechanics and fleets see only whether approval is holding up the work.
    if(!auth){ box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = `<h4>Customer approval</h4>${auth}`;
    return;
  }
  box.innerHTML = `<h4>Estimates &amp; invoices</h4>${auth}
    ${isShop ? (docs.length ? docs.map(d => `<div class="insp-row">
        <div class="insp-row-main"><b>${d.kind === 'estimate' ? 'Estimate' : 'Invoice'} #${d.id}</b> <span class="meta">· ${money2(d.total)}</span>
          <div class="meta">${esc(DOC_STATUS[d.status] || d.status)}${d.approved_by_name && d.status === 'approved' ? ' by ' + esc(d.approved_by_name) : ''} · ${fmtDate(d.created_at)}</div></div>
        <button type="button" class="est-open" data-doc="${d.id}">Open</button></div>`).join('') : '<p class="meta">No estimate yet.</p>')
      + `<div class="insp-start"><button type="button" id="estNewBtn">New estimate</button></div>` : ''}`;
  box.querySelectorAll('.est-open').forEach(b => b.onclick = () => openEstimateEditor(Number(b.dataset.doc)));
  const nb = document.getElementById('estNewBtn');
  if(nb) nb.onclick = () => newEstimateForJob(job);
  const ob = document.getElementById('authOverrideBtn');
  if(ob) ob.onclick = async () => {
    const reason = prompt('Why is repair going ahead without customer approval? (This is recorded.)');
    if(reason === null) return;
    const { error } = await sb.rpc('override_job_authorization', { p_job: job.id, p_reason: reason });
    if(error){ alert(error.message); return; }
    recordsToast('Override recorded');
    openRepairOrder(job.id);
  };
}

async function newEstimateForJob(job){
  const [custRes, orgRes] = await Promise.all([
    job.customer_id ? sb.from('customers').select('company_name, email, billing_email, billing_address, payment_terms, tax_exempt').eq('id', job.customer_id).maybeSingle() : Promise.resolve({ data:null }),
    sb.from('organizations').select('default_tax_rate').eq('id', session.orgId).maybeSingle()
  ]);
  const c = custRes.data || {};
  const { data, error } = await sb.from('invoices').insert([{
    org_id: session.orgId, job_id: job.id, kind: 'estimate', status: 'draft', created_by: session.id,
    customer_name: c.company_name || job.customer, customer_email: c.billing_email || c.email || null,
    customer_address: c.billing_address || null, unit_number: job.vehicle || null,
    payment_terms: c.payment_terms || 'due_on_receipt',
    tax_rate: c.tax_exempt ? 0 : Number((orgRes.data || {}).default_tax_rate || 0)
  }]).select('id').single();
  if(error){ alert('Could not start an estimate: ' + error.message); return; }
  openEstimateEditor(data.id, true);
}

// ---------------- Editor ----------------
async function openEstimateEditor(docId, suggestRecs){
  const overlay = document.getElementById('estModal');
  const body = document.getElementById('estBody');
  body.innerHTML = '<div class="meta" style="padding:24px;">Loading…</div>';
  overlay.classList.remove('hidden'); document.body.classList.add('modal-open');
  const { data: doc, error } = await sb.from('invoices').select('*').eq('id', docId).maybeSingle();
  if(error || !doc){ body.innerHTML = '<div class="form-error" style="padding:24px;">Could not load this document.</div>'; return; }
  const [linesRes, jobRes, orgRes, priceRes] = await Promise.all([
    sb.from('invoice_items').select('id, description, quantity, unit_price, item_type, taxable, recommended_repair_id, customer_decision, sort_order').eq('invoice_id', docId).order('sort_order').order('id'),
    doc.job_id ? sb.from('jobs').select('id, ro_number, customer, vehicle, warranty_claim_status').eq('id', doc.job_id).maybeSingle() : Promise.resolve({ data:null }),
    sb.from('organizations').select('labor_rate, default_tax_rate').eq('id', doc.org_id).maybeSingle(),
    sb.from('inventory_items').select('id, name, description, unit_price, part_number, track_stock').eq('org_id', doc.org_id).eq('active', true).order('name')
  ]);
  const partsRes = doc.job_id ? await sb.from('job_parts').select('item_id, qty, returned_qty, unit_price, inventory_items(name, part_number)').eq('job_id', doc.job_id) : { data:[] };
  const timeRes = doc.job_id ? await sb.from('job_time_summary').select('labor_minutes').eq('job_id', doc.job_id).maybeSingle() : { data:null };
  const recsRes = doc.job_id ? await sb.from('recommended_repairs').select('id, description, severity, status').eq('job_id', doc.job_id).in('status', ['recommended','approved']) : { data: [] };
  estCurrent = { doc, lines: (linesRes.data || []).map(l => ({ ...l })), job: jobRes.data, org: orgRes.data || {}, recs: recsRes.data || [], priceList: priceRes.data || [],
                 laborMinutes: timeRes.data ? Number(timeRes.data.labor_minutes) || 0 : 0,
                 jobParts: (partsRes.data || []).map(p => ({ ...p, net: Number(p.qty) - Number(p.returned_qty) })).filter(p => p.net > 0) };
  if(suggestRecs && estCurrent.recs.length && !estCurrent.lines.length) addRecommendedLines();
  renderEstimateEditor();
}

function renderEstimateEditor(){
  const body = document.getElementById('estBody');
  const { doc, lines, job } = estCurrent;
  const isEst = doc.kind === 'estimate';
  const editable = docEditable(doc);
  const t = editable ? previewTotals(lines, doc.tax_rate, doc.discount_amount) : { subtotal: doc.subtotal, discount: Math.min(Number(doc.discount_amount), Number(doc.subtotal)), tax: doc.tax_amount, total: doc.total };
  const unusedRecs = estCurrent.recs.filter(r => !lines.some(l => l.recommended_repair_id === r.id));
  body.innerHTML = `
    <div class="ro-head"><div>
      <div class="ro-head-num">${isEst ? 'ESTIMATE' : 'INVOICE'} #${doc.id}${job && job.ro_number ? ' · ' + esc(job.ro_number) : ''}</div>
      <h2>${esc(doc.customer_name)}${doc.unit_number ? ' — ' + esc(doc.unit_number) : ''}</h2>
      <div class="meta">${esc(DOC_STATUS[doc.status] || doc.status)} · created ${fmtDate(doc.created_at)}</div></div></div>
    ${approvalInfoHtml(doc)}
    ${job && job.warranty_claim_status === 'warranty' ? '<div class="auth-banner ok">This repair was accepted as a <b>warranty claim</b>. Price it accordingly (often $0 to the customer).</div>'
      : job && job.warranty_claim_status === 'pending_review' ? '<div class="auth-banner wait"><b>Potential warranty repair.</b> Decide on the repair order before billing.</div>' : ''}
    <div class="rec-grid est-head-grid">
      <div class="field"><label>PO number</label><input id="estPo" maxlength="60" value="${esc(doc.po_number || '')}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label>Payment terms</label><select id="estTerms" ${editable ? '' : 'disabled'}>${Object.keys(TERMS).map(k => `<option value="${k}" ${(doc.payment_terms || 'due_on_receipt') === k ? 'selected' : ''}>${TERMS[k]}</option>`).join('')}</select></div>
      <div class="field"><label>Tax rate (%)</label><input id="estTax" type="number" min="0" max="30" step="0.001" inputmode="decimal" value="${Number(doc.tax_rate)}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label>Discount ($)</label><input id="estDisc" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(doc.discount_amount)}" ${editable ? '' : 'disabled'}></div>
      <div class="field rec-span"><label>Customer email</label><input id="estEmail" type="email" maxlength="200" value="${esc(doc.customer_email || '')}"></div>
    </div>
    <div class="est-lines">
      <div class="est-line est-line-head"><span>Type</span><span>Description</span><span>Qty / hrs</span><span>Price</span><span>Tax</span><span>Amount</span><span></span></div>
      ${lines.map((l, i) => lineRowHtml(l, i, editable)).join('') || '<p class="meta">No lines yet.</p>'}
    </div>
    ${editable ? `<div class="est-add">
      <button type="button" class="ghost-btn" data-add="labor">+ Labor</button><button type="button" class="ghost-btn" data-add="part">+ Part</button>
      <button type="button" class="ghost-btn" data-add="fee">+ Fee</button><button type="button" class="ghost-btn" data-add="mileage">+ Mileage</button>
      ${estCurrent.priceList.length ? `<select id="estPriceList" aria-label="Add from price list"><option value="">+ From price list…</option>${estCurrent.priceList.map(p => `<option value="${p.id}">${esc(p.name)}${p.part_number ? ' (' + esc(p.part_number) + ')' : ''} — ${money2(p.unit_price)}</option>`).join('')}</select>` : ''}
      ${unusedRecs.length ? `<button type="button" class="ghost-btn" id="estAddRecs">+ Recommended repairs (${unusedRecs.length})</button>` : ''}
      ${estCurrent.jobParts && estCurrent.jobParts.length ? `<button type="button" class="ghost-btn" id="estAddParts">+ Parts used on this job (${estCurrent.jobParts.length})</button>` : ''}
      ${estCurrent.laborMinutes ? `<button type="button" class="ghost-btn" id="estAddTime">+ Labor from tracked time (${(Math.round(estCurrent.laborMinutes / 15) / 4).toFixed(2)} h)</button>` : ''}
    </div>` : ''}
    <div class="est-totals">
      <div><span>Subtotal</span><b>${money2(t.subtotal)}</b></div>
      ${Number(t.discount) ? `<div><span>Discount</span><b>−${money2(t.discount)}</b></div>` : ''}
      <div><span>Tax (${Number(doc.tax_rate)}%)</span><b>${money2(t.tax)}</b></div>
      <div class="est-grand"><span>${isEst ? 'Estimated total' : 'Total due'}</span><b>${money2(t.total)}</b></div>
    </div>
    <div class="field"><label>Notes for the customer</label><textarea id="estNotes" rows="2" maxlength="2000" ${editable ? '' : 'disabled'}>${esc(doc.notes || '')}</textarea></div>
    <p class="form-error" id="estError"></p>
    <div class="insp-footer est-actions">${actionsHtml(doc, editable)}</div>`;
  wireEditor(editable);
}

function lineRowHtml(l, i, editable){
  const amt = (Number(l.quantity) || 0) * (Number(l.unit_price) || 0);
  const declined = l.customer_decision === 'declined';
  if(!editable) return `<div class="est-line ro${declined ? ' is-declined' : ''}"><span class="rec-tag">${esc(LINE_TYPES[l.item_type] || l.item_type)}</span><span>${esc(l.description)}${declined ? ' <em class="meta">(declined by customer)</em>' : ''}</span><span>${Number(l.quantity)}</span><span>${money2(l.unit_price)}</span><span>${l.taxable ? 'Yes' : '—'}</span><span>${money2(amt)}</span><span></span></div>`;
  return `<div class="est-line" data-i="${i}">
    <select class="el-type" aria-label="Type">${Object.keys(LINE_TYPES).map(k => `<option value="${k}" ${l.item_type === k ? 'selected' : ''}>${LINE_TYPES[k]}</option>`).join('')}</select>
    <input class="el-desc" maxlength="500" value="${esc(l.description)}" placeholder="Description" aria-label="Description">
    <input class="el-qty" type="number" min="0.01" step="0.01" inputmode="decimal" value="${Number(l.quantity)}" aria-label="Quantity">
    <input class="el-price" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(l.unit_price)}" aria-label="Price">
    <label class="el-tax" title="Taxable"><input type="checkbox" class="el-taxable" ${l.taxable ? 'checked' : ''}> <span class="el-tax-lbl">Tax</span></label>
    <span class="el-amt">${money2(amt)}</span>
    <button type="button" class="el-del" aria-label="Remove line">×</button></div>`;
}

function approvalInfoHtml(doc){
  if(doc.kind !== 'estimate') return doc.due_date ? `<p class="meta">Due ${fmtDate(doc.due_date)}</p>` : '';
  if(doc.status === 'approved') return `<div class="auth-banner ok">Approved by <b>${esc(doc.approved_by_name || '')}</b> · ${fmtDateTime(doc.responded_at)} · ${doc.approved_via === 'link' ? 'online' : 'recorded by shop'} · ${money2(doc.approved_amount)}
      ${doc.approval_note ? `<div class="meta">“${esc(doc.approval_note)}”</div>` : ''}
      ${doc.approval_signature ? `<img class="est-sig" src="${esc(doc.approval_signature)}" alt="Customer signature">` : ''}
      ${doc.approval_ip ? `<div class="meta">Device: ${esc(doc.approval_ip)}${doc.approval_user_agent ? ' · ' + esc(doc.approval_user_agent.slice(0, 80)) : ''}</div>` : ''}</div>`;
  if(doc.status === 'declined') return `<div class="auth-banner bad">Declined by <b>${esc(doc.approved_by_name || '')}</b> · ${fmtDateTime(doc.responded_at)}${doc.approval_note ? `<div class="meta">“${esc(doc.approval_note)}”</div>` : ''}</div>`;
  if(doc.status === 'changes_requested') return `<div class="auth-banner wait"><b>${esc(doc.approved_by_name || 'Customer')}</b> asked for changes · ${fmtDateTime(doc.responded_at)}<div>“${esc(doc.approval_note || '')}”</div></div>`;
  if(doc.status === 'sent') return `<div class="auth-banner wait">Waiting for the customer · sent ${fmtDateTime(doc.approval_requested_at || doc.sent_at)}</div>`;
  return '';
}

function actionsHtml(doc, editable){
  const b = [];
  if(editable) b.push('<button type="button" class="ghost-btn" id="estSave">Save</button>');
  if(doc.kind === 'estimate'){
    if(['draft','changes_requested','sent'].includes(doc.status)) b.push(`<button type="button" id="estSend">${doc.status === 'sent' ? 'Resend' : 'Send for approval'}</button>`);
    if(doc.approval_token && doc.status === 'sent') b.push('<button type="button" class="ghost-btn" id="estCopy">Copy approval link</button>');
    if(['draft','sent','changes_requested'].includes(doc.status)) b.push('<button type="button" class="ghost-btn" id="estPhone">Approved by phone…</button>');
    if(['sent','approved','declined','changes_requested'].includes(doc.status)) b.push('<button type="button" class="ghost-btn" id="estRevise">Revise</button>');
    if(doc.status === 'approved') b.push('<button type="button" id="estConvert">Turn into invoice</button>');
  } else {
    if(doc.status === 'draft') b.push('<button type="button" id="estEmailInv">Email invoice</button>');
    if(doc.status === 'unpaid') b.push('<button type="button" id="estPaid">Mark paid</button>');
  }
  b.push('<button type="button" class="ghost-btn" id="estPdf">PDF</button>');
  return b.join('');
}

function collectEditor(){
  const d = estCurrent.doc;
  const rows = [...document.querySelectorAll('#estBody .est-line[data-i]')];
  rows.forEach(r => {
    const l = estCurrent.lines[Number(r.dataset.i)];
    l.item_type = r.querySelector('.el-type').value;
    l.description = r.querySelector('.el-desc').value;
    l.quantity = Number(r.querySelector('.el-qty').value);
    l.unit_price = Number(r.querySelector('.el-price').value);
    l.taxable = r.querySelector('.el-taxable').checked;
  });
  if(document.getElementById('estPo') && !document.getElementById('estPo').disabled){
    d.po_number = document.getElementById('estPo').value.trim() || null;
    d.payment_terms = document.getElementById('estTerms').value;
    d.tax_rate = Math.min(30, Math.max(0, Number(document.getElementById('estTax').value) || 0));
    d.discount_amount = Math.max(0, Number(document.getElementById('estDisc').value) || 0);
    d.notes = document.getElementById('estNotes').value.trim() || null;
  }
  d.customer_email = document.getElementById('estEmail').value.trim() || null;
}

function wireEditor(editable){
  const body = document.getElementById('estBody');
  const rerender = () => { collectEditor(); renderEstimateEditor(); };
  if(editable){
    body.querySelectorAll('.est-line[data-i] input, .est-line[data-i] select, #estTax, #estDisc').forEach(el => el.addEventListener('change', rerender));
    body.querySelectorAll('.el-del').forEach(b => b.onclick = () => { collectEditor(); estCurrent.lines.splice(Number(b.closest('.est-line').dataset.i), 1); renderEstimateEditor(); });
    body.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
      collectEditor();
      const type = b.dataset.add;
      estCurrent.lines.push({ item_type: type, description: type === 'labor' ? 'Labor' : type === 'mileage' ? 'Mileage' : '', quantity: 1,
        unit_price: type === 'labor' ? Number(estCurrent.org.labor_rate || 0) : 0, taxable: type === 'part' });
      renderEstimateEditor();
      const descs = body.querySelectorAll('.el-desc'); if(descs.length) descs[descs.length - 1].focus();
    });
    const pl = document.getElementById('estPriceList');
    if(pl) pl.onchange = () => {
      const p = estCurrent.priceList.find(x => x.id === Number(pl.value));
      if(!p) return;
      collectEditor();
      estCurrent.lines.push({ item_type: p.track_stock || p.part_number ? 'part' : 'other', description: p.name + (p.part_number ? ' (' + p.part_number + ')' : '') + (p.description ? ' — ' + p.description : ''), quantity: 1, unit_price: Number(p.unit_price), taxable: !!(p.track_stock || p.part_number) });
      renderEstimateEditor();
    };
    const ap = document.getElementById('estAddParts');
    if(ap) ap.onclick = () => {
      collectEditor();
      estCurrent.jobParts.forEach(p => { const n = p.inventory_items || {};
        estCurrent.lines.push({ item_type: 'part', description: (n.name || 'Part') + (n.part_number ? ' (' + n.part_number + ')' : ''), quantity: p.net, unit_price: Number(p.unit_price || 0), taxable: true }); });
      renderEstimateEditor();
    };
    const at = document.getElementById('estAddTime');
    if(at) at.onclick = () => {
      collectEditor();
      // Tracked labor, rounded to the nearest quarter hour, at the shop's labor rate.
      estCurrent.lines.push({ item_type: 'labor', description: 'Labor (tracked time)', quantity: Math.max(0.25, Math.round(estCurrent.laborMinutes / 15) / 4), unit_price: Number(estCurrent.org.labor_rate || 0), taxable: false });
      renderEstimateEditor();
    };
    const ar = document.getElementById('estAddRecs');
    if(ar) ar.onclick = () => { collectEditor(); addRecommendedLines(); renderEstimateEditor(); };
    document.getElementById('estSave').onclick = async () => { if(await saveEstimate()) recordsToast('Saved'); };
  }
  const on = (id, fn) => { const el = document.getElementById(id); if(el) el.onclick = fn; };
  on('estSend', sendEstimate);
  on('estCopy', async () => { await copyText(approvalLink(estCurrent.doc.approval_token)); recordsToast('Approval link copied — paste it in a text or WhatsApp'); });
  on('estPhone', recordPhoneApproval);
  on('estRevise', async () => {
    if(!confirm('Revise this estimate? The customer\'s link will stop working until you send the new version.')) return;
    const { error } = await sb.rpc('revise_estimate', { p_invoice: estCurrent.doc.id });
    if(error){ showEstError(error.message); return; }
    afterChange(estCurrent.doc.id);
  });
  on('estConvert', async () => {
    if(!confirm('Create an invoice from the approved lines?')) return;
    const { data, error } = await sb.rpc('convert_estimate_to_invoice', { p_estimate: estCurrent.doc.id });
    if(error){ showEstError(error.message); return; }
    recordsToast('Invoice #' + data + ' created');
    afterChange(Number(data));
  });
  on('estEmailInv', async () => {
    collectEditor();
    if(!(await saveEstimate())) return;
    if(!estCurrent.doc.customer_email){ showEstError('Add the customer\'s email first.'); return; }
    await emailDoc(estCurrent.doc.id, estCurrent.doc.customer_email);
    afterChange(estCurrent.doc.id);
  });
  on('estPaid', async () => {
    const { error } = await sb.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', estCurrent.doc.id);
    if(error){ showEstError(error.message); return; }
    recordsToast('Marked paid'); afterChange(estCurrent.doc.id);
  });
  on('estPdf', () => { if(typeof viewInvoicePdf === 'function') viewInvoicePdf(estCurrent.doc.id); });
}

function addRecommendedLines(){
  estCurrent.recs.filter(r => !estCurrent.lines.some(l => l.recommended_repair_id === r.id)).forEach(r => {
    estCurrent.lines.push({ item_type: 'labor', description: r.description, quantity: 1, unit_price: Number(estCurrent.org.labor_rate || 0), taxable: false, recommended_repair_id: r.id });
  });
}
function showEstError(msg){ const e = document.getElementById('estError'); if(e) e.textContent = msg; else alert(msg); }

async function saveEstimate(){
  collectEditor();
  const d = estCurrent.doc;
  const bad = estCurrent.lines.find(l => l.description.trim() && (!(l.quantity > 0) || l.unit_price < 0));
  if(bad){ showEstError('Each line needs a quantity above 0 and a price of 0 or more.'); return false; }
  const btn = document.getElementById('estSave'); if(btn) btn.disabled = true;
  const up = docEditable(d)
    ? { po_number: d.po_number, payment_terms: d.payment_terms, tax_rate: d.tax_rate, discount_amount: d.discount_amount, notes: d.notes, customer_email: d.customer_email }
    : { customer_email: d.customer_email };
  const { error: e1 } = await sb.from('invoices').update(up).eq('id', d.id);
  let e2 = null;
  if(!e1 && docEditable(d)){
    ({ error: e2 } = await sb.rpc('replace_invoice_items', { p_invoice: d.id, p_items: estCurrent.lines.map(l => ({
      description: l.description, quantity: l.quantity, unit_price: l.unit_price, item_type: l.item_type, taxable: !!l.taxable, recommended_repair_id: l.recommended_repair_id || null })) }));
  }
  if(btn) btn.disabled = false;
  if(e1 || e2){ showEstError('Could not save: ' + (e1 || e2).message); return false; }
  await reloadDoc(d.id);
  return true;
}
async function reloadDoc(id){
  const keepRecs = estCurrent ? estCurrent.recs : [];
  await openEstimateEditor(id);
  if(estCurrent && !estCurrent.recs.length) estCurrent.recs = keepRecs;
}

async function sendEstimate(){
  if(docEditable(estCurrent.doc) && !(await saveEstimate())) return;
  if(!estCurrent.lines.filter(l => l.description.trim()).length){ showEstError('Add at least one line before sending.'); return; }
  const { data: token, error } = await sb.rpc('send_estimate_for_approval', { p_invoice: estCurrent.doc.id });
  if(error){ showEstError(error.message); return; }
  const email = (document.getElementById('estEmail').value || '').trim();
  if(email){
    if(email !== estCurrent.doc.customer_email) await sb.from('invoices').update({ customer_email: email }).eq('id', estCurrent.doc.id);
    await emailDoc(estCurrent.doc.id, email);
  } else {
    await copyText(approvalLink(token));
    recordsToast('No email on file — approval link copied. Paste it in a text or WhatsApp.');
  }
  afterChange(estCurrent.doc.id);
}

async function emailDoc(id, email){
  const { data, error } = await sb.functions.invoke('send-invoice-email', { body: { invoiceId: id, recipientEmail: email } });
  if(error || (data && data.error)){ alert('Saved, but the email could not be sent: ' + (error ? error.message : data.error)); return false; }
  recordsToast('Emailed to ' + email);
  return true;
}

async function recordPhoneApproval(){
  if(docEditable(estCurrent.doc) && !(await saveEstimate())) return;
  const name = prompt('Who approved it? (name, and how — e.g. "Dan, by phone")');
  if(name === null) return;
  const { error } = await sb.rpc('record_shop_approval', { p_invoice: estCurrent.doc.id, p_name: name, p_note: null, p_declined_items: [] });
  if(error){ showEstError(error.message); return; }
  recordsToast('Approval recorded');
  afterChange(estCurrent.doc.id);
}

async function copyText(text){
  try{ await navigator.clipboard.writeText(text); }
  catch(e){ prompt('Copy this link:', text); }
}

async function afterChange(id){
  await reloadDoc(id);
  const ro = document.getElementById('roModal');
  if(estCurrent && estCurrent.doc.job_id && ro && !ro.classList.contains('hidden') && typeof openRepairOrder === 'function') openRepairOrder(estCurrent.doc.job_id);
  if(typeof refreshInvoices === 'function') refreshInvoices();
  if(typeof refreshCurrentView === 'function') refreshCurrentView();
}

function closeEstimateEditor(){
  document.getElementById('estModal').classList.add('hidden');
  const ro = document.getElementById('roModal');
  if(!ro || ro.classList.contains('hidden')) document.body.classList.remove('modal-open');
  estCurrent = null;
}

document.addEventListener('click', (e) => {
  if(e.target.id === 'estModal' || e.target.closest('#estClose')) closeEstimateEditor();
  const o = e.target.closest('.inv-open-editor');
  if(o){ e.preventDefault(); openEstimateEditor(Number(o.dataset.doc)); }
});
document.addEventListener('keydown', (e) => {
  const o = document.getElementById('estModal');
  if(e.key === 'Escape' && o && !o.classList.contains('hidden')){ e.stopImmediatePropagation(); closeEstimateEditor(); }
}, true);
