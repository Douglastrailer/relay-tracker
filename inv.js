// ============================================================
// RelayFleet — Phase 7: parts and inventory.
// Stock levels are always calculated by the database from movements
// (receive, use, return, count, move); nothing here edits a quantity
// directly. Mechanics only record parts used on their own jobs.
// ============================================================

let invState = { items:[], onhand:{}, levels:[], locations:[], vendors:[], pos:[], tab:'parts' };
const invMoney = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
const qtyFmt = n => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits:2 });
const PO_STATUS = { draft:'Draft', ordered:'Ordered', partial:'Partly received', received:'Received', cancelled:'Cancelled' };

// The parts list is fetched a page at a time (parts_page). Everything else — locations, vendors,
// purchase orders — stays loaded, since those lists are short.
async function loadInventoryData(){
  const [oh, lv, locs, vendors, pos] = await Promise.all([
    sb.from('stock_on_hand').select('item_id, on_hand, low').eq('org_id', session.orgId).limit(2000),
    sb.from('stock_levels').select('item_id, location_id, qty, bin').eq('org_id', session.orgId).limit(5000),
    sb.from('stock_locations').select('id, name, kind, mechanic_id, active').eq('org_id', session.orgId).order('kind').order('name'),
    sb.from('vendors').select('id, name, contact_name, phone, email, notes, active').eq('org_id', session.orgId).order('name'),
    sb.from('purchase_orders').select('id, po_number, vendor_id, location_id, status, notes, ordered_at, expected_at, received_at, created_at, purchase_order_lines(id, item_id, qty_ordered, qty_received, unit_cost)').eq('org_id', session.orgId).order('created_at', { ascending:false }).limit(200)
  ]);
  invState.onhand = {}; (oh.data || []).forEach(r => invState.onhand[r.item_id] = r);
  invState.levels = lv.data || [];
  invState.locations = locs.data || [];
  invState.vendors = vendors.data || [];
  invState.pos = pos.data || [];
}
const partsState = { q:'', filter:'all', vendor:'', category:'', offset:0, rows:[], count:0, totals:{}, seq:0, loading:false };
const vendorName = id => (invState.vendors.find(v => v.id === id) || {}).name || '';
const locName = id => (invState.locations.find(l => l.id === id) || {}).name || '';
const itemName = id => { const i = invState.items.find(x => x.id === id); return i ? i.name + (i.part_number ? ' (' + i.part_number + ')' : '') : 'Part'; };

async function refreshInventoryV2(){
  const root = document.getElementById('invRoot');
  if(!root) return;
  await loadInventoryData();
  const low = invState.items.filter(i => (invState.onhand[i.id] || {}).low).length;
  updateLowStockBadge(low);
  root.innerHTML = `
    <nav class="fleet-tabs inv-tabs">
      ${[['parts','Parts & prices'],['reorder','Low stock'],['count','Count'],['cores','Cores'],['pos','Purchase orders'],['vendors','Vendors'],['locations','Locations']].map(([k, l]) => `<button type="button" class="fleet-tab${invState.tab === k ? ' active' : ''}" data-itab="${k}">${l}${k === 'parts' && low ? ` <span class="inv-low-count">${low} low</span>` : ''}</button>`).join('')}
    </nav>
    <div id="invFormBox" class="hidden"></div>
    <div id="invPanel"></div>`;
  root.querySelectorAll('[data-itab]').forEach(b => b.onclick = () => { invState.tab = b.dataset.itab; refreshInventoryV2(); });
  ({ parts: renderParts, reorder: renderReorder, count: renderCount, cores: renderCores, pos: renderPOs, vendors: renderVendors, locations: renderLocations })[invState.tab]();
}
function updateLowStockBadge(n){
  const tab = document.querySelector('.dash-tab[data-target="shop-inventory"] .nav-label');
  if(!tab) return;
  let b = tab.parentElement.querySelector('.nav-low');
  if(n && !b){ b = document.createElement('span'); b.className = 'nav-low'; tab.after(b); }
  if(b){ if(n){ b.textContent = n; b.title = n + ' part' + (n === 1 ? '' : 's') + ' low on stock'; } else b.remove(); }
}
function invForm(html){ const b = document.getElementById('invFormBox'); b.innerHTML = `<div class="card rec-form">${html}</div>`; b.classList.remove('hidden'); b.scrollIntoView({ behavior:'smooth', block:'start' }); const c = b.querySelector('.inv-close'); if(c) c.onclick = () => { b.innerHTML = ''; b.classList.add('hidden'); }; return b; }
function invErr(msg){
  // A form opened in the blurred sheet has its own #invErr; the inventory panels use #invPanelErr.
  // Write into the form on screen when there is one, otherwise into the panel.
  const sheet = document.getElementById('formSheet');
  const inSheet = sheet && !sheet.classList.contains('hidden') ? sheet.querySelector('#invErr') : null;
  const e = inSheet || document.getElementById('invPanelErr') || document.getElementById('invErr');
  if(e) e.textContent = msg; else if(msg) alert(msg);
}

