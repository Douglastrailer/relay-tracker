// ============================================================
// RelayFleet — Admin → Shops, and Admin → Subscriptions (migrations 0065, 0066).
// Two screens, two jobs:
//   Shops          the accounts: who runs each shop, its people and locations, its AI line,
//                  approval, archive and permanent delete.
//   Subscriptions  the money: each shop's plan, its AI phone line (monthly fee + minutes),
//                  what it comes to this month, paid-through date and what it owes.
// Rows are for reading; a click opens the shop in a panel where things are changed and saved.
// ============================================================
const AST_PLAN = [['trial', 'Trial'], ['active', 'Active'], ['past_due', 'Past due'], ['cancelled', 'Cancelled'], ['comp', 'Complimentary']];
const AST_ACCESS = { approved: 'Approved', pending: 'Waiting for approval', rejected: 'Rejected' };
const AST_BILL_FILTERS = [['all', 'All'], ['past_due', 'Past due'], ['due_soon', 'Due this week'], ['active', 'Paid up'], ['trial', 'Trial'], ['comp', 'Complimentary'], ['cancelled', 'Cancelled'], ['no_date', 'No paid date']];
const AST_SHOP_FILTERS = [['all', 'All shops'], ['pending', 'Waiting for approval'], ['ai', 'With AI phone line'], ['rejected', 'Rejected'], ['archived', 'Archived']];
const AST_PAYING = ['active', 'due_soon', 'past_due', 'no_date'];          // states that are charged the plan price
const AST_BILLED = ['active', 'due_soon', 'past_due', 'no_date', 'trial', 'comp', 'cancelled'];   // states on the Subscriptions screen

const astState = { rows: [], loaded: false, ui: {}, closer: false };
const astUi = id => astState.ui[id] || (astState.ui[id] = { filter: 'all', q: '', sort: id === 'adminSubsBox' ? 'state' : 'name', dir: 1 });

const astEsc = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const astMoney = n => n == null || n === '' ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const astMoney0 = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const astDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const astIso = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
function astAddMonths(iso, n){
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let base = iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00') : today;
  if(base < today) base = today;   // a lapsed shop is extended from today, not from the old date
  const day = base.getDate(); const d = new Date(base.getFullYear(), base.getMonth() + n, 1);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return astIso(d);
}

// ---------- what a shop is charged ----------
function astCharges(r){
  const plan = AST_PAYING.includes(r.state) ? Number(r.monthly_price || 0) : 0;
  const ai = r.ai_this_month || {};
  const aiFee = Number(ai.monthly_fee || 0), aiMinutes = Number(ai.minutes || 0), aiPerMin = Number(ai.per_minute || r.ai_per_minute || 0);
  const aiUse = Math.round(aiMinutes * aiPerMin * 100) / 100;
  const aiTotal = ai.charge != null ? Number(ai.charge) : aiFee + aiUse;
  return { plan, aiFee, aiMinutes, aiPerMin, aiUse, aiTotal, total: Math.round((plan + aiTotal) * 100) / 100,
           aiLast: Number((r.ai_last_month || {}).charge || 0), aiLastLabel: (r.ai_last_month || {}).month_label || 'last month' };
}
const astHasAi = r => !!(r.ai_allowed || r.voice_line === 'live' || r.voice_line === 'provisioning' || Number((r.ai_this_month || {}).charge || 0));

