// ============================================================
// RelayFleet — Subscriptions and invoices (Relay's own control panel).
// Subscriptions: each shop's price, paid-through date and active / stopped, in separate columns.
// A shop's billing sheet: months paid, total paid, every invoice (view, PDF, edit, pay, void, email).
// Settings: the invoice register across all shops, and Relay's own details printed on invoices.
// Nothing here is ever shown to a shop except its own invoices.
// ============================================================
const SUB_FILTERS = [
  ['all', 'All'], ['active', 'Active'], ['expiring', 'Expiring in 7 days'], ['expired', 'Expired'],
  ['stopped', 'Stopped'], ['no_price', 'No price set'], ['free', 'Complimentary'], ['pending', 'Not approved']
];
const subState = { rows: [], history: {}, filter: 'all', settings: null };
const subMoney = n => n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const subDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const subErr = (id, m) => { const e = document.getElementById(id); if(e) e.textContent = m || ''; };
const INV_STATUS_LABEL = { unpaid: 'Unpaid', paid: 'Paid', void: 'Void', draft: 'Draft' };

// ---------- Subscriptions: one row per shop, every fact in its own column ----------
async function renderSubscriptions(){
  const box = document.getElementById('adminSubsBox');
  if(!box || !session || session.role !== 'admin') return;
  if(!subState.rows.length) box.innerHTML = '<div class="section-head"><h2>Subscriptions</h2></div><p class="meta">Loading…</p>';
  const { data, error } = await sb.rpc('admin_subscriptions');
  if(error || !data){ box.innerHTML = `<div class="section-head"><h2>Subscriptions</h2></div><p class="form-error">${esc(error ? error.message : 'Could not load this.')}</p>`; return; }
  subState.rows = data;
  // months paid and total paid come from each shop's billing history
  const histories = await Promise.all(data.map(r => sb.rpc('shop_billing_history', { p_org: r.org_id }).then(res => [r.org_id, res.data])));
  subState.history = Object.fromEntries(histories.filter(([, h]) => h));
  const count = k => data.filter(r => bucketOf(r) === k).length;
  const paying = data.filter(r => ['active', 'expiring', 'expired'].includes(bucketOf(r)));
  const monthly = paying.reduce((s, r) => s + Number(r.monthly_price || 0), 0);
  const owed = data.reduce((s, r) => s + Number(r.owed || 0), 0);
  const shown = data.filter(r => subState.filter === 'all' || bucketOf(r) === subState.filter);
  box.innerHTML = `<div class="section-head"><h2>Subscriptions</h2><span class="meta">${paying.length} paying · ${subMoney(monthly)} a month${owed ? ' · ' + subMoney(owed) + ' owed' : ''}</span></div>
    ${count('expired') ? `<div class="inv-warn">⚠ ${count('expired')} shop${count('expired') === 1 ? '' : 's'} past their paid-through date: ${esc(data.filter(r => bucketOf(r) === 'expired').map(r => r.name).join(', '))}</div>` : ''}
    <div class="fd-dates" id="subFilters" role="group" aria-label="Filter shops">
      ${SUB_FILTERS.map(([k, label]) => `<button type="button" class="fd-chip${subState.filter === k ? ' active' : ''}" data-subfilter="${k}" aria-pressed="${subState.filter === k}">${esc(label)} (${k === 'all' ? data.length : count(k)})</button>`).join('')}
    </div>
    <p class="form-error" id="subErr"></p>
    <div class="cw-wrap"><table class="cw-table subs-table"><thead><tr>
      <th>Shop</th><th class="num">Price per month</th><th>Paid through</th><th>Active</th><th class="num">Months paid</th><th class="num">Total paid</th><th class="num">Owed</th><th></th>
    </tr></thead><tbody>
    ${shown.length ? shown.map(subRowHtml).join('') : '<tr><td colspan="8"><div class="empty-note">No shops in this group.</div></td></tr>'}
    </tbody></table></div>
    <p class="meta">Set a shop's price and paid-through date here, then press <b>Save</b> on its row. <b>Stop</b> keeps the shop's history and can be undone with <b>Start</b>.</p>`;
  wireSubscriptions(box);
}
function bucketOf(r){ return r.bucket; }

