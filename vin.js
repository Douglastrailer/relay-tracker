// ============================================================
// RelayFleet — VIN lookup.
// Type or scan a VIN: it is checked for typos, decoded by the free NHTSA service, matched
// against this shop's own units, and checked for open safety recalls on that make/model/year.
// Reuses the decoder, the typo check and the scanner from the unit form (parts.js).
// ============================================================
const VIN_RECENT_KEY = 'relay.vin.recent';
const vinState = { vin: '', decoded: null, raw: null, seq: 0 };

// the fields worth showing a truck and trailer shop, in this order, when NHTSA knows them
const VIN_FIELDS = [
  ['ModelYear', 'Year'], ['Make', 'Make'], ['Model', 'Model'], ['Series', 'Series'], ['Trim', 'Trim'],
  ['VehicleType', 'Vehicle type'], ['BodyClass', 'Body'], ['TrailerType', 'Trailer type'], ['TrailerBodyType', 'Trailer body'], ['TrailerLength', 'Trailer length (ft)'],
  ['GVWR', 'Weight rating (GVWR)'], ['DriveType', 'Drive'], ['Axles', 'Axles'], ['AxleConfiguration', 'Axle setup'], ['BrakeSystemType', 'Brakes'],
  ['EngineManufacturer', 'Engine make'], ['EngineModel', 'Engine model'], ['EngineHP', 'Horsepower'], ['DisplacementL', 'Displacement (L)'], ['EngineCylinders', 'Cylinders'],
  ['FuelTypePrimary', 'Fuel'], ['TransmissionStyle', 'Transmission'], ['Manufacturer', 'Built by'], ['PlantCity', 'Plant city'], ['PlantCountry', 'Plant country']
];

function vinRecent(){ try { return JSON.parse(localStorage.getItem(VIN_RECENT_KEY) || '[]'); } catch(_){ return []; } }
function vinRemember(vin, label){
  try { const list = [{ vin, label }].concat(vinRecent().filter(x => x.vin !== vin)).slice(0, 8); localStorage.setItem(VIN_RECENT_KEY, JSON.stringify(list)); } catch(_){}
}

