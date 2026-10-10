// ============================================================
// RelayFleet — R11: barcode scanning, VIN scan & decode, parts fitment.
// Scanning uses the phone camera (html5-qrcode, loaded only when needed),
// a USB/Bluetooth scanner (types into the box), or typing.
// VIN decode: NHTSA vPIC (free, public). Fitment: part_fitment() in the
// database — the shop's own fitment notes and history; never a guess.
// ============================================================
const SCAN_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
let scanCam = null;
function loadScanLib(){
  if(window.Html5Qrcode) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = SCAN_LIB; s.onload = () => window.Html5Qrcode ? res() : rej(new Error('Scanner missing')); s.onerror = () => rej(new Error('Could not load the scanner')); document.head.appendChild(s); });
}
function stopScanCam(){ const c = scanCam; scanCam = null; if(c){ try { c.stop().catch(() => {}); } catch(_){} } }
// Opens the scanner sheet; calls onCode(text) once with the scanned or typed code.
function openScanner(title, onCode, opts){
  const node = document.createElement('div'); node.className = 'scan-box';
  node.innerHTML = `<div id="scanCam" class="scan-cam"></div><p class="meta" id="scanStatus">Starting the camera…</p>
    <div class="scan-manual"><input id="scanManual" ${opts && opts.vin ? 'maxlength="17" autocapitalize="characters" class="mono"' : ''} placeholder="${opts && opts.vin ? 'Or type the 17-character VIN' : 'Or type / use a barcode scanner'}" aria-label="Code"><button type="button" id="scanUse">Use</button></div>`;
  let done = false;
  const finish = (code) => { code = String(code || '').trim(); if(!code || done) return; done = true; stopScanCam(); closeFormSheet(); onCode(code); };
  openFormSheet(title, [node], () => { stopScanCam(); node.remove(); });
  const input = node.querySelector('#scanManual');
  node.querySelector('#scanUse').onclick = () => finish(input.value);
  input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); finish(input.value); } });   // USB/Bluetooth scanners end with Enter
  const status = node.querySelector('#scanStatus');
  loadScanLib().then(() => {
    if(done) return;
    const F = window.Html5QrcodeSupportedFormats || {};
    const formats = ['CODE_128','CODE_39','EAN_13','EAN_8','UPC_A','UPC_E','QR_CODE','DATA_MATRIX','ITF'].map(k => F[k]).filter(v => v != null);
    scanCam = new window.Html5Qrcode('scanCam', { formatsToSupport: formats.length ? formats : undefined, experimentalFeatures:{ useBarCodeDetectorIfSupported:true }, verbose:false });
    return scanCam.start({ facingMode:'environment' }, { fps:10, qrbox:(w, h) => ({ width:Math.round(w * 0.85), height:Math.round(Math.min(h, w) * 0.4) }) }, (text) => finish(text), () => {})
      .then(() => { status.textContent = opts && opts.vin ? 'Point at the VIN barcode (driver door jamb or dash).' : 'Point the camera at the barcode or label.'; });
  }).catch(() => { status.textContent = "The camera isn't available here — type the code, or use a barcode scanner."; node.querySelector('#scanCam').classList.add('hidden'); setTimeout(() => input.focus(), 50); });
}

