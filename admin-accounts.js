// ============================================================
// RelayFleet — Admin → Accounts. Every person with a login: name, the email they sign in
// with, and the company they belong to. Search, change role or company, turn the account on or
// off, delete it, or turn a deleted login back on. The actual sign-in removal runs on the server
// (admin-account function), because only the server can remove a login.
// ============================================================

let adminAccountsData = null;   // set by refreshAdminData (script.js) each time the Accounts screen loads
let adminAccountsQuery = '';

function accountCompanyLine(role, p, o){
  if(role === 'shop')     return 'Company: ' + o.orgName(p.org_id);
  if(role === 'mechanic') return 'Works for: ' + o.orgName(p.org_id);
  if(role === 'fleet')    return 'Customer of: ' + ((o.fleetShopsById[p.id] || []).join(', ') || o.orgName(p.org_id)) + ' · Company: ' + (p.company || '—');
  return 'Platform admin';
}

function accountRowHtml(p, o, role){
  const isMe = typeof session !== 'undefined' && session && session.id === p.id;
  const email = p.email ? esc(p.email) : '<span class="meta">no sign-in email on file</span>';
  return `
  <div class="account-row acct-row" data-id="${esc(p.id)}">
    <div class="acct-who">
      <div class="aname">${esc(p.name || 'No name')} ${p.active ? '' : '<span class="acct-off">Turned off</span>'}</div>
      <div class="acct-email">${email}</div>
      <div class="acct-co">${esc(accountCompanyLine(role, p, o))}</div>
    </div>
    <div class="acct-ctl">
      <select class="arole-select" aria-label="Role">
        <option value="mechanic" ${p.role==='mechanic'?'selected':''}>Mechanic</option>
        <option value="shop" ${p.role==='shop'?'selected':''}>Shop owner</option>
        <option value="fleet" ${p.role==='fleet'?'selected':''}>Fleet manager</option>
        <option value="admin" ${p.role==='admin'?'selected':''}>Admin</option>
      </select>
      <input type="text" class="acompany-input" aria-label="Company (fleet only)" placeholder="Company (fleet only)" value="${esc(p.company || '')}">
      <button type="button" class="toggle-btn ${p.active ? 'on' : 'off'}" data-active="${p.active ? 'true' : 'false'}">${p.active ? 'Active' : 'Turned off'}</button>
      <button type="button" class="j-edit acc-save">Save</button>
      ${p.active ? '' : '<button type="button" class="text-btn acc-restore">Turn login back on</button>'}
      <button type="button" class="text-btn danger acc-delete" ${isMe ? 'disabled title="You cannot delete your own account"' : ''}>Delete account</button>
    </div>
  </div>`;
}

function renderAdminAccounts(o){
  if(o) adminAccountsData = o;
  const box = document.getElementById('adminAccounts'); if(!box || !adminAccountsData) return;
  const d = adminAccountsData;
  const roleSel = document.getElementById('accountsRoleFilter');
  const role = roleSel ? roleSel.value : 'shop';
  const q = adminAccountsQuery.trim().toLowerCase();
  const rows = d.profiles
    .filter(p => p.role === role)
    .filter(p => !q || [p.name, p.email, p.company, d.orgName(p.org_id)].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

  box.innerHTML = `
    <div class="acct-tools">
      <input type="search" id="acctSearch" placeholder="Search by name, sign-in email or company" value="${esc(adminAccountsQuery)}" aria-label="Search accounts">
      <span class="meta">${rows.length} account${rows.length === 1 ? '' : 's'}</span>
    </div>
    ${rows.map(p => accountRowHtml(p, d, role)).join('') || '<div class="empty-note">No accounts match.</div>'}`;

  const search = document.getElementById('acctSearch');
  search.oninput = () => {
    adminAccountsQuery = search.value;
    renderAdminAccounts();
    const again = document.getElementById('acctSearch');
    if(again){ again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  };
  if(roleSel) roleSel.onchange = () => renderAdminAccounts();

  box.querySelectorAll('.account-row').forEach(row => {
    const id = row.dataset.id;
    const p = d.profiles.find(x => x.id === id);
    row.querySelector('.toggle-btn').onclick = async (e) => {
      const newActive = e.target.dataset.active !== 'true';
      const { error } = await sb.from('profiles').update({ active: newActive }).eq('id', id);
      if(error) relayFail(error, 'Could not change the account'); else refreshAdminData();
    };
    row.querySelector('.acc-save').onclick = async () => {
      const newRole = row.querySelector('.arole-select').value;
      const company = row.querySelector('.acompany-input').value.trim();
      const { error } = await sb.from('profiles').update({ role: newRole, company: newRole === 'fleet' ? company : null }).eq('id', id);
      if(error) relayFail(error, 'Could not update'); else refreshAdminData();
    };
    const restore = row.querySelector('.acc-restore');
    if(restore) restore.onclick = () => runAccountAction(id, 'restore', p);
    const del = row.querySelector('.acc-delete');
    if(!del.disabled) del.onclick = async () => {
      if(!(await relayConfirm({
        message: `Delete ${p ? p.name : 'this account'}? They will be signed out and cannot sign in again. If they have worked on jobs, invoices or time entries, Relay keeps that record and turns the login off instead, so the history stays correct.`,
        confirmText: 'Delete account', danger: true }))) return;
      runAccountAction(id, 'delete', p);
    };
  });
}

async function runAccountAction(profileId, action, p){
  const { data, error } = await sb.functions.invoke('admin-account', { body: { profile_id: profileId, action } });
  const msg = error ? (error.message || 'Something went wrong') : (data && data.error);
  if(msg){ relayFail({ message: msg }, action === 'restore' ? 'Could not turn the login back on' : 'Could not delete the account'); return; }
  const res = data || {};
  const name = res.name || (p && p.name) || 'Account';
  if(action === 'restore') recordsToast(`${name}'s login is back on.`);
  else if(res.result === 'disabled') recordsToast(`${name} has work history, so the record is kept and the login is turned off.`);
  else recordsToast(`${name} is deleted.`);
  refreshAdminData();
}
