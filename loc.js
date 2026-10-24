// ============================================================
// RelayFleet — R8 multi-location: one company, several shop yards.
// The switcher (shown once there are 2+ yards) filters the Dashboard,
// Work orders, Dispatch, Shop floor and Profitability. Everyone in the
// company can still see every yard — it's a view, not a wall.
// ============================================================
let relayLocations = [];
// ---- Separate locations (migration 0047) ----
// Each location is its own shop to the people using it. The chosen location is sent with every
// request (header x-relay-location) and the database shows and saves only that location's records.
// Office staff are held to their own location by the database; the owner switches here.
let relayChosenLoc = null;
function locKey(){ return 'relay.loc.' + (session && session.id); }
function savedLocation(){ try { const v = Number(localStorage.getItem(locKey())); return v > 0 ? v : null; } catch(_){ return null; } }
function applyLocationHeader(){
  if(typeof sb === 'undefined' || !sb || !sb.rest || !sb.rest.headers) return;
  if(relayChosenLoc) sb.rest.headers['x-relay-location'] = String(relayChosenLoc); else delete sb.rest.headers['x-relay-location'];
}
// called straight after sign-in, before anything loads, so the first screen is already the right location
function applyStartupLocation(){
  if(!session || session.role !== 'shop'){ relayChosenLoc = null; applyLocationHeader(); return; }
  relayChosenLoc = (session.staffRole !== 'owner' && session.locationId) ? session.locationId : (savedLocation() || session.locationId || null);
  applyLocationHeader();
}
function isLocOwner(){ return session && session.role === 'shop' && session.staffRole === 'owner'; }
function chosenLocation(){ return relayLocations.find(l => l.id === relayChosenLoc) || null; }
function locDisplayName(l){ return l ? (l.display_name || l.name) : ''; }
function switchLocation(id){
  try { localStorage.setItem(locKey(), String(id)); } catch(_){}
  location.reload();   // everything reloads in the new location: lists, board, live updates
}
let locFocus = null;   // kept for older callers; the chosen location replaces it
function currentLocationId(){
  if(!session || !['shop','admin'].includes(session.role) || relayLocations.length < 2) return null;
  return relayChosenLoc;
}
function setLocFocus(id){ if(id && isLocOwner()) switchLocation(id); }
// the switcher at the top of the menu: logo and name; the owner can change it, staff see theirs
function renderLocSwitcher(){
  const host = document.querySelector('#shopView .dash-tabs');
  let box = document.getElementById('locSwitcher');
  if(!host || !session || session.role !== 'shop' || relayLocations.length < 2){ if(box) box.remove(); return; }
  if(!box){ box = document.createElement('div'); box.id = 'locSwitcher'; box.className = 'loc-switcher'; host.prepend(box); }
  const cur = chosenLocation() || relayLocations[0];
  const logo = cur && cur.logo_path && typeof billingLogoPublicUrl === 'function' ? billingLogoPublicUrl(cur.logo_path) : '';
  const mark = logo ? `<img src="${esc(logo)}" alt="" class="loc-sw-logo">` : `<span class="loc-sw-logo loc-sw-initial" aria-hidden="true">${esc((locDisplayName(cur) || '?').trim().charAt(0).toUpperCase())}</span>`;
  box.innerHTML = isLocOwner()
    ? `${mark}<div class="loc-sw-fixed"><span class="loc-sw-label">Location</span><b>${esc(locDisplayName(cur))}</b></div><span class="loc-sw-caret" aria-hidden="true">▾</span>
       <select id="locSwSelect" class="loc-sw-select" aria-label="Switch location">${relayLocations.map(l => `<option value="${l.id}" ${l.id === (cur && cur.id) ? 'selected' : ''}>${esc(locDisplayName(l))}</option>`).join('')}</select>`
    : `${mark}<div class="loc-sw-fixed"><span class="loc-sw-label">Location</span><b>${esc(locDisplayName(cur))}</b></div>`;
  const sel = document.getElementById('locSwSelect');
  if(sel) sel.onchange = () => { const id = Number(sel.value); if(id && id !== relayChosenLoc) switchLocation(id); };
}
function renderLocFocusBar(){ const bar = document.getElementById('locFocusBar'); if(bar) bar.remove(); }   // replaced by the switcher in the menu
function locTag(id){
  if(relayLocations.length < 2 || currentLocationId() || !id) return '';
  return ` <span class="loc-tag">${esc(shopLocName(id))}</span>`;
}
function locFilter(q){ const id = currentLocationId(); return id ? q.eq('location_id', id) : q; }
function shopLocName(id){ const l = relayLocations.find(x => x.id === id); return l ? l.name : ''; }
async function loadLocations(){
  if(!session || !session.orgId) { relayLocations = []; return; }
  const { data } = await sb.from('shop_locations').select('id, name, display_name, logo_path, address, phone, email, lat, lng, show_on_map, position, active, payment_instructions, invoice_terms, review_link, labor_rate, tax_rate').eq('org_id', session.orgId).order('position').order('id');
  relayLocations = (data || []).filter(l => l.active);
  window.relayAllLocations = data || [];
  if(session && session.role === 'shop' && relayLocations.length && !relayLocations.some(l => l.id === relayChosenLoc)){
    relayChosenLoc = (session.staffRole !== 'owner' && session.locationId) ? session.locationId : relayLocations[0].id;
    applyLocationHeader();
  }
  renderLocSwitcher();
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
    if(error){ relayFail(error.message); return; }
    job.location_id = id; recordsToast('Moved to ' + shopLocName(id)); if(typeof refreshCurrentView === 'function') refreshCurrentView();
  };
}
// Settings: locations — business profile, exact pin, show on the Relay map, who works where
async function renderLocationSettings(){
  const box = document.getElementById('locSettings');
  if(!box || !(typeof can !== 'function' || can('settings'))) return;
  await loadLocations();
  const all = window.relayAllLocations || [];
  // mechanics and office staff (never the owner, who works in every location) each belong to one location
  const { data: peopleRaw } = await sb.from('profiles').select('id, name, role, staff_role, location_id').eq('org_id', session.orgId).eq('active', true).in('role', ['mechanic', 'shop']).order('name');
  const people = (peopleRaw || []).filter(p => !(p.role === 'shop' && (p.staff_role || 'owner') === 'owner'));
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Locations</h2></div><div class="card new-job-form loc-settings">
    <p class="meta" style="margin-top:0;">Each location (shop or mobile service area) has its own address, phone and email, and a pin on the map. Fleet customers can find your locations on the Relay map.</p>
    ${all.map(l => `<div class="loc-set" data-id="${l.id}"><div class="loc-set-head"><b>${esc(l.name)}</b>${l.active ? '' : ' <span class="rec-tag">Hidden</span>'}${l.lat == null ? ' <span class="rec-tag warn">No pin yet</span>' : l.show_on_map ? ' <span class="rec-tag ok">On the map</span>' : ' <span class="rec-tag">Not on the map</span>'}
        <span class="loc-set-actions"><button type="button" class="text-btn" data-locedit="${l.id}">Edit</button>${all.filter(x => x.active).length > 1 || !l.active ? `<button type="button" class="text-btn" data-loctog="${l.id}" data-on="${l.active}">${l.active ? 'Hide' : 'Show'}</button>` : ''}</span></div>
        <div class="meta">${esc([l.address, l.phone, l.email].filter(Boolean).join(' · ') || 'No details yet')}</div>
        <div class="meta">Mechanics: ${esc((people || []).filter(p => p.location_id === l.id).map(p => p.name).join(', ') || 'none')}</div></div>`).join('')}
    <div id="locForm"></div><button type="button" class="ghost-btn" id="locAdd">+ Add location</button><p class="form-error" id="locErr"></p>
    ${(people || []).length && all.filter(x => x.active).length > 1 ? `<h3 class="loc-people-h">Who works where</h3><p class="meta">Office staff see only their own location. Mechanics always see the jobs assigned to them.</p>${people.map(p => `<div class="ro-inv tc-row"><span>${esc(p.name)} <span class="meta">${p.role === 'mechanic' ? 'Mechanic' : 'Office'}</span></span><select data-person="${p.id}" aria-label="Location for ${esc(p.name)}">${all.filter(x => x.active).map(x => `<option value="${x.id}" ${x.id === p.location_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>`).join('')}` : ''}
  </div>`;
  const form = (l) => {
    document.getElementById('locForm').innerHTML = `<div class="loc-edit"><div class="rec-grid">
      <div class="field"><label>Location name *</label><input id="lfName" maxlength="80" value="${l ? esc(l.name) : ''}" placeholder="e.g. Orlando FL"></div>
      <div class="field"><label>Phone</label><input id="lfPhone" maxlength="40" value="${l && l.phone ? esc(l.phone) : ''}"></div>
      <div class="field"><label>Email</label><input id="lfEmail" type="email" maxlength="254" value="${l && l.email ? esc(l.email) : ''}"></div>
      <div class="field rec-span"><label>Address</label><div class="loc-addr"><input id="lfAddr" maxlength="200" value="${l && l.address ? esc(l.address) : ''}" placeholder="Street, city, state ZIP"><button type="button" class="ghost-btn" id="lfFind">Find on map</button></div></div></div>
      <div class="loc-pinmap" id="lfMap"></div><p class="meta" id="lfPinNote">${l && l.lat != null ? 'Drag the pin to the exact spot if needed.' : 'Type the address and tap “Find on map”, or tap the map to drop the pin.'}</p>
      <div class="loc-id-block">
        <div class="loc-id-head"><b>This location's own details</b><span class="meta">Printed on this location's estimates, invoices and receipts, and shown to its customers. Leave a box empty to use the company's.</span></div>
        <div class="rec-grid">
          <div class="field"><label for="lfDisplay">Name on documents</label><input id="lfDisplay" maxlength="120" value="${l && l.display_name ? esc(l.display_name) : ''}" placeholder="e.g. RelayFleet Philadelphia"></div>
          <div class="field"><label for="lfLogo">Logo</label><div class="loc-logo-row">${l && l.logo_path && typeof billingLogoPublicUrl === 'function' ? `<img class="loc-logo-prev" alt="Current logo" src="${esc(billingLogoPublicUrl(l.logo_path))}">` : ''}<input id="lfLogo" type="file" accept="image/png,image/jpeg,image/webp"></div></div>
          <div class="field"><label for="lfLabor">Labor rate ($ per hour)</label><input id="lfLabor" type="number" min="0" max="10000" step="0.01" inputmode="decimal" value="${l && l.labor_rate != null ? esc(l.labor_rate) : ''}"></div>
          <div class="field"><label for="lfTax">Sales tax (%)</label><input id="lfTax" type="number" min="0" max="30" step="0.001" inputmode="decimal" value="${l && l.tax_rate != null ? esc(l.tax_rate) : ''}"></div>
          <div class="field rec-span"><label for="lfPay">How customers pay this location</label><textarea id="lfPay" maxlength="1000" rows="2" placeholder="e.g. Zelle to philly@yourshop.com, or check payable to …">${l && l.payment_instructions ? esc(l.payment_instructions) : ''}</textarea></div>
          <div class="field rec-span"><label for="lfTerms">Warranty &amp; terms</label><textarea id="lfTerms" maxlength="2000" rows="3" placeholder="e.g. Parts and labor warranted 12 months or 12,000 miles…">${l && l.invoice_terms ? esc(l.invoice_terms) : ''}</textarea></div>
          <div class="field rec-span"><label for="lfReview">Review link</label><input id="lfReview" maxlength="300" type="url" value="${l && l.review_link ? esc(l.review_link) : ''}" placeholder="This location's Google review page"></div>
        </div>
      </div>
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
      // this location's own details (empty means "use the company's")
      const num = (id, max) => { const v = document.getElementById(id).value.trim(); if(v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : NaN; };
      row.display_name = document.getElementById('lfDisplay').value.trim() || null;
      row.labor_rate = num('lfLabor', 10000); row.tax_rate = num('lfTax', 30);
      if(Number.isNaN(row.labor_rate)){ err.textContent = 'Check the labor rate: a number from 0 to 10,000.'; return; }
      if(Number.isNaN(row.tax_rate)){ err.textContent = 'Check the sales tax: a percentage from 0 to 30.'; return; }
      row.payment_instructions = document.getElementById('lfPay').value.trim() || null;
      row.invoice_terms = document.getElementById('lfTerms').value.trim() || null;
      row.review_link = document.getElementById('lfReview').value.trim() || null;
      if(row.review_link && !/^https:\/\//i.test(row.review_link)){ err.textContent = 'The review link should start with https://'; return; }
      const logoFile = document.getElementById('lfLogo').files[0];
      if(logoFile){
        if(logoFile.size > 3 * 1024 * 1024){ err.textContent = 'The logo is too big: 3 MB at most.'; return; }
        const path = `${session.orgId}/loc-${l ? l.id : 'new'}-${Date.now()}-${logoFile.name.replace(/[^A-Za-z0-9._-]/g, '_')}`;
        const up = await sb.storage.from('shop-logos').upload(path, logoFile);
        if(up.error){ err.textContent = friendlyError(up.error, 'The logo could not be uploaded').message; return; }
        row.logo_path = path;
      }
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
  // Locations are separate now: the Dashboard shows only the chosen location, so the
  // side-by-side location cards are gone. The switcher at the top of the menu changes location.
  const box = document.getElementById('locOverview'); if(box){ box.innerHTML = ''; box.classList.add('hidden'); }
}