// ---------------- VIN ----------------
const VIN_W = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
const VIN_V = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
function cleanVin(v){ return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^I(?=.{17}$)/, ''); }   // some VIN barcodes start with an extra "I"
function vinProblem(v){
  if(v.length !== 17) return 'A VIN has 17 characters (this has ' + v.length + ').';
  if(/[IOQ]/.test(v)) return 'A VIN never contains the letters I, O or Q — check for 1, 0 or 9.';
  if(/^[1-5]/.test(v)){   // North American VINs carry a check digit
    const sum = v.split('').reduce((t, ch, i) => t + (/\d/.test(ch) ? Number(ch) : VIN_V[ch] || 0) * VIN_W[i], 0) % 11;
    if((sum === 10 ? 'X' : String(sum)) !== v[8]) return "This VIN's check digit doesn't add up — one character is probably misread.";
  }
  return null;
}
const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
async function decodeVin(v){
  const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(v) + '?format=json');
  if(!r.ok) throw new Error('The VIN service did not answer (' + r.status + ').');
  const x = ((await r.json()).Results || [])[0] || {};
  const engine = [x.EngineManufacturer, x.EngineModel].filter(Boolean).join(' ').trim() || (x.DisplacementL ? Number(x.DisplacementL).toFixed(1) + ' L' : '');
  const t = String(x.VehicleType || '') + ' ' + String(x.BodyClass || '');
  return { year: x.ModelYear ? Number(x.ModelYear) : null, make: x.Make ? titleCase(x.Make) : '', model: x.Model || '', engine,
           type: /TRAILER/i.test(t) ? 'trailer' : /TRUCK|TRACTOR/i.test(t) ? 'truck' : '' };
}
async function vinFill(raw){
  const msg = document.getElementById('ufVinMsg'); const set = (t, cls) => { if(msg){ msg.textContent = t; msg.className = 'vin-msg ' + (cls || ''); } };
  const v = cleanVin(raw); const vin = document.getElementById('ufVin'); if(vin) vin.value = v;
  const bad = vinProblem(v); if(bad){ set(bad, 'warn'); if(v.length !== 17) return; }
  set('Looking up the VIN…');
  try {
    const d = await decodeVin(v);
    if(!d.make && !d.year){ set("The VIN service doesn't recognise this VIN. Check it, or fill in the details by hand.", 'warn'); return; }
    const put = (id, val) => { const el = document.getElementById(id); if(el && val) el.value = val; };
    put('ufYear', d.year); put('ufMake', d.make); put('ufModel', d.model); put('ufEngine', d.engine);
    const ty = document.getElementById('ufType'); if(ty && d.type && [...ty.options].some(o => o.value === d.type)) ty.value = d.type;
    set('Decoded: ' + [d.year, d.make, d.model].filter(Boolean).join(' ') + (d.engine ? ' · ' + d.engine : '') + '. Check it, then Save.' + (bad ? ' (' + bad + ')' : ''), bad ? 'warn' : 'ok');
  } catch(e){ set("Couldn't reach the VIN service — fill in the details by hand.", 'warn'); }
}
document.addEventListener('click', (e) => {
  if(e.target.closest('#ufVinScan')) openScanner('Scan the VIN', (code) => vinFill(code), { vin:true });
  if(e.target.closest('#ufVinDecode')) vinFill((document.getElementById('ufVin') || {}).value);
  if(e.target.closest('#ifBarcodeScan')) openScanner('Scan the part barcode', (code) => { const el = document.getElementById('ifBarcode'); if(el) el.value = code; });
});

// ---------------- finding a part by its code ----------------
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function findPartByCode(items, code){
  const c = normCode(code); if(c.length < 3) return null;
  return items.find(i => normCode(i.barcode) === c) || items.find(i => normCode(i.part_number) === c)
    // cross-references are often written with a brand in front ("WEB 66864F"): match the whole entry or any word in it
    || items.find(i => String(i.cross_ref || '').split(/[,;/]+/).some(x => normCode(x) === c || x.trim().split(/\s+/).some(w => normCode(w).length >= 3 && normCode(w) === c))) || null;
}
async function fitmentFor(itemId, unitId){
  if(!unitId) return { verdict:'unknown', reason:'This work order has no unit linked, so fitment can\'t be checked.' };
  const { data, error } = await sb.rpc('part_fitment', { p_item: itemId, p_unit: unitId });
  return error ? { verdict:'unknown', reason:"Fitment couldn't be checked right now." } : data;
}
function fitmentHtml(f){
  if(!f) return '';
  const icon = { fits:'✓', mismatch:'⚠', unknown:'?' }[f.verdict] || '?';
  return `<span class="fit fit-${esc(f.verdict)}"><b>${icon} ${f.verdict === 'fits' ? 'Fits' : f.verdict === 'mismatch' ? "Doesn't match this unit" : 'Fitment unknown'}</b> ${esc(f.reason || '')}</span>`;
}

