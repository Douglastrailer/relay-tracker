// ============================================================
// RelayFleet — the safety net: put things back, chase unpaid invoices,
// join duplicate customers, tell Relay something, and (for Relay) see which shops are active.
// ============================================================

// ---------- Recently removed, and putting things back ----------
const REMOVED_KINDS = [['customers', 'customer', 'Customers'], ['units', 'unit', 'Units'], ['parts', 'part', 'Parts'], ['cancelled_work_orders', 'work_order', 'Cancelled work orders']];
async function renderRemovedBox(){
  const box = document.getElementById('removedBox');
  if(!box || !session || session.role !== 'shop'){ if(box) box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '<div class="section-head"><h3>Recently removed</h3></div><p class="meta">Loading…</p>';
  const { data, error } = await sb.rpc('recently_removed', { p_days: 90 });
  if(error || !data){ box.innerHTML = `<div class="section-head"><h3>Recently removed</h3></div><p class="form-error">${esc(error ? error.message : 'Could not load this.')}</p>`; return; }
  const groups = REMOVED_KINDS.map(([key, kind, label]) => ({ kind, label, rows: data[key] || [] })).filter(g => g.rows.length);
  const when = t => t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  box.innerHTML = `<div class="section-head"><h3>Recently removed</h3></div>
    <p class="meta">Nothing is ever really deleted. Anything removed in the last 90 days can be put back here.</p>
    <p class="form-error" id="removedErr"></p>
    ${groups.length ? groups.map(g => `<h4 class="rec-subhead">${esc(g.label)}</h4><div class="rec-list">${g.rows.map(r => `
      <div class="rec-row-static"><div class="rec-main"><b>${esc(r.name || '#' + r.id)}</b><div class="meta">${esc(r.customer ? r.customer + ' · ' : '')}removed ${esc(when(r.removed_at))}</div></div>
      <button type="button" class="text-btn" data-restore="${g.kind}" data-rid="${r.id}">Put back</button></div>`).join('')}</div>`).join('')
      : '<div class="empty-note">Nothing has been removed in the last 90 days.</div>'}`;
  box.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { data: ok, error: e2 } = await sb.rpc('restore_record', { p_kind: b.dataset.restore, p_id: Number(b.dataset.rid) });
    if(e2 || !ok){ const el = document.getElementById('removedErr'); if(el) el.textContent = e2 ? e2.message : 'That could not be put back — it may already be active.'; b.disabled = false; return; }
    if(typeof recordsToast === 'function') recordsToast('Put back');
    renderRemovedBox();
    if(typeof refreshCustomersPage === 'function') refreshCustomersPage();
    if(typeof refreshInventoryV2 === 'function' && b.dataset.restore === 'part') refreshInventoryV2();
  });
}

// ---------- Unpaid invoices past their due date ----------
async function renderOverdueBox(){
  const box = document.getElementById('overdueBox');
  if(!box || !session || session.role !== 'shop'){ if(box) box.classList.add('hidden'); return; }
  const { data, error } = await sb.rpc('overdue_invoices');
  if(error || !data){ box.classList.remove('hidden'); box.innerHTML = `<div class="section-head"><h2>Past due</h2></div><p class="form-error">${esc(error ? error.message : 'Could not load this.')}</p>`; return; }
  const rows = data.rows || [];
  const badge = document.getElementById('pastDueBadge');
  if(badge){ badge.textContent = rows.length ? String(rows.length) : ''; badge.classList.toggle('hidden', !rows.length); }
  box.classList.remove('hidden');
  if(!rows.length){ box.innerHTML = '<div class="section-head"><h2>Past due</h2></div><div class="empty-note">Nothing is past due. Every invoice is paid or still within its due date.</div>'; return; }
  const money = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  box.innerHTML = `<div class="section-head"><h2>Past due</h2><span class="meta">${rows.length} invoice${rows.length === 1 ? '' : 's'} · ${money(data.total)}</span></div>
    <p class="form-error" id="overdueErr"></p>
    <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Invoice</th><th>Customer</th><th class="num">Days late</th><th class="num">Amount</th><th>Reminders</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b class="mono">${esc(r.doc_number || '#' + r.id)}</b></td><td>${esc(r.customer)}</td>
      <td class="num ${Number(r.days_late) > 30 ? 'neg' : ''}">${esc(String(r.days_late))}</td><td class="num"><b>${money(r.total)}</b></td>
      <td>${Number(r.reminders_sent) ? esc(String(r.reminders_sent)) + ' sent' : '<span class="meta">none yet</span>'}</td>
      <td class="cw-acts"><button type="button" class="text-btn" data-odpdf="${r.id}">PDF</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="job-actions" style="margin-top:10px;"><button type="button" class="ghost-btn" id="odRemind">Send reminders now</button></div>
    <p class="meta">Reminders go out once a week, three at most per invoice, and never for an invoice that has been paid.</p>`;
  box.querySelectorAll('[data-odpdf]').forEach(b => b.onclick = () => { if(typeof viewInvoicePdf === 'function') viewInvoicePdf(Number(b.dataset.odpdf)); });
  document.getElementById('odRemind').onclick = async () => {
    const btn = document.getElementById('odRemind'); btn.disabled = true; btn.textContent = 'Sending…';
    const { data: n, error: e2 } = await sb.rpc('queue_payment_reminders', { p_org: session.orgId });
    btn.disabled = false; btn.textContent = 'Send reminders now';
    if(e2){ document.getElementById('overdueErr').textContent = e2.message; return; }
    if(typeof notifyKick === 'function') notifyKick();
    if(typeof recordsToast === 'function') recordsToast(Number(n) ? `${n} reminder${Number(n) === 1 ? '' : 's'} queued` : 'Nothing to send — everyone has been reminded recently');
    renderOverdueBox();
  };
}

