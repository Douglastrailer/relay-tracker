// ============================================================
// RelayFleet — R8 multi-location: one company, several shop yards.
// The switcher (shown once there are 2+ yards) filters the Dashboard,
// Work orders, Dispatch, Shop floor and Profitability. Everyone in the
// company can still see every yard — it's a view, not a wall.
// ============================================================
let relayLocations = [];
// R10: no top-bar switcher. A location card on the Dashboard can "focus" one city
// (this session only); everything else shows all locations.
let locFocus = null;
function currentLocationId(){
  if(!session || !['shop','admin'].includes(session.role) || relayLocations.length < 2) return null;
  return locFocus && relayLocations.some(l => l.id === locFocus) ? locFocus : null;
}
function setLocFocus(id){
  locFocus = id || null;
  renderLocFocusBar(); renderLocFormField();
  if(typeof refreshCurrentView === 'function') refreshCurrentView();
  if(typeof refreshDispatch === 'function' && typeof panelVisible === 'function' && panelVisible('shop-dispatch')) refreshDispatch();
  if(typeof refreshShopFloor === 'function' && typeof panelVisible === 'function' && panelVisible('shop-floor')) refreshShopFloor();
  if(typeof refreshAnalyticsV2 === 'function' && typeof panelVisible === 'function' && panelVisible('shop-analytics')) refreshAnalyticsV2();
  renderLocOverview();
}
function renderLocFocusBar(){
  let bar = document.getElementById('locFocusBar');
  const id = currentLocationId();
  if(!id){ if(bar) bar.remove(); return; }
  if(!bar){
    const first = document.querySelector('#shopView .dash-panel');
    if(!first) return;
    first.parentElement.insertBefore(Object.assign(document.createElement('div'), { id:'locFocusBar', className:'loc-focus-bar' }), first);
    bar = document.getElementById('locFocusBar');
  }
  bar.innerHTML = `<span>Showing <b>${esc(shopLocName(id))}</b> only</span><button type="button" class="text-btn" id="locFocusAll">Show all locations</button>`;
  document.getElementById('locFocusAll').onclick = () => setLocFocus(null);
}
function locTag(id){
  if(relayLocations.length < 2 || currentLocationId() || !id) return '';
  return ` <span class="loc-tag">${esc(shopLocName(id))}</span>`;
}
function locFilter(q){ const id = currentLocationId(); return id ? q.eq('location_id', id) : q; }
function shopLocName(id){ const l = relayLocations.find(x => x.id === id); return l ? l.name : ''; }
async function loadLocations(){
  if(!session || !session.orgId) { relayLocations = []; return; }
  const { data } = await sb.from('shop_locations').select('id, name, address, phone, email, lat, lng, show_on_map, position, active').eq('org_id', session.orgId).order('position').order('id');
  relayLocations = (data || []).filter(l => l.active);
  window.relayAllLocations = data || [];
}
function renderLocSwitch(){ const w = document.getElementById('locSwitchWrap'); if(w) w.remove(); renderLocFocusBar(); }   // R10: replaced by the Dashboard overview
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
// Settings: locations — business profile, exact pin, show on the Relay map, who works where
async function renderLocationSettings(){
  const box = document.getElementById('locSettings');
  if(!box || !(typeof can !== 'function' || can('settings'))) return;
  await loadLocations();
  const all = window.relayAllLocations || [];
  const { data: people } = await sb.from('profiles').select('id, name, role, location_id').eq('org_id', session.orgId).eq('active', true).in('role', ['mechanic']).order('name');
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Locations</h2></div><div class="card new-job-form loc-settings">
    <p class="meta" style="margin-top:0;">Each location (shop or mobile service area) has its own address, phone and email, and a pin on the map. Fleet customers can find your locations on the Relay map.</p>
    ${all.map(l => `<div class="loc-set" data-id="${l.id}"><div class="loc-set-head"><b>${esc(l.name)}</b>${l.active ? '' : ' <span class="rec-tag">Hidden</span>'}${l.lat == null ? ' <span class="rec-tag warn">No pin yet</span>' : l.show_on_map ? ' <span class="rec-tag ok">On the map</span>' : ' <span class="rec-tag">Not on the map</span>'}
        <span class="loc-set-actions"><button type="button" class="text-btn" data-locedit="${l.id}">Edit</button>${all.filter(x => x.active).length > 1 || !l.active ? `<button type="button" class="text-btn" data-loctog="${l.id}" data-on="${l.active}">${l.active ? 'Hide' : 'Show'}</button>` : ''}</span></div>
        <div class="meta">${esc([l.address, l.phone, l.email].filter(Boolean).join(' · ') || 'No details yet')}</div>
        <div class="meta">Mechanics: ${esc((people || []).filter(p => p.location_id === l.id).map(p => p.name).join(', ') || 'none')}</div></div>`).join('')}
    <div id="locForm"></div><button type="button" class="ghost-btn" id="locAdd">+ Add location</button><p class="form-error" id="locErr"></p>
    ${(people || []).length && all.filter(x => x.active).length > 1 ? `<h3 class="loc-people-h">Who works where</h3>${people.map(p => `<div class="ro-inv tc-row"><span>${esc(p.name)}</span><select data-person="${p.id}" aria-label="Location for ${esc(p.name)}">${all.filter(x => x.active).map(x => `<option value="${x.id}" ${x.id === p.location_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>`).join('')}` : ''}
  </div>`;
  const form = (l) => {
    document.getElementById('locForm').innerHTML = `<div class="loc-edit"><div class="rec-grid">
      <div class="field"><label>Location name *</label><input id="lfName" maxlength="80" value="${l ? esc(l.name) : ''}" placeholder="e.g. Orlando FL"></div>
      <div class="field"><label>Phone</label><input id="lfPhone" maxlength="40" value="${l && l.phone ? esc(l.phone) : ''}"></div>
      <div class="field"><label>Email</label><input id="lfEmail" type="email" maxlength="254" value="${l && l.email ? esc(l.email) : ''}"></div>
      <div class="field rec-span"><label>Address</label><div class="loc-addr"><input id="lfAddr" maxlength="200" value="${l && l.address ? esc(l.address) : ''}" placeholder="Street, city, state ZIP"><button type="button" class="ghost-btn" id="lfFind">Find on map</button></div></div></div>
      <div class="loc-pinmap" id="lfMap"></div><p class="meta" id="lfPinNote">${l && l.lat != null ? 'Drag the pin to the exact spot if needed.' : 'Type the address and tap “Find on map”, or tap the map to drop the pin.'}</p>
      <label class="rec-check"><input type="checkbox" id="lfShow" ${!l || l.show_on_map ? 'checked' : ''}> Show this location on the Relay map (fleet customers can find it)</label>
      <div class="job-actions"><button type="button" id="lfSave">${l ? 'Save location' : 'Add location'}</button><button type="button" class="ghost-btn" id="lfCancel">Cancel</button></div></div>`;
    let pin = l && l.lat != null ? { lat: l.lat, lng: l.lng } : null, marker = null, map = null;
    if(window.L){
      map = L.map('lfMap').setView(pin ? [pin.lat, pin.lng] : [39.5, -98.35], pin ? 16 : 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap' }).addTo(map);
      const place = (ll) => { pin = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) }; if(marker) marker.setLatLng(ll); else { marker = L.marker(ll, { draggable:true }).addTo(map); marker.on('dragend', () => place(marker.getLatLng())); } document.getElementById('lfPinNote').textContent = `Pin set (${pin.lat}, ${pin.lng}). Drag it to the exact spot if needed.`; };
      if(pin) place(L.latLng(pin.lat, pin.lng));
      map.on('click', e => place(e.latlng));
      setTimeout(() => map.invalidateSize(), 60);
      document.getElementById('lfFind').onclick = async () => {
        const q = document.getElementById('lfAddr').value.trim(); if(!q) return;
        const note = document.getElementById('lfPinNote'); note.textContent = 'Looking up the address…';
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language':'en' } });
          const hits = await r.json();
          if(!hits.length){ note.textContent = "Couldn't find that address. Check it, or tap the map to drop the pin."; return; }
          const ll = L.latLng(Number(hits[0].lat), Number(hits[0].lon)); place(ll); map.setView(ll, 17);
          note.textContent = 'Found. Zoomed in — drag the pin onto your exact building or yard if it is a little off.';
        } catch(_){ note.textContent = "Address lookup isn't available right now — tap the map to drop the pin."; }
      };
    }
    document.getElementById('lfCancel').onclick = () => { document.getElementById('locForm').innerHTML = ''; };
    document.getElementById('lfSave').onclick = async () => {
      const err = document.getElementById('locErr'); err.textContent = '';
      const row = { name: document.getElementById('lfName').value.trim(), phone: document.getElementById('lfPhone').value.trim() || null, email: document.getElementById('lfEmail').value.trim() || null,
        address: document.getElementById('lfAddr').value.trim() || null, show_on_map: document.getElementById('lfShow').checked, lat: pin ? pin.lat : null, lng: pin ? pin.lng : null };
      if(!row.name){ err.textContent = 'Enter a name.'; return; }
      if(row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)){ err.textContent = 'Check the email address.'; return; }
      const res = l ? await sb.from('shop_locations').update(row).eq('id', l.id) : await sb.from('shop_locations').insert([{ ...row, org_id: session.orgId, position: all.length + 1 }]);
      if(res.error){ err.textContent = res.error.code === '23505' ? 'You already have a location with that name.' : res.error.message; return; }
      recordsToast(l ? 'Location saved' : 'Location added'); await afterLocationsChange();
    };
  };
  document.getElementById('locAdd').onclick = () => form(null);
  box.querySelectorAll('[data-locedit]').forEach(b => b.onclick = () => form(all.find(l => l.id === Number(b.dataset.locedit))));
  box.querySelectorAll('[data-loctog]').forEach(b => b.onclick = async () => { await sb.from('shop_locations').update({ active: b.dataset.on !== 'true' }).eq('id', Number(b.dataset.loctog)); await afterLocationsChange(); });
  box.querySelectorAll('[data-person]').forEach(sel => sel.onchange = async () => {
    const { error } = await sb.rpc('set_member_location', { p_profile: sel.dataset.person, p_location: Number(sel.value) });
    if(error){ document.getElementById('locErr').textContent = error.message; return; }
    recordsToast('Moved to ' + shopLocName(Number(sel.value))); renderLocOverview();
  });
}
async function afterLocationsChange(){ await loadLocations(); renderLocSwitch(); renderLocFormField(); renderLocationSettings(); renderLocOverview(); if(typeof refreshCurrentView === 'function') refreshCurrentView(); }
async function initLocations(){
  await loadLocations();
  renderLocSwitch(); renderLocFormField(); renderLocOverview();
  document.querySelectorAll('.dash-tab[data-target="shop-overview"]').forEach(t => t.addEventListener('click', renderLocOverview));
  const st = document.getElementById('notifySettings');
  if(st && !document.getElementById('locSettings')) st.insertAdjacentHTML('beforebegin', '<div id="locSettings"></div>');
  document.querySelectorAll('.dash-tab[data-target="shop-billing"]').forEach(t => t.addEventListener('click', renderLocationSettings));
  renderLocationSettings();
}

