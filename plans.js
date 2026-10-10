// ============================================================
// RelayFleet — one plan: $320/month, unlimited users, 14-day free trial.
// Billing is manual for now: the platform admin sets each shop's status in
// the admin panel (set_org_billing). The database (0030) decides whether a
// shop may start new work; this file only shows the status.
// ============================================================
const RELAY_PLAN = { name:'Relay', price:320, trialDays:14, contact:'support@relayfleet.us' };
const BILLING_LABEL = { trial:'Free trial', active:'Active', past_due:'Payment past due', cancelled:'Cancelled', comp:'Complimentary' };
function trialDaysLeft(o){ if(!o || !o.trial_ends_at) return null; return Math.ceil((new Date(o.trial_ends_at).getTime() - Date.now()) / 864e5); }
const fmtDay = d => d ? new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '';
// Mirrors org_in_good_standing() in the database, for messages only.
function billingState(o){
  if(!o) return { ok:true };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const graceEnd = o.paid_through ? new Date(new Date(o.paid_through + 'T12:00:00').getTime() + 7 * 864e5) : null;
  switch(o.billing_status){
    case 'comp': return { ok:true, text:'Complimentary' };
    case 'trial': { const d = trialDaysLeft(o); return d == null || d > 0 ? { ok:true, trial:true, days:d } : { ok:false, text:'Your free trial has ended.' }; }
    case 'active': return !graceEnd || graceEnd >= today ? { ok:true, text:'Active' + (o.paid_through ? ' · paid through ' + fmtDay(o.paid_through) : '') } : { ok:false, text:'Your Relay payment is past due.' };
    case 'past_due': return graceEnd && graceEnd >= today ? { ok:true, due:true, text:'Payment is past due — please pay by ' + fmtDay(graceEnd) + ' to keep creating new work.' } : { ok:false, text:'Your Relay payment is past due.' };
    default: return { ok:false, text:'Your Relay plan is cancelled.' };
  }
}
function contactRelayHref(subject){ return 'mailto:' + RELAY_PLAN.contact + '?subject=' + encodeURIComponent(subject + (session && session.orgName ? ' — ' + session.orgName : '')); }

