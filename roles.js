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
    sb.from('profiles').select('id, name, role, staff_role, active').eq('org_id', session.orgId).in('role', ['shop','mechanic']).order('name'),
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

// ---------------- Shop mechanics (records only) ----------------
// A shop keeps its own list of mechanics. They have no RelayFleet login, are not assigned to jobs
// and do not clock time here. Only the shop's own staff can read or add them (migration 0062).
let rosterEditing = null;   // null = form closed, 'new' = adding, a number = editing that record
async function renderRosterCard(){
  if(!can('team') || !session || !session.orgId) return;
  let host = document.getElementById('teamRoster');
  if(!host){ const slot = document.getElementById('teamList'); if(!slot) return; host = document.createElement('div'); host.id = 'teamRoster'; slot.appendChild(host); }
  const { data, error } = await sb.from('shop_roster').select('id, name, phone, note, active').eq('org_id', session.orgId).order('name');
  if(error){ host.innerHTML = `<div class="team-subhead">Shop mechanics</div><p class="form-error">${esc(error.message)}</p>`; return; }
  const rows = data || [];
  const editing = typeof rosterEditing === 'number' ? rows.find(r => r.id === rosterEditing) : null;
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const formHtml = rosterEditing === null ? '' : `
    <form id="rosterForm" class="roster-form" novalidate>
      <div class="roster-form-head"><b>${editing ? 'Edit shop mechanic' : 'New shop mechanic'}</b><span class="meta">No RelayFleet account needed</span></div>
      <div class="roster-grid">
        <div class="field"><label for="rosterName">Full name</label><input id="rosterName" maxlength="120" placeholder="e.g. Mike Johnson" value="${esc(editing ? editing.name : '')}"></div>
        <div class="field"><label for="rosterPhone">Phone (optional)</label><input id="rosterPhone" type="tel" maxlength="40" inputmode="tel" placeholder="e.g. (555) 123-4567" value="${esc(editing && editing.phone || '')}"></div>
        <div class="field roster-wide"><label for="rosterNote">Note (optional)</label><input id="rosterNote" maxlength="500" placeholder="e.g. Trailer specialist, day shift" value="${esc(editing && editing.note || '')}"></div>
      </div>
      <p class="form-error" id="rosterErr"></p>
      <div class="roster-actions"><button type="button" class="ghost-btn" id="rosterCancel">Cancel</button><button type="submit" class="roster-save">${editing ? 'Save changes' : 'Add mechanic'}</button></div>
    </form>`;
  host.innerHTML = `
    <div class="roster-head">
      <div><div class="team-subhead">Shop mechanics <span class="roster-count">${rows.length}</span></div>
        <p class="meta roster-sub">Mechanics who work in your shop but do not use Relay. For your records only — they have no login. Mobile technicians join with the invite code above.</p></div>
      ${rosterEditing === null ? '<button type="button" class="roster-save" id="rosterAddBtn">+ Add mechanic</button>' : ''}
    </div>
    ${formHtml}
    ${rows.length ? rows.map(r => `<div class="team-row roster-row${r.active ? '' : ' is-inactive'}">
        <div class="roster-who"><span class="roster-avatar" aria-hidden="true">${esc(initials(r.name))}</span>
          <div><div class="tname">${esc(r.name)}</div><div class="tstatus">Shop mechanic — ${r.active ? 'Active' : 'Inactive'}${r.phone ? ' · ' + esc(r.phone) : ''}</div>${r.note ? `<div class="roster-note">${esc(r.note)}</div>` : ''}</div></div>
        <div class="roster-ctl"><button type="button" class="text-btn" data-roster-edit="${r.id}">Edit</button>
          <button type="button" class="toggle-btn ${r.active ? 'on' : 'off'}" data-roster-toggle="${r.id}" data-on="${r.active}">${r.active ? 'Active' : 'Inactive'}</button></div>
      </div>`).join('') : (rosterEditing === null ? '<div class="empty-note">No shop mechanics yet. Add the people who work in your shop to keep your team list complete.</div>' : '')}
    <p class="form-error" id="rosterListErr"></p>`;
  const addBtn = document.getElementById('rosterAddBtn');
  if(addBtn) addBtn.onclick = () => { rosterEditing = 'new'; renderRosterCard().then(() => { const n = document.getElementById('rosterName'); if(n) n.focus(); }); };
  const form = document.getElementById('rosterForm');
  if(form){
    document.getElementById('rosterCancel').onclick = () => { rosterEditing = null; renderRosterCard(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('rosterErr'); err.textContent = '';
      const name = document.getElementById('rosterName').value.trim();
      if(!name){ err.textContent = "Enter the mechanic's name."; return; }
      const phone = document.getElementById('rosterPhone').value.trim() || null;
      const note = document.getElementById('rosterNote').value.trim() || null;
      const res = editing
        ? await sb.from('shop_roster').update({ name, phone, note }).eq('id', editing.id)
        : await sb.from('shop_roster').insert({ org_id: session.orgId, name, phone, note, created_by: session.id });
      if(res.error){ err.textContent = res.error.message; return; }
      recordsToast(editing ? 'Mechanic updated' : 'Mechanic added');
      rosterEditing = null; renderRosterCard();
    };
  }
  host.querySelectorAll('[data-roster-edit]').forEach(b => b.onclick = () => { rosterEditing = Number(b.dataset.rosterEdit); renderRosterCard().then(() => { const n = document.getElementById('rosterName'); if(n) n.focus(); }); });
  host.querySelectorAll('[data-roster-toggle]').forEach(b => b.onclick = async () => {
    const on = b.dataset.on === 'true';
    const { error: upErr } = await sb.from('shop_roster').update({ active: !on }).eq('id', b.dataset.rosterToggle);
    if(upErr){ document.getElementById('rosterListErr').textContent = upErr.message; return; }
    renderRosterCard();
  });
}

function initRolesUI(){
  applyRoleUI();
  document.querySelectorAll('.dash-tab[data-target="shop-team"]').forEach(t => t.addEventListener('click', renderRolesPanel));
  renderRolesPanel();
}