function activeBadge(r){
  const b = r.bucket;
  if(b === 'free') return '<span class="badge arrived"><span class="bd"></span>Complimentary</span>';
  if(b === 'stopped') return '<span class="badge offline"><span class="bd"></span>Stopped</span>';
  if(b === 'pending') return '<span class="badge pending"><span class="bd"></span>Not approved</span>';
  if(b === 'no_price') return '<span class="badge pending"><span class="bd"></span>No price set</span>';
  if(b === 'onboarding') return '<span class="badge pending"><span class="bd"></span>Onboarding</span>';
  if(b === 'expired') return `<span class="badge cancelled"><span class="bd"></span>Expired · ${Math.abs(r.days_left)} days late</span>`;
  if(b === 'expiring') return `<span class="badge waiting"><span class="bd"></span>Ends in ${r.days_left} day${r.days_left === 1 ? '' : 's'}</span>`;
  return `<span class="badge arrived"><span class="bd"></span>Active · ${r.days_left} days left</span>`;
}

function subRowHtml(r){
  const h = subState.history[r.org_id] || {};
  const canToggle = r.bucket !== 'free' && r.bucket !== 'pending';
  const stopped = r.bucket === 'stopped';
  return `<tr data-org="${esc(r.org_id)}">
    <td><b>${esc(r.name)}</b><div class="meta">${esc(r.contact_email || 'no email on file')} · ${r.people} user${r.people === 1 ? '' : 's'}</div></td>
    <td class="num"><input type="number" class="sub-price" data-org="${esc(r.org_id)}" min="0" step="1" value="${r.monthly_price == null ? '' : Number(r.monthly_price)}" placeholder="not set" aria-label="Price per month for ${esc(r.name)}" style="width:7.5rem"></td>
    <td><input type="date" class="sub-paid" data-org="${esc(r.org_id)}" value="${esc(r.paid_through || '')}" aria-label="Paid through for ${esc(r.name)}"></td>
    <td>${activeBadge(r)}${canToggle ? `<div><button type="button" class="text-btn" data-toggle="${esc(r.org_id)}" data-active="${stopped ? '0' : '1'}">${stopped ? 'Start' : 'Stop'}</button></div>` : ''}</td>
    <td class="num">${h.months_paid != null ? esc(String(h.months_paid)) : '—'}</td>
    <td class="num">${h.total_paid != null ? subMoney(h.total_paid) : '—'}</td>
    <td class="num">${Number(r.owed) ? `<b>${subMoney(r.owed)}</b>` : subMoney(0)}</td>
    <td class="cw-acts"><button type="button" class="text-btn" data-save="${esc(r.org_id)}">Save</button>
      <button type="button" class="text-btn" data-billing="${esc(r.org_id)}">Invoices (${(h.invoices || []).length})</button></td>
  </tr>`;
}

function wireSubscriptions(box){
  box.querySelectorAll('[data-subfilter]').forEach(b => b.onclick = () => { subState.filter = b.dataset.subfilter; renderSubscriptions(); });
  box.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const org = b.dataset.save;
    const priceEl = box.querySelector(`.sub-price[data-org="${org}"]`), paidEl = box.querySelector(`.sub-paid[data-org="${org}"]`);
    const price = priceEl.value === '' ? null : Number(priceEl.value);
    if(price != null && !(price >= 0)){ subErr('subErr', 'That price is not a number.'); return; }
    if(price == null && priceEl.value === '' && subState.rows.find(r => r.org_id === org).monthly_price != null){ subErr('subErr', 'To remove a price, ask Relay support — a shop cannot be left with no price after it has one.'); return; }
    b.disabled = true; subErr('subErr', '');
    const { error } = await sb.rpc('set_shop_subscription', { p_org: org, p_price: price, p_paid_through: paidEl.value || null, p_active: null });
    b.disabled = false;
    if(error){ subErr('subErr', error.message); return; }
    recordsToast('Saved'); renderSubscriptions();
  });
  box.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const turnOn = b.dataset.active === '0';
    if(!turnOn && !confirm('Stop this shop? It keeps its history and can be started again, but it cannot create new work while stopped.')) return;
    const { error } = await sb.rpc('set_shop_subscription', { p_org: b.dataset.toggle, p_price: null, p_paid_through: null, p_active: turnOn });
    if(error){ subErr('subErr', error.message); return; }
    recordsToast(turnOn ? 'Started' : 'Stopped'); renderSubscriptions();
  });
  box.querySelectorAll('[data-billing]').forEach(b => b.onclick = () => openShopBilling(b.dataset.billing));
}

