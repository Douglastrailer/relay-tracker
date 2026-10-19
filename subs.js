// ============================================================
// RelayFleet — Subscriptions (Relay's own control panel).
// A price agreed per shop, who is due, who has expired, and the invoices Relay sends.
// Nothing here is ever shown to a shop except its own invoices.
// ============================================================
const SUB_BUCKETS = [
  ['expired',   'Expired',        'Past their date — these need chasing'],
  ['expiring',  'Expiring soon',  'Due within a week'],
  ['active',    'Active',         'Paid up'],
  ['no_price',  'No price set',   'Agree a price before you can invoice them'],
  ['onboarding','Onboarding',     'Approved, not billed yet'],
  ['free',      'Complimentary',  'Not charged'],
  ['stopped',   'Stopped',        'Cancelled'],
  ['pending',   'Not approved',   'Waiting for you to approve the shop']
];
const subState = { rows: [], bucket: 'all' };
const subMoney = n => n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const subDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

async function renderSubscriptions(){
  const box = document.getElementById('adminSubsBox');
  if(!box || !session || session.role !== 'admin') return;
  if(!subState.rows.length) box.innerHTML = '<div class="section-head"><h2>Subscriptions</h2></div><p class="meta">Loading…</p>';
  const { data, error } = await sb.rpc('admin_subscriptions');
  if(error || !data){ box.innerHTML = `<div class="section-head"><h2>Subscriptions</h2></div><p class="form-error">${esc(error ? error.message : 'Could not load this.')}</p>`; return; }
  subState.rows = data;
  const by = k => data.filter(r => r.bucket === k);
  const money = data.filter(r => r.bucket === 'active' || r.bucket === 'expiring' || r.bucket === 'expired');
  const monthly = money.reduce((s, r) => s + Number(r.monthly_price || 0), 0);
  const owed = data.reduce((s, r) => s + Number(r.owed || 0), 0);
  const shown = subState.bucket === 'all' ? data : by(subState.bucket);
  box.innerHTML = `<div class="section-head"><h2>Subscriptions</h2><span class="meta">${money.length} paying · ${subMoney(monthly)} a month${owed ? ' · ' + subMoney(owed) + ' owed' : ''}</span></div>
    ${by('expired').length ? `<div class="inv-warn">⚠ ${by('expired').length} shop${by('expired').length === 1 ? '' : 's'} past the due date: ${esc(by('expired').map(r => r.name).join(', '))}</div>` : ''}
    <div class="fd-dates" id="subBuckets">
      <button type="button" class="fd-chip${subState.bucket === 'all' ? ' active' : ''}" data-bucket="all">All (${data.length})</button>
      ${SUB_BUCKETS.filter(([k]) => by(k).length).map(([k, label]) => `<button type="button" class="fd-chip${subState.bucket === k ? ' active' : ''}" data-bucket="${k}" title="${esc(SUB_BUCKETS.find(b => b[0] === k)[2])}">${label} (${by(k).length})</button>`).join('')}
    </div>
    <p class="form-error" id="subErr"></p>
    <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Shop</th><th class="num">Price / month</th><th>Paid through</th><th>State</th><th>Last invoice</th><th></th></tr></thead><tbody>
    ${shown.length ? shown.map(r => {
      const b = SUB_BUCKETS.find(x => x[0] === r.bucket) || ['', r.bucket];
      const cls = r.bucket === 'expired' ? 'cancelled' : r.bucket === 'expiring' ? 'waiting' : r.bucket === 'active' ? 'arrived' : 'pending';
      const li = r.last_invoice;
      return `<tr data-org="${esc(r.org_id)}">
        <td><b>${esc(r.name)}</b><div class="meta">${esc(r.contact_email || 'no email on file')} · ${r.people} user${r.people === 1 ? '' : 's'}${r.note ? ' · ' + esc(r.note) : ''}</div></td>
        <td class="num"><input type="number" class="sub-price" data-org="${esc(r.org_id)}" min="0" step="1" value="${r.monthly_price == null ? '' : Number(r.monthly_price)}" placeholder="not set" aria-label="Monthly price for ${esc(r.name)}" style="width:7rem"></td>
        <td>${subDate(r.paid_through)}${r.days_left != null ? `<div class="meta">${r.days_left < 0 ? Math.abs(r.days_left) + ' days late' : r.days_left + ' days left'}</div>` : ''}</td>
        <td><span class="badge ${cls}"><span class="bd"></span>${esc(b[1])}</span>${Number(r.owed) ? `<div class="meta">${subMoney(r.owed)} owed</div>` : ''}</td>
        <td>${li ? `${esc(li.number)}<div class="meta">${subMoney(li.amount)} · ${esc(li.status)}${li.sent_at ? ' · sent' : ''}</div>` : '<span class="meta">none yet</span>'}</td>
        <td class="cw-acts"><button type="button" class="text-btn" data-savesub="${esc(r.org_id)}">Save</button>
          <details class="row-more"><summary aria-label="More for ${esc(r.name)}">More</summary><div class="row-menu">
            <button type="button" class="text-btn" data-invoice="${esc(r.org_id)}">Create invoice</button>
            ${li && li.status === 'unpaid' ? `<button type="button" class="text-btn" data-paid="${li.id}">Mark paid</button><button type="button" class="text-btn" data-send="${li.id}" data-org="${esc(r.org_id)}">Email invoice</button>` : ''}
            ${li && li.status === 'unpaid' ? `<button type="button" class="text-btn danger" data-void="${li.id}">Void invoice</button>` : ''}
          </div></details></td></tr>`;
    }).join('') : '<tr><td colspan="6"><div class="empty-note">No shops in this group.</div></td></tr>'}
    </tbody></table></div>`;
  const err = m => { const e = document.getElementById('subErr'); if(e) e.textContent = m || ''; };
  box.querySelectorAll('[data-bucket]').forEach(b => b.onclick = () => { subState.bucket = b.dataset.bucket; renderSubscriptions(); });
  box.querySelectorAll('[data-savesub]').forEach(b => b.onclick = async () => {
    const org = b.dataset.savesub, input = box.querySelector(`.sub-price[data-org="${org}"]`);
    const price = input.value === '' ? null : Number(input.value);
    if(price != null && !(price >= 0)){ err('That price is not a number.'); return; }
    b.disabled = true; err('');
    const { error: e2 } = await sb.rpc('set_org_billing', { p_org: org, p_status: null, p_trial_ends: null, p_paid_through: null, p_note: null, p_price: price });
    b.disabled = false;
    if(e2){ err(e2.message); return; }
    recordsToast('Price saved'); renderSubscriptions();
  });
  box.querySelectorAll('[data-invoice]').forEach(b => b.onclick = () => openSubInvoiceForm(b.dataset.invoice));
  box.querySelectorAll('[data-paid]').forEach(b => b.onclick = async () => {
    if(!confirm('Mark this subscription invoice as paid? The shop\'s paid-through date moves to the end of the period.')) return;
    const { error: e2 } = await sb.rpc('mark_subscription_paid', { p_invoice: Number(b.dataset.paid), p_paid_on: null });
    if(e2){ err(e2.message); return; }
    recordsToast('Marked paid'); renderSubscriptions();
  });
  box.querySelectorAll('[data-void]').forEach(b => b.onclick = async () => {
    if(!confirm('Void this invoice? Use this when it was raised by mistake.')) return;
    const { error: e2 } = await sb.rpc('void_subscription_invoice', { p_invoice: Number(b.dataset.void) });
    if(e2){ err(e2.message); return; }
    recordsToast('Voided'); renderSubscriptions();
  });
  box.querySelectorAll('[data-send]').forEach(b => b.onclick = () => emailSubInvoice(Number(b.dataset.send), b.dataset.org));
}