// ---------------- Inventory: Scan ----------------
async function inventoryScan(){
  openScanner('Scan a part', async (code) => {
    const { data } = await sb.from('inventory_items').select('id, name, part_number, barcode, cross_ref').eq('org_id', session.orgId).eq('active', true).limit(10000);
    const items = data || [];
    const it = findPartByCode(items, code);
    if(it){
      const s = document.getElementById('invSearch'); if(s){ s.value = it.part_number || it.name; s.dispatchEvent(new Event('input')); }
      recordsToast('Found: ' + it.name); return;
    }
    // not known yet: link it to a part once, or add a new part
    const node = document.createElement('div'); node.className = 'scan-box';
    node.innerHTML = `<p>Relay doesn't know <b class="mono">${esc(code)}</b> yet. Link it to one of your parts — from then on, scanning it finds that part.</p>
      <div class="scan-manual"><input list="scanLinkList" id="scanLink" placeholder="Part name or number" aria-label="Part"><datalist id="scanLinkList">${items.map(i => `<option value="${esc((i.part_number ? i.part_number + ' — ' : '') + i.name)}"></option>`).join('')}</datalist><button type="button" id="scanLinkGo">Link</button></div>
      <p class="form-error" id="scanLinkErr"></p><button type="button" class="ghost-btn" id="scanNew">Add as a new part instead</button>`;
    openFormSheet('New barcode', [node], () => node.remove());
    node.querySelector('#scanLinkGo').onclick = async () => {
      const v = node.querySelector('#scanLink').value; const pick = items.find(i => (i.part_number ? i.part_number + ' — ' : '') + i.name === v);
      if(!pick){ node.querySelector('#scanLinkErr').textContent = 'Pick a part from the list.'; return; }
      const { error } = await sb.from('inventory_items').update({ barcode: code }).eq('id', pick.id);
      if(error){ node.querySelector('#scanLinkErr').textContent = error.code === '23505' ? 'That barcode is already linked to another part.' : error.message; return; }
      closeFormSheet(); recordsToast('Linked to ' + pick.name); if(typeof refreshInventoryV2 === 'function') refreshInventoryV2();
    };
    node.querySelector('#scanNew').onclick = () => { closeFormSheet(); if(typeof openItemForm === 'function'){ openItemForm(null); setTimeout(() => { const b = document.getElementById('ifBarcode'); if(b) b.value = code; }, 30); } };
  });
}