function astStatus(r){
  const days = r.days_left == null ? null : Number(r.days_left);
  const s = r.state;
  const map = {
    archived: ['muted', 'Archived'], rejected: ['muted', 'Rejected'], pending: ['warn', 'Waiting for approval'],
    comp: ['ok', 'Complimentary'], cancelled: ['muted', 'Cancelled'], no_date: ['warn', 'No paid date'],
    trial: ['info', r.trial_ends_at ? 'Trial until ' + astDate(r.trial_ends_at).replace(/, \d{4}$/, '') : 'Trial'],
    past_due: ['bad', days != null && days < 0 ? `Past due ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}` : 'Past due'],
    due_soon: ['warn', days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`],
    active: ['ok', 'Paid up']
  };
  const [tone, text] = map[s] || ['muted', s];
  return `<span class="as-status as-${tone}"><i aria-hidden="true"></i>${astEsc(text)}</span>`;
}

// ---------- loading ----------
async function renderShopTable(boxId){
  const box = document.getElementById(boxId);
  if(!box || typeof session === 'undefined' || !session || session.role !== 'admin') return;
  if(!astState.loaded) box.innerHTML = (typeof skelRows === 'function' ? skelRows(4, { wide: true }) : '<p class="meta">Loading…</p>');
  const { data, error } = await sb.rpc('admin_shop_table');
  if(error){
    const missing = /admin_shop_table|schema cache|does not exist/i.test(error.message || '');
    box.innerHTML = `<p class="form-error">${missing ? 'This screen needs the database update 0065_shop_control.sql. Run it in Supabase → SQL Editor, then refresh.' : astEsc(error.message)}</p>`;
    return;
  }
  astState.rows = data || []; astState.loaded = true;
  if(typeof subState !== 'undefined') subState.rows = astState.rows;   // subs.js (invoice forms, register) reads the shop from here
  document.querySelectorAll('body > .row-menu.ast-float').forEach(m => m.remove());
  if(boxId === 'adminSubsBox') astDrawBilling(box, boxId); else astDrawShops(box, boxId);
}

function refreshShopTables(){
  ['adminShopsBox', 'adminSubsBox'].forEach(id => { const b = document.getElementById(id); if(b && b.childElementCount) renderShopTable(id); });
}

// The people who run the shop: active owners and office staff (0067), else the single owner from older data.
function astLeads(r){
  const team = Array.isArray(r.team) ? r.team.filter(t => t.role === 'shop' && t.active !== false) : [];
  return team.length ? team : (r.owner_name || r.contact_email ? [{ name: r.owner_name, email: r.contact_email, phone: r.contact_phone, staff_role: 'owner' }] : []);
}
const AST_ROLE = t => t.role === 'shop' ? (t.staff_role === 'owner' ? 'Owner' : 'Office staff') : t.role === 'mechanic' ? (t.no_login ? 'Mechanic, no login' : 'Mechanic') : t.role;
function astSearchMatch(r, q){
  if(!q) return true;
  const people = (Array.isArray(r.team) ? r.team : []).flatMap(t => [t.name, t.email, t.phone]);
  return [r.name, r.owner_name, r.contact_email, r.contact_phone, r.billing_email, r.voice_number, ...people].some(v => String(v || '').toLowerCase().includes(q));
}
function astSorted(rows, ui, valueOf){
  return rows.slice().sort((a, b) => { const x = valueOf(a), y = valueOf(b); return (x > y ? 1 : x < y ? -1 : 0) * ui.dir || String(a.name).localeCompare(String(b.name)); });
}
const astSortTh = (ui, key, label, cls) => `<th class="${cls || ''}" aria-sort="${ui.sort === key ? (ui.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="as-sort${ui.sort === key ? ' on' : ''}" data-sort="${key}">${label}<span aria-hidden="true">${ui.sort === key ? (ui.dir > 0 ? ' ↑' : ' ↓') : ''}</span></button></th>`;
const astChips = (list, ui, count) => `<div class="as-filters" role="group" aria-label="Show">${list.map(([k, l]) => { const c = count(k);
  return (k === 'all' || c) ? `<button type="button" class="as-chip${ui.filter === k ? ' on' : ''}" data-astfilter="${k}" aria-pressed="${ui.filter === k}">${l}<span>${c}</span></button>` : ''; }).join('')}</div>`;

// ---------- Subscriptions: the money ----------
function astDrawBilling(box, boxId){
  const ui = astUi(boxId), q = ui.q.trim().toLowerCase();
  const billed = astState.rows.filter(r => AST_BILLED.includes(r.state));
  const sums = billed.reduce((s, r) => { const c = astCharges(r); s.plan += c.plan; s.ai += c.aiTotal; s.total += c.total; s.owed += Number(r.owed || 0); return s; }, { plan: 0, ai: 0, total: 0, owed: 0 });
  const n = k => billed.filter(r => r.state === k).length;
  const pastDue = billed.filter(r => r.state === 'past_due');
  const order = ['past_due', 'due_soon', 'no_date', 'trial', 'active', 'comp', 'cancelled'];
  const val = r => ui.sort === 'total' ? astCharges(r).total : ui.sort === 'paid' ? (r.paid_through || '9999') : ui.sort === 'owed' ? Number(r.owed || 0)
    : ui.sort === 'state' ? order.indexOf(r.state) : String(r.name || '').toLowerCase();
  const shown = astSorted(billed.filter(r => (ui.filter === 'all' || r.state === ui.filter) && astSearchMatch(r, q)), ui, val);
  const month = new Date().toLocaleDateString('en-US', { month: 'long' });
  box.innerHTML = `<section class="as-ledger" aria-label="${astEsc(month)} at a glance">
      <div class="as-lead"><span>Coming in for ${astEsc(month)}</span><b>${astMoney(sums.total)}</b></div>
      <dl>
        <div><dt>Plans</dt><dd>${astMoney(sums.plan)}</dd></div>
        <div><dt>AI phone lines</dt><dd>${astMoney(sums.ai)}</dd></div>
        <div class="${sums.owed ? 'is-bad' : ''}"><dt>Owed to Relay</dt><dd>${astMoney(sums.owed)}</dd></div>
        <div class="${pastDue.length ? 'is-bad' : ''}"><dt>Past due</dt><dd>${pastDue.length} shop${pastDue.length === 1 ? '' : 's'}</dd></div>
      </dl>
    </section>
    <div class="as-bar">${astChips(AST_BILL_FILTERS, ui, k => k === 'all' ? billed.length : n(k))}
      <input type="search" class="as-search" placeholder="Find a shop" value="${astEsc(ui.q)}" aria-label="Find a shop"></div>
    <div class="as-table-wrap"><table class="as-table as-bill"><thead><tr>
      ${astSortTh(ui, 'name', 'Shop')}${astSortTh(ui, 'state', 'Status')}<th class="num">Plan</th><th>AI phone line</th>${astSortTh(ui, 'total', 'This month', 'num')}${astSortTh(ui, 'paid', 'Paid through')}${astSortTh(ui, 'owed', 'Owed', 'num')}
    </tr></thead><tbody>
      ${shown.length ? shown.map(astBillRow).join('') : `<tr><td colspan="7" class="as-empty">No shops here. <button type="button" class="link" data-astclear="1">Show all</button></td></tr>`}
    </tbody>${shown.length > 1 ? `<tfoot><tr><td colspan="4">${shown.length} shops</td><td class="num">${astMoney(shown.reduce((s, r) => s + astCharges(r).total, 0))}</td><td></td><td class="num">${astMoney(shown.reduce((s, r) => s + Number(r.owed || 0), 0))}</td></tr></tfoot>` : ''}</table></div>
    <p class="as-note">Open a shop to change its plan, price, paid-through date or AI line pricing, and to see and send its invoices. A new invoice adds the AI line charge for the month before it.</p>`;
  astWireCommon(box, boxId);
  box.querySelectorAll('tr[data-org]').forEach(tr => { tr.onclick = () => openBillingPanel(tr.dataset.org); tr.onkeydown = e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openBillingPanel(tr.dataset.org); } }; });
}

function astBillRow(r){
  const c = astCharges(r);
  const plan = r.state === 'comp' ? '<span class="as-quiet">Free</span>' : r.monthly_price == null ? '<span class="as-quiet">Not set</span>'
    : `${astMoney0(r.monthly_price)}<span class="as-quiet">/mo</span>${AST_PAYING.includes(r.state) ? '' : '<div class="as-sub">not charged now</div>'}`;
  const ai = astHasAi(r)
    ? `<div>${astMoney0(r.ai_monthly_fee || 0)}<span class="as-quiet">/mo</span> + ${astMoney0(r.ai_per_minute || 0)}<span class="as-quiet">/min</span></div>
       <div class="as-sub">${c.aiMinutes} min so far${r.voice_line === 'live' ? '' : r.voice_line === 'provisioning' ? ' · setting up' : r.ai_allowed ? ' · line off' : ''}</div>`
    : '<span class="as-quiet">None</span>';
  return `<tr data-org="${astEsc(r.org_id)}" data-state="${astEsc(r.state)}" tabindex="0" aria-label="Open ${astEsc(r.name)} billing">
    <td class="as-shop"><b>${astEsc(r.name)}</b><div class="as-sub">${astEsc(astLeads(r).map(t => t.name).filter(Boolean).join(', ') || 'No owner on file')}</div></td>
    <td>${astStatus(r)}</td>
    <td class="num">${plan}</td>
    <td class="as-ai">${ai}</td>
    <td class="num as-total"><b>${astMoney(c.total)}</b>${c.aiTotal && c.plan ? `<div class="as-sub">${astMoney0(c.plan)} + ${astMoney(c.aiTotal)} AI</div>` : ''}</td>
    <td>${r.paid_through ? astDate(r.paid_through) : '<span class="as-quiet">—</span>'}</td>
    <td class="num">${Number(r.owed) ? `<b class="as-owed">${astMoney(r.owed)}</b>` : '<span class="as-quiet">—</span>'}</td></tr>`;
}

// ---------- Shops: the accounts ----------
function astDrawShops(box, boxId){
  const ui = astUi(boxId), q = ui.q.trim().toLowerCase(), rows = astState.rows;
  const n = k => k === 'ai' ? rows.filter(r => r.state !== 'archived' && astHasAi(r)).length : rows.filter(r => r.state === k).length;
  const inFilter = r => ui.filter === 'all' ? r.state !== 'archived' : ui.filter === 'ai' ? r.state !== 'archived' && astHasAi(r) : r.state === ui.filter;
  const val = r => ui.sort === 'people' ? Number(r.people || 0) : ui.sort === 'joined' ? (r.created_at || '') : ui.sort === 'work' ? Number(r.jobs_30d || 0) : String(r.name || '').toLowerCase();
  const shown = astSorted(rows.filter(r => inFilter(r) && astSearchMatch(r, q)), ui, val);
  const waiting = rows.filter(r => r.state === 'pending');
  const active = rows.filter(r => r.state !== 'archived').length;
  box.innerHTML = `<p class="as-intro">${active} shop${active === 1 ? '' : 's'} on Relay${n('archived') ? `, ${n('archived')} archived` : ''}.${waiting.length ? ` <b>${waiting.length} waiting for your approval.</b>` : ''}</p>
    <div class="as-bar">${astChips(AST_SHOP_FILTERS, ui, k => k === 'all' ? active : n(k))}
      <input type="search" class="as-search" placeholder="Find a shop, owner, email or phone" value="${astEsc(ui.q)}" aria-label="Find a shop"></div>
    <div class="as-table-wrap"><table class="as-table as-shops"><thead><tr>
      ${astSortTh(ui, 'name', 'Shop')}<th>Owner</th>${astSortTh(ui, 'people', 'People', 'num')}${astSortTh(ui, 'work', 'Work orders, 30 days', 'num')}<th>AI phone line</th><th>Access</th>${astSortTh(ui, 'joined', 'Joined')}
    </tr></thead><tbody>
      ${shown.length ? shown.map(astShopRow).join('') : `<tr><td colspan="7" class="as-empty">No shops here. <button type="button" class="link" data-astclear="1">Show all</button></td></tr>`}
    </tbody></table></div>`;
  astWireCommon(box, boxId);
  box.querySelectorAll('tr[data-org]').forEach(tr => { tr.onclick = e => { if(e.target.closest('button')) return; openShopPanel(tr.dataset.org); };
    tr.onkeydown = e => { if((e.key === 'Enter' || e.key === ' ') && e.target === tr){ e.preventDefault(); openShopPanel(tr.dataset.org); } }; });
  box.querySelectorAll('[data-approve]').forEach(b => b.onclick = async e => { e.stopPropagation(); await astSetAccess(b.dataset.approve, 'approved'); });
}

function astShopRow(r){
  const line = r.voice_line === 'live' ? `<span class="as-status as-ok"><i></i>${astEsc(typeof voicePretty === 'function' && r.voice_number ? voicePretty(r.voice_number) : (r.voice_number || 'On'))}</span>`
    : r.voice_line === 'provisioning' ? '<span class="as-status as-info"><i></i>Setting up</span>'
    : r.ai_allowed ? '<span class="as-quiet">Approved, not on</span>' : '<span class="as-quiet">—</span>';
  const access = r.state === 'archived' ? '<span class="as-status as-muted"><i></i>Archived</span>'
    : r.access === 'pending' ? `<button type="button" class="as-approve" data-approve="${astEsc(r.org_id)}">Approve</button>`
    : r.access === 'rejected' ? '<span class="as-status as-muted"><i></i>Rejected</span>' : '<span class="as-status as-ok"><i></i>Approved</span>';
  return `<tr data-org="${astEsc(r.org_id)}" data-state="${astEsc(r.state)}" tabindex="0" aria-label="Open ${astEsc(r.name)}">
    <td class="as-shop"><b>${astEsc(r.name)}</b>${r.locations > 1 ? `<div class="as-sub">${r.locations} locations</div>` : ''}</td>
    <td class="as-owner">${astLeads(r).length ? astLeads(r).map(t => `<div class="as-person"><span>${astEsc(t.name || 'No name')}</span><span class="as-sub">${astEsc(t.email || t.phone || 'No email on file')}</span></div>`).join('') : '<span class="as-quiet">No owner on file</span>'}</td>
    <td class="num">${Number(r.people || 0)}</td>
    <td class="num">${Number(r.jobs_30d || 0)}</td>
    <td>${line}</td>
    <td>${access}</td>
    <td>${r.created_at ? astDate(r.created_at) : '—'}</td></tr>`;
}

function astWireCommon(box, boxId){
  const ui = astUi(boxId), redraw = () => (boxId === 'adminSubsBox' ? astDrawBilling : astDrawShops)(box, boxId);
  const search = box.querySelector('.as-search'); let t = null;
  if(search) search.oninput = () => { clearTimeout(t); t = setTimeout(() => { ui.q = search.value; redraw(); const s = box.querySelector('.as-search'); if(s){ s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 200); };
  box.querySelectorAll('[data-astfilter]').forEach(b => b.onclick = () => { ui.filter = b.dataset.astfilter; redraw(); });
  box.querySelectorAll('[data-astclear]').forEach(b => b.onclick = e => { e.stopPropagation(); ui.filter = 'all'; ui.q = ''; redraw(); });
  box.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { const k = b.dataset.sort; ui.dir = ui.sort === k ? -ui.dir : 1; ui.sort = k; redraw(); });
}

// ---------- saving ----------
async function astSave(org, patch, okText){
  const { data, error } = await sb.rpc('admin_update_shop', Object.assign({ p_org: org }, patch));
  if(error){
    const missing = /admin_update_shop|schema cache|does not exist/i.test(error.message || '');
    if(typeof relayNotice === 'function') relayNotice(missing ? 'Run the database update 0065_shop_control.sql in Supabase first.' : error.message, { kind: 'error' });
    return false;
  }
  if(typeof recordsToast === 'function') recordsToast(okText || 'Saved');
  return data || true;
}
const astRow = org => astState.rows.find(r => r.org_id === org) || {};

async function astSetAccess(org, to){
  const r = astRow(org);
  const words = { approved: `Approve ${r.name}? Its people can sign in and start working.`, pending: `Move ${r.name} back to waiting for approval? Its people see the waiting screen until you approve it again.`, rejected: `Reject ${r.name}? Its people see a rejection message when they sign in.` };
  if(!(await relayConfirm({ title: { approved: 'Approve shop', pending: 'Move back to waiting', rejected: 'Reject shop' }[to], message: words[to], confirmText: { approved: 'Approve', pending: 'Move back', rejected: 'Reject' }[to], danger: to !== 'approved' }))) return false;
  const ok = await astSave(org, { p_access: to }, { approved: 'Approved', pending: 'Moved back to waiting', rejected: 'Rejected' }[to]);
  if(ok) refreshShopTables();
  return ok;
}

// ---------- the shop panel (Shops screen) ----------
function openShopPanel(org){
  const r = astRow(org); if(!r.org_id) return;
  const c = astCharges(r), archived = r.state === 'archived';
  const aiBlocks = r.voice_line === 'live' || r.voice_line === 'provisioning';
  const body = document.createElement('div'); body.className = 'as-panel';
  body.innerHTML = `
    <section class="as-p-top">
      <div><h3>${astEsc(r.name)}</h3><p>${astStatus(r)}</p></div>
      <dl class="as-facts">
        <div><dt>Billing email</dt><dd>${r.billing_email ? `<a href="mailto:${astEsc(r.billing_email)}">${astEsc(r.billing_email)}</a>` : '<span class="as-quiet">Not set, invoices go to the owner</span>'}</dd></div>
        <div><dt>People</dt><dd>${Number(r.people || 0)}</dd></div>
        <div><dt>Locations</dt><dd>${Number(r.locations || 0) || 1}</dd></div>
        <div><dt>Work orders, last 30 days</dt><dd>${Number(r.jobs_30d || 0)}</dd></div>
        <div><dt>AI phone line</dt><dd>${r.voice_line === 'live' ? astEsc(typeof voicePretty === 'function' && r.voice_number ? voicePretty(r.voice_number) : r.voice_number || 'On') : r.voice_line === 'provisioning' ? 'Setting up' : r.ai_allowed ? 'Approved, not turned on' : 'Not approved'}</dd></div>
        <div><dt>Joined</dt><dd>${astDate(r.created_at)}</dd></div>
      </dl>
    </section>
    <section class="as-p-sec">
      <h4>People</h4>
      ${(Array.isArray(r.team) && r.team.length) ? `<ul class="as-people">${r.team.map(t => `<li class="${t.active === false ? 'is-off' : ''}">
        <div><b>${astEsc(t.name || 'No name')}</b><span class="as-role">${astEsc(AST_ROLE(t))}${t.active === false ? ', switched off' : ''}</span></div>
        <div class="as-contact">${t.email ? `<a href="mailto:${astEsc(t.email)}">${astEsc(t.email)}</a>` : ''}${t.phone ? `<a href="tel:${astEsc(t.phone)}">${astEsc(t.phone)}</a>` : ''}${!t.email && !t.phone ? '<span class="as-quiet">No email or phone</span>' : ''}</div></li>`).join('')}</ul>`
        : `<p class="as-p-help">${astEsc([r.owner_name, r.contact_email, r.contact_phone].filter(Boolean).join(', ') || 'No people on file.')}</p>`}
    </section>
    <section class="as-p-sec">
      <h4>Billing</h4>
      <p class="as-p-line">${astStatus(r)} <span>${astMoney(c.total)} this month${r.paid_through ? `, paid through ${astDate(r.paid_through)}` : ''}${Number(r.owed) ? `, <b class="as-owed">${astMoney(r.owed)} owed</b>` : ''}.</span></p>
      <button type="button" class="ghost-btn" id="asOpenBilling">Open billing</button>
    </section>
    ${archived ? '' : `<section class="as-p-sec">
      <h4>Access</h4>
      <p class="as-p-help">${r.access === 'approved' ? 'This shop is approved. Its people can sign in.' : r.access === 'pending' ? 'This shop signed up and is waiting for you.' : 'This shop was rejected. Its people see a rejection message.'}</p>
      <div class="as-p-actions">
        ${r.access !== 'approved' ? '<button type="button" id="asApprove">Approve</button>' : ''}
        ${r.access === 'approved' ? '<button type="button" class="ghost-btn" id="asUnapprove">Move back to waiting</button>' : ''}
        ${r.access !== 'rejected' ? '<button type="button" class="ghost-btn" id="asReject">Reject</button>' : ''}
      </div></section>`}
    <section class="as-p-sec as-p-danger">
      <h4>${archived ? 'Archived' : 'Switch off or remove'}</h4>
      <p class="as-p-help">${archived ? `Archived ${astDate(r.archived_at)}. Its people cannot sign in. Restore it to switch it back on, or delete it for good.`
        : 'Archive switches the shop and its people off and keeps everything. Delete removes the shop and all its records for good.'}</p>
      <div class="as-p-actions">
        ${archived ? '<button type="button" class="ghost-btn" id="asRestore">Restore shop</button>'
          : `<button type="button" class="ghost-btn" id="asArchive" ${aiBlocks ? 'disabled' : ''}>Archive shop</button>`}
        <button type="button" class="ghost-btn as-del" id="asDelete">Delete permanently…</button>
      </div>
      ${aiBlocks && !archived ? '<p class="as-p-help">Turn off the AI phone line before archiving (AI phone lines screen).</p>' : ''}
    </section>`;
  if(typeof openFormSheet === 'function') openFormSheet('Shop', [body]);
  const on = (id, fn) => { const b = body.querySelector('#' + id); if(b) b.onclick = fn; };
  const after = () => { if(typeof closeFormSheet === 'function') closeFormSheet(); };
  on('asOpenBilling', () => { after(); const tab = document.querySelector('#adminView .dash-tab[data-target="admin-subs"]'); if(tab) tab.click(); setTimeout(() => openBillingPanel(org), 350); });
  on('asApprove', async () => { if(await astSetAccess(org, 'approved')) after(); });
  on('asUnapprove', async () => { if(await astSetAccess(org, 'pending')) after(); });
  on('asReject', async () => { if(await astSetAccess(org, 'rejected')) after(); });
  on('asArchive', async () => { after(); if(typeof archiveShop === 'function') await archiveShop(org, r.name); });
  on('asRestore', async () => { after(); if(typeof restoreShop === 'function') await restoreShop(org, r.name); });
  on('asDelete', () => { after(); if(typeof openDeleteShop === 'function') openDeleteShop(org, r.name, archived); });
}

// ---------- the billing panel (Subscriptions screen) ----------
async function openBillingPanel(org){
  const r = astRow(org); if(!r.org_id) return;
  const c = astCharges(r);
  const body = document.createElement('div'); body.className = 'as-panel';
  body.innerHTML = `
    <section class="as-p-top">
      <div><h3>${astEsc(r.name)}</h3><p>${astStatus(r)}${r.paid_through ? ` <span class="as-quiet">paid through ${astDate(r.paid_through)}</span>` : ''}</p>
        <p class="as-p-help">${astLeads(r).length ? 'Run by ' + astLeads(r).map(t => astEsc(t.name || 'No name') + (t.email ? ` (${astEsc(t.email)})` : '')).join(', ') + '. ' : ''}Invoices are emailed to ${astEsc(r.billing_email || r.contact_email || 'nobody yet: add an email in Accounts')}.</p></div>
      <div class="as-bill-sum" aria-label="This month">
        <div class="as-bill-lines">
          <div><span>Plan${AST_PAYING.includes(r.state) ? '' : ` <em>(${r.state === 'comp' ? 'complimentary' : r.state === 'trial' ? 'trial' : 'cancelled'}, not charged)</em>`}</span><b>${astMoney(c.plan)}</b></div>
          <div><span>AI phone line, monthly fee</span><b>${astMoney(c.aiFee)}</b></div>
          <div><span>AI phone line, ${c.aiMinutes} min × ${astMoney(c.aiPerMin)}</span><b>${astMoney(c.aiUse)}</b></div>
        </div>
        <div class="as-bill-total"><span>This month so far</span><b>${astMoney(c.total)}</b></div>
        ${c.aiLast ? `<p class="as-p-help">${astEsc(c.aiLastLabel)}: AI phone line ${astMoney(c.aiLast)}, added to the next invoice you create.</p>` : ''}
      </div>
    </section>
    <section class="as-p-sec">
      <h4>Plan</h4>
      <div class="as-p-grid">
        <label>Status<select id="bpStatus">${AST_PLAN.map(([k, l]) => `<option value="${k}" ${r.billing_status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Price per month<span class="as-money"><i>$</i><input id="bpPrice" type="number" min="0" max="100000" step="1" inputmode="decimal" value="${r.monthly_price == null ? '' : Number(r.monthly_price)}" placeholder="Not set"></span></label>
        <label>Paid through<input id="bpPaid" type="date" value="${astEsc(r.paid_through || '')}"></label>
        <label class="${r.billing_status === 'trial' ? '' : 'hidden'}" id="bpTrialWrap">Trial ends<input id="bpTrial" type="date" value="${astEsc(r.trial_ends_at ? String(r.trial_ends_at).slice(0, 10) : '')}"></label>
      </div>
      <div class="as-p-quick" role="group" aria-label="Extend the paid-through date">
        <span>Extend paid-through</span>
        <button type="button" class="as-chip" data-extend="1">+1 month</button><button type="button" class="as-chip" data-extend="3">+3 months</button><button type="button" class="as-chip" data-extend="12">+1 year</button>
      </div>
      <p class="form-error" id="bpErr"></p>
      <div class="as-p-actions"><button type="button" id="bpSave">Save plan</button></div>
    </section>
    <section class="as-p-sec">
      <h4>AI phone line pricing</h4>
      <div class="as-p-grid">
        <label class="as-check"><input id="aiAllowed" type="checkbox" ${r.ai_allowed ? 'checked' : ''}> Approved for an AI phone line</label>
        <label>Monthly fee<span class="as-money"><i>$</i><input id="aiFee" type="number" min="0" step="1" value="${r.ai_monthly_fee == null ? '' : Number(r.ai_monthly_fee)}" placeholder="0"></span></label>
        <label>Per minute<span class="as-money"><i>$</i><input id="aiMin" type="number" min="0" step="0.01" value="${r.ai_per_minute == null ? '' : Number(r.ai_per_minute)}" placeholder="0.00"></span></label>
      </div>
      <p class="as-p-help">${r.voice_line === 'live' ? 'Line is on' + (r.voice_number ? ': ' + astEsc(typeof voicePretty === 'function' ? voicePretty(r.voice_number) : r.voice_number) : '') + '. ' : ''}The monthly fee is charged for any month the line is on. Minutes are counted per call, rounded up.</p>
      <p class="form-error" id="aiErr"></p>
      <div class="as-p-actions"><button type="button" class="ghost-btn" id="aiSave">Save AI line pricing</button></div>
    </section>
    <section class="as-p-sec">
      <div class="as-p-row"><h4>Invoices</h4><button type="button" class="ghost-btn" id="sbNew">New invoice</button></div>
      <p class="form-error" id="sbErr"></p>
      <div id="bpInvoices"><p class="meta">Loading invoices…</p></div>
    </section>`;
  if(typeof openFormSheet === 'function') openFormSheet('Billing', [body]);
  const $ = s => body.querySelector(s);
  const reopen = async () => { if(typeof closeFormSheet === 'function') closeFormSheet(true); await renderShopTable('adminSubsBox'); refreshShopTables(); openBillingPanel(org); };
  $('#bpStatus').onchange = () => $('#bpTrialWrap').classList.toggle('hidden', $('#bpStatus').value !== 'trial');
  body.querySelectorAll('[data-extend]').forEach(b => b.onclick = () => {
    $('#bpPaid').value = astAddMonths($('#bpPaid').value || r.paid_through, Number(b.dataset.extend));
    if(['trial', 'past_due', 'cancelled'].includes($('#bpStatus').value)){ $('#bpStatus').value = 'active'; $('#bpTrialWrap').classList.add('hidden'); }   // paying makes the plan active
    $('#bpPaid').classList.add('as-changed');
  });
  $('#bpSave').onclick = async () => {
    const err = $('#bpErr'); err.textContent = '';
    const status = $('#bpStatus').value, priceTxt = $('#bpPrice').value, paid = $('#bpPaid').value, trial = $('#bpTrial').value;
    if(priceTxt === '' && r.monthly_price != null){ err.textContent = 'A price can be changed but not removed. Choose Complimentary for a shop that does not pay.'; return; }
    const price = priceTxt === '' ? null : Number(priceTxt);
    if(price != null && !(price >= 0 && price <= 100000)){ err.textContent = 'That price looks wrong.'; return; }
    if(status === 'cancelled' && r.billing_status !== 'cancelled' && !(await relayConfirm({ title: 'Cancel plan', message: `Cancel ${r.name}'s plan? The shop keeps its data but cannot open new work orders, estimates or invoices until the plan is active again.`, confirmText: 'Cancel plan', danger: true }))) return;
    const patch = {};
    if(status !== r.billing_status) patch.p_billing_status = status;
    if(price != null && price !== Number(r.monthly_price)) patch.p_price = price;
    if(paid && paid !== (r.paid_through || '')) patch.p_paid_through = paid;
    if(!paid && r.paid_through) patch.p_clear_paid_through = true;
    if(status === 'trial' && trial && trial !== String(r.trial_ends_at || '').slice(0, 10)) patch.p_trial_ends = trial;
    if(!Object.keys(patch).length){ err.textContent = 'Nothing changed.'; return; }
    $('#bpSave').disabled = true;
    const ok = await astSave(org, patch, 'Plan saved');
    $('#bpSave').disabled = false;
    if(ok) reopen();
  };
  $('#aiSave').onclick = async () => {
    const err = $('#aiErr'); err.textContent = '';
    const fee = $('#aiFee').value === '' ? 0 : Number($('#aiFee').value), per = $('#aiMin').value === '' ? 0 : Number($('#aiMin').value);
    if(!(fee >= 0 && fee <= 10000) || !(per >= 0 && per <= 100)){ err.textContent = 'Check the fee and the price per minute.'; return; }
    if(!$('#aiAllowed').checked && r.voice_line === 'live' && !(await relayConfirm({ title: 'Remove approval', message: `${r.name}'s AI line is on. Removing approval stops them turning it on again, but does not turn the current line off (do that on the AI phone lines screen).`, confirmText: 'Remove approval', danger: true }))) return;
    $('#aiSave').disabled = true;
    const { error } = await sb.rpc('set_voice_plan', { p_org: org, p_allowed: $('#aiAllowed').checked, p_monthly_fee: fee, p_per_minute: per });
    $('#aiSave').disabled = false;
    if(error){ err.textContent = error.message; return; }
    if(typeof recordsToast === 'function') recordsToast('AI line pricing saved');
    reopen();
  };
  $('#sbNew').onclick = () => { if(typeof openSubInvoiceForm === 'function') openSubInvoiceForm(org, reopen); };

  // invoices (subs.js does the work on each one)
  const { data: h, error } = await sb.rpc('shop_billing_history', { p_org: org });
  const box = $('#bpInvoices'); if(!box) return;
  if(error || !h){ box.innerHTML = `<p class="form-error">${astEsc(error ? error.message : 'Could not load the invoices.')}</p>`; return; }
  if(typeof subState !== 'undefined') subState.history[org] = h;
  const tag = { paid: ['ok', 'Paid'], unpaid: ['warn', 'Unpaid'], void: ['muted', 'Void'], draft: ['muted', 'Draft'] };
  box.innerHTML = (h.invoices || []).length ? `<p class="as-p-help">${Number(h.months_paid) || 0} month${Number(h.months_paid) === 1 ? '' : 's'} paid, ${astMoney(h.total_paid)} in total${h.first_period ? ' since ' + astDate(h.first_period) : ''}.</p>
    <table class="as-table as-inv"><thead><tr><th>Invoice</th><th>Period</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>
    ${h.invoices.map(i => { const [tone, label] = tag[i.status] || ['muted', i.status];
      return `<tr><td><b>${astEsc(i.number)}</b><div class="as-sub">${i.status === 'paid' && i.paid_on ? 'paid ' + astDate(i.paid_on) : 'due ' + astDate(i.due_date)}${i.sent_at ? ', emailed' : ''}</div></td>
        <td>${astDate(i.period_start).replace(/, \d{4}$/, '')} – ${astDate(i.period_end)}</td>
        <td class="num">${astMoney(i.amount)}${Number(i.ai_line_amount) ? `<div class="as-sub">incl. ${astMoney(i.ai_line_amount)} AI</div>` : ''}</td>
        <td><span class="as-status as-${tone}"><i></i>${label}</span></td>
        <td class="as-inv-acts">
          <button type="button" class="text-btn" data-view="${i.id}">View</button><button type="button" class="text-btn" data-pdf="${i.id}">PDF</button>
          ${i.status === 'unpaid' ? `<button type="button" class="text-btn" data-paid="${i.id}">Mark paid</button><button type="button" class="text-btn" data-email="${i.id}">Email</button>` : ''}
          ${i.status !== 'void' ? `<details class="row-more"><summary aria-label="More">More</summary><div class="row-menu"><button type="button" class="text-btn" data-edit="${i.id}">Edit</button>${i.status === 'unpaid' ? `<button type="button" class="text-btn danger" data-void="${i.id}">Void</button>` : ''}</div></details>` : ''}
        </td></tr>`; }).join('')}
    </tbody></table>` : '<p class="as-p-help">No invoices yet. Create the first one with New invoice.</p>';
  const errEl = $('#sbErr');
  body.querySelectorAll('[data-view]').forEach(b => b.onclick = () => openInvoiceView(Number(b.dataset.view), org));
  body.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => downloadSubscriptionPdf(Number(b.dataset.pdf)));
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditInvoice(Number(b.dataset.edit), h.invoices.find(x => x.id === Number(b.dataset.edit)), reopen));
  body.querySelectorAll('[data-email]').forEach(b => b.onclick = () => emailSubInvoice(Number(b.dataset.email), org, errEl));
  body.querySelectorAll('[data-paid]').forEach(b => b.onclick = async () => {
    if(!(await relayConfirm({ message: 'Mark this invoice as paid? The shop\'s paid-through date moves to the end of its period.' }))) return;
    const { error: e2 } = await sb.rpc('mark_subscription_paid', { p_invoice: Number(b.dataset.paid), p_paid_on: null });
    if(e2){ errEl.textContent = e2.message; return; }
    if(typeof recordsToast === 'function') recordsToast('Marked paid'); reopen();
  });
  body.querySelectorAll('[data-void]').forEach(b => b.onclick = async () => {
    if(!(await relayConfirm({ message: 'Void this invoice? Use this when it was raised by mistake. It stays in the history, marked void.', danger: true, confirmText: 'Void' }))) return;
    const { error: e2 } = await sb.rpc('void_subscription_invoice', { p_invoice: Number(b.dataset.void) });
    if(e2){ errEl.textContent = e2.message; return; }
    if(typeof recordsToast === 'function') recordsToast('Voided'); reopen();
  });
}
