// ============================================================
// RelayFleet — "Switching from another system?" (Fullbay, Shopmonkey,
// Tekmetric, spreadsheets…). Drop all exported files at once (CSV/Excel,
// every sheet of a workbook). Relay recognises each file from its columns,
// combines split fields (First+Last name, Address/City/State/ZIP), and imports
// customers → units → parts through import_records (same checks as Import).
// Formats aren't hard-coded: every column match can be changed before importing.
// ============================================================
// More column names other systems use (also helps the one-file import).
const MIG_SYN = {
  customers: { company_name:['companyname','businessname','fleetname','accountname','customername','company','organization','organisation','fleet'], contact_name:['contact','contactname','primarycontact','fullname'],
    phone:['phonenumber','mobilephone','mobile','cellphone','cell','workphone','phone1','primaryphone','telephone'], email:['emailaddress','primaryemail','email1'], billing_address:['address1','addressline1','streetaddress','address','street'],
    payment_terms:['terms','paymentterms','netterms'], notes:['notes','note','memo','comments'] },
  units: { unit_number:['unit','unitnumber','unitno','fleetnumber','fleetunit','truck','trucknumber','trailernumber','vehiclenumber','equipmentnumber','assetnumber','asset','stocknumber','unitid'],
    customer:['customer','customername','owner','company','fleet','account','companyname'], vin:['vin','vinnumber','serialnumber','serial'], year:['year','modelyear'], make:['make','manufacturer'], model:['model'],
    plate:['licenseplate','plate','license','plateno','platenumber','tag'], plate_state:['platestate','licensestate','licenseplatestate','state'], odometer:['odometer','mileage','miles','odometerreading','currentmileage','currentodometer'],
    unit_type:['type','vehicletype','unittype','equipmenttype','bodytype','vehicleclass'] },
  parts: { name:['description','partdescription','name','partname','itemname','item','title'], part_number:['partnumber','part','partno','sku','itemnumber','mfgpartnumber','manufacturerpartnumber','number'],
    brand:['brand','manufacturer','mfg','mfr'], category:['category','partcategory','group','type'], cost:['cost','unitcost','ourcost','averagecost','avgcost','lastcost','purchaseprice','wholesale'],
    unit_price:['price','retail','retailprice','sellprice','saleprice','listprice','unitprice','msrp','sellingprice'], qty_on_hand:['quantity','qty','onhand','qtyonhand','quantityonhand','instock','stock','available','availablequantity','qoh'],
    min_qty:['min','minqty','minimum','reorderpoint','minstock','minquantity','reorderlevel'], vendor:['vendor','supplier','vendorname','preferredvendor'] }
};
// extra customer pieces that get combined
const MIG_PIECES = [['first','First name',['firstname','first','givenname']], ['last','Last name',['lastname','last','surname','familyname']], ['address2','Address line 2',['address2','addressline2','suite','unit2']],
  ['city','City',['city','town']], ['state','State',['state','province','region']], ['zip','ZIP',['zip','zipcode','postalcode','postcode','zippostal']]];
(function extendSynonyms(){
  if(typeof IMPORT_FIELDS !== 'object') return;
  Object.entries(MIG_SYN).forEach(([kind, fields]) => (IMPORT_FIELDS[kind] || []).forEach(f => { (fields[f[0]] || []).forEach(s => { if(!f[3].includes(s)) f[3].push(s); }); }));
})();
let migState = null;