// ---------------- Parts & prices ----------------
function renderParts(){
  const panel = document.getElementById('invPanel');
  const cats = [...new Set(invState.items.map(i => i.category).filter(Boolean))].sort();
  panel.innerHTML = `<div class="rec-toolbar">
      <input type="search" id="invSearch" placeholder="Search name, part #, brand, cross-reference, vendor" aria-label="Search parts" value="${esc(partsState.q)}">
      <select id="invVendorFilter" aria-label="Filter by vendor"><option value="">All vendors</option>${invState.vendors.filter(v => v.active).map(v => `<option value="${v.id}" ${String(partsState.vendor) === String(v.id) ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
      <select id="invCatFilter" aria-label="Filter by category"><option value="">All categories</option>${cats.map(c => `<option value="${esc(c)}" ${partsState.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button type="button" class="ghost-btn" id="invScanCode">Scan part</button>
      <button type="button" class="ghost-btn" id="invScan">Scan vendor invoice</button>
      <button type="button" class="ghost-btn" id="invPrices">Change prices</button>
      <button type="button" id="invAdd">Add part or service</button>
    </div>
    <div id="invNegWarn"></div>
    <div class="fd-dates" id="invFilters"></div>
    <div class="meta" id="invSummary"></div>
    <div id="invList" class="rec-list"></div>
    <button id="invLoadMore" class="btn-ghost hidden" style="margin-top:14px;">Load more</button>`;
  const chips = () => {
    const t = partsState.totals || {};
    const set = [['all', 'All parts', t.all], ['low', 'Low stock', t.low], ['negative', 'Below zero', t.negative], ['nostock', 'None on hand', t.nostock], ['service', 'Services', t.service]];
    document.getElementById('invFilters').innerHTML = set.filter(([k, , n]) => k === 'all' || k === partsState.filter || Number(n) > 0)
      .map(([k, l, n]) => `<button type="button" class="fd-chip${partsState.filter === k ? ' active' : ''}" data-pfilter="${k}">${l}${n != null ? ' (' + n + ')' : ''}</button>`).join('');
  };
  const draw = () => {
    document.getElementById('invList').innerHTML = partsState.rows.length ? partsState.rows.map(i => {
      const low = i.low, lv = (i.levels || []).filter(l => Number(l.qty) !== 0);
      return `<div class="inv-row${low ? ' is-low' : ''}${Number(i.on_hand) < 0 ? ' is-neg' : ''}">
        <div class="rec-main"><b>${esc(i.name)}</b>
          <div class="meta">${[i.part_number ? '#' + i.part_number : '', i.brand, i.category, vendorName(i.vendor_id), Number(i.core_charge) > 0 ? 'Core ' + invMoney(i.core_charge) : ''].filter(Boolean).map(esc).join(' · ')}</div>
          ${i.track_stock && lv.length ? `<div class="meta">${lv.map(l => `${esc(locName(l.location_id))}: <b class="${Number(l.qty) < 0 ? 'neg' : ''}">${qtyFmt(l.qty)}</b>${l.bin ? ' (' + esc(l.bin) + ')' : ''}`).join(' · ')}</div>` : ''}</div>
        <div class="inv-nums"><span><em>Price</em>${invMoney(i.unit_price)}</span>${i.cost != null ? `<span><em>Cost</em>${invMoney(i.cost)}</span>` : ''}
          ${i.track_stock ? `<span><em>On hand</em><b class="${Number(i.on_hand) < 0 ? 'neg' : ''}">${qtyFmt(i.on_hand)}</b></span><span><em>Min</em>${qtyFmt(i.min_qty)}</span>` : '<span><em>Service</em>—</span>'}</div>
        <div class="inv-actions"><button type="button" class="text-btn" data-edit="${i.id}">Edit</button>
          <details class="row-more"><summary aria-label="More actions for ${esc(i.name)}">More</summary><div class="row-menu">
          ${i.track_stock ? `<button type="button" class="text-btn" data-count="${i.id}">Count</button><button type="button" class="text-btn" data-move="${i.id}">Move</button><button type="button" class="text-btn" data-hist="${i.id}">History</button>` : ''}
          <button type="button" class="text-btn" data-usage="${i.id}">Usage</button>
          <button type="button" class="text-btn danger" data-del="${i.id}">Remove</button></div></details></div></div>`;
    }).join('') : `<div class="empty-note">${partsState.q || partsState.filter !== 'all' || partsState.vendor || partsState.category ? 'Nothing matches. <button type="button" class="link" data-pclear>Clear the filters</button>' : '<b>No parts yet.</b> <span class="empty-acts"><button type="button" class="ghost-btn" data-click="invAdd">Add a part</button><button type="button" class="ghost-btn" data-click="openMigrate">Import a list</button></span>'}</div>`;
    const left = Math.max(0, partsState.count - partsState.rows.length), more = document.getElementById('invLoadMore');
    more.classList.toggle('hidden', left === 0); more.textContent = `Load more (${left} left)`;
    const t = partsState.totals || {};
    const warn = document.getElementById('invNegWarn');
    if(warn) warn.innerHTML = Number(t.negative) > 0 && partsState.filter !== 'negative'
      ? `<div class="inv-warn">⚠ ${t.negative} part${Number(t.negative) === 1 ? ' is' : 's are'} below zero. That usually means parts were used without being received first. <button type="button" class="link" data-pfilter="negative">Show them</button></div>` : '';
    document.getElementById('invSummary').textContent = partsState.count
      ? `${partsState.count} part${partsState.count === 1 ? '' : 's'}${t.stock_value != null ? ' · stock on hand is worth ' + invMoney(t.stock_value) : ''}` : '';
    chips();
  };
  const load = async (append) => {
    const mySeq = ++partsState.seq; partsState.loading = true;
    if(!append){ partsState.offset = 0; document.getElementById('invList').innerHTML = '<div class="meta">Loading…</div>'; }
    const { data, error } = await sb.rpc('parts_page', { p_search: partsState.q || null, p_filter: partsState.filter, p_vendor: partsState.vendor ? Number(partsState.vendor) : null, p_category: partsState.category || null, p_offset: partsState.offset, p_limit: 50 });
    if(mySeq !== partsState.seq) return;
    partsState.loading = false;
    if(error || !data){ document.getElementById('invList').innerHTML = `<div class="form-error">Parts couldn't be loaded${error ? ': ' + esc(error.message) : '.'}</div>`; document.getElementById('invLoadMore').classList.add('hidden'); return; }
    partsState.rows = append ? partsState.rows.concat(data.rows || []) : (data.rows || []);
    partsState.count = Number(data.count || 0); partsState.totals = data.totals || {};
    partsState.offset = partsState.rows.length;
    invState.items = partsState.rows;            // the forms and pickers read this
    updateLowStockBadge(Number((data.totals || {}).low || 0));
    draw();
  };
  let t = null;
  document.getElementById('invSearch').oninput = (e) => { clearTimeout(t); partsState.q = e.target.value.trim(); t = setTimeout(() => load(false), 300); };
  document.getElementById('invVendorFilter').onchange = (e) => { partsState.vendor = e.target.value; load(false); };
  document.getElementById('invCatFilter').onchange = (e) => { partsState.category = e.target.value; load(false); };
  document.getElementById('invAdd').onclick = () => openItemForm(null);
  document.getElementById('invLoadMore').onclick = () => load(true);
  document.getElementById('invPrices').onclick = () => openPriceChange();
  const scanBtn = document.getElementById('invScan'); if(scanBtn) scanBtn.onclick = () => startInvoiceScan();
  const codeBtn = document.getElementById('invScanCode'); if(codeBtn){ if(typeof inventoryScan === 'function') codeBtn.onclick = () => inventoryScan(); else codeBtn.remove(); }
  panel.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-pfilter]'); if(f){ partsState.filter = f.dataset.pfilter; load(false); return; }
    if(e.target.closest('[data-pclear]')){ Object.assign(partsState, { q:'', filter:'all', vendor:'', category:'' }); document.getElementById('invSearch').value = ''; document.getElementById('invVendorFilter').value = ''; document.getElementById('invCatFilter').value = ''; load(false); return; }
    const b = e.target.closest('[data-edit],[data-count],[data-move],[data-hist],[data-usage],[data-del]'); if(!b) return;
    if(b.dataset.edit) openItemForm(Number(b.dataset.edit));
    else if(b.dataset.count) openCountForm(Number(b.dataset.count));
    else if(b.dataset.move) openMoveForm(Number(b.dataset.move));
    else if(b.dataset.hist) openHistory(Number(b.dataset.hist));
    else if(b.dataset.usage) openUsage(Number(b.dataset.usage));
    else if(b.dataset.del){
      if(!confirm('Remove this from your parts and price list? Its history is kept.')) return;
      const { error } = await sb.from('inventory_items').update({ active:false }).eq('id', Number(b.dataset.del));
      if(error){ alert(error.message); return; }
      load(false); if(typeof populateInventoryPicker === 'function') populateInventoryPicker();
    }
  });
  load(false);
}