// ---------- landing page ----------
function renderLandingPricing(){
  const box = document.getElementById('lxPricingGrid'); if(!box) return;
  box.innerHTML = `<div class="lx-plan featured"><div class="lx-plan-head"><b>${RELAY_PLAN.name}</b><span class="lx-price">$${RELAY_PLAN.price}<em>/month</em></span></div>
    <ul><li><b>Unlimited users</b> — office staff, every mechanic, and your fleet customers</li><li>Work orders, dispatch with live GPS and ETA, estimates and approvals, invoices and payments</li>
    <li>Inventory with barcode scanning, VIN decode, inspections, time clock, reports and profitability</li><li>Multiple locations, the fleet portal, and Natasha, your assistant</li></ul>
    <button type="button" class="lx-btn lx-btn-primary" id="landingSignup3">Start your ${RELAY_PLAN.trialDays}-day free trial</button><p class="lx-note">No card needed to start.</p></div>`;
  const b = document.getElementById('landingSignup3'); const s = document.getElementById('landingSignup');
  if(b) b.onclick = () => { if(s) s.click(); };
}
// ---------- shop: Settings → Plan & billing ----------
async function renderPlanBox(){
  const box = document.getElementById('planBox'); if(!box || !session || session.role !== 'shop') return;
  const { data: org } = await sb.from('organizations').select('billing_status, trial_ends_at, paid_through').eq('id', session.orgId).maybeSingle();
  if(!org) return;
  const st = billingState(org), d = trialDaysLeft(org);
  const line = org.billing_status === 'trial' && st.ok ? (d == null ? 'Free trial — starts when your shop is approved' : `Free trial · ${d} day${d === 1 ? '' : 's'} left (ends ${fmtDay(org.trial_ends_at)})`) : (st.text || BILLING_LABEL[org.billing_status]);
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Plan &amp; billing</h2></div><div class="card new-job-form plan-card" style="max-width:640px;">
    <div class="plan-now"><div><span class="meta">Your plan</span><b>${RELAY_PLAN.name} · $${RELAY_PLAN.price}/month · unlimited users</b><span class="${st.ok ? 'meta' : 'neg'}">${esc(line)}</span></div>
      <a class="ghost-btn" href="${contactRelayHref(org.billing_status === 'trial' ? 'Subscribe to Relay' : 'Relay billing question')}">${org.billing_status === 'trial' ? 'Subscribe' : 'Contact Relay'}</a></div>
    ${!st.ok ? '<p class="meta">Your data is safe: you can still see everything, finish jobs in progress and record payments. Creating new work orders, estimates and invoices resumes as soon as your plan is active.</p>' : ''}
    <p class="meta">Billing is by invoice for now. Questions: <a href="mailto:${RELAY_PLAN.contact}">${RELAY_PLAN.contact}</a></p></div>`;
}
// ---------- shop: a banner only when it matters ----------
async function renderTrialBanner(){
  const ov = document.getElementById('shop-overview'); if(!ov || !session || session.role !== 'shop' || !session.orgId) return;
  const { data: org } = await sb.from('organizations').select('billing_status, trial_ends_at, paid_through').eq('id', session.orgId).maybeSingle();
  let b = document.getElementById('trialBanner'); const st = billingState(org);
  let text = '', cls = '';
  if(org && st.trial && st.days != null && st.days <= 7) text = `Your free trial ends in ${st.days} day${st.days === 1 ? '' : 's'}. Keep everything running for $${RELAY_PLAN.price}/month, unlimited users.`;
  else if(st.due){ text = st.text; cls = 'warn'; }
  else if(!st.ok){ text = st.text + ' New work orders, estimates and invoices are paused — your data is safe.'; cls = 'stop'; }
  if(!text){ if(b) b.remove(); return; }
  if(!b){ b = Object.assign(document.createElement('div'), { id:'trialBanner' }); ov.insertBefore(b, ov.firstChild); }
  b.className = 'trial-banner ' + cls;
  b.innerHTML = `<span>${esc(text)}</span><a class="ghost-btn" href="${contactRelayHref(st.ok ? 'Subscribe to Relay' : 'Reactivate Relay')}">${st.ok ? 'Subscribe' : 'Contact Relay'}</a>`;
}
// ---------- admin: every shop's billing ----------
async function renderAdminPlans(){
  const box = document.getElementById('adminPlansBox'); if(!box || !session || session.role !== 'admin') return;
  const { data } = await sb.from('organizations').select('id, name, status, billing_status, trial_ends_at, paid_through, billing_note').order('name');
  const orgs = data || [];
  const n = s => orgs.filter(o => o.billing_status === s).length;
  const dateIn = v => v ? String(v).slice(0, 10) : '';
  box.innerHTML = `<div class="section-head"><h2>Billing</h2><span class="meta">$${RELAY_PLAN.price}/month per shop · ${n('active')} active · ${n('trial')} on trial · ${n('past_due')} past due · ${n('comp')} complimentary</span></div>
    <div class="an-scroll"><table class="an-table admin-billing"><thead><tr><th>Shop</th><th>Status</th><th>Trial ends</th><th>Paid through</th><th>Note</th><th></th></tr></thead><tbody>
    ${orgs.map(o => { const st = billingState(o); return `<tr data-org="${o.id}"><td><b>${esc(o.name || '—')}</b>${o.status !== 'approved' ? ` <span class="rec-tag">${esc(o.status || '')}</span>` : ''}${!st.ok ? ' <span class="rec-tag warn">paused</span>' : ''}</td>
      <td><select data-f="status">${Object.entries(BILLING_LABEL).map(([k, l]) => `<option value="${k}" ${o.billing_status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input type="date" data-f="trial" value="${dateIn(o.trial_ends_at)}"></td><td><input type="date" data-f="paid" value="${dateIn(o.paid_through)}"></td>
      <td><input data-f="note" maxlength="500" value="${esc(o.billing_note || '')}" placeholder="e.g. Invoice #12 paid"></td><td><button type="button" class="ghost-btn" data-save>Save</button></td></tr>`; }).join('')}
    </tbody></table></div><p class="form-error" id="adminBillErr"></p>`;
  box.querySelectorAll('[data-save]').forEach(btn => btn.onclick = async () => {
    const tr = btn.closest('tr'), v = f => tr.querySelector(`[data-f="${f}"]`).value;
    const { error } = await sb.rpc('set_org_billing', { p_org: tr.dataset.org, p_status: v('status'), p_trial_ends: v('trial') ? new Date(v('trial') + 'T23:59:00').toISOString() : null, p_paid_through: v('paid') || null, p_note: v('note') || null });
    document.getElementById('adminBillErr').textContent = error ? error.message : '';
    if(!error){ recordsToast('Billing saved'); renderAdminPlans(); }
  });
}
function initPlansUI(){
  if(!session) return;
  if(session.role === 'shop'){
    const ls = document.getElementById('locSettings') || document.getElementById('notifySettings');
    if(ls && !document.getElementById('planBox')) ls.insertAdjacentHTML('beforebegin', '<div id="planBox"></div>');
    document.querySelectorAll('.dash-tab[data-target="shop-billing"]').forEach(t => t.addEventListener('click', renderPlanBox));
    renderPlanBox(); renderTrialBanner();
  }
  if(session.role === 'admin'){
    const ov = document.getElementById('admin-overview');
    if(ov && !document.getElementById('adminPlansBox')) ov.insertAdjacentHTML('beforeend', '<div class="section" id="adminPlansBox"></div>');
    renderAdminPlans();
  }
}
renderLandingPricing();
