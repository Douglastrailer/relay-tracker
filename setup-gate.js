// ============================================================
// RelayFleet — the shop setup that must be finished before the shop uses Relay.
// Step 1: the shop location (address + map pin), filled in right here in the panel.
// Step 2: the customer updates the shop sends.
// Until both are done the app behind the panel cannot be used (it is made inert), and the
// database itself refuses new work orders and invoices (migration 0045).
// ============================================================
const SETUP_EVENTS = [
  ['job_received', 'We received your work order'],
  ['mechanic_assigned', 'A technician is assigned'],
  ['en_route', 'The technician is on the way'],
  ['arrived', 'The technician has arrived'],
  ['estimate_approved', 'The estimate is approved'],
  ['repair_completed', 'The repair is complete'],
  ['payment_received', 'Payment is received'],
  ['review_request', 'Ask for a review afterwards']
];
const setupState = { status: null, loc: null, pin: null, map: null, marker: null, retry: 0, timer: null, busy: false };

// Checks whether setup is needed. A failed check is retried (it never leaves the app open by
// accident), and the panel is never rebuilt while someone is filling it in.
async function checkShopSetupGate(opts){
  opts = opts || {};
  if(typeof session === 'undefined' || !session || session.role !== 'shop') return;
  if(setupState.busy) return;
  if(document.getElementById('setupGate') && !opts.force) return;
  setupState.busy = true;
  let res;
  try { res = await sb.rpc('shop_setup_status'); } catch(e){ res = { error: e }; }
  setupState.busy = false;
  if(res.error || !res.data){
    const waits = [2000, 5000, 15000, 30000, 60000];
    clearTimeout(setupState.timer);
    setupState.timer = setTimeout(() => checkShopSetupGate(opts), waits[Math.min(setupState.retry++, waits.length - 1)]);
    return;
  }
  setupState.retry = 0;
  setupState.status = res.data;
  if(!res.data.needed){ removeSetupGate(); return; }
  await loadSetupLocation();
  showSetupGate();
}

async function loadSetupLocation(){
  const { data } = await sb.from('shop_locations').select('id, name, address, phone, lat, lng, active').eq('org_id', session.orgId).eq('active', true).order('id', { ascending: true }).limit(5);
  const rows = data || [];
  // the first active location that is already complete, otherwise the first one to finish, otherwise a new one
  setupState.loc = rows.find(l => l.lat != null && l.address) || rows[0] || null;
  setupState.pin = setupState.loc && setupState.loc.lat != null ? { lat: setupState.loc.lat, lng: setupState.loc.lng } : null;
}

function locationDone(){ const l = setupState.loc; return !!(l && l.id && l.lat != null && l.address); }

function removeSetupGate(){
  const g = document.getElementById('setupGate'); if(g) g.remove();
  document.querySelectorAll('[data-setup-inert]').forEach(el => { el.inert = false; el.removeAttribute('data-setup-inert'); });
  document.body.classList.remove('setup-open');
  if(setupState.map){ try { setupState.map.remove(); } catch(_){} setupState.map = null; setupState.marker = null; }
}

function showSetupGate(){
  const existing = document.getElementById('setupGate'); if(existing) existing.remove();
  const canFinish = session.staffRole === 'owner' || session.staffRole === 'office';
  const gate = document.createElement('div');
  gate.id = 'setupGate'; gate.className = 'setup-gate';
  gate.innerHTML = canFinish ? setupHtml() : `<div class="setup-card setup-card-small" role="dialog" aria-modal="true" aria-labelledby="setupGateTitle">
      <div class="setup-brand">Relay</div>
      <h2 id="setupGateTitle">Your shop isn't set up yet</h2>
      <p class="meta">Ask your shop owner to finish setup: the shop location and the customer updates. Relay opens for everyone once it's done.</p>
      <div class="setup-foot"><button type="button" class="text-btn" id="setupOut">Sign out</button><button type="button" id="setupRecheck">Check again</button></div></div>`;
  document.body.appendChild(gate);
  // everything behind the panel is made inert: no clicks, no keyboard focus
  [...document.body.children].forEach(el => { if(el !== gate && !el.inert && el.tagName !== 'SCRIPT'){ el.inert = true; el.setAttribute('data-setup-inert', ''); } });
  document.body.classList.add('setup-open');
  wireSetupGate(gate, canFinish);
}

