// ============================================================
// RelayFleet — the plan a shop is on. The price is agreed privately and set by Relay in Admin → Subscriptions; the app never shows a figure the shop has not been told.
// Billing is manual for now: the platform admin sets each shop's status in
// the admin panel (set_org_billing). The database (0030) decides whether a
// shop may start new work; this file only shows the status.
// ============================================================
// No price is kept in the app: Relay agrees one with each shop and sets it in Admin → Subscriptions.
const RELAY_PLAN = { name:'Relay', contact:'support@relayfleet.us' };
const BILLING_LABEL = { trial:'Onboarding', active:'Active', past_due:'Payment past due', cancelled:'Cancelled', comp:'Complimentary' };
function trialDaysLeft(o){ if(!o || !o.trial_ends_at) return null; return Math.ceil((new Date(o.trial_ends_at).getTime() - Date.now()) / 864e5); }
const fmtDay = d => d ? new Date(String(d).length <= 10 ? d + 'T12:00:00' : d).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '';
// Mirrors org_in_good_standing() in the database, for messages only.
function billingState(o){
  if(!o) return { ok:true };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const graceEnd = o.paid_through ? new Date(new Date(o.paid_through + 'T12:00:00').getTime() + 7 * 864e5) : null;
  switch(o.billing_status){
    case 'comp': return { ok:true, text:'Complimentary' };
    case 'trial': { const d = trialDaysLeft(o); return d == null || d > 0 ? { ok:true, trial:true, days:d } : { ok:false, text:'Your onboarding period has ended.' }; }
    case 'active': return !graceEnd || graceEnd >= today ? { ok:true, text:'Active' + (o.paid_through ? ' · paid through ' + fmtDay(o.paid_through) : '') } : { ok:false, text:'Your Relay payment is past due.' };
    case 'past_due': return graceEnd && graceEnd >= today ? { ok:true, due:true, text:'Payment is past due — please pay by ' + fmtDay(graceEnd) + ' to keep creating new work.' } : { ok:false, text:'Your Relay payment is past due.' };
    default: return { ok:false, text:'Your Relay plan is cancelled.' };
  }
}
function contactRelayHref(subject){ return 'mailto:' + RELAY_PLAN.contact + '?subject=' + encodeURIComponent(subject + (session && session.orgName ? ' — ' + session.orgName : '')); }