function renderVinPanel(){
  const box = document.getElementById('vinBox'); if(!box) return;
  if(box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = `<div class="section-head"><h2>VIN lookup</h2><span class="meta">Free, from the U.S. NHTSA vehicle database</span></div>
    <form class="vin-search" id="vinForm" autocomplete="off">
      <label for="vinInput" class="sr-only">VIN</label>
      <input id="vinInput" class="mono" maxlength="20" placeholder="Type or scan a 17-character VIN" spellcheck="false" autocapitalize="characters">
      <button type="button" class="ghost-btn" id="vinScan">Scan</button>
      <button type="submit" id="vinGo">Look up</button>
    </form>
    <p class="meta" id="vinCount" aria-live="polite"></p>
    <div id="vinRecent"></div>
    <div id="vinResult" aria-live="polite"></div>`;
  const input = box.querySelector('#vinInput');
  input.addEventListener('input', () => {
    const v = cleanVin(input.value);
    document.getElementById('vinCount').textContent = v ? `${v.length} of 17 characters` : '';
  });
  box.querySelector('#vinForm').onsubmit = (e) => { e.preventDefault(); vinLookup(input.value); };
  box.querySelector('#vinScan').onclick = () => { if(typeof openScanner === 'function') openScanner('Scan the VIN', (code) => { input.value = code; vinLookup(code); }, { vin: true }); };
  vinDrawRecent();
}
function vinDrawRecent(){
  const el = document.getElementById('vinRecent'); if(!el) return;
  const list = vinRecent();
  el.innerHTML = list.length ? `<div class="fd-dates" aria-label="Recent lookups"><span class="meta">Recent:</span> ${list.map(x => `<button type="button" class="fd-chip" data-vinre="${esc(x.vin)}" title="${esc(x.vin)}">${esc(x.label || x.vin)}</button>`).join('')}</div>` : '';
  el.querySelectorAll('[data-vinre]').forEach(b => b.onclick = () => { document.getElementById('vinInput').value = b.dataset.vinre; vinLookup(b.dataset.vinre); });
}

async function vinLookup(raw){
  const out = document.getElementById('vinResult'); if(!out) return;
  const vin = cleanVin(raw); const input = document.getElementById('vinInput'); if(input) input.value = vin;
  const problem = vinProblem(vin);
  if(vin.length !== 17){ out.innerHTML = `<p class="form-error">${esc(problem || 'Type a 17-character VIN.')}</p>`; return; }
  const mySeq = ++vinState.seq;
  out.innerHTML = '<p class="meta">Looking up the VIN…</p>';
  const go = document.getElementById('vinGo'); if(go) go.disabled = true;
  // decode, our own units, in parallel
  const [dec, mine] = await Promise.all([
    vinDecodeFull(vin).then(d => ({ d }), e => ({ e })),
    sb.from('units').select('id, unit_number, customer_id, year, make, model, active').eq('vin', vin).limit(5)
  ]);
  if(go) go.disabled = false;
  if(mySeq !== vinState.seq) return;   // a newer lookup has started
  vinState.vin = vin;
  const units = (mine && mine.data) || [];
  let customers = {};
  if(units.length){
    const ids = [...new Set(units.map(u => u.customer_id).filter(Boolean))];
    if(ids.length){ const { data: cs } = await sb.from('customers').select('id, company_name').in('id', ids); (cs || []).forEach(c => customers[c.id] = c.company_name); }
  }
  if(dec.e){
    out.innerHTML = `${problem ? `<p class="inv-warn">⚠ ${esc(problem)}</p>` : ''}<p class="form-error">Couldn't reach the VIN service. Check your connection and try again.</p>${vinUnitsHtml(units, customers, vin, null)}`;
    vinWireResult(out, vin, null); return;
  }
  const x = dec.d; vinState.raw = x;
  const known = !!(x.Make || x.ModelYear);
  const title = [x.ModelYear, x.Make ? titleCase(x.Make) : '', x.Model].filter(Boolean).join(' ');
  if(known) vinRemember(vin, title || vin);
  const nhtsaNote = x.ErrorCode && !/^0\b/.test(String(x.ErrorCode)) ? String(x.ErrorText || '').split(';')[0] : '';
  const CAPS = { Make: 1, VehicleType: 1, TrailerType: 1, PlantCountry: 1, PlantCity: 1 };   // NHTSA sends these in capitals
  const rows = VIN_FIELDS.map(([k, label]) => [label, CAPS[k] ? titleCase(x[k]) : x[k]]).filter(([, v]) => v != null && String(v).trim() !== '' && String(v) !== 'Not Applicable');
  out.innerHTML = `
    ${problem ? `<p class="inv-warn">⚠ ${esc(problem)}</p>` : ''}
    ${known ? `<div class="card vin-card"><div class="vin-title"><div><b>${esc(title || 'Vehicle')}</b><div class="meta mono">${esc(vin)}</div></div>
        <button type="button" class="ghost-btn" id="vinCopy">Copy VIN</button></div>
        <dl class="vin-grid">${rows.map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>
        ${nhtsaNote ? `<p class="meta">NHTSA note: ${esc(nhtsaNote)}</p>` : ''}</div>`
      : `<p class="form-error">The NHTSA database doesn't recognise this VIN${nhtsaNote ? ' (' + esc(nhtsaNote) + ')' : ''}. Check it against the vehicle's door sticker or title.</p>`}
    ${vinUnitsHtml(units, customers, vin, known ? x : null)}
    ${known && x.Make && x.Model && x.ModelYear ? '<div id="vinRecalls"><p class="meta">Checking for safety recalls…</p></div>' : ''}`;
  vinWireResult(out, vin, known ? x : null);
  vinDrawRecent();
  if(known && x.Make && x.Model && x.ModelYear) vinRecalls(x.Make, x.Model, x.ModelYear, mySeq);
}

function vinUnitsHtml(units, customers, vin, x){
  if(units.length) return `<div class="section-head" style="margin-top:18px;"><h3>Already in your units</h3></div><div class="rec-list">
    ${units.map(u => `<div class="rec-row-static"><div class="rec-main"><b>${esc(u.unit_number || 'Unit')}</b>${u.active ? '' : ' <span class="meta">(removed)</span>'}
      <div class="meta">${esc(customers[u.customer_id] || 'no customer')} · ${esc([u.year, u.make, u.model].filter(Boolean).join(' '))}</div></div>
      <button type="button" class="text-btn" data-vinunit="${u.id}">Repair history</button></div>`).join('')}</div>`;
  return `<div class="job-actions" style="margin-top:14px;"><span class="meta">This VIN is not one of your units yet.</span>
    <button type="button" id="vinAddUnit">Add as a new unit</button></div>`;
}
function vinWireResult(out, vin, x){
  const copy = out.querySelector('#vinCopy');
  if(copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(vin); recordsToast('VIN copied'); } catch(_){ recordsToast('Could not copy — select it and copy by hand'); } };
  out.querySelectorAll('[data-vinunit]').forEach(b => b.onclick = () => { if(typeof openUnitHistory === 'function') openUnitHistory(Number(b.dataset.vinunit)); });
  const add = out.querySelector('#vinAddUnit');
  if(add) add.onclick = () => {
    if(typeof openUnitForm !== 'function') return;
    openUnitForm(null);
    // the unit form fills itself from the VIN, using the same decoder
    setTimeout(() => { const f = document.getElementById('ufVin'); if(f){ f.value = vin; if(typeof vinFill === 'function') vinFill(vin); } }, 60);
  };
}

// the full NHTSA answer (the unit form only needs year/make/model/engine)
async function vinDecodeFull(vin){
  const r = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json');
  if(!r.ok) throw new Error('VIN service answered ' + r.status);
  return ((await r.json()).Results || [])[0] || {};
}

// Recalls are published by make, model and year — not by VIN — so the result says so honestly.
async function vinRecalls(make, model, year, mySeq){
  const el = () => document.getElementById('vinRecalls');
  try {
    const r = await fetch('https://api.nhtsa.gov/recalls/recallsByVehicle?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model) + '&modelYear=' + encodeURIComponent(year));
    if(mySeq !== vinState.seq || !el()) return;
    if(!r.ok) throw new Error(String(r.status));
    const list = ((await r.json()).results || []).sort((a, b) => String(b.ReportReceivedDate || '').localeCompare(String(a.ReportReceivedDate || '')));
    el().innerHTML = `<div class="section-head" style="margin-top:18px;"><h3>Safety recalls</h3><span class="meta">${list.length ? list.length + ' for ' + esc([year, titleCase(make), model].join(' ')) : 'none found'}</span></div>
      ${list.length ? `<p class="meta">Recalls are listed for every ${esc(year)} ${esc(titleCase(make))} ${esc(model)}. Check with the dealer whether this particular vehicle has had the fix done.</p>
        <div class="rec-list">${list.slice(0, 15).map(c => `<details class="vin-recall"><summary><b>${esc(c.Component || 'Recall')}</b> <span class="meta mono">${esc(c.NHTSACampaignNumber || '')}</span></summary>
          ${c.Summary ? `<p>${esc(c.Summary)}</p>` : ''}${c.Consequence ? `<p><b>Risk:</b> ${esc(c.Consequence)}</p>` : ''}${c.Remedy ? `<p><b>Fix:</b> ${esc(c.Remedy)}</p>` : ''}</details>`).join('')}</div>
        ${list.length > 15 ? `<p class="meta">Showing the 15 most recent of ${list.length}.</p>` : ''}`
      : '<p class="meta">NHTSA lists no recalls for this make, model and year.</p>'}`;
  } catch(_){
    if(mySeq === vinState.seq && el()) el().innerHTML = '<p class="meta">Couldn\'t check recalls right now. The vehicle details above are still correct.</p>';
  }
}