// ================= Dashboard: every location side by side =================
let locOverviewBusy = false;
async function renderLocOverview(){
  const ov = document.getElementById('shop-overview');
  if(!ov || !session || session.role !== 'shop' || relayLocations.length < 2){ const b = document.getElementById('locOverview'); if(b) b.remove(); return; }
  if(locOverviewBusy) return; locOverviewBusy = true;
  try {
    let box = document.getElementById('locOverview');
    if(!box){ const tiles = document.getElementById('todayTiles'); box = Object.assign(document.createElement('div'), { id:'locOverview', className:'section' }); (tiles ? tiles.parentElement : ov).insertBefore(box, tiles ? tiles.nextSibling : ov.firstChild); }
    const day0 = new Date(); day0.setHours(0, 0, 0, 0);
    const [act, done, inv, mech, live] = await Promise.all([
      sb.from('jobs').select('id, location_id, job_type, status').eq('org_id', session.orgId).not('status', 'in', '(complete,invoiced,paid,cancelled)'),
      sb.from('jobs').select('id, location_id').eq('org_id', session.orgId).gte('completed_at', day0.toISOString()),
      sb.from('invoices').select('total, status, jobs(location_id)').eq('org_id', session.orgId).eq('kind', 'invoice').gte('created_at', day0.toISOString()),
      sb.from('profiles').select('id, name, availability, location_id').eq('org_id', session.orgId).eq('role', 'mechanic').eq('active', true).order('name'),
      sb.from('locations').select('mechanic_id, updated_at, is_live')]);
    const liveSet = new Set((live.data || []).filter(l => l.is_live && Date.now() - new Date(l.updated_at).getTime() < 15 * 60000).map(l => l.mechanic_id));
    const focus = currentLocationId();
    const money = n => '$' + Math.round(n).toLocaleString();
    const cards = relayLocations.map(l => {
      const a = (act.data || []).filter(j => j.location_id === l.id);
      const road = a.filter(j => j.job_type === 'mobile').length;
      const waiting = a.filter(j => ['waiting_approval','waiting_parts'].includes(j.status)).length;
      const doneN = (done.data || []).filter(j => j.location_id === l.id).length;
      const rev = (inv.data || []).filter(i => i.status !== 'draft' && i.jobs && i.jobs.location_id === l.id).reduce((t, i) => t + Number(i.total || 0), 0);
      const ms = (mech.data || []).filter(m => m.location_id === l.id);
      const dot = m => liveSet.has(m.id) ? 'live' : (m.availability || 'offline');
      return `<button type="button" class="loc-card${focus === l.id ? ' on' : ''}" data-loc="${l.id}" aria-pressed="${focus === l.id}">
        <div class="loc-card-head"><b>${esc(l.name)}</b>${l.address ? `<span class="meta">${esc(l.address)}</span>` : ''}</div>
        <div class="loc-stats"><span><em>Open</em>${a.length}</span><span class="${road ? 'hot' : ''}"><em>Road calls</em>${road}</span><span class="${waiting ? 'warn' : ''}"><em>Waiting</em>${waiting}</span><span><em>Done today</em>${doneN}</span><span><em>Revenue today</em>${money(rev)}</span></div>
        <div class="loc-mechs">${ms.length ? ms.map(m => `<span class="loc-mech"><i class="dot dot-${esc(dot(m))}"></i>${esc(m.name)}</span>`).join('') : '<span class="meta">No mechanics assigned — Settings → Locations</span>'}</div>
      </button>`;
    }).join('');
    const unassigned = (mech.data || []).filter(m => !relayLocations.some(l => l.id === m.location_id));
    box.innerHTML = `<div class="section-head"><h2>Locations</h2><span class="meta">${focus ? `Showing ${esc(shopLocName(focus))} · <button type="button" class="text-btn" id="locOvAll">Show all</button>` : 'Tap a location to focus on it'}</span></div>
      <div class="loc-grid">${cards}</div>${unassigned.length ? `<p class="meta">Not assigned to a location: ${unassigned.map(m => esc(m.name)).join(', ')}.</p>` : ''}`;
    box.querySelectorAll('.loc-card').forEach(c => c.onclick = () => setLocFocus(Number(c.dataset.loc) === focus ? null : Number(c.dataset.loc)));
    const all = document.getElementById('locOvAll'); if(all) all.onclick = () => setLocFocus(null);
  } finally { locOverviewBusy = false; }
}