// ---------- Joining two customers that are the same ----------
function openMergeCustomers(keepId){
  const list = (typeof recordsCustomers !== 'undefined' ? recordsCustomers : []).filter(c => c.active);
  const keep = list.find(c => c.id === keepId) || list[0];
  if(!keep){ alert('Add some customers first.'); return; }
  const others = list.filter(c => c.id !== keep.id);
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>Join a duplicate into ${esc(keep.company_name)}</h3></div>
    <p class="meta">Pick the duplicate. Its units, work orders and invoices move to <b>${esc(keep.company_name)}</b>, and the duplicate is removed (you can put it back from Settings).</p>
    <div class="field"><label for="mergeFrom">The duplicate to join in</label>
      <select id="mergeFrom">${others.map(c => `<option value="${c.id}">${esc(c.company_name)}</option>`).join('')}</select></div>
    <p class="form-error" id="mergeErr"></p>
    <div class="job-actions"><button type="button" id="mergeGo">Join them</button></div></div>`;
  if(typeof openFormSheet === 'function') openFormSheet('Join duplicate customers', [body]);
  else document.body.appendChild(body);
  body.querySelector('#mergeGo').onclick = async () => {
    const from = Number(body.querySelector('#mergeFrom').value);
    const name = (others.find(c => c.id === from) || {}).company_name || 'that customer';
    if(!confirm(`Join "${name}" into "${keep.company_name}"? Their units, work orders and invoices move across.`)) return;
    const btn = body.querySelector('#mergeGo'); btn.disabled = true; btn.textContent = 'Joining…';
    const { data, error } = await sb.rpc('merge_customers', { p_keep: keep.id, p_merge: from });
    btn.disabled = false; btn.textContent = 'Join them';
    if(error){ body.querySelector('#mergeErr').textContent = error.message; return; }
    if(typeof closeFormSheet === 'function') closeFormSheet();
    if(typeof recordsToast === 'function') recordsToast(`Joined · ${data.units} unit${data.units === 1 ? '' : 's'}, ${data.work_orders} work order${data.work_orders === 1 ? '' : 's'} moved`);
    if(typeof refreshCustomersPage === 'function') refreshCustomersPage();
  };
}

// ---------- Tell Relay ----------
function initFeedbackUI(){
  if(!session || !session.id) return;
  // It belongs with the other account items in the ⋯ menu, not floating over the work.
  const menu = document.getElementById('menuLang') || document.getElementById('logoutBtn');
  if(!menu || document.getElementById('feedbackBtn')) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'feedbackBtn'; btn.className = 'menu-item';
  btn.textContent = 'Tell Relay'; btn.title = 'Something wrong, confusing or missing? Tell us.';
  menu.parentNode.insertBefore(btn, menu.id === 'menuLang' ? menu : menu);
  btn.onclick = () => openFeedbackSheet();
}
function openFeedbackSheet(){
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>Tell Relay</h3></div>
    <p class="meta">Something broken, confusing or missing? A sentence is plenty. We read every one.</p>
    <div class="field"><label for="fbMsg">What happened?</label><textarea id="fbMsg" rows="4" maxlength="2000"></textarea></div>
    <p class="form-error" id="fbErr"></p>
    <div class="job-actions"><button type="button" id="fbSend">Send</button></div></div>`;
  if(typeof openFormSheet === 'function') openFormSheet('Tell Relay', [body]);
  const ta = body.querySelector('#fbMsg'); if(ta) ta.focus();
  body.querySelector('#fbSend').onclick = async () => {
    const msg = (body.querySelector('#fbMsg').value || '').trim();
    if(msg.length < 2){ body.querySelector('#fbErr').textContent = 'Write a little more.'; return; }
    const b = body.querySelector('#fbSend'); b.disabled = true; b.textContent = 'Sending…';
    const page = (document.querySelector('.dash-tab.active') || {}).title || document.title;
    const { error } = await sb.rpc('send_feedback', { p_message: msg, p_page: page });
    b.disabled = false; b.textContent = 'Send';
    if(error){ body.querySelector('#fbErr').textContent = error.message; return; }
    if(typeof closeFormSheet === 'function') closeFormSheet();
    if(typeof recordsToast === 'function') recordsToast('Thank you — that reached Relay');
  };
}

