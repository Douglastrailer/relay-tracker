// ============================================================
// RelayFleet — Admin → Shops & subscriptions (migration 0065).
// One table, one row per shop, every control on the row:
//   access (approved / not approved / rejected), plan status, price, paid-through date (+1 month),
//   what the shop owes, its invoices, archive / restore, and permanent delete.
// A change saves on its own as soon as it is made (a toast confirms it), and every change is logged
// on the server. Destructive actions keep their safety steps: archive asks first; permanent delete
// shows what will be removed and needs the shop's exact name typed in (admin-console.js).
// The same table is drawn on the Shops screen and on the Subscriptions screen.
// ============================================================
const AST_FILTERS = [
  ['all', 'All'], ['active', 'Active'], ['due_soon', 'Due in 7 days'], ['past_due', 'Past due'], ['trial', 'Trial'],
  ['comp', 'Complimentary'], ['cancelled', 'Cancelled'], ['no_date', 'No paid date'], ['pending', 'Not approved'], ['archived', 'Archived']
];
const AST_PLAN = [['trial', 'Trial'], ['active', 'Active'], ['past_due', 'Past due'], ['cancelled', 'Cancelled'], ['comp', 'Complimentary']];
const AST_ACCESS = [['approved', 'Approved'], ['pending', 'Not approved'], ['rejected', 'Rejected']];
const astState = { rows: [], loaded: false, ui: {} };
// each screen keeps its own filter, search and sort
const astUi = id => astState.ui[id] || (astState.ui[id] = { filter: 'all', q: '', sort: 'name', dir: 1 });

const astEsc = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const astMoney = n => n == null || n === '' ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function astStateBadge(r){
  const days = r.days_left == null ? null : Number(r.days_left);
  const trialEnd = r.trial_ends_at ? astDate(r.trial_ends_at) : '';
  switch(r.state){
    case 'archived': return '<span class="badge offline"><span class="bd"></span>Archived</span>';
    case 'rejected': return '<span class="badge cancelled"><span class="bd"></span>Rejected</span>';
    case 'pending': return '<span class="badge pending"><span class="bd"></span>Not approved</span>';
    case 'comp': return '<span class="badge arrived"><span class="bd"></span>Complimentary</span>';
    case 'cancelled': return '<span class="badge cancelled"><span class="bd"></span>Cancelled</span>';
    case 'trial': return `<span class="badge waiting"><span class="bd"></span>Trial${trialEnd ? ' · ends ' + astEsc(trialEnd) : ''}</span>`;
    case 'no_date': return '<span class="badge pending"><span class="bd"></span>No paid date</span>';
    case 'past_due': return `<span class="badge overdue"><span class="bd"></span>Past due${days != null && days < 0 ? ' · ' + Math.abs(days) + ' day' + (Math.abs(days) === 1 ? '' : 's') : ''}</span>`;
    case 'due_soon': return `<span class="badge waiting"><span class="bd"></span>Due in ${days} day${days === 1 ? '' : 's'}</span>`;
    default: return `<span class="badge arrived"><span class="bd"></span>Active${days != null ? ' · ' + days + ' days left' : ''}</span>`;
  }
}

function astFiltered(ui){
  const q = ui.q.trim().toLowerCase();
  const rows = astState.rows.filter(r => (ui.filter === 'all' ? r.state !== 'archived' || !!q : r.state === ui.filter)
    && (!q || [r.name, r.owner_name, r.contact_email, r.contact_phone].some(v => String(v || '').toLowerCase().includes(q))));
  const key = ui.sort, dir = ui.dir;
  const val = r => key === 'price' ? Number(r.monthly_price == null ? -1 : r.monthly_price)
    : key === 'paid' ? (r.paid_through || '0000') : key === 'owed' ? Number(r.owed || 0)
    : key === 'state' ? ['past_due', 'due_soon', 'no_date', 'pending', 'trial', 'active', 'comp', 'cancelled', 'rejected', 'archived'].indexOf(r.state)
    : String(r.name || '').toLowerCase();
  return rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
}

