// ============================================================
// RelayFleet — R8 multi-location: one company, several shop yards.
// The switcher (shown once there are 2+ yards) filters the Dashboard,
// Work orders, Dispatch, Shop floor and Profitability. Everyone in the
// company can still see every yard — it's a view, not a wall.
// ============================================================
let relayLocations = [];
function currentLocationId(){
  if(!session || !['shop','admin'].includes(session.role) || relayLocations.length < 2) return null;
  let v = null; try { v = localStorage.getItem('relay.loc.' + session.orgId); } catch(_){}
  const id = Number(v);
  return id && relayLocations.some(l => l.id === id) ? id : null;
}
function locFilter(q){ const id = currentLocationId(); return id ? q.eq('location_id', id) : q; }
function shopLocName(id){ const l = relayLocations.find(x => x.id === id); return l ? l.name : ''; }
async function loadLocations(){
  if(!session || !session.orgId) { relayLocations = []; return; }
  const { data } = await sb.from('shop_locations').select('id, name, address, phone, position, active').eq('org_id', session.orgId).order('position').order('id');
  relayLocations = (data || []).filter(l => l.active);
  window.relayAllLocations = data || [];
}
function renderLocSwitch(){
  let wrap = document.getElementById('locSwitchWrap');
  const show = ['shop','admin'].includes(session.role) && relayLocations.length >= 2;
  if(!show){ if(wrap) wrap.remove(); return; }
  if(!wrap){
    const anchor = document.getElementById('gSearchWrap');
    if(!anchor) return;
    anchor.insertAdjacentHTML('afterend', '<div id="locSwitchWrap" class="loc-switch"><select id="locSwitch" aria-label="Location"></select></div>');
    wrap = document.getElementById('locSwitchWrap');
  }
  const cur = currentLocationId();
  document.getElementById('locSwitch').innerHTML = `<option value="">All locations</option>` + relayLocations.map(l => `<option value="${l.id}" ${l.id === cur ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  document.getElementById('locSwitch').onchange = (e) => {
    try { localStorage.setItem('relay.loc.' + session.orgId, e.target.value); } catch(_){}
    renderLocFormField();
    if(typeof refreshCurrentView === 'function') refreshCurrentView();
    if(typeof refreshDispatch === 'function' && typeof panelVisible === 'function' && panelVisible('shop-dispatch')) refreshDispatch();
    if(typeof refreshShopFloor === 'function' && typeof panelVisible === 'function' && panelVisible('shop-floor')) refreshShopFloor();
    if(typeof refreshAnalyticsV2 === 'function' && typeof panelVisible === 'function' && panelVisible('shop-analytics')) refreshAnalyticsV2();
  };
}
// New work order form: which yard (only when there are 2+)
function renderLocFormField(){
  const form = document.querySelector('#woCreateBox .new-job-form, .new-job-form');
  let f = document.getElementById('njShopLocField');
  if(relayLocations.length < 2){ if(f) f.remove(); return; }
  if(!f && form){
    const anchor = document.getElementById('njCustomer');
    const field = anchor ? anchor.closest('.field') : null;
    (field || form.firstElementChild).insertAdjacentHTML('beforebegin', '<div class="field" id="njShopLocField"><label>Location</label><select id="njShopLoc"></select></div>');
  }
  const sel = document.getElementById('njShopLoc'); if(!sel) return;
  const cur = currentLocationId();
  sel.innerHTML = relayLocations.map(l => `<option value="${l.id}" ${l.id === cur ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
}
// Work order: show and change the yard
async function loadWoLocation(job){
  const box = document.getElementById('woLocBox');
  if(!box) return;
  if(relayLocations.length < 2 && window.relayAllLocations && window.relayAllLocations.length < 2){ box.classList.add('hidden'); return; }
  const isShop = session.role === 'shop' || session.role === 'admin';
  box.classList.remove('hidden');
  box.innerHTML = `<h4>Location</h4>${isShop && !isClosedStatus(job.status) ? `<div class="ro-status-row"><select id="woLoc">${relayLocations.map(l => `<option value="${l.id}" ${l.id === job.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select><button type="button" id="woLocSave">Move</button></div>`
    : `<p>${esc(shopLocName(job.location_id) || '—')}</p>`}`;
  const b = document.getElementById('woLocSave');
  if(b) b.onclick = async () => {
    const id = Number(document.getElementById('woLoc').value);
    if(id === job.location_id) return;
    const { error } = await sb.from('jobs').update({ location_id: id, bay_id: null }).eq('id', job.id);
    if(error){ alert(error.message); return; }
    job.location_id = id; recordsToast('Moved to ' + shopLocName(id)); if(typeof refreshCurrentView === 'function') refreshCurrentView();
  };
}
// Settings: locations
async function renderLocationSettings(){
  const box = document.getElementById('locSettings');
  if(!box || !(typeof can !== 'function' || can('settings'))) return;
  await loadLocations();
  const all = window.relayAllLocations || [];
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Locations</h2></div><div class="card new-job-form" style="max-width:640px;">
    <p class="meta" style="margin-top:0;">Run more than one yard? Add each location. Work orders, bays and stock belong to a location, and a switcher at the top lets you view one yard or all of them.</p>
    ${all.map(l => `<div class="ro-inv loc-row"><div><b>${esc(l.name)}</b>${l.active ? '' : ' <span class="rec-tag">Hidden</span>'}<div class="meta">${esc([l.address, l.phone].filter(Boolean).join(' · ') || 'No address')}</div></div>
      <button type="button" class="text-btn" data-locedit="${l.id}">Edit</button>${all.filter(x => x.active).length > 1 || !l.active ? `<button type="button" class="text-btn" data-loctog="${l.id}" data-on="${l.active}">${l.active ? 'Hide' : 'Show'}</button>` : ''}</div>`).join('')}
    <div id="locForm"></div><button type="button" class="ghost-btn" id="locAdd">+ Add location</button><p class="form-error" id="locErr"></p></div>`;
  const form = (l) => {
    document.getElementById('locForm').innerHTML = `<div class="rec-grid"><div class="field"><label>Name *</label><input id="lfName" maxlength="80" value="${l ? esc(l.name) : ''}" placeholder="e.g. San Diego yard"></div>
      <div class="field"><label>Phone</label><input id="lfPhone" maxlength="40" value="${l && l.phone ? esc(l.phone) : ''}"></div>
      <div class="field rec-span"><label>Address</label><input id="lfAddr" maxlength="200" value="${l && l.address ? esc(l.address) : ''}"></div></div>
      <div class="job-actions"><button type="button" id="lfSave">${l ? 'Save' : 'Add location'}</button></div>`;
    document.getElementById('lfSave').onclick = async () => {
      const row = { name: document.getElementById('lfName').value.trim(), phone: document.getElementById('lfPhone').value.trim() || null, address: document.getElementById('lfAddr').value.trim() || null };
      const err = document.getElementById('locErr');
      if(!row.name){ err.textContent = 'Enter a name.'; return; }
      const res = l ? await sb.from('shop_locations').update(row).eq('id', l.id) : await sb.from('shop_locations').insert([{ ...row, org_id: session.orgId, position: all.length + 1 }]);
      if(res.error){ err.textContent = res.error.code === '23505' ? 'You already have a location with that name.' : res.error.message; return; }
      recordsToast(l ? 'Location saved' : 'Location added'); await afterLocationsChange();
    };
  };
  document.getElementById('locAdd').onclick = () => form(null);
  box.querySelectorAll('[data-locedit]').forEach(b => b.onclick = () => form(all.find(l => l.id === Number(b.dataset.locedit))));
  box.querySelectorAll('[data-loctog]').forEach(b => b.onclick = async () => { await sb.from('shop_locations').update({ active: b.dataset.on !== 'true' }).eq('id', Number(b.dataset.loctog)); await afterLocationsChange(); });
}
async function afterLocationsChange(){ await loadLocations(); renderLocSwitch(); renderLocFormField(); renderLocationSettings(); if(typeof refreshCurrentView === 'function') refreshCurrentView(); }
async function initLocations(){
  await loadLocations();
  renderLocSwitch(); renderLocFormField();
  const st = document.getElementById('notifySettings');
  if(st && !document.getElementById('locSettings')) st.insertAdjacentHTML('beforebegin', '<div id="locSettings"></div>');
  document.querySelectorAll('.dash-tab[data-target="shop-billing"]').forEach(t => t.addEventListener('click', renderLocationSettings));
  renderLocationSettings();
}