// ---------------- VIN lookup elsewhere (R11b): New work order + unit history ----------------
// One shared lookup: clean, check, decode. Never throws.
async function lookupVin(raw){
  const vin = cleanVin(raw); const problem = vinProblem(vin);
  if(vin.length !== 17) return { vin, problem, decoded:null };
  try { const d = await decodeVin(vin); return { vin, problem, decoded: (d.make || d.year) ? d : null, unknown: !(d.make || d.year) }; }
  catch(_){ return { vin, problem, decoded:null, offline:true }; }
}
function vinSummary(d){ return [d.year, d.make, d.model].filter(Boolean).join(' ') + (d.engine ? ' · ' + d.engine : '') + (d.type ? ' · ' + (d.type === 'trailer' ? 'Trailer' : 'Truck') : ''); }
// New work order form
async function njVinFill(raw){
  const msg = document.getElementById('njVinMsg'), inp = document.getElementById('njVin');
  const set = (t, cls) => { if(msg){ msg.textContent = t; msg.className = 'vin-msg ' + (cls || ''); } };
  window.njVinDecoded = null;
  set('Looking up the VIN…');
  const r = await lookupVin(raw); if(inp) inp.value = r.vin;
  if(r.vin.length !== 17){ set(r.problem, 'warn'); return; }
  if(r.decoded){
    window.njVinDecoded = { vin: r.vin, ...r.decoded };
    const ty = document.getElementById('njUnitType'); if(ty && r.decoded.type && [...ty.options].some(o => o.value === r.decoded.type)) ty.value = r.decoded.type;
    set(vinSummary(r.decoded) + ' — saved to the unit when you create the work order.' + (r.problem ? ' (' + r.problem + ')' : ''), r.problem ? 'warn' : 'ok');
  } else set(r.offline ? "Couldn't reach the VIN service — the VIN will still be saved." : (r.problem || "The VIN service doesn't recognise this VIN — it will still be saved."), 'warn');
}
// After "Create": put the VIN and decoded details on the unit — filling blanks only, never overwriting.
async function applyVinToUnit(unitId, raw, decoded){
  try {
    const vin = cleanVin(raw); if(!unitId || vin.length < 11) return;
    const { data: u } = await sb.from('units').select('vin, year, make, model, engine').eq('id', unitId).maybeSingle();
    if(!u) return;
    const d = decoded && decoded.vin === vin ? decoded : null;
    const patch = {};
    if(!u.vin) patch.vin = vin.slice(0, 17);
    if(d){ if(!u.year && d.year) patch.year = d.year; if(!u.make && d.make) patch.make = d.make; if(!u.model && d.model) patch.model = d.model; if(!u.engine && d.engine) patch.engine = d.engine; }
    if(Object.keys(patch).length) await sb.from('units').update(patch).eq('id', unitId);
  } catch(_){ /* a VIN problem must never block the work order */ }
}
// Unit history: decode and save to the unit (an explicit action, so it updates the unit)
async function uhVinLookup(unitId){
  const box = document.getElementById('uhVinBox'); if(!box) return;
  const { data: u } = await sb.from('units').select('id, vin, unit_type').eq('id', unitId).maybeSingle();
  const show = async (raw) => {
    box.classList.remove('hidden'); box.innerHTML = '<p class="meta">Looking up the VIN…</p>';
    const r = await lookupVin(raw);
    if(r.vin.length !== 17){ box.innerHTML = `<p class="vin-msg warn">${esc(r.problem)}</p>`; return; }
    if(!r.decoded){ box.innerHTML = `<p class="vin-msg warn">${esc(r.offline ? "Couldn't reach the VIN service right now." : (r.problem || "The VIN service doesn't recognise this VIN."))}</p>`; return; }
    box.innerHTML = `<div class="uh-vin"><div><span class="meta">VIN <span class="mono">${esc(r.vin)}</span></span><b>${esc(vinSummary(r.decoded))}</b>${r.problem ? `<p class="vin-msg warn">${esc(r.problem)}</p>` : ''}</div>
      <div class="job-actions"><button type="button" id="uhVinSave">Save to unit</button><button type="button" class="ghost-btn" id="uhVinClose">Close</button></div></div>`;
    document.getElementById('uhVinClose').onclick = () => { box.classList.add('hidden'); box.innerHTML = ''; };
    document.getElementById('uhVinSave').onclick = async () => {
      const d = r.decoded; const patch = { vin: r.vin, year: d.year || null, make: d.make || null, model: d.model || null, engine: d.engine || null };
      if(d.type) patch.unit_type = d.type;
      const { error } = await sb.from('units').update(patch).eq('id', unitId);
      if(error){ box.insertAdjacentHTML('beforeend', `<p class="form-error">${esc(error.message)}</p>`); return; }
      recordsToast('Unit updated from its VIN'); if(typeof openUnitHistory === 'function') openUnitHistory(unitId);
    };
  };
  if(u && u.vin) show(u.vin);
  else openScanner('Scan the VIN', (code) => show(code), { vin:true });
}
document.addEventListener('click', (e) => {
  if(e.target.closest('#njVinScan')) openScanner('Scan the VIN', (code) => njVinFill(code), { vin:true });
  if(e.target.closest('#njVinDecode')) njVinFill((document.getElementById('njVin') || {}).value);
  const uh = e.target.closest('#uhVin'); if(uh) uhVinLookup(Number(uh.dataset.unit));
});