function astRowHtml(r){
  const id = astEsc(r.org_id), archived = r.state === 'archived';
  const aiBlocks = r.voice_line === 'live' || r.voice_line === 'provisioning';
  const contact = [r.owner_name, r.contact_email].filter(Boolean).map(astEsc).join(' · ') || 'no contact on file';
  const facts = [r.contact_phone ? astEsc(r.contact_phone) : '', `${r.people} user${r.people === 1 ? '' : 's'}`, `${r.jobs_30d || 0} job${r.jobs_30d === 1 ? '' : 's'} in 30 days`].filter(Boolean).join(' · ');
  const since = r.created_at ? 'Joined ' + astDate(r.created_at) : '';
  const sel = (cls, opts, cur, label) => `<select class="ast-in ${cls}" data-org="${id}" aria-label="${label} for ${astEsc(r.name)}" ${archived ? 'disabled' : ''}>${opts.map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<tr class="ast-row" data-org="${id}" data-state="${astEsc(r.state)}">
    <td class="ast-shop" title="${astEsc(since)}"><div class="ast-name"><b>${astEsc(r.name)}</b>${aiBlocks ? ' <span class="ast-tag">AI line</span>' : ''}</div><div class="meta ast-contact">${contact}</div><div class="meta ast-facts">${facts}</div></td>
    <td class="ast-state">${astStateBadge(r)}</td>
    <td>${sel('ast-access', AST_ACCESS, r.access, 'Access')}</td>
    <td>${sel('ast-plan', AST_PLAN, r.billing_status, 'Plan status')}</td>
    <td class="num"><div class="ast-price"><span aria-hidden="true">$</span><input type="number" class="ast-in ast-price-in" data-org="${id}" min="0" max="100000" step="1" inputmode="decimal" value="${r.monthly_price == null ? '' : Number(r.monthly_price)}" placeholder="—" aria-label="Price per month for ${astEsc(r.name)}" ${archived ? 'disabled' : ''}></div></td>
    <td><div class="ast-paid"><input type="date" class="ast-in ast-paid-in" data-org="${id}" value="${astEsc(r.paid_through || '')}" aria-label="Paid through for ${astEsc(r.name)}" ${archived ? 'disabled' : ''}>
      ${archived ? '' : `<button type="button" class="ast-plus" data-plus="${id}" title="Add one month to the paid-through date">+1 mo</button>`}</div></td>
    <td class="ast-acts">
      <button type="button" class="ghost-btn ast-inv${Number(r.owed) ? ' owes' : ''}" data-billing="${id}">${Number(r.owed) ? astMoney(r.owed) + ' owed' : 'Invoices' + (r.invoices ? ' (' + r.invoices + ')' : '')}</button>
      <details class="row-more"><summary aria-label="More actions for ${astEsc(r.name)}">More</summary><div class="row-menu">
        ${archived ? `<button type="button" class="text-btn" data-shop-restore="${id}">Restore shop</button>`
                   : `<button type="button" class="text-btn" data-shop-archive="${id}" ${aiBlocks ? 'disabled title="Turn off the AI phone line first"' : ''}>Archive shop</button>`}
        <button type="button" class="text-btn danger" data-shop-delete="${id}">Delete permanently…</button>
      </div></details>
    </td></tr>`;
}

async function renderShopTable(boxId){
  const box = document.getElementById(boxId);
  if(!box || typeof session === 'undefined' || !session || session.role !== 'admin') return;
  if(!astState.loaded) box.innerHTML = '<div class="section-head"><h2>All shops</h2></div>' + (typeof skelRows === 'function' ? skelRows(4, { wide: true }) : '<p class="meta">Loading…</p>');
  const { data, error } = await sb.rpc('admin_shop_table');
  if(error){
    const missing = /admin_shop_table|schema cache|does not exist/i.test(error.message || '');
    box.innerHTML = `<div class="section-head"><h2>All shops</h2></div><p class="form-error">${missing ? 'This screen needs the database update 0065_shop_control.sql. Run it in Supabase → SQL Editor, then refresh.' : astEsc(error.message)}</p>`;
    return;
  }
  astState.rows = data || []; astState.loaded = true;
  if(typeof subState !== 'undefined') subState.rows = astState.rows;   // the billing sheet (subs.js) reads the shop from here
  astDraw(box, boxId);
}

