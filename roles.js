// ============================================================
// RelayFleet — Phase 10: office roles and fleet users in the app.
// The database enforces every permission (staff_can); this file only
// keeps people from seeing tabs and buttons their role cannot use, and
// gives the owner a place to set roles.
// ============================================================

// Mirrors public.staff_can() in migration 0022: two shop roles.
// Owner and Office staff can use every feature; only the owner manages the team.
// (Old role names still cached in an open tab count as Office staff.)
const STAFF_LABEL = { owner:'Owner', office:'Office staff' };
function can(cap){
  if(!session) return false;
  if(session.role === 'admin') return true;
  if(session.role !== 'shop') return false;
  if((session.staffRole || 'owner') === 'owner') return true;
  return cap !== 'team';
}
const TAB_CAPS = { 'shop-invoices':'billing', 'shop-inventory':'inventory', 'shop-analytics':'analytics', 'shop-billing':'settings', 'shop-team':'team' };

function applyRoleUI(){
  if(!session) return;
  if(session.role === 'shop'){
    Object.entries(TAB_CAPS).forEach(([panel, cap]) => {
      const allowed = can(cap);
      document.querySelectorAll(`.dash-tab[data-target="${panel}"]`).forEach(t => t.classList.toggle('hidden', !allowed));
      const p = document.getElementById(panel);
      if(!allowed && p && !p.classList.contains('hidden')){
        const home = document.querySelector('.dash-tab[data-target="shop-overview"]');
        if(home) home.click();
      }
    });
  }
  if(session.role === 'fleet'){
    const fu = session.staffRole === 'fleet_user';
    document.querySelectorAll('#fleetView .fleet-tab[data-ftab="invoices"]').forEach(t => t.classList.toggle('hidden', fu));
  }
}