function openItemForm(id){
  const i = id ? invState.items.find(x => x.id === id) : null;
  const v = k => i && i[k] != null ? esc(String(i[k])) : '';
  const box = invForm(`<div class="rec-form-head"><h3>${i ? 'Edit ' + esc(i.name) : 'Add a part or service'}</h3><button type="button" class="ghost inv-close">Close</button></div>
    <div class="rec-grid">
      <div class="field"><label>Name *</label><input id="ifName" maxlength="120" value="${v('name')}" placeholder="e.g. Glad hand seal"></div>
      <div class="field"><label>Part number</label><input id="ifPn" maxlength="60" value="${v('part_number')}"></div>
      <div class="field"><label>Your cost ($)</label><input id="ifCost" type="number" min="0" step="0.01" value="${v('cost')}"></div>
      <div class="field"><label>Selling price ($) *</label><input id="ifPrice" type="number" min="0" step="0.01" value="${v('unit_price')}"></div>
      <div class="field"><label>Vendor</label><select id="ifVendor"><option value="">—</option>${invState.vendors.filter(x => x.active || (i && x.id === i.vendor_id)).map(x => `<option value="${x.id}" ${i && i.vendor_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Minimum on hand (low-stock alert)</label><input id="ifMin" type="number" min="0" step="1" value="${i ? Number(i.min_qty) : 0}"></div>
      <label class="rec-check rec-span"><input type="checkbox" id="ifTrack" ${!i || i.track_stock ? 'checked' : ''}> Track stock for this part (leave unticked for services like labor or shop supplies)</label>
    </div>
    <details class="more-details"${i && (i.category || i.brand || i.cross_ref || i.barcode || i.fitment || i.description || Number(i.core_charge) > 0) ? ' open' : ''}><summary>More details</summary>
    <div class="rec-grid">
      <div class="field"><label>Category</label><input id="ifCat" maxlength="60" value="${v('category')}" placeholder="e.g. Air system"></div>
      <div class="field"><label>Brand</label><input id="ifBrand" maxlength="60" value="${v('brand')}" placeholder="e.g. Haldex"></div>
      <div class="field"><label>Core charge ($)</label><input id="ifCore" type="number" min="0" step="0.01" value="${v('core_charge')}" placeholder="0.00"></div>
      <div class="field"><label>Barcode</label><div class="vin-row"><input id="ifBarcode" maxlength="80" class="mono" value="${v('barcode')}" placeholder="Scan or type"><button type="button" class="ghost-btn" id="ifScanBarcode">Scan</button></div></div>
      <div class="field rec-span"><label>Cross-reference numbers</label><input id="ifXref" maxlength="300" value="${v('cross_ref')}" placeholder="Other part numbers for the same part, separated by commas"></div>
      <div class="field rec-span"><label>Fits (optional)</label><input id="ifFitment" maxlength="500" value="${v('fitment')}" placeholder="Makes, models or engines it fits — e.g. Kenworth T680, Freightliner Cascadia"></div>
      <div class="field rec-span"><label>Description</label><input id="ifDesc" maxlength="300" value="${v('description')}"></div>
    </div></details>
    </div><p class="form-error" id="invErr"></p><div class="job-actions"><button type="button" id="ifSave">${i ? 'Save' : 'Add'}</button></div>`);
  const sc = box.querySelector('#ifScanBarcode');
  if(sc){ if(typeof openScanner === 'function') sc.onclick = () => openScanner('Scan this part\'s barcode', code => { document.getElementById('ifBarcode').value = code; }); else sc.remove(); }
  box.querySelector('#ifSave').onclick = async () => {
    const name = document.getElementById('ifName').value.trim(), price = parseFloat(document.getElementById('ifPrice').value);
    const costRaw = document.getElementById('ifCost').value, cost = costRaw === '' ? null : parseFloat(costRaw), min = parseFloat(document.getElementById('ifMin').value) || 0;
    if(!name){ invErr('Enter a name.'); return; }
    if(!(price >= 0)){ invErr('Enter a selling price of 0 or more.'); return; }
    if(cost != null && !(cost >= 0)){ invErr('Cost cannot be negative.'); return; }
    const row = { name, unit_price: price, cost, min_qty: Math.max(0, min), part_number: document.getElementById('ifPn').value.trim() || null,
      category: document.getElementById('ifCat').value.trim() || null, vendor_id: Number(document.getElementById('ifVendor').value) || null,
      description: document.getElementById('ifDesc').value.trim() || null, track_stock: document.getElementById('ifTrack').checked,
      brand: document.getElementById('ifBrand').value.trim() || null, cross_ref: document.getElementById('ifXref').value.trim() || null, barcode: (document.getElementById('ifBarcode').value || '').trim() || null, fitment: (document.getElementById('ifFitment').value || '').trim() || null,
      core_charge: document.getElementById('ifCore').value === '' ? null : parseFloat(document.getElementById('ifCore').value) };
    if(row.core_charge != null && !(row.core_charge >= 0)){ invErr('Core charge cannot be negative.'); return; }
    const res = i ? await sb.from('inventory_items').update(row).eq('id', i.id) : await sb.from('inventory_items').insert([{ ...row, org_id: session.orgId, created_by: session.id }]);
    if(res.error && res.error.code === '23505' && /barcode/.test(res.error.message || '')){ invErr('That barcode is already used by another part.'); return; }
    if(res.error){ invErr(res.error.code === '23505' ? 'That part number is already in your list.' : res.error.message); return; }
    recordsToast(i ? 'Saved' : 'Added'); refreshInventoryV2(); if(typeof populateInventoryPicker === 'function') populateInventoryPicker();
  };
}

function locOptions(selected){ return invState.locations.filter(l => l.active).map(l => `<option value="${l.id}" ${l.id === selected ? 'selected' : ''}>${esc(l.name)}</option>`).join(''); }
function openCountForm(id){
  const i = invState.items.find(x => x.id === id);
  const shop = (invState.locations.find(l => l.kind === 'shop' && l.active) || {}).id;
  const cur = lid => Number((invState.levels.find(l => l.item_id === id && l.location_id === lid) || {}).qty || 0);
  const box = invForm(`<div class="rec-form-head"><h3>Count — ${esc(i.name)}</h3><button type="button" class="ghost inv-close">Close</button></div>
    <div class="rec-grid"><div class="field"><label>Location</label><select id="cLoc">${locOptions(shop)}</select></div>
      <div class="field"><label>Counted on the shelf</label><input id="cQty" type="number" min="0" step="1" value="${cur(shop)}"></div>
      <div class="field rec-span"><label>Note</label><input id="cNote" maxlength="300" placeholder="e.g. Monthly count"></div></div>
    <p class="meta" id="cCur">System shows ${qtyFmt(cur(shop))} here.</p><p class="form-error" id="invErr"></p>
    <div class="job-actions"><button type="button" id="cSave">Save count</button></div>`);
  box.querySelector('#cLoc').onchange = () => { const l = Number(document.getElementById('cLoc').value); document.getElementById('cQty').value = cur(l); document.getElementById('cCur').textContent = 'System shows ' + qtyFmt(cur(l)) + ' here.'; };
  box.querySelector('#cSave').onclick = async () => {
    const q = parseFloat(document.getElementById('cQty').value);
    if(!(q >= 0)){ invErr('Enter a count of 0 or more.'); return; }
    const { data, error } = await sb.rpc('adjust_stock', { p_item: id, p_location: Number(document.getElementById('cLoc').value), p_new_qty: q, p_note: document.getElementById('cNote').value.trim() || null });
    if(error){ invErr(error.message); return; }
    recordsToast(Number(data) ? 'Count saved (' + (data > 0 ? '+' : '') + qtyFmt(data) + ')' : 'Count matches — no change'); refreshInventoryV2();
  };
}
function openMoveForm(id){
  const i = invState.items.find(x => x.id === id);
  const box = invForm(`<div class="rec-form-head"><h3>Move — ${esc(i.name)}</h3><button type="button" class="ghost inv-close">Close</button></div>
    <div class="rec-grid"><div class="field"><label>From</label><select id="mFrom">${locOptions()}</select></div><div class="field"><label>To</label><select id="mTo">${locOptions()}</select></div>
      <div class="field"><label>Quantity</label><input id="mQty" type="number" min="1" step="1" value="1"></div><div class="field"><label>Note</label><input id="mNote" maxlength="300" placeholder="e.g. Truck restock"></div></div>
    <p class="form-error" id="invErr"></p><div class="job-actions"><button type="button" id="mSave">Move</button></div>`);
  const to = box.querySelector('#mTo'); if(to.options.length > 1) to.selectedIndex = 1;
  box.querySelector('#mSave').onclick = async () => {
    const q = parseFloat(document.getElementById('mQty').value);
    const { error } = await sb.rpc('transfer_stock', { p_item: id, p_from: Number(document.getElementById('mFrom').value), p_to: Number(document.getElementById('mTo').value), p_qty: q, p_note: document.getElementById('mNote').value.trim() || null });
    if(error){ invErr(error.message); return; }
    recordsToast('Moved'); refreshInventoryV2();
  };
}
async function openHistory(id){
  const i = invState.items.find(x => x.id === id);
  const { data } = await sb.from('stock_movements').select('created_at, kind, qty_change, location_id, note, job_id, jobs(ro_number)').eq('item_id', id).order('created_at', { ascending:false }).limit(100);
  const K = { receive:'Received', use:'Used on repair', return:'Returned', adjust:'Count', transfer:'Moved' };
  invForm(`<div class="rec-form-head"><h3>History — ${esc(i.name)}</h3><button type="button" class="ghost inv-close">Close</button></div>
    ${(data || []).length ? `<div class="inv-hist">${data.map(m => `<div><span class="meta">${fmtDateTime(m.created_at)}</span><span>${esc(K[m.kind] || m.kind)}${m.jobs && m.jobs.ro_number ? ' · ' + esc(m.jobs.ro_number) : ''}${m.note ? ' · ' + esc(m.note) : ''}</span><span>${esc(locName(m.location_id))}</span><b class="${m.qty_change < 0 ? 'neg' : 'pos'}">${m.qty_change > 0 ? '+' : ''}${qtyFmt(m.qty_change)}</b></div>`).join('')}</div>` : '<p class="meta">No stock history yet.</p>'}`);
}

async function reorderLowStock(){
  const low = invState.items.filter(i => (invState.onhand[i.id] || {}).low);
  if(!low.length){ alert('Nothing is low on stock right now.'); return; }
  if(!confirm(`Create draft purchase orders for ${low.length} low part${low.length === 1 ? '' : 's'}? One per vendor; you can edit them before ordering.`)) return;
  const byVendor = {};
  low.forEach(i => { (byVendor[i.vendor_id || 0] = byVendor[i.vendor_id || 0] || []).push(i); });
  let made = 0;
  for(const [vid, items] of Object.entries(byVendor)){
    const { data: po, error } = await sb.from('purchase_orders').insert([{ org_id: session.orgId, vendor_id: Number(vid) || null, notes: 'Low-stock reorder', created_by: session.id }]).select('id').single();
    if(error){ alert(error.message); return; }
    // Order enough to get back to twice the minimum.
    const lines = items.map(i => ({ po_id: po.id, item_id: i.id, unit_cost: i.cost, qty_ordered: Math.max(1, Math.ceil(Number(i.min_qty) * 2 - Number((invState.onhand[i.id] || {}).on_hand || 0))) }));
    const { error: e2 } = await sb.from('purchase_order_lines').insert(lines);
    if(e2){ alert(e2.message); return; }
    made++;
  }
  recordsToast(made + ' draft purchase order' + (made === 1 ? '' : 's') + ' created');
  invState.tab = 'pos'; refreshInventoryV2();
}

// ---------------- Purchase orders ----------------
function renderPOs(){
  const panel = document.getElementById('invPanel');
  panel.innerHTML = `<div class="rec-toolbar"><span class="meta">Receiving a purchase order adds the parts to stock and updates their cost.</span><button type="button" id="poNew">New purchase order</button></div>
    <div class="rec-list">${invState.pos.length ? invState.pos.map(po => { const ls = po.purchase_order_lines || [];
      const total = ls.reduce((s, l) => s + Number(l.qty_ordered) * Number(l.unit_cost || 0), 0);
      return `<button type="button" class="rec-row" data-po="${po.id}"><div class="rec-main"><b>${esc(po.po_number)}</b><div class="meta">${esc(vendorName(po.vendor_id) || 'No vendor')} · ${ls.length} line${ls.length === 1 ? '' : 's'} · ${fmtDate(po.created_at)}${po.expected_at ? ' · expected ' + fmtDate(po.expected_at) : ''}</div></div>
        <div class="rec-side"><b>${invMoney(total)}</b><span class="rec-tag">${esc(PO_STATUS[po.status])}</span></div></button>`; }).join('') : '<div class="empty-note">No purchase orders yet.</div>'}</div>`;
  document.getElementById('poNew').onclick = () => openPO(null);
  panel.querySelectorAll('[data-po]').forEach(b => b.onclick = () => openPO(Number(b.dataset.po)));
}
function openPO(id){
  const po = id ? invState.pos.find(x => x.id === id) : null;
  const editable = !po || po.status === 'draft';
  const receivable = po && ['ordered','partial'].includes(po.status);
  const lines = po ? (po.purchase_order_lines || []) : [];
  const box = invForm(`<div class="rec-form-head"><h3>${po ? esc(po.po_number) + ' · ' + esc(PO_STATUS[po.status]) : 'New purchase order'}</h3><button type="button" class="ghost inv-close">Close</button></div>
    <div class="rec-grid">
      <div class="field"><label>Vendor</label><select id="poVendor" ${editable ? '' : 'disabled'}><option value="">—</option>${invState.vendors.map(v => `<option value="${v.id}" ${po && po.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Receive into</label><select id="poLoc" ${editable ? '' : 'disabled'}>${locOptions(po ? po.location_id : null)}</select></div>
      <div class="field"><label>Expected</label><input type="date" id="poExp" value="${po && po.expected_at ? po.expected_at : ''}" ${editable || receivable ? '' : 'disabled'}></div>
      <div class="field"><label>Notes</label><input id="poNotes" maxlength="1000" value="${po ? esc(po.notes || '') : ''}"></div>
    </div>
    <div class="po-lines">${lines.map(l => `<div class="po-line"><span>${esc(itemName(l.item_id))}</span><span>${qtyFmt(l.qty_received)} / ${qtyFmt(l.qty_ordered)} received</span><span>${l.unit_cost != null ? invMoney(l.unit_cost) + ' ea' : ''}</span>
        ${receivable && Number(l.qty_received) < Number(l.qty_ordered) ? `<span class="po-recv"><input type="number" aria-label="Quantity received" min="1" max="${Number(l.qty_ordered) - Number(l.qty_received)}" step="1" value="${Number(l.qty_ordered) - Number(l.qty_received)}" data-rq="${l.id}" aria-label="Quantity to receive"><input type="number" min="0" step="0.01" value="${l.unit_cost != null ? Number(l.unit_cost) : ''}" placeholder="cost" data-rc="${l.id}" aria-label="Unit cost"><button type="button" class="ghost-btn" data-recv="${l.id}">Receive</button></span>` : ''}
        ${editable ? `<button type="button" class="text-btn danger" data-rmline="${l.id}">Remove</button>` : ''}</div>`).join('') || '<p class="meta">No lines yet.</p>'}</div>
    ${editable ? `<div class="insp-start"><select id="poItem"><option value="">Add a part…</option>${invState.items.filter(i => i.track_stock || i.part_number).map(i => `<option value="${i.id}">${esc(itemName(i.id))}</option>`).join('')}</select><input id="poQty" type="number" min="1" step="1" value="1" style="max-width:90px"><button type="button" id="poAddLine">Add line</button></div>` : ''}
    <p class="form-error" id="invErr"></p>
    <div class="job-actions">${editable ? `<button type="button" id="poSave">${po ? 'Save' : 'Create'}</button>` : ''}${po && po.status === 'draft' ? '<button type="button" id="poOrdered">Mark ordered</button>' : ''}${po && ['draft','ordered'].includes(po.status) && lines.every(l => !Number(l.qty_received)) ? '<button type="button" class="ghost-btn" id="poCancel">Cancel PO</button>' : ''}</div>`);
  const header = () => ({ vendor_id: Number(document.getElementById('poVendor').value) || null, location_id: Number(document.getElementById('poLoc').value) || null,
    expected_at: document.getElementById('poExp').value || null, notes: document.getElementById('poNotes').value.trim() || null });
  const saveHeader = async () => {
    if(po){ const { error } = await sb.from('purchase_orders').update(editable ? header() : { expected_at: header().expected_at, notes: header().notes }).eq('id', po.id); return error; }
    const { data, error } = await sb.from('purchase_orders').insert([{ ...header(), org_id: session.orgId, created_by: session.id }]).select('id').single();
    if(!error) id = data.id; return error;
  };
  const reopen = async () => { await refreshInventoryV2(); openPO(id); };
  const on = (sel, fn) => { const el = box.querySelector(sel); if(el) el.onclick = fn; };
  on('#poSave', async () => { const e = await saveHeader(); if(e){ invErr(e.message); return; } recordsToast('Saved'); reopen(); });
  on('#poAddLine', async () => {
    const item = Number(document.getElementById('poItem').value), qty = parseFloat(document.getElementById('poQty').value);
    if(!item){ invErr('Pick a part.'); return; } if(!(qty > 0)){ invErr('Enter a quantity above 0.'); return; }
    if(!po){ const e = await saveHeader(); if(e){ invErr(e.message); return; } }
    const it = invState.items.find(x => x.id === item);
    const { error } = await sb.from('purchase_order_lines').insert([{ po_id: id, item_id: item, qty_ordered: qty, unit_cost: it ? it.cost : null }]);
    if(error){ invErr(error.message); return; } reopen();
  });
  box.querySelectorAll('[data-rmline]').forEach(b => b.onclick = async () => { const { error } = await sb.from('purchase_order_lines').delete().eq('id', Number(b.dataset.rmline)); if(error){ invErr(error.message); return; } reopen(); });
  on('#poOrdered', async () => { if(!lines.length){ invErr('Add at least one line first.'); return; } const e = await saveHeader(); if(e){ invErr(e.message); return; }
    const { error } = await sb.from('purchase_orders').update({ status:'ordered' }).eq('id', po.id); if(error){ invErr(error.message); return; } recordsToast('Marked ordered'); reopen(); });
  on('#poCancel', async () => { if(!confirm('Cancel this purchase order?')) return; const { error } = await sb.from('purchase_orders').update({ status:'cancelled' }).eq('id', po.id); if(error){ invErr(error.message); return; } reopen(); });
  box.querySelectorAll('[data-recv]').forEach(b => b.onclick = async () => {
    const lid = Number(b.dataset.recv), q = parseFloat(box.querySelector(`[data-rq="${lid}"]`).value), cRaw = box.querySelector(`[data-rc="${lid}"]`).value;
    b.disabled = true;
    const { data, error } = await sb.rpc('receive_po_line', { p_line: lid, p_qty: q, p_unit_cost: cRaw === '' ? null : parseFloat(cRaw) });
    b.disabled = false;
    if(error){ invErr(error.message); return; }
    recordsToast(data === 'received' ? 'All received — purchase order closed' : 'Received'); reopen();
  });
}

// ---------------- Vendors and locations ----------------
function renderVendors(){
  const panel = document.getElementById('invPanel');
  panel.innerHTML = `<div class="rec-toolbar"><span class="meta">Where you buy parts.</span><button type="button" id="vNew">Add vendor</button></div>
    <div class="rec-list">${invState.vendors.length ? invState.vendors.map(v => `<button type="button" class="rec-row${v.active ? '' : ' is-inactive'}" data-v="${v.id}"><div class="rec-main"><b>${esc(v.name)}</b><div class="meta">${[v.contact_name, v.phone, v.email].filter(Boolean).map(esc).join(' · ') || 'No contact details'}</div></div><div class="rec-side">${v.active ? '' : '<span class="rec-tag">Inactive</span>'}</div></button>`).join('') : '<div class="empty-note">No vendors yet.</div>'}</div>`;
  document.getElementById('vNew').onclick = () => openVendor(null);
  panel.querySelectorAll('[data-v]').forEach(b => b.onclick = () => openVendor(Number(b.dataset.v)));
}
function openVendor(id){
  const v = id ? invState.vendors.find(x => x.id === id) : null;
  const val = k => v && v[k] ? esc(v[k]) : '';
  const box = invForm(`<div class="rec-form-head"><h3>${v ? esc(v.name) : 'New vendor'}</h3><button type="button" class="ghost inv-close">Close</button></div>
    <div class="rec-grid"><div class="field"><label>Name *</label><input id="vName" maxlength="120" value="${val('name')}"></div><div class="field"><label>Contact</label><input id="vContact" maxlength="120" value="${val('contact_name')}"></div>
      <div class="field"><label>Phone</label><input id="vPhone" maxlength="40" value="${val('phone')}"></div><div class="field"><label>Email</label><input id="vEmail" type="email" maxlength="200" value="${val('email')}"></div>
      <div class="field rec-span"><label>Notes</label><input id="vNotes" maxlength="1000" value="${val('notes')}" placeholder="e.g. Account #, delivery days"></div>
      ${v ? `<label class="rec-check"><input type="checkbox" id="vActive" ${v.active ? 'checked' : ''}> Active</label>` : ''}</div>
    <p class="form-error" id="invErr"></p><div class="job-actions"><button type="button" id="vSave">${v ? 'Save' : 'Add vendor'}</button></div>`);
  box.querySelector('#vSave').onclick = async () => {
    const row = { name: document.getElementById('vName').value.trim(), contact_name: document.getElementById('vContact').value.trim() || null, phone: document.getElementById('vPhone').value.trim() || null,
      email: document.getElementById('vEmail').value.trim() || null, notes: document.getElementById('vNotes').value.trim() || null };
    if(!row.name){ invErr('Enter a name.'); return; }
    if(v) row.active = document.getElementById('vActive').checked;
    const res = v ? await sb.from('vendors').update(row).eq('id', v.id) : await sb.from('vendors').insert([{ ...row, org_id: session.orgId }]);
    if(res.error){ invErr(res.error.code === '23505' ? 'You already have a vendor with that name.' : res.error.message); return; }
    recordsToast('Saved'); refreshInventoryV2();
  };
}
async function renderLocations(){
  const panel = document.getElementById('invPanel');
  const mechs = typeof fetchOrgMechanics === 'function' ? (await fetchOrgMechanics()).filter(m => m.active) : [];
  const mname = id => (mechs.find(m => m.id === id) || {}).name || '';
  panel.innerHTML = `<div class="rec-toolbar"><span class="meta">Your shop and each mechanic's service truck. Mechanics can take parts from the shop or their own truck.</span><button type="button" id="lNew">Add location</button></div>
    <div class="rec-list">${invState.locations.map(l => `<button type="button" class="rec-row${l.active ? '' : ' is-inactive'}" data-l="${l.id}"><div class="rec-main"><b>${esc(l.name)}</b><div class="meta">${l.kind === 'truck' ? 'Service truck' + (l.mechanic_id ? ' · ' + esc(mname(l.mechanic_id)) : '') : 'Shop'}</div></div>
      <div class="rec-side"><span class="meta">${invState.levels.filter(x => x.location_id === l.id && Number(x.qty) > 0).length} parts in stock</span>${l.active ? '' : '<span class="rec-tag">Inactive</span>'}</div></button>`).join('')}</div>`;
  const open = (l) => {
    const box = invForm(`<div class="rec-form-head"><h3>${l ? esc(l.name) : 'New location'}</h3><button type="button" class="ghost inv-close">Close</button></div>
      <div class="rec-grid"><div class="field"><label>Name *</label><input id="lName" maxlength="60" value="${l ? esc(l.name) : ''}" placeholder="e.g. Robert's truck"></div>
        <div class="field"><label>Type</label><select id="lKind"><option value="shop" ${l && l.kind === 'shop' ? 'selected' : ''}>Shop</option><option value="truck" ${!l || l.kind === 'truck' ? 'selected' : ''}>Service truck</option></select></div>
        <div class="field"><label>Mechanic (for a truck)</label><select id="lMech"><option value="">—</option>${mechs.map(m => `<option value="${m.id}" ${l && l.mechanic_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        ${l ? `<label class="rec-check"><input type="checkbox" id="lActive" ${l.active ? 'checked' : ''}> Active</label>` : ''}</div>
      <p class="form-error" id="invErr"></p><div class="job-actions"><button type="button" id="lSave">${l ? 'Save' : 'Add'}</button></div>`);
    box.querySelector('#lSave').onclick = async () => {
      const row = { name: document.getElementById('lName').value.trim(), kind: document.getElementById('lKind').value, mechanic_id: document.getElementById('lMech').value || null };
      if(!row.name){ invErr('Enter a name.'); return; }
      if(l) row.active = document.getElementById('lActive').checked;
      const res = l ? await sb.from('stock_locations').update(row).eq('id', l.id) : await sb.from('stock_locations').insert([{ ...row, org_id: session.orgId }]);
      if(res.error){ invErr(res.error.code === '23505' ? 'That name, or a truck for that mechanic, already exists.' : res.error.message); return; }
      recordsToast('Saved'); refreshInventoryV2();
    };
  };
  document.getElementById('lNew').onclick = () => open(null);
  panel.querySelectorAll('[data-l]').forEach(b => b.onclick = () => open(invState.locations.find(x => x.id === Number(b.dataset.l))));
}

// ---------------- Repair Order: parts used ----------------
async function loadRoParts(job, opts){
  const box = document.getElementById('roParts');
  if(!box) return;
  if(!opts.canWork){ box.classList.add('hidden'); return; }
  const [jp, items, locs] = await Promise.all([
    sb.from('job_parts').select('id, item_id, location_id, qty, returned_qty, unit_price, created_at').eq('job_id', job.id).order('created_at'),
    sb.from('inventory_items').select('id, name, part_number, unit_price, track_stock, barcode, cross_ref').eq('org_id', job.org_id).eq('active', true).order('name').limit(2000),
    sb.from('stock_locations').select('id, name, kind, mechanic_id').eq('org_id', job.org_id).eq('active', true)
  ]);
  const its = items.data || [];
  const nm = id => { const i = its.find(x => x.id === id); return i ? i.name + (i.part_number ? ' (' + i.part_number + ')' : '') : 'Part'; };
  // Mechanics take from the shop or their own truck; the shop from anywhere.
  const myLocs = (locs.data || []).filter(l => session.role !== 'mechanic' || l.kind === 'shop' || l.mechanic_id === session.id);
  const own = myLocs.find(l => l.mechanic_id === session.id);
  const parts = jp.data || [];
  const closed = ['paid','cancelled'].includes(job.status);
  box.classList.remove('hidden');
  box.innerHTML = `<h4>Parts used</h4>
    ${parts.length ? `<div class="po-lines">${parts.map(p => { const net = Number(p.qty) - Number(p.returned_qty);
      return `<div class="po-line"><span>${esc(nm(p.item_id))}</span><span>${qtyFmt(net)}${Number(p.returned_qty) ? ' <em class="meta">(' + qtyFmt(p.returned_qty) + ' returned)</em>' : ''}</span><span class="meta">${p.location_id ? esc(((locs.data || []).find(l => l.id === p.location_id) || {}).name || '') : ''}</span>
        ${!closed && net > 0 ? `<button type="button" class="text-btn" data-ret="${p.id}" data-max="${net}">Return</button>` : ''}</div>`; }).join('')}</div>` : '<p class="meta">No parts recorded yet.</p>'}
    ${!closed ? `<div class="insp-start parts-add">
      <input id="ppSearch" list="ppList" placeholder="Part name or number" aria-label="Part"><datalist id="ppList">${its.map(i => `<option value="${esc(i.name + (i.part_number ? ' (' + i.part_number + ')' : ''))}"></option>`).join('')}</datalist>
      <input id="ppQty" type="number" min="1" step="1" value="1" aria-label="Quantity" style="max-width:80px">
      <select id="ppLoc" aria-label="Taken from">${myLocs.map(l => `<option value="${l.id}" ${own && l.id === own.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <button type="button" class="ghost-btn" id="ppScan">Scan</button><button type="button" id="ppAdd">Add part</button></div><p class="pp-fit" id="ppFit"></p><p class="form-error" id="ppErr"></p>` : ''}`;
  // R11: find the chosen part, show whether it fits this unit
  const pick = () => { const txt = (document.getElementById('ppSearch') || {}).value; if(!txt) return null; const t = txt.trim().toLowerCase();
    return its.find(i => (i.name + (i.part_number ? ' (' + i.part_number + ')' : '')).toLowerCase() === t) || (typeof findPartByCode === 'function' ? findPartByCode(its, txt) : null) || its.find(i => i.name.toLowerCase() === t) || null; };
  let lastFit = null;
  const showFit = async () => { const it = pick(); const box = document.getElementById('ppFit'); if(!box) return; lastFit = null; box.innerHTML = '';
    if(!it) return; if(typeof fitmentFor !== 'function') return; lastFit = { id: it.id, f: await fitmentFor(it.id, job.unit_id) }; box.innerHTML = fitmentHtml(lastFit.f); };
  const ps = document.getElementById('ppSearch'); if(ps) ps.addEventListener('change', showFit);
  const sc = document.getElementById('ppScan');
  if(sc && typeof openScanner !== 'function') sc.remove();   // scanning arrives with parts.js; adding parts never depends on it
  else if(sc) sc.onclick = () => openScanner('Scan a part', (code) => {
    const it = findPartByCode(its, code);
    if(!it){ document.getElementById('ppErr').textContent = 'No part with code ' + code + ' — link the barcode to a part in Inventory → Scan part.'; return; }
    ps.value = it.name + (it.part_number ? ' (' + it.part_number + ')' : ''); showFit();
  });
  const add = document.getElementById('ppAdd');
  if(add) add.onclick = async () => {
    { const it0 = pick(); if(it0 && typeof fitmentFor === 'function'){ const f = lastFit && lastFit.id === it0.id ? lastFit.f : await fitmentFor(it0.id, job.unit_id);
        if(f && f.verdict === 'mismatch' && !confirm("This part doesn't match this unit:\n" + (f.reason || '') + "\n\nAdd it anyway?")) return; } }
    const txt = document.getElementById('ppSearch').value.trim().toLowerCase();
    const it = its.find(i => (i.name + (i.part_number ? ' (' + i.part_number + ')' : '')).toLowerCase() === txt) || its.find(i => i.part_number && i.part_number.toLowerCase() === txt) || its.find(i => i.name.toLowerCase() === txt);
    const err = document.getElementById('ppErr'); err.textContent = '';
    if(!it){ err.textContent = 'Pick a part from the list.'; return; }
    const q = parseFloat(document.getElementById('ppQty').value);
    add.disabled = true;
    const { error } = await sb.rpc('use_part', { p_job: job.id, p_item: it.id, p_location: Number(document.getElementById('ppLoc').value) || null, p_qty: q });
    add.disabled = false;
    if(error){ err.textContent = error.message; return; }
    recordsToast('Part added'); loadRoParts(job, opts);
  };
  box.querySelectorAll('[data-ret]').forEach(b => b.onclick = async () => {
    const q = prompt(`How many to return to stock? (up to ${b.dataset.max})`, b.dataset.max);
    if(q === null) return;
    const { error } = await sb.rpc('return_part', { p_job_part: Number(b.dataset.ret), p_qty: parseFloat(q) });
    if(error){ alert(error.message); return; }
    recordsToast('Returned to stock'); loadRoParts(job, opts);
  });
}

function initInventoryV2(){
  const tab = document.querySelector('.dash-tab[data-target="shop-inventory"]');
  if(tab) tab.addEventListener('click', refreshInventoryV2);
  refreshInventoryV2();
}


// ============================================================
// Low stock → what to order, grouped by vendor
// ============================================================
let reorderData = null;
async function renderReorder(){
  const panel = document.getElementById('invPanel');
  panel.innerHTML = '<div class="meta">Working out what you need…</div>';
  const { data, error } = await sb.rpc('reorder_suggestions');
  if(error || !data){ panel.innerHTML = `<div class="form-error">Couldn't work out the low stock${error ? ': ' + esc(error.message) : '.'}</div>`; return; }
  reorderData = data;
  const vendors = data.vendors || [];
  if(!vendors.length){ panel.innerHTML = '<div class="empty-note"><b>Nothing is low.</b> Parts appear here when the amount on hand (plus anything already on order) drops to the minimum you set.</div>'; return; }
  panel.innerHTML = `<div class="rec-toolbar"><div class="meta">${data.count} part${data.count === 1 ? '' : 's'} to order · about ${invMoney(data.est_cost)}</div>
      <select id="roLocation" aria-label="Deliver to"><option value="">Deliver to… (optional)</option>${invState.locations.filter(l => l.active).map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
      <button type="button" id="roCreate">Create purchase orders</button></div>
    <p class="form-error" id="invPanelErr"></p>
    ${vendors.map(v => `<div class="section ro-vendor">
      <div class="section-head"><h3>${esc(v.vendor_name)}</h3><span class="meta">about ${invMoney(v.est_cost)}</span>
        <label class="rec-check"><input type="checkbox" class="ro-all" data-vendor="${v.vendor_id || ''}" checked> All</label></div>
      <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Part</th><th class="num">On hand</th><th class="num">On order</th><th class="num">Min</th><th class="num">Used (90 days)</th><th class="num">Order</th></tr></thead><tbody>
      ${(v.lines || []).map(l => `<tr>
        <td><label class="rec-check"><input type="checkbox" class="ro-pick" data-vendor="${v.vendor_id || ''}" data-item="${l.item_id}" checked> <b>${esc(l.name)}</b></label>${l.part_number ? `<div class="meta">#${esc(l.part_number)}</div>` : ''}</td>
        <td class="num ${Number(l.on_hand) <= 0 ? 'neg' : ''}">${qtyFmt(l.on_hand)}</td><td class="num">${qtyFmt(l.on_order)}</td><td class="num">${qtyFmt(l.min_qty)}</td><td class="num">${qtyFmt(l.used_90)}</td>
        <td class="num"><input type="number" class="ro-qty" data-item="${l.item_id}" min="0" step="1" value="${l.suggest}" aria-label="Quantity to order for ${esc(l.name)}" style="width:5.5rem"></td></tr>`).join('')}
      </tbody></table></div></div>`).join('')}`;
  panel.querySelectorAll('.ro-all').forEach(a => a.onchange = () => panel.querySelectorAll(`.ro-pick[data-vendor="${a.dataset.vendor}"]`).forEach(c => { c.checked = a.checked; }));
  document.getElementById('roCreate').onclick = async () => {
    const lines = [...panel.querySelectorAll('.ro-pick:checked')].map(c => {
      const q = panel.querySelector(`.ro-qty[data-item="${c.dataset.item}"]`);
      return { item_id: Number(c.dataset.item), qty: Number(q && q.value) || 0 };
    }).filter(l => l.qty > 0);
    if(!lines.length){ invErr('Tick at least one part with a quantity above 0.'); return; }
    const btn = document.getElementById('roCreate'); btn.disabled = true; btn.textContent = 'Creating…';
    const loc = document.getElementById('roLocation').value;
    const { data: res, error: err } = await sb.rpc('create_reorder_pos', { p_lines: lines, p_location: loc ? Number(loc) : null });
    btn.disabled = false; btn.textContent = 'Create purchase orders';
    if(err){ invErr(err.message); return; }
    recordsToast(`${res.created} draft purchase order${res.created === 1 ? '' : 's'} created`);
    invState.tab = 'pos'; refreshInventoryV2();
  };
}

// ============================================================
// Count: a whole location in one go
// ============================================================
const countState = { location:'', onlyStocked:false, q:'', rows:[], entered:{} };
async function renderCount(){
  const panel = document.getElementById('invPanel');
  const locs = invState.locations.filter(l => l.active);
  if(!countState.location && locs.length) countState.location = String(locs[0].id);
  panel.innerHTML = `<div class="rec-toolbar">
      <select id="cntLoc" aria-label="Location to count">${locs.map(l => `<option value="${l.id}" ${String(l.id) === String(countState.location) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <input type="search" id="cntSearch" placeholder="Search this list" aria-label="Search the count sheet" value="${esc(countState.q)}">
      <label class="rec-check"><input type="checkbox" id="cntStocked" ${countState.onlyStocked ? 'checked' : ''}> Only parts already here</label>
      <button type="button" class="ghost-btn" id="cntFill">Copy expected into every box</button>
      <button type="button" id="cntSave">Save the count</button></div>
    <p class="meta">Type what you actually counted. Blank boxes are left alone, so you can stop and come back.</p>
    <p class="form-error" id="invPanelErr"></p>
    <div id="cntList"></div>`;
  const draw = () => {
    const rows = countState.rows;
    document.getElementById('cntList').innerHTML = rows.length ? `<div class="cw-wrap"><table class="cw-table"><thead><tr><th>Part</th><th class="num">Relay expects</th><th class="num">Counted</th><th class="num">Difference</th></tr></thead><tbody>
      ${rows.map(r => { const e = countState.entered[r.item_id]; const diff = e === undefined || e === '' ? null : Number(e) - Number(r.expected);
        return `<tr><td><b>${esc(r.name)}</b>${r.part_number ? `<div class="meta">#${esc(r.part_number)}${r.bin ? ' · ' + esc(r.bin) : ''}</div>` : ''}</td>
        <td class="num">${qtyFmt(r.expected)}</td>
        <td class="num"><input type="number" class="cnt-in" data-item="${r.item_id}" min="0" step="1" value="${e === undefined ? '' : esc(String(e))}" aria-label="Counted for ${esc(r.name)}" style="width:5.5rem"></td>
        <td class="num ${diff == null ? '' : diff === 0 ? 'meta' : diff < 0 ? 'neg' : 'pos'}">${diff == null ? '—' : (diff > 0 ? '+' : '') + qtyFmt(diff)}</td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty-note">Nothing to count here yet.</div>';
    document.getElementById('cntList').querySelectorAll('.cnt-in').forEach(inp => inp.oninput = () => { countState.entered[inp.dataset.item] = inp.value; const row = inp.closest('tr'); const r = countState.rows.find(x => String(x.item_id) === inp.dataset.item);
      const cell = row.lastElementChild; const d = inp.value === '' ? null : Number(inp.value) - Number(r.expected);
      cell.textContent = d == null ? '—' : (d > 0 ? '+' : '') + qtyFmt(d); cell.className = 'num ' + (d == null ? '' : d === 0 ? 'meta' : d < 0 ? 'neg' : 'pos'); });
  };
  const load = async () => {
    document.getElementById('cntList').innerHTML = '<div class="meta">Loading…</div>';
    const { data, error } = await sb.rpc('count_session_list', { p_location: Number(countState.location), p_search: countState.q || null, p_only_stocked: countState.onlyStocked });
    if(error || !data){ document.getElementById('cntList').innerHTML = `<div class="form-error">${error ? esc(error.message) : 'The count sheet could not be loaded.'}</div>`; return; }
    countState.rows = data.rows || []; draw();
  };
  document.getElementById('cntLoc').onchange = (e) => { countState.location = e.target.value; countState.entered = {}; load(); };
  document.getElementById('cntStocked').onchange = (e) => { countState.onlyStocked = e.target.checked; load(); };
  let t = null; document.getElementById('cntSearch').oninput = (e) => { clearTimeout(t); countState.q = e.target.value.trim(); t = setTimeout(load, 300); };
  document.getElementById('cntFill').onclick = () => { countState.rows.forEach(r => { countState.entered[r.item_id] = String(r.expected); }); draw(); };
  document.getElementById('cntSave').onclick = async () => {
    const counts = Object.entries(countState.entered).filter(([, v]) => v !== '' && v != null).map(([k, v]) => ({ item_id: Number(k), counted: Number(v) }));
    if(!counts.length){ invErr('Type at least one count first.'); return; }
    if(counts.some(c => !(c.counted >= 0))){ invErr('A count cannot be below zero.'); return; }
    const changed = counts.filter(c => { const r = countState.rows.find(x => x.item_id === c.item_id); return r && Number(r.expected) !== c.counted; }).length;
    if(!confirm(`Save this count? ${changed} part${changed === 1 ? '' : 's'} will change, out of ${counts.length} counted.`)) return;
    const btn = document.getElementById('cntSave'); btn.disabled = true; btn.textContent = 'Saving…';
    const { data, error } = await sb.rpc('apply_count_session', { p_location: Number(countState.location), p_counts: counts, p_note: 'Stock count' });
    btn.disabled = false; btn.textContent = 'Save the count';
    if(error){ invErr(error.message); return; }
    recordsToast(`Count saved · ${data.changed} changed, ${data.unchanged} already right${Number(data.value_change) ? ' · value ' + (Number(data.value_change) > 0 ? '+' : '') + invMoney(data.value_change) : ''}`);
    countState.entered = {}; load();
  };
  load();
}

// ============================================================
// Cores owed back to the vendor
// ============================================================
const coreState = { status:'owed' };
async function renderCores(){
  const panel = document.getElementById('invPanel');
  panel.innerHTML = '<div class="meta">Loading…</div>';
  const { data, error } = await sb.rpc('core_list', { p_status: coreState.status, p_limit: 200 });
  if(error || !data){ panel.innerHTML = `<div class="form-error">Couldn't load the cores${error ? ': ' + esc(error.message) : '.'}</div>`; return; }
  const rows = data.rows || [];
  panel.innerHTML = `<div class="rec-toolbar">
      <div class="fd-dates">${[['owed', 'Owed'], ['returned', 'Returned'], ['credited', 'Credited'], ['all', 'All']].map(([k, l]) => `<button type="button" class="fd-chip${coreState.status === k ? ' active' : ''}" data-cstatus="${k}">${l}</button>`).join('')}</div>
      <div class="meta">${data.owed_count} core${data.owed_count === 1 ? '' : 's'} owed · ${invMoney(data.owed_amount)}</div></div>
    <p class="form-error" id="invPanelErr"></p>
    ${rows.length ? `<div class="cw-wrap"><table class="cw-table"><thead><tr><th><input type="checkbox" id="coreAll" aria-label="Select all"></th><th>Part</th><th>Vendor</th><th>Work order</th><th class="num">Qty</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
      ${rows.map(c => `<tr><td><input type="checkbox" class="core-pick" value="${c.id}" aria-label="Select this core"></td>
        <td><b>${esc(c.name)}</b>${c.part_number ? `<div class="meta">#${esc(c.part_number)}</div>` : ''}</td>
        <td>${esc(c.vendor_name || '—')}</td><td>${esc(c.ro_number || '—')}</td>
        <td class="num">${qtyFmt(c.qty)}</td><td class="num">${invMoney(c.amount)}</td>
        <td><span class="badge ${c.status === 'owed' ? 'waiting' : c.status === 'credited' ? 'arrived' : 'onsite'}"><span class="bd"></span>${c.status === 'written_off' ? 'Written off' : c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span></td></tr>`).join('')}
      </tbody></table></div>
      <div class="job-actions" style="margin-top:12px;"><button type="button" class="ghost-btn" data-cset="returned">Mark returned</button><button type="button" class="ghost-btn" data-cset="credited">Mark credited</button><button type="button" class="ghost-btn" data-cset="written_off">Write off</button></div>`
      : `<div class="empty-note">${coreState.status === 'owed' ? '<b>No cores owed.</b> When you use a part that has a core charge, the core is listed here until you send it back.' : 'Nothing here.'}</div>`}`;
  panel.querySelectorAll('[data-cstatus]').forEach(b => b.onclick = () => { coreState.status = b.dataset.cstatus; renderCores(); });
  const all = document.getElementById('coreAll'); if(all) all.onchange = () => panel.querySelectorAll('.core-pick').forEach(c => { c.checked = all.checked; });
  panel.querySelectorAll('[data-cset]').forEach(b => b.onclick = async () => {
    const ids = [...panel.querySelectorAll('.core-pick:checked')].map(c => Number(c.value));
    if(!ids.length){ invErr('Tick at least one core first.'); return; }
    const { error: e2 } = await sb.rpc('set_core_status', { p_ids: ids, p_status: b.dataset.cset, p_note: null });
    if(e2){ invErr(e2.message); return; }
    recordsToast(`${ids.length} core${ids.length === 1 ? '' : 's'} updated`); renderCores();
  });
}

// ============================================================
// How a part has been used
// ============================================================
async function openUsage(id){
  const i = invState.items.find(x => x.id === id) || { id, name: 'Part' };
  const box = invForm(`<div class="rec-form-head"><h3>${esc(i.name)} — how it has been used</h3><button type="button" class="ghost inv-close">Close</button></div><div id="usageBody"><div class="meta">Loading…</div></div>`);
  const { data, error } = await sb.rpc('part_usage', { p_item: id, p_days: 365 });
  const body = box.querySelector('#usageBody'); if(!body) return;
  if(error || !data){ body.innerHTML = `<div class="form-error">${error ? esc(error.message) : 'That could not be loaded.'}</div>`; return; }
  const margin = Number(data.revenue) > 0 ? Math.round(Number(data.margin) / Number(data.revenue) * 100) : null;
  body.innerHTML = `<div class="kpi-grid">
      <div class="kpi"><em>Used in the last year</em><b>${qtyFmt(data.used_qty)}</b><span class="meta">${data.jobs} work order${data.jobs === 1 ? '' : 's'}</span></div>
      <div class="kpi"><em>You charged</em><b>${invMoney(data.revenue)}</b></div>
      <div class="kpi"><em>It cost you</em><b>${invMoney(data.cost)}</b></div>
      <div class="kpi"><em>Margin</em><b>${invMoney(data.margin)}</b><span class="meta">${margin == null ? '' : margin + '%'}</span></div>
    </div>
    <p class="meta">${data.last_used ? 'Last used ' + new Date(data.last_used).toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' }) : 'Never used on a work order yet.'}${Number(data.received_qty) ? ' · received ' + qtyFmt(data.received_qty) + ' in the last year' : ''}</p>`;
}

// ============================================================
// Change many prices at once (preview first)
// ============================================================
function openPriceChange(){
  const cats = [...new Set(invState.items.map(i => i.category).filter(Boolean))].sort();
  const box = invForm(`<div class="rec-form-head"><h3>Change prices</h3><button type="button" class="ghost inv-close">Close</button></div>
    <div class="rec-grid">
      <div class="field"><label for="pcMode">How</label><select id="pcMode"><option value="percent">Raise or lower by a percentage</option><option value="margin">Price from cost, to a margin</option></select></div>
      <div class="field"><label for="pcValue" id="pcValueLabel">Percentage (e.g. 10 for +10%, -5 for -5%)</label><input id="pcValue" type="number" step="0.1" value="10"></div>
      <div class="field"><label for="pcVendor">Only this vendor</label><select id="pcVendor"><option value="">All vendors</option>${invState.vendors.filter(v => v.active).map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="pcCat">Only this category</label><select id="pcCat"><option value="">All categories</option>${cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="pcRound">Rounding</label><select id="pcRound"><option value="none">Nearest cent</option><option value="up99">Ending in .99</option><option value="whole">Whole dollars</option></select></div>
    </div>
    <p class="form-error" id="invErr"></p>
    <div class="job-actions"><button type="button" class="ghost-btn" id="pcPreview">Preview</button><button type="button" id="pcApply" disabled>Apply</button></div>
    <div id="pcResult"></div>`);
  const args = () => ({ p_mode: document.getElementById('pcMode').value, p_value: Number(document.getElementById('pcValue').value),
    p_vendor: document.getElementById('pcVendor').value ? Number(document.getElementById('pcVendor').value) : null,
    p_category: document.getElementById('pcCat').value || null, p_round: document.getElementById('pcRound').value });
  document.getElementById('pcMode').onchange = (e) => { document.getElementById('pcValueLabel').textContent = e.target.value === 'margin' ? 'Margin % (e.g. 40 — only parts that have a cost)' : 'Percentage (e.g. 10 for +10%, -5 for -5%)';
    document.getElementById('pcValue').value = e.target.value === 'margin' ? 40 : 10; document.getElementById('pcApply').disabled = true; document.getElementById('pcResult').innerHTML = ''; };
  document.getElementById('pcPreview').onclick = async () => {
    invErr(''); const a = args();
    const { data, error } = await sb.rpc('preview_price_change', { ...a, p_limit: 500 });
    if(error || !data){ invErr(error ? error.message : 'The preview could not be loaded.'); document.getElementById('pcApply').disabled = true; return; }
    const rows = data.rows || [];
    document.getElementById('pcApply').disabled = rows.length === 0;
    document.getElementById('pcResult').innerHTML = rows.length
      ? `<p class="meta">${data.count} price${data.count === 1 ? '' : 's'} would change. Showing the first ${rows.length}.</p>
         <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Part</th><th class="num">Now</th><th class="num">Would become</th></tr></thead><tbody>
         ${rows.map(r => `<tr><td>${esc(r.name)}${r.part_number ? ` <span class="meta">#${esc(r.part_number)}</span>` : ''}</td><td class="num">${invMoney(r.old_price)}</td><td class="num"><b>${invMoney(r.new_price)}</b></td></tr>`).join('')}
         </tbody></table></div>`
      : '<div class="empty-note">Nothing would change.</div>';
  };
  document.getElementById('pcApply').onclick = async () => {
    const a = args();
    if(!confirm('Change these prices? This updates your price list for new estimates and invoices. Work already written keeps its prices.')) return;
    const btn = document.getElementById('pcApply'); btn.disabled = true; btn.textContent = 'Applying…';
    const { data, error } = await sb.rpc('apply_price_change', a);
    btn.textContent = 'Apply';
    if(error){ invErr(error.message); btn.disabled = false; return; }
    recordsToast(`${data.updated} price${data.updated === 1 ? '' : 's'} updated`);
    document.getElementById('invFormBox').classList.add('hidden'); document.getElementById('invFormBox').innerHTML = '';
    refreshInventoryV2(); if(typeof populateInventoryPicker === 'function') populateInventoryPicker();
  };
}