async function migReadAll(file){
  if(/\.(xlsx|xls)$/i.test(file.name)){
    const X = await loadSheetJs();
    const wb = X.read(await file.arrayBuffer(), { type:'array' });
    return wb.SheetNames.map(n => ({ name: file.name + (wb.SheetNames.length > 1 ? ' — ' + n : ''), rows: X.utils.sheet_to_json(wb.Sheets[n], { header:1, raw:false, defval:'' }).filter(r => r.some(x => String(x).trim() !== '')) }));
  }
  return [{ name: file.name, rows: parseCsv(await file.text()) }];
}
function migMap(kind, headers){
  const map = guessMapping(kind, headers);
  if(kind === 'customers'){ MIG_PIECES.forEach(([k, , syn]) => { const i = headers.findIndex((h, n) => !Object.values(map).includes(n) && syn.includes(normHead(h))); if(i >= 0) map[k] = i; }); }
  if(kind === 'customers' && map.company_name == null && map.first == null && map.last == null){ const i = headers.findIndex(h => normHead(h) === 'name'); if(i >= 0) map.company_name = i; }
  return map;
}
// What is this file? Scored from its columns, with the file name as a hint.
function migDetect(name, headers){
  const n = String(name).toLowerCase(), H = headers.map(normHead);
  if(/vendor|supplier/.test(n) && !H.some(h => /qty|quantity|onhand|partnumber/.test(h))) return { kind:'skip', why:'Vendors — Relay adds vendors from your parts list.' };
  if(/invoice|report|lineitem|profit|payment|appointment|labor/.test(n)) return { kind:'skip', why:'Reports and past invoices aren\'t imported — your new work starts in Relay.' };
  const score = {};
  ['customers','units','parts'].forEach(k => { const m = migMap(k, headers); score[k] = Object.keys(m).length; });
  if(H.some(h => h === 'vin' || h === 'vinnumber')) score.units += 3;
  if(H.some(h => /^(year|modelyear)$/.test(h)) && H.some(h => h === 'make')) score.units += 2;
  if(H.some(h => /partnumber|partno|sku|qtyonhand|onhand|quantity/.test(h))) score.parts += 3;
  if(H.some(h => /firstname|lastname|email|emailaddress|phone|phonenumber/.test(h))) score.customers += 2;
  if(/customer|fleet|client|contact/.test(n)) score.customers += 3;
  if(/vehicle|unit|equipment|asset|truck|trailer/.test(n)) score.units += 3;
  if(/inventory|part|stock|product/.test(n)) score.parts += 3;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 3 ? { kind: best[0] } : { kind:'skip', why:"Couldn't tell what this file holds — pick the type if it's customers, units or parts." };
}
function migRows(f){
  const m = f.map, get = (r, k) => m[k] != null ? String(r[m[k]] ?? '').trim() : '';
  return f.rows.map(r => {
    const o = {};
    IMPORT_FIELDS[f.kind].forEach(([k]) => { const v = get(r, k); if(v !== '') o[k] = v; });
    if(f.kind === 'customers'){
      const person = [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ');
      if(!o.company_name && person) o.company_name = person;
      if(!o.contact_name && person && o.company_name !== person) o.contact_name = person;
      const line1 = [o.billing_address, get(r, 'address2')].filter(Boolean).join(', ');
      const cityLine = [get(r, 'city'), [get(r, 'state'), get(r, 'zip')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const addr = [line1, cityLine].filter(Boolean).join(', '); if(addr) o.billing_address = addr;
    }
    return o;
  }).filter(o => Object.keys(o).length);
}
function migFieldsFor(kind){ return IMPORT_FIELDS[kind].map(([k, l, req]) => [k, l, req]).concat(kind === 'customers' ? MIG_PIECES.map(([k, l]) => [k, l, 0]) : []); }

function openMigration(){
  const node = document.createElement('div'); node.className = 'mig-box'; node.id = 'migBox';
  migState = { files: [], result: null };
  openFormSheet('Switching from another system?', [node], () => { migState = null; node.remove(); });
  renderMigration();
}
function renderMigration(){
  const box = document.getElementById('migBox'); if(!box || !migState) return;
  const st = migState, KIND = { customers:'Customers', units:'Units (trucks & trailers)', parts:'Parts & inventory', skip:'Skip this file' };
  const ready = st.files.filter(f => f.kind !== 'skip');
  box.innerHTML = `<p class="meta mig-intro">Export your <b>customers</b>, <b>vehicles/units</b> and <b>parts/inventory</b> from Fullbay, Shopmonkey, Tekmetric or any system as CSV or Excel, then add all the files here. Relay works out what each one is.</p>
    <label class="mig-drop" id="migDrop"><input type="file" id="migFiles" multiple accept=".csv,.xlsx,.xls,text/csv" hidden><b>Choose files</b><span>or drop them here · CSV or Excel</span></label>
    ${st.files.length ? `<div class="mig-files">${st.files.map((f, i) => `<div class="mig-file${f.kind === 'skip' ? ' skip' : ''}">
        <div class="mig-file-head"><div><b>${esc(f.name)}</b><span class="meta">${f.rows.length} row${f.rows.length === 1 ? '' : 's'}</span></div>
          <select data-mkind="${i}" aria-label="What this file holds">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${f.kind === 'skip' ? `<p class="meta">${esc(f.why || 'Skipped.')}</p>` : `<details><summary>Check columns (${Object.keys(f.map).length} matched)</summary><div class="rec-grid">${migFieldsFor(f.kind).map(([k, label, req]) => `<div class="field"><label>${esc(label)}${req ? ' *' : ''}</label><select data-mmap="${i}" data-field="${k}"><option value="">—</option>${f.headers.map((h, n) => `<option value="${n}" ${f.map[k] === n ? 'selected' : ''}>${esc(h || 'Column ' + (n + 1))}</option>`).join('')}</select></div>`).join('')}</div>
          <p class="meta">Example: ${esc(JSON.stringify(migRows({ ...f, rows: f.rows.slice(0, 1) })[0] || {}).replace(/[{}"]/g, '').replace(/,/g, ' · ').slice(0, 220))}</p></details>`}
      </div>`).join('')}</div>` : ''}
    <p class="form-error" id="migErr"></p>
    ${st.result ? st.result : ''}
    ${ready.length ? `<div class="job-actions"><label class="rec-check"><input type="checkbox" id="migUpdate"> Update records that already exist</label><button type="button" id="migGo">Import ${ready.length} file${ready.length === 1 ? '' : 's'}</button></div>` : ''}`;
  const input = document.getElementById('migFiles');
  input.onchange = () => migAddFiles([...input.files]);
  const drop = document.getElementById('migDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); migAddFiles([...e.dataTransfer.files]); });
  box.querySelectorAll('[data-mkind]').forEach(s => s.onchange = () => { const f = st.files[Number(s.dataset.mkind)]; f.kind = s.value; f.why = s.value === 'skip' ? 'Skipped.' : ''; if(f.kind !== 'skip') f.map = migMap(f.kind, f.headers); st.result = null; renderMigration(); });
  box.querySelectorAll('[data-mmap]').forEach(s => s.onchange = () => { const f = st.files[Number(s.dataset.mmap)]; if(s.value === '') delete f.map[s.dataset.field]; else f.map[s.dataset.field] = Number(s.value); renderMigration(); });
  const go = document.getElementById('migGo'); if(go) go.onclick = () => runMigration(document.getElementById('migUpdate').checked);
}
async function migAddFiles(list){
  const err = document.getElementById('migErr'); if(err) err.textContent = '';
  for(const file of list){
    try {
      for(const sh of await migReadAll(file)){
        if(sh.rows.length < 2) continue;
        if(sh.rows.length > 20001){ if(err) err.textContent = sh.name + ' has more than 20,000 rows — split it and add the parts.'; continue; }
        const headers = sh.rows[0].map(String), det = migDetect(sh.name, headers);
        const f = { name: sh.name, headers, rows: sh.rows.slice(1), kind: det.kind, why: det.why || '', map: {} };
        if(f.kind !== 'skip') f.map = migMap(f.kind, headers);
        migState.files.push(f);
      }
    } catch(e){ if(err) err.textContent = file.name + ': ' + (e.message || e); }
  }
  migState.result = null; renderMigration();
}
async function runMigration(update){
  const st = migState, err = document.getElementById('migErr');
  const order = ['customers','units','parts'];
  const todo = st.files.filter(f => f.kind !== 'skip').sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for(const f of todo){
    const req = migFieldsFor(f.kind).filter(([k, , r]) => r && !(k === 'company_name' && (f.map.first != null || f.map.last != null)));
    const missing = req.find(([k]) => f.map[k] == null);
    if(missing){ err.textContent = `${f.name}: pick the column for "${missing[1]}" (under Check columns).`; return; }
  }
  const go = document.getElementById('migGo'); go.disabled = true;
  const lines = [];
  for(const f of todo){
    const rows = migRows(f); const tot = { inserted:0, updated:0, skipped:0, errors:[] };
    for(let i = 0; i < rows.length; i += 500){
      go.textContent = `Importing ${f.name}… ${Math.min(i + 500, rows.length)} of ${rows.length}`;
      const { data, error } = await sb.rpc('import_records', { p_kind: f.kind, p_rows: rows.slice(i, i + 500), p_update: !!update });
      if(error){ tot.errors.push({ row: i + 2, message: error.message + ' (this batch was not imported)' }); continue; }
      tot.inserted += data.inserted; tot.updated += data.updated; tot.skipped += data.skipped;
      (data.errors || []).forEach(e => tot.errors.push({ row: e.row + i + 1, message: e.message }));
    }
    lines.push({ f, tot });
  }
  st.result = `<div class="mig-result"><b>Import finished.</b>${lines.map(({ f, tot }) => `<div class="mig-line"><span>${esc(f.name)} → ${{ customers:'customers', units:'units', parts:'parts' }[f.kind]}</span><span>${tot.inserted} added · ${tot.updated} updated · ${tot.skipped} already in Relay${tot.errors.length ? ` · <span class="neg">${tot.errors.length} need fixing</span>` : ''}</span></div>
      ${tot.errors.length ? `<div class="imp-errs">${tot.errors.slice(0, 100).map(e => `<div>Row ${e.row}: ${esc(e.message)}</div>`).join('')}</div>` : ''}`).join('')}</div>`;
  recordsToast('Import finished'); renderMigration();
}
document.addEventListener('click', (e) => { if(e.target.closest('#migStart')) openMigration(); });