function setupHtml(){
  const l = setupState.loc, done = locationDone();
  const name = l ? l.name : ((session.orgName || '').trim() || 'Main location');
  return `<div class="setup-card" role="dialog" aria-modal="true" aria-labelledby="setupGateTitle">
    <div class="setup-brand">Relay</div>
    <h2 id="setupGateTitle">Set up your shop</h2>
    <p class="meta">Two quick steps. Relay opens as soon as both are done.</p>

    <section class="setup-step ${done ? 'is-done' : 'is-current'}" id="setupStep1">
      <div class="setup-step-head"><span class="setup-num">${done ? '✓' : '1'}</span><div><b>Where is your shop?</b>
        <div class="meta">Customers and fleets find you on the Relay map with this.</div></div></div>
      ${done ? `<div class="setup-summary"><div><b>${relayEsc(l.name)}</b><div class="meta">${relayEsc(l.address)}</div></div><button type="button" class="text-btn" id="setupLocChange">Change</button></div>` : locationFormHtml(name)}
    </section>

    <section class="setup-step ${done ? 'is-current' : ''}" id="setupStep2">
      <div class="setup-step-head"><span class="setup-num">2</span><div><b>What should customers be told?</b>
        <div class="meta">Emails go to the customer on each job. You can change these later in Settings.</div></div></div>
      <div class="setup-events">${SETUP_EVENTS.map(([k, label]) => `<label class="setup-check"><input type="checkbox" value="${k}" checked><span>${relayEsc(label)}</span></label>`).join('')}</div>
    </section>

    <p class="form-error" id="setupErr" role="alert"></p>
    <div class="setup-foot">
      <button type="button" class="text-btn" id="setupOut">Sign out</button>
      <div class="setup-foot-main">${done ? '' : '<span class="meta" id="setupFinishHint">Save your location first.</span>'}<button type="button" id="setupFinish" ${done ? '' : 'disabled'}>Finish setup</button></div>
    </div>
  </div>`;
}

function locationFormHtml(name){
  const l = setupState.loc;
  return `<div class="setup-locform">
      <div class="setup-row">
        <div class="field"><label for="slName">Location name</label><input id="slName" maxlength="80" value="${relayEsc(name)}" placeholder="e.g. Orlando yard"></div>
        <div class="field"><label for="slPhone">Phone (optional)</label><input id="slPhone" maxlength="40" inputmode="tel" value="${relayEsc((l && l.phone) || '')}"></div>
      </div>
      <div class="field"><label for="slAddr">Street address</label>
        <div class="setup-addr"><input id="slAddr" maxlength="200" autocomplete="street-address" value="${relayEsc((l && l.address) || '')}" placeholder="Street, city, state ZIP"><button type="button" class="ghost-btn" id="slFind">Find on map</button></div></div>
      <div class="setup-map" id="slMap" aria-label="Map: tap to place the pin on your shop"></div>
      <p class="meta" id="slNote">Type the address and press “Find on map”, or tap the map to place the pin on your shop.</p>
      <div class="setup-locsave"><button type="button" id="slSave">Save location</button></div>
    </div>`;
}

function wireSetupGate(gate, canFinish){
  const out = gate.querySelector('#setupOut');
  if(out) out.onclick = async () => { try { await sb.auth.signOut(); } catch(_){} location.reload(); };
  const re = gate.querySelector('#setupRecheck');
  if(re) re.onclick = () => { removeSetupGate(); checkShopSetupGate({ force: true }); };
  if(!canFinish) return;
  const err = m => { const e = gate.querySelector('#setupErr'); if(e) e.textContent = m || ''; };
  const change = gate.querySelector('#setupLocChange');
  if(change) change.onclick = () => {
    const step = gate.querySelector('#setupStep1');
    step.classList.remove('is-done'); step.classList.add('is-current');
    step.querySelector('.setup-summary').outerHTML = locationFormHtml(setupState.loc.name);
    setupState.pin = setupState.loc.lat != null ? { lat: setupState.loc.lat, lng: setupState.loc.lng } : null;
    wireLocationForm(gate, err);
  };
  wireLocationForm(gate, err);
  const fin = gate.querySelector('#setupFinish');
  if(fin) fin.onclick = async () => {
    if(!locationDone()){ err('Save your location first (step 1).'); return; }
    const events = [...gate.querySelectorAll('.setup-events input:checked')].map(i => i.value);
    fin.disabled = true; fin.textContent = 'Finishing…'; err('');
    const { error } = await sb.rpc('complete_shop_setup', { p_events: events });
    fin.disabled = false; fin.textContent = 'Finish setup';
    if(error){ err(friendlyError(error, 'Setup is not finished yet').message); return; }
    removeSetupGate();
    if(typeof recordsToast === 'function') recordsToast('Setup complete. Welcome to Relay.');
  };
}