// ---------- For Relay: which shops are actually using it ----------
async function renderShopUsage(){
  const box = document.getElementById('adminUsageBox');
  if(!box || !session || session.role !== 'admin') return;
  const { data, error } = await sb.rpc('shop_usage', { p_days: 30 });
  if(error || !data){ box.innerHTML = `<div class="section-head"><h2>Shop activity</h2></div><p class="form-error">${esc(error ? error.message : 'Could not load this.')}</p>`; return; }
  const rows = data || [];
  const money = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const quiet = rows.filter(r => r.quiet_days == null || Number(r.quiet_days) > 14);
  box.innerHTML = `<div class="section-head"><h2>Shop activity</h2><span class="meta">last 30 days</span></div>
    ${quiet.length ? `<div class="inv-warn">⚠ ${quiet.length} shop${quiet.length === 1 ? ' has' : 's have'} created no work orders in two weeks: ${esc(quiet.map(r => r.name).slice(0, 5).join(', '))}${quiet.length > 5 ? ' and more' : ''}.</div>` : ''}
    <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Shop</th><th class="num">People</th><th class="num">Work orders</th><th class="num">Invoiced</th><th>Last work order</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r.name)}</b><div class="meta">${esc(r.billing_status || '')}</div></td>
      <td class="num">${esc(String(r.people))}</td><td class="num ${Number(r.work_orders) === 0 ? 'neg' : ''}">${esc(String(r.work_orders))}</td>
      <td class="num">${money(r.invoiced)}</td>
      <td>${r.last_work_order ? esc(new Date(r.last_work_order).toLocaleDateString()) + (Number(r.quiet_days) > 14 ? ` <span class="meta">(${esc(String(r.quiet_days))} days ago)</span>` : '') : '<span class="meta">never</span>'}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// ---------- Declining a service request: the reason is required, and the customer is emailed it ----------
const DECLINE_REASONS = ['We are fully booked right now', 'We cannot reach that location', 'We do not service that type of vehicle', 'Please call us to talk it through'];
function openDeclineRequest(requestId, onDone){
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>Decline this request</h3></div>
    <p class="meta">The customer is emailed straight away with this reason, so keep it short and kind.</p>
    <div class="job-actions" id="drQuick" style="flex-wrap:wrap;">${DECLINE_REASONS.map(r => `<button type="button" class="ghost-btn" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <div class="field"><label for="drReason">Reason for the customer</label><textarea id="drReason" rows="3" maxlength="300" placeholder="e.g. We are fully booked this week — please try us again next Monday."></textarea></div>
    <p class="form-error" id="drErr"></p>
    <div class="job-actions"><button type="button" id="drSend">Decline and email the customer</button></div></div>`;
  if(typeof openFormSheet === 'function') openFormSheet('Decline request', [body]);
  body.querySelectorAll('[data-reason]').forEach(b => b.onclick = () => { body.querySelector('#drReason').value = b.dataset.reason; body.querySelector('#drReason').focus(); });
  body.querySelector('#drSend').onclick = async () => {
    const reason = (body.querySelector('#drReason').value || '').trim();
    if(reason.length < 3){ body.querySelector('#drErr').textContent = 'Write a short reason for the customer first.'; return; }
    const btn = body.querySelector('#drSend'); btn.disabled = true; btn.textContent = 'Sending…';
    const { error } = await sb.rpc('respond_to_request', { p_request: requestId, p_action: 'decline', p_reason: reason });
    btn.disabled = false; btn.textContent = 'Decline and email the customer';
    if(error){ body.querySelector('#drErr').textContent = error.message; return; }
    if(typeof notifyKick === 'function') notifyKick();
    if(typeof closeFormSheet === 'function') closeFormSheet();
    if(typeof recordsToast === 'function') recordsToast('Declined — the customer has been emailed the reason');
    if(typeof onDone === 'function') onDone();
  };
}