// ---------- A shop's billing sheet: summary, every invoice, and the actions on each ----------
async function openShopBilling(orgId){
  const shop = subState.rows.find(r => r.org_id === orgId); if(!shop) return;
  const { data: h, error } = await sb.rpc('shop_billing_history', { p_org: orgId });
  if(error || !h){ recordsToast(error ? error.message : 'Could not load this shop.'); return; }
  subState.history[orgId] = h;
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form">
    <div class="rec-form-head"><h3>${esc(shop.name)}</h3></div>
    <div class="kpi-grid">
      <div class="kpi"><em>Price per month</em><b>${h.monthly_price == null ? 'Not set' : subMoney(h.monthly_price)}</b></div>
      <div class="kpi"><em>Paid through</em><b>${h.paid_through ? subDate(h.paid_through) : '—'}</b></div>
      <div class="kpi"><em>Active</em><b>${h.active ? 'Yes' : 'No'}</b><span class="meta">${esc(h.billing_status || '')}</span></div>
      <div class="kpi"><em>Months paid</em><b>${esc(String(h.months_paid))}</b><span class="meta">${h.first_period ? 'since ' + subDate(h.first_period) : 'no payments yet'}</span></div>
      <div class="kpi"><em>Total paid</em><b>${subMoney(h.total_paid)}</b></div>
      <div class="kpi${Number(h.owed) ? ' bad' : ''}"><em>Owed now</em><b>${subMoney(h.owed)}</b></div>
    </div>
    <div class="job-actions" style="margin-top:12px;"><button type="button" id="sbNew">New invoice</button></div>
    <p class="form-error" id="sbErr"></p>
    ${(h.invoices || []).length ? `<div class="cw-wrap"><table class="cw-table"><thead><tr><th>Invoice</th><th>Period</th><th class="num">Amount</th><th>Status</th><th>Due</th><th>Paid</th><th></th></tr></thead><tbody>
      ${h.invoices.map(i => `<tr>
        <td class="mono"><b>${esc(i.number)}</b>${i.sent_at ? '<div class="meta">emailed</div>' : ''}</td>
        <td>${subDate(i.period_start)} – ${subDate(i.period_end)}</td>
        <td class="num">${subMoney(i.amount)}</td>
        <td><span class="badge ${i.status === 'paid' ? 'arrived' : i.status === 'void' ? 'offline' : 'waiting'}"><span class="bd"></span>${esc(INV_STATUS_LABEL[i.status] || i.status)}</span></td>
        <td>${subDate(i.due_date)}</td><td>${i.paid_on ? subDate(i.paid_on) : '—'}</td>
        <td class="cw-acts">
          <button type="button" class="text-btn" data-view="${i.id}">View</button>
          <button type="button" class="text-btn" data-pdf="${i.id}">PDF</button>
          ${i.status !== 'void' ? `<button type="button" class="text-btn" data-edit="${i.id}">Edit</button>` : ''}
          ${i.status === 'unpaid' ? `<button type="button" class="text-btn" data-paid="${i.id}">Mark paid</button><button type="button" class="text-btn" data-email="${i.id}">Email</button><button type="button" class="text-btn danger" data-void="${i.id}">Void</button>` : ''}
        </td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty-note">No invoices yet for this shop.</div>'}
  </div>`;
  if(typeof openFormSheet === 'function') openFormSheet(`${shop.name} — billing`, [body]);
  const reload = async () => { if(typeof closeFormSheet === 'function') closeFormSheet(); await renderSubscriptions(); openShopBilling(orgId); };
  body.querySelector('#sbNew').onclick = () => openSubInvoiceForm(orgId, reload);
  body.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openInvoiceView(Number(b.dataset.view), orgId));
  body.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => downloadSubscriptionPdf(Number(b.dataset.pdf)));
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditInvoice(Number(b.dataset.edit), h.invoices.find(x => x.id === Number(b.dataset.edit)), reload));
  body.querySelectorAll('[data-email]').forEach(b => b.onclick = () => emailSubInvoice(Number(b.dataset.email), orgId, body.querySelector('#sbErr')));
  body.querySelectorAll('[data-paid]').forEach(b => b.onclick = async () => {
    if(!confirm('Mark this invoice as paid? The shop\'s paid-through date moves to the end of its period.')) return;
    const { error: e2 } = await sb.rpc('mark_subscription_paid', { p_invoice: Number(b.dataset.paid), p_paid_on: null });
    if(e2){ body.querySelector('#sbErr').textContent = e2.message; return; }
    recordsToast('Marked paid'); reload();
  });
  body.querySelectorAll('[data-void]').forEach(b => b.onclick = async () => {
    if(!confirm('Void this invoice? Use this when it was raised by mistake. It stays in the history, marked void.')) return;
    const { error: e2 } = await sb.rpc('void_subscription_invoice', { p_invoice: Number(b.dataset.void) });
    if(e2){ body.querySelector('#sbErr').textContent = e2.message; return; }
    recordsToast('Voided'); reload();
  });
}

// ---------- Creating an invoice ----------
function openSubInvoiceForm(orgId, onDone){
  const shop = subState.rows.find(r => r.org_id === orgId); if(!shop) return;
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>New invoice for ${esc(shop.name)}</h3></div>
    <div class="rec-grid">
      <div class="field"><label for="siMonths">How many months</label><select id="siMonths">${[1, 3, 6, 12].map(m => `<option value="${m}">${m} month${m === 1 ? '' : 's'}</option>`).join('')}</select></div>
      <div class="field"><label for="siAmount">Amount</label><input id="siAmount" type="number" min="0" step="0.01" value="${shop.monthly_price == null ? '' : Number(shop.monthly_price)}" placeholder="their monthly price"></div>
      <div class="field"><label for="siDue">Due in (days)</label><input id="siDue" type="number" min="0" max="90" value="14"></div>
      <div class="field rec-span"><label for="siNote">Note on the invoice (optional)</label><input id="siNote" maxlength="200"></div>
    </div>
    <p class="meta">The period starts the day their current one ends${shop.paid_through ? ' (' + subDate(shop.paid_through) + ')' : ''}.</p>
    <p class="form-error" id="siErr"></p>
    <div class="job-actions"><button type="button" id="siCreate">Create invoice</button><button type="button" class="ghost-btn" id="siCreateSend">Create and email it</button></div></div>`;
  if(typeof openFormSheet === 'function') openFormSheet('New subscription invoice', [body]);
  const months = body.querySelector('#siMonths'), amount = body.querySelector('#siAmount');
  months.onchange = () => { if(shop.monthly_price != null) amount.value = (Number(shop.monthly_price) * Number(months.value)).toFixed(2); };
  const make = async (alsoSend) => {
    const btn = body.querySelector(alsoSend ? '#siCreateSend' : '#siCreate'); btn.disabled = true;
    const { data, error } = await sb.rpc('create_subscription_invoice', {
      p_org: orgId, p_period_start: null, p_months: Number(months.value),
      p_amount: amount.value === '' ? null : Number(amount.value),
      p_due_days: Number(body.querySelector('#siDue').value) || 14,
      p_note: body.querySelector('#siNote').value.trim() || null });
    btn.disabled = false;
    if(error){ body.querySelector('#siErr').textContent = error.message; return; }
    recordsToast('Invoice ' + data.number + ' created');
    if(alsoSend) await emailSubInvoice(data.id, orgId, body.querySelector('#siErr'));
    if(typeof closeFormSheet === 'function') closeFormSheet();
    if(typeof onDone === 'function') onDone(); else renderSubscriptions();
  };
  body.querySelector('#siCreate').onclick = () => make(false);
  body.querySelector('#siCreateSend').onclick = () => make(true);
}

// ---------- Editing an invoice (figures locked once it is paid; the note stays editable) ----------
function openEditInvoice(invId, inv, onDone){
  if(!inv) return;
  const paid = inv.status === 'paid';
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>Edit ${esc(inv.number)}</h3></div>
    ${paid ? '<p class="meta">This invoice is paid. Only its note can change. To change the figures, void it and raise a new one.</p>' : '<p class="meta">Change the figures while the invoice is unpaid. Every change is recorded.</p>'}
    <div class="rec-grid">
      <div class="field"><label for="eiAmount">Amount</label><input id="eiAmount" type="number" min="0" step="0.01" value="${Number(inv.amount)}" ${paid ? 'disabled' : ''}></div>
      <div class="field"><label for="eiDue">Due date</label><input id="eiDue" type="date" value="${esc(inv.due_date || '')}" ${paid ? 'disabled' : ''}></div>
      <div class="field"><label for="eiStart">Period starts</label><input id="eiStart" type="date" value="${esc(inv.period_start)}" ${paid ? 'disabled' : ''}></div>
      <div class="field"><label for="eiEnd">Period ends</label><input id="eiEnd" type="date" value="${esc(inv.period_end)}" ${paid ? 'disabled' : ''}></div>
      <div class="field rec-span"><label for="eiNote">Note on the invoice</label><input id="eiNote" maxlength="200" value="${esc(inv.note || '')}"></div>
    </div>
    <p class="form-error" id="eiErr"></p>
    <div class="job-actions"><button type="button" id="eiSave">Save changes</button></div></div>`;
  if(typeof openFormSheet === 'function') openFormSheet('Edit invoice', [body]);
  body.querySelector('#eiSave').onclick = async () => {
    const btn = body.querySelector('#eiSave'); btn.disabled = true;
    const { error } = await sb.rpc('update_subscription_invoice', {
      p_id: invId, p_amount: Number(body.querySelector('#eiAmount').value), p_due_date: body.querySelector('#eiDue').value || null,
      p_period_start: body.querySelector('#eiStart').value || null, p_period_end: body.querySelector('#eiEnd').value || null,
      p_note: body.querySelector('#eiNote').value.trim() || null });
    btn.disabled = false;
    if(error){ body.querySelector('#eiErr').textContent = error.message; return; }
    recordsToast('Invoice saved');
    if(typeof closeFormSheet === 'function') closeFormSheet();
    if(typeof onDone === 'function') onDone(); else renderSubscriptions();
  };
}

// ---------- The digital invoice: what the shop and the customer see, on screen ----------
async function openInvoiceView(invId, orgId){
  const found = Object.values(subState.history).flatMap(h => h.invoices || []).find(i => i.id === invId);
  const { data: reg } = await sb.rpc('subscription_register', {});
  const hit = (reg || []).find(r => r.id === invId);
  const inv = found ? { ...found, org_id: orgId, shop: (hit && hit.shop) } : hit;
  if(!inv){ recordsToast('Invoice not found.'); return; }
  inv.org_id = orgId || inv.org_id;
  const settings = await loadPlatformSettings();
  const shop = subState.rows.find(r => r.org_id === inv.org_id) || { name: inv.shop || 'Shop' };
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form" style="max-width:640px;">
    <div class="inv-head"><div><b style="font-size:1.2rem;">${esc(settings.legal_name || 'Relay')}</b>
      <div class="meta">${esc(settings.address || '')}</div><div class="meta">${esc([settings.email, settings.phone].filter(Boolean).join(' · '))}</div></div>
      <div style="text-align:right;"><b class="mono">${esc(inv.number)}</b><div class="meta">Issued ${subDate(inv.issued_on)}</div>
        <span class="badge ${inv.status === 'paid' ? 'arrived' : inv.status === 'void' ? 'offline' : 'waiting'}"><span class="bd"></span>${esc(INV_STATUS_LABEL[inv.status] || inv.status)}</span></div></div>
    <p style="margin-top:16px;"><span class="meta">Bill to</span><br><b>${esc(shop.name)}</b></p>
    <table class="cw-table" style="margin-top:12px;"><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>
      <tr><td>Relay subscription, ${subDate(inv.period_start)} to ${subDate(inv.period_end)}${inv.note ? '<div class="meta">' + esc(inv.note) + '</div>' : ''}</td><td class="num">${subMoney(inv.amount)}</td></tr>
    </tbody><tfoot><tr><th>${inv.status === 'paid' ? 'Total paid' : 'Total due'}</th><th class="num">${subMoney(inv.amount)}</th></tr></tfoot></table>
    <p class="meta" style="margin-top:12px;">Due ${subDate(inv.due_date)}${inv.paid_on ? ' · Paid ' + subDate(inv.paid_on) : ''}</p>
    ${settings.payment_instructions && inv.status === 'unpaid' ? `<p class="meta">${esc(settings.payment_instructions)}</p>` : ''}
    <div class="job-actions"><button type="button" id="ivPdf">Download PDF</button><button type="button" class="ghost-btn" id="ivEmail">Email to shop</button></div>
    <p class="form-error" id="ivErr"></p></div>`;
  if(typeof openFormSheet === 'function') openFormSheet(inv.number, [body]);
  body.querySelector('#ivPdf').onclick = () => downloadSubscriptionPdf(invId);
  body.querySelector('#ivEmail').onclick = () => emailSubInvoice(invId, inv.org_id, body.querySelector('#ivErr'));
}

async function loadPlatformSettings(){
  if(subState.settings) return subState.settings;
  const { data } = await sb.from('platform_settings').select('*').eq('id', 1).maybeSingle();
  subState.settings = data || { legal_name: 'Relay' };
  return subState.settings;
}

// ---------- PDF: the same layout the email attaches ----------
async function downloadSubscriptionPdf(invId){
  const { data, error } = await sb.functions.invoke('get-subscription-pdf', { body: { invoiceId: invId } });
  if(error || !data){ recordsToast(error ? 'Could not make the PDF: ' + error.message : 'Could not make the PDF.'); return; }
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `relay-invoice-${invId}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Email the invoice (PDF attached) to the shop ----------
async function emailSubInvoice(invoiceId, orgId, errEl){
  const shop = subState.rows.find(r => r.org_id === orgId);
  const to = shop && shop.contact_email;
  const show = m => { if(errEl) errEl.textContent = m; else subErr('subErr', m); };
  if(!to){ show('That shop has no email on file — add one in Accounts first.'); return; }
  const { error } = await sb.functions.invoke('send-subscription-invoice', { body: { invoiceId, recipientEmail: to } });
  if(error){ show('Could not send: ' + error.message); return; }
  recordsToast('Invoice emailed to ' + to);
  renderSubscriptions();
}

// ---------- Settings: the invoice register and Relay's own details ----------
async function renderAdminSettings(){
  const box = document.getElementById('adminSettingsBox');
  if(!box || !session || session.role !== 'admin') return;
  const settings = await loadPlatformSettings();
  box.innerHTML = `<div class="section-head"><h2>Invoices</h2><span class="meta">every subscription invoice, every shop</span></div>
    <div class="rec-toolbar">
      <select id="regStatus" aria-label="Filter by status"><option value="">All statuses</option><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="void">Void</option></select>
      <select id="regShop" aria-label="Filter by shop"><option value="">All shops</option>${subState.rows.map(r => `<option value="${esc(r.org_id)}">${esc(r.name)}</option>`).join('')}</select>
    </div>
    <p class="form-error" id="regErr"></p>
    <div id="regList"><p class="meta">Loading…</p></div>
    <div class="section-head" style="margin-top:28px;"><h2>Relay's details on invoices</h2></div>
    <p class="meta">These appear at the top of every subscription invoice, PDF and email.</p>
    <form class="card rec-form" id="pfForm" style="max-width:640px;" autocomplete="off">
      <div class="rec-grid">
        <div class="field"><label for="pfName">Company name on invoices</label><input id="pfName" required maxlength="120" value="${esc(settings.legal_name || '')}"></div>
        <div class="field"><label for="pfEmail">Billing email</label><input id="pfEmail" type="email" maxlength="120" value="${esc(settings.email || '')}"></div>
        <div class="field rec-span"><label for="pfAddress">Address</label><input id="pfAddress" maxlength="200" value="${esc(settings.address || '')}"></div>
        <div class="field"><label for="pfPhone">Phone</label><input id="pfPhone" maxlength="40" value="${esc(settings.phone || '')}"></div>
        <div class="field"><label for="pfDue">Default days to pay</label><input id="pfDue" type="number" min="0" max="90" value="${settings.default_due_days == null ? 14 : settings.default_due_days}"></div>
        <div class="field rec-span"><label for="pfPay">How to pay (printed on unpaid invoices)</label><input id="pfPay" maxlength="300" value="${esc(settings.payment_instructions || '')}"></div>
        <div class="field rec-span"><label for="pfNote">Default note</label><input id="pfNote" maxlength="200" value="${esc(settings.default_note || '')}"></div>
      </div>
      <p class="form-error" id="pfErr"></p>
      <div class="job-actions"><button type="submit" id="pfSave">Save details</button></div>
    </form>`;
  box.querySelector('#pfForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = box.querySelector('#pfSave'); btn.disabled = true;
    const { error } = await sb.rpc('save_platform_settings', {
      p_legal_name: box.querySelector('#pfName').value, p_address: box.querySelector('#pfAddress').value || null,
      p_email: box.querySelector('#pfEmail').value || null, p_phone: box.querySelector('#pfPhone').value || null,
      p_payment_instructions: box.querySelector('#pfPay').value || null, p_default_due_days: Number(box.querySelector('#pfDue').value) || 14,
      p_default_note: box.querySelector('#pfNote').value || null });
    btn.disabled = false;
    if(error){ box.querySelector('#pfErr').textContent = error.message; return; }
    subState.settings = null; recordsToast('Details saved');
  };
  const loadRegister = async () => {
    const list = box.querySelector('#regList');
    const { data, error } = await sb.rpc('subscription_register', { p_status: box.querySelector('#regStatus').value || null, p_org: box.querySelector('#regShop').value || null });
    if(error || !data){ list.innerHTML = `<p class="form-error">${esc(error ? error.message : 'Could not load invoices.')}</p>`; return; }
    if(!data.length){ list.innerHTML = '<div class="empty-note">No invoices match.</div>'; return; }
    const total = data.filter(i => i.status !== 'void').reduce((s, i) => s + Number(i.amount), 0);
    list.innerHTML = `<p class="meta">${data.length} invoice${data.length === 1 ? '' : 's'} · ${subMoney(total)} (not counting void)</p>
      <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Invoice</th><th>Shop</th><th>Period</th><th class="num">Amount</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>
      ${data.map(i => `<tr><td class="mono"><b>${esc(i.number)}</b></td><td>${esc(i.shop)}</td><td>${subDate(i.period_start)} – ${subDate(i.period_end)}</td>
        <td class="num">${subMoney(i.amount)}</td><td><span class="badge ${i.status === 'paid' ? 'arrived' : i.status === 'void' ? 'offline' : 'waiting'}"><span class="bd"></span>${esc(INV_STATUS_LABEL[i.status] || i.status)}</span></td>
        <td>${subDate(i.due_date)}</td>
        <td class="cw-acts"><button type="button" class="text-btn" data-rview="${i.id}">View</button><button type="button" class="text-btn" data-rpdf="${i.id}">PDF</button>
          ${i.status !== 'void' ? `<button type="button" class="text-btn" data-redit="${i.id}">Edit</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
    list.querySelectorAll('[data-rview]').forEach(b => b.onclick = () => { const inv = data.find(x => x.id === Number(b.dataset.rview)); openInvoiceView(inv.id, inv.org_id); });
    list.querySelectorAll('[data-rpdf]').forEach(b => b.onclick = () => downloadSubscriptionPdf(Number(b.dataset.rpdf)));
    list.querySelectorAll('[data-redit]').forEach(b => b.onclick = () => {
      const inv = data.find(x => x.id === Number(b.dataset.redit));
      openEditInvoice(inv.id, { ...inv, period_start: inv.period_start, period_end: inv.period_end }, loadRegister);
    });
  };
  box.querySelector('#regStatus').onchange = loadRegister;
  box.querySelector('#regShop').onchange = loadRegister;
  loadRegister();
}