function wireLocationForm(gate, err){
  const mapEl = gate.querySelector('#slMap'); if(!mapEl) return;
  if(setupState.map){ try { setupState.map.remove(); } catch(_){} setupState.map = null; setupState.marker = null; }
  const note = gate.querySelector('#slNote');
  const place = (lat, lng, zoom) => {
    setupState.pin = { lat: +Number(lat).toFixed(6), lng: +Number(lng).toFixed(6) };
    if(!window.L || !setupState.map) return;
    const ll = L.latLng(setupState.pin.lat, setupState.pin.lng);
    if(setupState.marker) setupState.marker.setLatLng(ll);
    else { setupState.marker = L.marker(ll, { draggable: true }).addTo(setupState.map); setupState.marker.on('dragend', e => { const p = e.target.getLatLng(); setupState.pin = { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }; }); }
    if(zoom) setupState.map.setView(ll, zoom);
  };
  if(window.L){
    const p = setupState.pin;
    setupState.map = L.map(mapEl, { attributionControl: true }).setView(p ? [p.lat, p.lng] : [39.5, -98.35], p ? 16 : 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(setupState.map);
    if(p) place(p.lat, p.lng);
    setupState.map.on('click', e => { place(e.latlng.lat, e.latlng.lng); note.textContent = 'Pin placed. Drag it onto your building or yard if it is a little off.'; });
    setTimeout(() => setupState.map && setupState.map.invalidateSize(), 80);
  } else {
    mapEl.innerHTML = '<p class="meta" style="padding:12px">The map could not load. Check your connection and reopen Relay.</p>';
  }
  gate.querySelector('#slFind').onclick = async () => {
    const q = gate.querySelector('#slAddr').value.trim();
    if(!q){ err('Type your street address first.'); return; }
    err(''); note.textContent = 'Looking up the address…';
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } });
      const hits = await r.json();
      if(!hits.length){ note.textContent = "Couldn't find that address. Check it, or tap the map to place the pin."; return; }
      place(hits[0].lat, hits[0].lon, 17);
      note.textContent = 'Found. Drag the pin onto your building or yard if it is a little off.';
    } catch(_){ note.textContent = "Address lookup isn't available right now. Tap the map to place the pin."; }
  };
  gate.querySelector('#slSave').onclick = async () => {
    const name = gate.querySelector('#slName').value.trim();
    const address = gate.querySelector('#slAddr').value.trim();
    const phone = gate.querySelector('#slPhone').value.trim() || null;
    if(!name){ err('Enter a name for the location.'); return; }
    if(!address){ err('Enter the street address.'); return; }
    if(!setupState.pin){ err('Place the pin on the map: press “Find on map”, or tap the map.'); return; }
    const btn = gate.querySelector('#slSave'); btn.disabled = true; btn.textContent = 'Saving…'; err('');
    const row = { name, address, phone, lat: setupState.pin.lat, lng: setupState.pin.lng, show_on_map: true, active: true };
    const res = setupState.loc && setupState.loc.id
      ? await sb.from('shop_locations').update(row).eq('id', setupState.loc.id).select('id, name, address, phone, lat, lng, active')
      : await sb.from('shop_locations').insert([{ ...row, org_id: session.orgId, position: 1 }]).select('id, name, address, phone, lat, lng, active');
    btn.disabled = false; btn.textContent = 'Save location';
    if(res.error){
      err(res.error.code === '23505' ? 'You already have a location with that name. Use a different name.' : friendlyError(res.error, 'Could not save the location').message);
      return;
    }
    const saved = Array.isArray(res.data) ? res.data[0] : res.data;
    setupState.loc = saved || { ...row, id: setupState.loc && setupState.loc.id };
    showSetupGate();   // redraw: step 1 shows as done, Finish is ready
  };
}

// look again when the window comes back into view, and once a minute, in case setup was finished elsewhere
if(typeof window !== 'undefined'){
  window.addEventListener('focus', () => { if(!document.getElementById('setupGate')) checkShopSetupGate(); });
  setInterval(() => { if(!document.hidden && !document.getElementById('setupGate')) checkShopSetupGate(); }, 60000);
}