function openSubInvoiceForm(orgId){
  const shop = subState.rows.find(r => r.org_id === orgId); if(!shop) return;
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>Invoice ${esc(shop.name)}</h3></div>
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
    if(typeof closeFormSheet === 'function') closeFormSheet();
    recordsToast('Invoice ' + data.number + ' created');
    if(alsoSend) await emailSubInvoice(data.id, orgId);
    renderSubscriptions();
  };
  body.querySelector('#siCreate').onclick = () => make(false);
  body.querySelector('#siCreateSend').onclick = () => make(true);
}

// Emails the subscription invoice to the shop, through Relay's own notification function.
async function emailSubInvoice(invoiceId, orgId){
  const shop = subState.rows.find(r => r.org_id === orgId);
  const to = shop && shop.contact_email;
  if(!to){ const e = document.getElementById('subErr'); if(e) e.textContent = 'That shop has no email on file — add one in Accounts first.'; return; }
  const { error } = await sb.functions.invoke('send-subscription-invoice', { body: { invoiceId, recipientEmail: to } });
  if(error){ const e = document.getElementById('subErr'); if(e) e.textContent = 'Could not send: ' + error.message; return; }
  await sb.from('subscription_invoices').update({ sent_at: new Date().toISOString() }).eq('id', invoiceId);
  recordsToast('Invoice emailed to ' + to);
  renderSubscriptions();
}
