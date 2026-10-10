// ============================================================
// RelayFleet — Redesign R6a: spreadsheet import + new-shop setup checklist.
// Import: CSV or Excel → match columns → preview → import_records (the
// database checks every row and reports problems by row). Checklist:
// ticks itself off from the shop's real data.
// ============================================================
const IMPORT_FIELDS = {
  customers: [['company_name','Company name',1,['company','companyname','customer','customername','name','business','account']], ['contact_name','Contact name',0,['contact','contactname','contactperson']],
    ['phone','Phone',0,['phone','phonenumber','tel','telephone','mobile','cell']], ['email','Email',0,['email','emailaddress','mail']], ['billing_email','Billing email',0,['billingemail','apemail','invoiceemail','accountspayable']],
    ['billing_address','Billing address',0,['address','billingaddress','street','mailingaddress']], ['payment_terms','Payment terms',0,['terms','paymentterms']], ['notes','Notes',0,['notes','note','comments']]],
  units: [['unit_number','Unit number',1,['unit','unitnumber','unitno','truck','trucknumber','trailer','trailernumber','fleetnumber','fleetno','number','equipment']], ['customer','Customer',0,['customer','customername','company','owner','fleet']],
    ['unit_type','Type',0,['type','unittype','equipmenttype','category']], ['vin','VIN',0,['vin','vinnumber','serial']], ['year','Year',0,['year','modelyear']], ['make','Make',0,['make','manufacturer','brand']],
    ['model','Model',0,['model']], ['plate','Plate',0,['plate','license','licenseplate','tag']], ['plate_state','Plate state',0,['state','platestate']], ['odometer','Odometer',0,['odometer','miles','mileage','odo']], ['notes','Notes',0,['notes','note','comments']]],
  parts: [['name','Part name',1,['name','partname','description','desc','item','itemname','product']], ['part_number','Part number',0,['partnumber','part','pn','partno','sku','itemnumber','itemno']],
    ['brand','Brand',0,['brand','manufacturer','mfr','make']], ['category','Category',0,['category','group','type']], ['cost','Cost',0,['cost','unitcost','ourcost','purchaseprice']],
    ['unit_price','Sell price',0,['price','sellprice','saleprice','retail','listprice','unitprice']], ['qty_on_hand','Quantity on hand',0,['qty','quantity','onhand','qoh','stock','instock','count']],
    ['min_qty','Minimum quantity',0,['min','minqty','minimum','reorderpoint','reorder']], ['vendor','Vendor',0,['vendor','supplier']]]
};
const IMPORT_LABEL = { customers:'Customers', units:'Units (trucks & trailers)', parts:'Parts' };
let importState = null;
const normHead = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function parseCsv(text){
  text = text.replace(/^\ufeff/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){ if(c === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if(c === '"') q = true; else if(c === delim){ row.push(cell); cell = ''; }
    else if(c === '\n' || c === '\r'){ if(c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if(cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
function loadSheetJs(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Could not load the Excel reader. Save the file as CSV and try again.')); document.head.appendChild(s); });
}
async function readSheet(file){
  if(/\.(xlsx|xls)$/i.test(file.name)){
    const X = await loadSheetJs();
    const wb = X.read(await file.arrayBuffer(), { type:'array' });
    return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header:1, raw:false, defval:'' }).filter(r => r.some(x => String(x).trim() !== ''));
  }
  return parseCsv(await file.text());
}
function guessMapping(kind, headers){
  const map = {};
  IMPORT_FIELDS[kind].forEach(([key, , , syn]) => {
    const i = headers.findIndex((h, n) => !Object.values(map).includes(n) && (normHead(h) === normHead(key) || syn.includes(normHead(h))));
    if(i >= 0) map[key] = i;
  });
  return map;
}
function renderImportCard(){
  const box = document.getElementById('importBox');
  if(!box) return;
  const st = importState;
  const fields = st ? IMPORT_FIELDS[st.kind] : null;
  const mapped = st ? st.rows.map(r => { const o = {}; fields.forEach(([k]) => { if(st.map[k] != null) o[k] = String(r[st.map[k]] ?? '').trim(); }); return o; }) : [];
  box.innerHTML = `<div class="card qbo-card">
    <h3>Import from a spreadsheet</h3>
    <p class="meta">Bring in your existing customers, trucks and trailers, or parts list from a CSV or Excel file. Every row is checked; problems are listed by row number.</p>
    <div class="mig-cta"><div><b>Switching from Fullbay, Shopmonkey or another system?</b><span class="meta">Add all your exported files at once — Relay sorts them out.</span></div><button type="button" id="migStart">Bring everything over</button></div>
    <div class="rec-toolbar"><select id="impKind" aria-label="What to import">${Object.entries(IMPORT_LABEL).map(([k, l]) => `<option value="${k}" ${st && st.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button type="button" class="ghost-btn" id="impTemplate">Download a template</button>
      <label class="ghost-btn imp-file">Choose file…<input type="file" id="impFile" accept=".csv,.xlsx,.xls,text/csv" hidden></label></div>
    ${st ? `<div class="imp-map"><p><b>${esc(st.fileName)}</b> · ${st.rows.length} row${st.rows.length === 1 ? '' : 's'}. Check which column holds each field:</p>
      <div class="rec-grid">${fields.map(([k, label, req]) => `<div class="field"><label>${label}${req ? ' *' : ''}</label><select data-map="${k}"><option value="">— not in my file —</option>${st.headers.map((h, i) => `<option value="${i}" ${st.map[k] === i ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="an-scroll"><table class="an-table imp-preview"><thead><tr><th>Row</th>${fields.filter(([k]) => st.map[k] != null).map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody>${mapped.slice(0, 8).map((o, i) => `<tr><td>${i + 2}</td>${fields.filter(([k]) => st.map[k] != null).map(([k]) => `<td>${esc(o[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${st.rows.length > 8 ? `<p class="meta">Showing the first 8 of ${st.rows.length}.</p>` : ''}
      <label class="rec-check"><input type="checkbox" id="impUpdate" ${st.update ? 'checked' : ''}> Update records that already exist (same ${st.kind === 'customers' ? 'company name' : st.kind === 'units' ? 'unit number' : 'part number'})</label>
      <p class="form-error" id="impErr"></p>
      <div class="job-actions"><button type="button" id="impGo">Import ${st.rows.length} row${st.rows.length === 1 ? '' : 's'}</button><button type="button" class="ghost-btn" id="impReset">Start over</button></div></div>` : ''}
    <div id="impResult">${st && st.result ? st.result : ''}</div></div>`;
  document.getElementById('impKind').onchange = (e) => { if(importState){ importState.kind = e.target.value; importState.map = guessMapping(importState.kind, importState.headers); importState.result = ''; } renderImportCard(); if(!importState) box.dataset.kind = e.target.value; };
  document.getElementById('impTemplate').onclick = () => { const k = document.getElementById('impKind').value; downloadCsv('relay-import-' + k + '.csv', [IMPORT_FIELDS[k].map(([, l]) => l)]); };
  document.getElementById('impFile').onchange = async (e) => {
    const f = e.target.files[0]; if(!f) return;
    try {
      const rows = await readSheet(f);
      if(rows.length < 2) throw new Error('The file needs a header row and at least one row of data.');
      if(rows.length > 5001) throw new Error('Import up to 5,000 rows at a time — split the file.');
      const kind = document.getElementById('impKind').value, headers = rows[0].map(String);
      importState = { kind, fileName: f.name, headers, rows: rows.slice(1), map: guessMapping(kind, headers), update:false, result:'' };
    } catch(err){ importState = null; renderImportCard(); document.getElementById('importBox').querySelector('.qbo-card').insertAdjacentHTML('beforeend', `<p class="form-error">${esc(err.message)}</p>`); return; }
    renderImportCard();
  };
  if(!st) return;
  box.querySelectorAll('[data-map]').forEach(s => s.onchange = () => { st.map[s.dataset.map] = s.value === '' ? undefined : Number(s.value); renderImportCard(); });
  document.getElementById('impUpdate').onchange = (e) => { st.update = e.target.checked; };
  document.getElementById('impReset').onclick = () => { importState = null; renderImportCard(); };
  document.getElementById('impGo').onclick = async () => {
    const req = fields.filter(([, , r]) => r).find(([k]) => st.map[k] == null);
    if(req){ document.getElementById('impErr').textContent = `Pick the column for "${req[1]}".`; return; }
    const btn = document.getElementById('impGo'); btn.disabled = true;
    const tot = { inserted:0, updated:0, skipped:0, errors:[] };
    for(let i = 0; i < mapped.length; i += 500){
      btn.textContent = `Importing… ${Math.min(i + 500, mapped.length)} of ${mapped.length}`;
      const { data, error } = await sb.rpc('import_records', { p_kind: st.kind, p_rows: mapped.slice(i, i + 500), p_update: st.update });
      if(error){ document.getElementById('impErr').textContent = error.message; btn.disabled = false; btn.textContent = 'Try again'; return; }
      tot.inserted += data.inserted; tot.updated += data.updated; tot.skipped += data.skipped;
      (data.errors || []).forEach(e => tot.errors.push({ row: e.row + i + 1, message: e.message }));   // +1: the header row
    }
    st.result = `<div class="imp-done"><b>Done.</b> ${tot.inserted} added · ${tot.updated} updated · ${tot.skipped} already existed${tot.errors.length ? ` · <span class="neg">${tot.errors.length} need fixing</span>` : ''}</div>
      ${tot.errors.length ? `<div class="imp-errs">${tot.errors.slice(0, 200).map(e => `<div>Row ${e.row}: ${esc(e.message)}</div>`).join('')}</div>` : ''}`;
    recordsToast(`Imported ${tot.inserted + tot.updated} ${st.kind}`);
    renderImportCard();
  };
}
function initImportUI(){
  const box = document.getElementById('integrationsBox');
  if(!box || document.getElementById('importBox')) return renderImportCard();
  box.insertAdjacentHTML('afterbegin', '<div id="importBox"></div>');
  renderImportCard();
}

// ================= New-shop setup checklist =================
async function renderSetupChecklist(){
  const ov = document.getElementById('shop-overview');
  if(!ov || !session || session.role !== 'shop' || (typeof can === 'function' && !can('settings'))) return;
  let box = document.getElementById('setupBox');
  const key = 'relay.setupHidden.' + session.orgId;
  try { if(localStorage.getItem(key) === '1'){ if(box) box.remove(); return; } } catch(_){}
  const [o, mech, cust, units, jobs, bays] = await Promise.all([
    sb.from('organizations').select('billing_address, billing_phone, billing_email, labor_rate, default_tax_rate, logo_path').eq('id', session.orgId).maybeSingle(),
    sb.from('profiles').select('id', { count:'exact', head:true }).eq('org_id', session.orgId).eq('role', 'mechanic'),
    sb.from('customers').select('id', { count:'exact', head:true }).eq('org_id', session.orgId),
    sb.from('units').select('id', { count:'exact', head:true }).eq('org_id', session.orgId),
    sb.from('jobs').select('id', { count:'exact', head:true }).eq('org_id', session.orgId),
    sb.from('shop_bays').select('id', { count:'exact', head:true }).eq('org_id', session.orgId)]);
  const org = o.data || {};
  const steps = [
    ['Add your company details', 'Address, phone and logo — they appear on estimates and invoices.', !!(org.billing_address && (org.billing_phone || org.billing_email)), 'shop-billing', 'Open Settings'],
    ['Set your labor rate and sales tax', 'Used for estimates, invoices and reports.', org.labor_rate != null && org.default_tax_rate != null, 'shop-billing', 'Open Settings'],
    ['Invite your mechanics', 'Share your shop code so they can join from their phones.', (mech.count || 0) > 0, 'shop-team', 'Open Team'],
    ['Add your customers and units', 'Import them from a spreadsheet, or add them one by one.', (cust.count || 0) > 0 && (units.count || 0) > 0, 'shop-integrations', 'Import'],
    ['Create your first work order', 'Or accept a request from your request link.', (jobs.count || 0) > 0, 'shop-jobs', 'New work order'],
    ['Set up your bays (optional)', 'For the Shop floor screen.', (bays.count || 0) > 0, 'shop-billing', 'Open Settings']];
  const done = steps.filter(s => s[2]).length;
  if(done === steps.length){ if(box) box.remove(); return; }
  if(!box){ box = document.createElement('div'); box.id = 'setupBox'; box.className = 'setup-box'; ov.insertBefore(box, ov.firstChild); }
  box.innerHTML = `<div class="setup-head"><div><h2>Get your shop ready</h2><span class="meta">${done} of ${steps.length} done</span></div><button type="button" class="text-btn" id="setupHide">Hide</button></div>
    <div class="setup-bar"><span style="width:${Math.round(done / steps.length * 100)}%"></span></div>
    <ol class="setup-steps">${steps.map(([t, d, ok, target, btn], i) => `<li class="${ok ? 'ok' : ''}"><span class="setup-mark" aria-hidden="true">${ok ? '✓' : i + 1}</span>
      <div><b>${t}</b><span>${d}</span></div>${ok ? '<em>Done</em>' : `<button type="button" class="ghost-btn" data-go="${target}" data-new="${target === 'shop-jobs' ? 1 : ''}">${btn}</button>`}</li>`).join('')}</ol>`;
  box.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const t = document.querySelector(`.dash-tab[data-target="${b.dataset.go}"]`); if(t) t.click();
    if(b.dataset.new){ const cb = document.getElementById('woCreateBox'), nb = document.getElementById('woNewBtn'); if(cb){ cb.classList.remove('hidden'); if(nb) nb.textContent = 'Close'; } }
  });
  document.getElementById('setupHide').onclick = () => { try { localStorage.setItem(key, '1'); } catch(_){} box.remove(); };
}