// ---------- shop: Settings → Plan & billing ----------
async function renderPlanBox(){
  const box = document.getElementById('planBox'); if(!box || !session || session.role !== 'shop') return;
  const [orgRes, invRes] = await Promise.all([
    sb.from('organizations').select('billing_status, trial_ends_at, paid_through, monthly_price').eq('id', session.orgId).maybeSingle(),
    sb.from('subscription_invoices').select('id, number, period_start, period_end, amount, status, due_date, paid_on').eq('org_id', session.orgId).neq('status', 'void').order('period_start', { ascending: false }).limit(12)
  ]);
  const org = orgRes.data; if(!org) return;
  const invoices = invRes.data || [];
  const st = billingState(org), d = trialDaysLeft(org);
  const money = n => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = v => v ? new Date(v + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  // The price is the one Relay agreed with this shop; until it is set, nothing is shown.
  const price = org.monthly_price == null ? null : Number(org.monthly_price);
  const priceLine = org.billing_status === 'comp' ? 'Complimentary — no charge'
    : price == null ? 'Relay will confirm your price with you'
    : `${money(price)} per month · unlimited users`;
  const status = org.billing_status === 'trial' && st.ok
    ? (d == null ? 'Getting started' : `Onboarding · ${d} day${d === 1 ? '' : 's'} left`)
    : org.paid_through ? `Paid through ${day(org.paid_through)}` : st.text || '';
  const unpaid = invoices.filter(x => x.status === 'unpaid');
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Plan &amp; billing</h2></div>
    <div class="card new-job-form plan-card" style="max-width:640px;">
      <div class="plan-now"><div><span class="meta">Your plan</span><b>${esc(priceLine)}</b><span class="${st.ok ? 'meta' : 'neg'}">${esc(status)}</span></div>
        <a class="ghost-btn" href="${contactRelayHref('Relay billing question')}">Contact Relay</a></div>
      ${unpaid.length ? `<p class="${unpaid.some(x => x.due_date < new Date().toISOString().slice(0, 10)) ? 'neg' : 'meta'}">${unpaid.length === 1 ? 'One invoice is' : unpaid.length + ' invoices are'} waiting to be paid: ${esc(money(unpaid.reduce((t, x) => t + Number(x.amount), 0)))}.</p>` : ''}
      ${!st.ok ? '<p class="meta">Your data is safe: you can still see everything, finish jobs in progress and record payments. Creating new work orders, estimates and invoices is paused until the subscription is renewed.</p>' : ''}
      ${invoices.length ? `<h4 class="rec-subhead">Your Relay invoices</h4>
      <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Invoice</th><th>Period</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
      ${invoices.map(x => `<tr><td class="mono">${esc(x.number)}</td><td>${day(x.period_start)} – ${day(x.period_end)}</td><td class="num"><b>${money(x.amount)}</b></td>
        <td>${x.status === 'paid' ? `<span class="badge arrived"><span class="bd"></span>Paid${x.paid_on ? ' ' + esc(day(x.paid_on)) : ''}</span>` : `<span class="badge waiting"><span class="bd"></span>Due ${esc(day(x.due_date))}</span>`}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <p class="meta">Billing is by invoice. Questions: <a href="mailto:${RELAY_PLAN.contact}">${RELAY_PLAN.contact}</a></p>
    </div>`;
}
// ---------- shop: a banner only when it matters ----------
async function renderTrialBanner(){
  const ov = document.getElementById('shop-overview'); if(!ov || !session || session.role !== 'shop' || !session.orgId) return;
  const { data: org } = await sb.from('organizations').select('billing_status, trial_ends_at, paid_through').eq('id', session.orgId).maybeSingle();
  let b = document.getElementById('trialBanner'); const st = billingState(org);
  let text = '', cls = '';
  if(org && st.trial && st.days != null && st.days <= 7) text = `Your onboarding period ends in ${st.days} day${st.days === 1 ? '' : 's'}. Keep everything running for your agreed plan`;
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
  // what the shops are worth each month, and who needs chasing
  const day = 864e5, today = new Date(); today.setHours(0, 0, 0, 0);
  const dayDiff = v => v ? Math.round((new Date(v + 'T00:00:00').getTime() - today.getTime()) / day) : null;
  const approved = orgs.filter(o => o.status === 'approved');
  const paying = approved.filter(o => o.billing_status === 'active');
  const comp = approved.filter(o => o.billing_status === 'comp');
  const onboarding = approved.filter(o => o.billing_status === 'trial');
  const late = approved.filter(o => (o.billing_status === 'active' || o.billing_status === 'past_due') && dayDiff(o.paid_through) != null && dayDiff(o.paid_through) < 0);
  const dueSoon = paying.filter(o => { const d = dayDiff(o.paid_through); return d != null && d >= 0 && d <= 7; });
  const money = n => '$' + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const tile = (label, value, sub, cls) => `<div class="kpi${cls ? ' ' + cls : ''}"><em>${label}</em><b>${value}</b>${sub ? `<span class="meta">${sub}</span>` : ''}</div>`;
  const names = list => list.slice(0, 6).map(o => esc(o.name)).join(', ') + (list.length > 6 ? ` +${list.length - 6} more` : '');
  // The money summary lives on the Subscriptions tab, built from each shop's agreed price.
  box.innerHTML = `<div class="section-head"><h2>Billing</h2><span class="meta">your agreed plan'active')} active · ${n('trial')} onboarding · ${n('past_due')} past due · ${n('comp')} complimentary</span></div>
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
    // Billing lives on its own Subscriptions tab now, not on the Overview.
    const subsPanel = document.getElementById('admin-subs');
    // The old billing box duplicated the Subscriptions screen; that screen is now the one place for billing.
    if(ov && !document.getElementById('adminUsageBox')) ov.insertAdjacentHTML('beforeend', '<div class="section" id="adminUsageBox"></div>');
    if(typeof renderShopUsage === 'function') renderShopUsage();
    if(typeof renderSubscriptions === 'function') renderSubscriptions();
    if(typeof renderAdminSettings === 'function') renderAdminSettings();
    if(ov && !document.getElementById('adminPlansBox')) ov.insertAdjacentHTML('beforeend', '<div class="section" id="adminPlansBox"></div>');
    renderAdminPlans();
  }
}