function astDraw(box, boxId){
  document.querySelectorAll('body > .row-menu.ast-float').forEach(m => m.remove());   // a menu left open when the table is redrawn
  const ui = astUi(boxId), rows = astState.rows, n = k => rows.filter(r => r.state === k).length;
  const paying = rows.filter(r => ['active', 'due_soon', 'past_due'].includes(r.state));
  const mrr = paying.reduce((s, r) => s + Number(r.monthly_price || 0), 0);
  const owed = rows.reduce((s, r) => s + Number(r.owed || 0), 0);
  const shown = astFiltered(ui);
  const sortTh = (key, label, cls) => `<th class="${cls || ''}"><button type="button" class="ast-sort${ui.sort === key ? ' on' : ''}" data-sort="${key}" aria-label="Sort by ${label}">${label}${ui.sort === key ? (ui.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  box.innerHTML = `<div class="section-head"><h2>All shops</h2><span class="meta">${rows.length} shop${rows.length === 1 ? '' : 's'} · ${n('archived')} archived</span></div>
    <div class="ast-kpis">
      <div class="ast-kpi"><em>Monthly revenue</em><b>${astMoney(mrr)}</b><span>${paying.length} paying shop${paying.length === 1 ? '' : 's'}</span></div>
      <div class="ast-kpi${n('past_due') ? ' bad' : ''}"><em>Past due</em><b>${n('past_due')}</b><span>${n('due_soon')} due in 7 days</span></div>
      <div class="ast-kpi"><em>Trials</em><b>${n('trial')}</b><span>${n('comp')} complimentary</span></div>
      <div class="ast-kpi${n('pending') ? ' warn' : ''}"><em>Waiting for approval</em><b>${n('pending')}</b><span>${n('rejected')} rejected</span></div>
      <div class="ast-kpi${owed ? ' bad' : ''}"><em>Owed to Relay</em><b>${astMoney(owed)}</b><span>unpaid invoices</span></div>
    </div>
    <div class="ast-tools">
      <input type="search" class="ast-search" id="astSearch_${boxId}" placeholder="Search shop, owner, email or phone" value="${astEsc(ui.q)}" aria-label="Search shops">
      <div class="fd-dates ast-filters" role="group" aria-label="Filter shops">
        ${AST_FILTERS.map(([k, l]) => { const c = k === 'all' ? rows.filter(r => r.state !== 'archived').length : n(k);
          return (k === 'all' || c) ? `<button type="button" class="fd-chip${ui.filter === k ? ' active' : ''}" data-astfilter="${k}" aria-pressed="${ui.filter === k}">${l} <span class="ast-count">${c}</span></button>` : ''; }).join('')}
      </div>
    </div>
    <div class="cw-wrap ast-wrap"><table class="cw-table ast-table"><thead><tr>
      ${sortTh('name', 'Shop')}${sortTh('state', 'Status')}<th>Access</th><th>Plan</th>${sortTh('price', 'Price / month', 'num')}${sortTh('paid', 'Paid through')}${sortTh('owed', 'Invoices')}
    </tr></thead><tbody>
      ${shown.length ? shown.map(astRowHtml).join('') : `<tr><td colspan="7"><div class="empty-note">No shops match.${ui.q || ui.filter !== 'all' ? ' <button type="button" class="link" data-astclear="1">Show all shops</button>' : ''}</div></td></tr>`}
    </tbody></table></div>
    <p class="meta ast-help">Changes save as soon as you make them. <b>Plan</b> decides whether the shop can open new work: Trial, Active and Complimentary can; Cancelled cannot; Active and Past due stop 7 days after the paid-through date. <b>Archive</b> switches the shop and its people off without deleting anything.</p>`;
  astWire(box, boxId);
}

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

function astWire(box, boxId){
  const ui = astUi(boxId);
  const redraw = () => astDraw(box, boxId);
  const reload = () => renderShopTable(boxId);
  const rowOf = org => astState.rows.find(r => r.org_id === org) || {};
  const search = box.querySelector('.ast-search'); let t = null;
  if(search) search.oninput = () => { clearTimeout(t); t = setTimeout(() => { ui.q = search.value; redraw(); const s = box.querySelector('.ast-search'); if(s){ s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 200); };
  box.querySelectorAll('[data-astfilter]').forEach(b => b.onclick = () => { ui.filter = b.dataset.astfilter; redraw(); });
  box.querySelectorAll('[data-astclear]').forEach(b => b.onclick = () => { ui.filter = 'all'; ui.q = ''; redraw(); });
  box.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { const k = b.dataset.sort; ui.dir = ui.sort === k ? -ui.dir : 1; ui.sort = k; redraw(); });

  box.querySelectorAll('.ast-access').forEach(s => s.onchange = async () => {
    const r = rowOf(s.dataset.org), to = s.value;
    const words = { approved: `Approve ${r.name}? Its people can sign in and start working.`, pending: `Move ${r.name} back to "not approved"? Its people will see the waiting screen until you approve it again.`, rejected: `Reject ${r.name}? Its people will see a rejection message when they sign in.` };
    if(!(await relayConfirm({ message: words[to], confirmText: AST_ACCESS.find(a => a[0] === to)[1], danger: to !== 'approved' }))){ s.value = r.access; return; }
    if(await astSave(s.dataset.org, { p_access: to }, 'Access changed')) reload(); else s.value = r.access;
  });
  box.querySelectorAll('.ast-plan').forEach(s => s.onchange = async () => {
    const r = rowOf(s.dataset.org), to = s.value;
    if(to === 'cancelled' && !(await relayConfirm({ message: `Cancel ${r.name}'s plan? The shop keeps its data but cannot open new work orders, estimates or invoices until the plan is active again.`, confirmText: 'Cancel plan', danger: true }))){ s.value = r.billing_status; return; }
    if(await astSave(s.dataset.org, { p_billing_status: to }, 'Plan changed')) reload(); else s.value = r.billing_status;
  });
  box.querySelectorAll('.ast-price-in').forEach(inp => {
    const commit = async () => {
      const r = rowOf(inp.dataset.org), was = r.monthly_price == null ? '' : String(Number(r.monthly_price));
      if(inp.value === was) return;
      if(inp.value === ''){ inp.value = was; if(typeof relayNotice === 'function') relayNotice('A price can be changed but not removed. Set Plan to Complimentary for a shop that does not pay.'); return; }
      const v = Number(inp.value);
      if(!(v >= 0 && v <= 100000)){ inp.value = was; if(typeof relayNotice === 'function') relayNotice('That price looks wrong.', { kind: 'error' }); return; }
      if(await astSave(inp.dataset.org, { p_price: v }, 'Price saved')){ r.monthly_price = v; } else inp.value = was;
    };
    inp.onchange = commit;
    inp.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); inp.blur(); } };
  });
  box.querySelectorAll('.ast-paid-in').forEach(inp => inp.onchange = async () => {
    const r = rowOf(inp.dataset.org), was = r.paid_through || '';
    const ok = inp.value ? await astSave(inp.dataset.org, { p_paid_through: inp.value }, 'Paid-through date saved')
                         : ((await relayConfirm({ message: `Clear ${r.name}'s paid-through date?`, confirmText: 'Clear date' })) && await astSave(inp.dataset.org, { p_clear_paid_through: true }, 'Date cleared'));
    if(ok) reload(); else inp.value = was;
  });
  box.querySelectorAll('[data-plus]').forEach(b => b.onclick = async () => {
    const r = rowOf(b.dataset.plus), next = astAddMonths(r.paid_through, 1);
    b.disabled = true;
    const patch = { p_paid_through: next };
    if(['trial', 'past_due', 'cancelled'].includes(r.billing_status)) patch.p_billing_status = 'active';   // paying a month makes the plan active
    if(await astSave(b.dataset.plus, patch, `Paid through ${astDate(next)}`)) reload(); else b.disabled = false;
  });
  // The More menu is lifted out of the table while open (the table scrolls sideways and sits on glass,
  // either of which would clip or misplace it), placed under its button, and put back when it closes.
  box.querySelectorAll('.ast-acts details').forEach(dt => {
    const menu = dt.querySelector('.row-menu'); if(!menu) return;
    dt.addEventListener('toggle', () => {
      if(!dt.open){ menu.classList.remove('ast-float'); menu.style.cssText = ''; dt.appendChild(menu); return; }
      astCloseMenus(dt);
      const r = dt.querySelector('summary').getBoundingClientRect();
      document.body.appendChild(menu); menu.classList.add('ast-float');
      menu.style.left = Math.max(8, Math.min(window.innerWidth - 216, r.right - 200)) + 'px';
      const below = window.innerHeight - r.bottom > 140;
      menu.style.top = below ? (r.bottom + 4) + 'px' : 'auto'; menu.style.bottom = below ? 'auto' : (window.innerHeight - r.top + 4) + 'px';
    });
  });
  if(!astState.closer){ astState.closer = true;
    window.addEventListener('scroll', e => { if(!(e.target && e.target.closest && e.target.closest('.ast-float'))) astCloseMenus(); }, true);
    window.addEventListener('resize', () => astCloseMenus());
    document.addEventListener('click', e => { if(!e.target.closest || !(e.target.closest('.ast-acts details') || e.target.closest('.ast-float'))) astCloseMenus(); });
  }
  box.querySelectorAll('[data-billing]').forEach(b => b.onclick = () => { if(typeof openShopBilling === 'function') openShopBilling(b.dataset.billing); });
  box.querySelectorAll('[data-shop-archive]').forEach(b => b.onclick = async () => { astCloseMenus(); if(typeof archiveShop === 'function') await archiveShop(b.dataset.shopArchive, rowOf(b.dataset.shopArchive).name); });
  box.querySelectorAll('[data-shop-restore]').forEach(b => b.onclick = async () => { astCloseMenus(); if(typeof restoreShop === 'function') await restoreShop(b.dataset.shopRestore, rowOf(b.dataset.shopRestore).name); });
  box.querySelectorAll('[data-shop-delete]').forEach(b => b.onclick = () => { astCloseMenus(); const r = rowOf(b.dataset.shopDelete); if(typeof openDeleteShop === 'function') openDeleteShop(r.org_id, r.name, r.state === 'archived'); });
}

function astCloseMenus(except){
  document.querySelectorAll('.ast-acts details[open]').forEach(o => { if(o !== except) o.open = false; });   // each one puts its menu back
}

// Both screens draw this table, and anything that changes a shop redraws whichever one is open.
function refreshShopTables(){
  ['adminShopsBox', 'adminSubsBox'].forEach(id => { const b = document.getElementById(id); if(b && b.childElementCount) renderShopTable(id); });
}