// ---------------- Team page: office staff and roles ----------------
async function renderRolesPanel(){
  const box = document.getElementById('teamRoles');
  if(!box) return;
  if(!can('team')){ box.innerHTML = ''; return; }
  const [staffRes, linkRes] = await Promise.all([
    sb.from('profiles').select('id, name, role, staff_role, active').eq('org_id', session.orgId).in('role', ['shop','mechanic']).is('deleted_at', null).order('name'),
    sb.from('fleet_shop_links').select('profiles:fleet_id(id, name, company, staff_role, active)').eq('org_id', session.orgId)
  ]);
  const people = staffRes.data || [];
  const fleets = (linkRes.data || []).map(l => l.profiles).filter(Boolean);
  const amOwner = session.staffRole === 'owner' || session.role === 'admin';
  const roleOf = p => p.role === 'mechanic' ? 'mechanic' : (p.staff_role === 'owner' || !p.staff_role ? 'owner' : 'office');
  const select = p => {
    const r = roleOf(p);
    if(p.id === session.id) return `<span class="rec-tag">${esc(STAFF_LABEL[r] || 'Mechanic')} (you)</span>`;
    if(r === 'owner') return '<span class="rec-tag">Owner</span>';
    const opts = [['office','Office staff'], ['mechanic','Mechanic']];
    return `<select class="role-select" data-id="${p.id}" aria-label="Role for ${esc(p.name)}" ${amOwner ? '' : 'disabled'}>${opts.map(([v, l]) => `<option value="${v}" ${v === r ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  };
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Office staff &amp; roles</h2></div>
    <div class="card">
      <p class="meta" style="margin-top:0;">New staff join with the mechanic invite code; then set their role here.
        <b>Office staff</b> can use every feature of Relay, the same as the owner. Only the owner changes roles and deactivates people.
        <b>Mechanics</b> see their own jobs on their phone.</p>
      <div class="role-list">${people.map(p => `<div class="role-row${p.active ? '' : ' is-inactive'}"><div><b>${esc(p.name)}</b>${p.active ? '' : ' <span class="meta">(deactivated)</span>'}</div>
        <div class="role-ctl">${select(p)}${p.role === 'shop' && roleOf(p) !== 'owner' && p.id !== session.id ? `<button type="button" class="text-btn" data-staff-active="${p.id}" data-on="${p.active}">${p.active ? 'Deactivate' : 'Reactivate'}</button>` : ''}</div></div>`).join('')}</div>
      ${fleets.length ? `<h4 class="rec-subhead">Fleet accounts</h4><p class="meta">A <b>fleet user</b> follows their repairs and units but does not see estimates, invoices or prices.</p>
      <div class="role-list">${fleets.map(f => `<div class="role-row"><div><b>${esc(f.name)}</b> <span class="meta">${esc(f.company || '')}</span></div>
        <div class="role-ctl"><select class="role-select" data-id="${f.id}" aria-label="Role for ${esc(f.name)}"><option value="fleet_manager" ${f.staff_role !== 'fleet_user' ? 'selected' : ''}>Fleet manager</option><option value="fleet_user" ${f.staff_role === 'fleet_user' ? 'selected' : ''}>Fleet user</option></select></div></div>`).join('')}</div>` : ''}
      <p class="form-error" id="rolesErr"></p>
    </div>`;
  box.querySelectorAll('.role-select').forEach(sel => sel.onchange = async () => {
    const err = document.getElementById('rolesErr'); err.textContent = '';
    const { error } = await sb.rpc('set_team_role', { p_profile: sel.dataset.id, p_staff_role: sel.value });
    if(error){ err.textContent = error.message; renderRolesPanel(); return; }
    recordsToast('Role updated');
    renderRolesPanel();
    if(typeof renderTeamList === 'function') renderTeamList();
  });
  box.querySelectorAll('[data-staff-active]').forEach(b => b.onclick = async () => {
    const on = b.dataset.on === 'true';
    if(on && !(await relayConfirm({ message: 'Deactivate this person? They are signed out and cannot use Relay until reactivated.', confirmText: 'Deactivate', danger: true }))) return;
    const { error } = await sb.from('profiles').update({ active: !on }).eq('id', b.dataset.staffActive);
    if(error){ document.getElementById('rolesErr').textContent = error.message; return; }
    renderRolesPanel();
  });
}

// ---------------- Mechanics the shop adds itself (no login) ----------------
// The owner can add a mechanic who does not use Relay. They are a normal mechanic in the list and on
// work orders, with no way to sign in. The record is made on the server (team-mechanic function, migration 0063).
let mechFormFor = null;   // null = closed, 'new' = adding, a profile id = editing that mechanic
let mechImportTried = false;
async function saveShopMechanic(payload){
  const { data, error } = await sb.functions.invoke('team-mechanic', { body: payload });
  let serverMsg = '';
  if(error && error.context && typeof error.context.json === 'function'){
    try { const b = await error.context.json(); serverMsg = (b && b.error) || ''; } catch(e){}
  }
  const msg = error ? (serverMsg || error.message || 'Something went wrong') : (data && data.error);
  return msg ? { error: msg } : { data };
}
function initMechAdd(mechanics){
  if(!session || session.role !== 'shop' || !can('team')) return;
  const btn = document.getElementById('mechAddBtn'), slot = document.getElementById('mechAddForm');
  if(!btn || !slot) return;
  const refresh = () => { renderTeamList(); if(typeof populateMechanicSelect === 'function') populateMechanicSelect(); };
  const draw = () => {
    const editing = mechFormFor && mechFormFor !== 'new' ? (mechanics || []).find(m => m.id === mechFormFor) : null;
    if(mechFormFor && mechFormFor !== 'new' && !editing) mechFormFor = null;
    btn.classList.toggle('hidden', mechFormFor !== null);
    if(mechFormFor === null){ slot.innerHTML = ''; return; }
    slot.innerHTML = `<form id="mechForm" class="roster-form" novalidate>
      <div class="roster-form-head"><b>${editing ? 'Edit mechanic' : 'Add a mechanic'}</b><span class="meta">No Relay account needed. You assign their work orders; they do not sign in.</span></div>
      <div class="roster-grid">
        <div class="field"><label for="mechName">Full name</label><input id="mechName" maxlength="120" placeholder="e.g. Mike Johnson" value="${esc(editing ? editing.name : '')}"></div>
        <div class="field"><label for="mechPhone">Phone (optional)</label><input id="mechPhone" type="tel" maxlength="40" inputmode="tel" placeholder="e.g. (555) 123-4567" value="${esc(editing && editing.phone || '')}"></div>
      </div>
      <p class="form-error" id="mechErr"></p>
      <div class="roster-actions"><button type="button" class="ghost-btn" id="mechCancel">Cancel</button><button type="submit" class="roster-save" id="mechSave">${editing ? 'Save changes' : 'Add mechanic'}</button></div>
    </form>`;
    document.getElementById('mechCancel').onclick = () => { mechFormFor = null; draw(); };
    document.getElementById('mechForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('mechErr'); err.textContent = '';
      const name = document.getElementById('mechName').value.trim();
      if(!name){ err.textContent = "Enter the mechanic's name."; return; }
      const save = document.getElementById('mechSave'); save.disabled = true;
      const payload = { name, phone: document.getElementById('mechPhone').value.trim() };
      const res = await saveShopMechanic(editing ? Object.assign(payload, { action: 'update', profile_id: editing.id }) : Object.assign(payload, { action: 'add' }));
      if(res.error){ save.disabled = false; err.textContent = res.error; return; }
      recordsToast(editing ? 'Mechanic updated' : name + ' added. You can assign work orders to them now.');
      mechFormFor = null; refresh();
    };
    const n = document.getElementById('mechName'); if(n) n.focus();
  };
  btn.onclick = () => { mechFormFor = 'new'; draw(); };
  // Delete for good. The server refuses while the mechanic still has open work orders.
  document.querySelectorAll('#teamList [data-mech-del]').forEach(b => b.onclick = async () => {
    const m = (mechanics || []).find(x => x.id === b.dataset.mechDel); if(!m) return;
    if(!(await relayConfirm({ message: `Delete ${m.name} permanently? Their login is removed and they disappear from your team and from every list. Work orders and time they already recorded stay in your records under their name. This cannot be undone.`, confirmText: 'Delete permanently', danger: true }))) return;
    b.disabled = true;
    const res = await saveShopMechanic({ action: 'delete', profile_id: m.id });
    if(res.error){ b.disabled = false; relayFail({ message: res.error }, 'Could not delete the mechanic'); return; }
    recordsToast(`${m.name} is deleted.`);
    refresh();
  });
  document.querySelectorAll('#teamList [data-mech-edit]').forEach(b => b.onclick = () => { mechFormFor = b.dataset.mechEdit; draw(); });
  draw();
  // Mechanics typed into the earlier "records" list become normal mechanics, once.
  if(!mechImportTried){
    mechImportTried = true;
    sb.from('shop_roster').select('id, name, phone').eq('org_id', session.orgId).eq('active', true).is('profile_id', null).then(async ({ data }) => {
      let moved = 0;
      for(const r of (data || [])){ const res = await saveShopMechanic({ action: 'add', name: r.name, phone: r.phone || '', roster_id: r.id }); if(!res.error) moved++; }
      if(moved) refresh();
    });
  }
}

function initRolesUI(){
  applyRoleUI();
  document.querySelectorAll('.dash-tab[data-target="shop-team"]').forEach(t => t.addEventListener('click', renderRolesPanel));
  renderRolesPanel();
}
