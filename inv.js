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

async function loadInventoryData(){
  const [items, oh, lv, locs, vendors, pos] = await Promise.all([
    sb.from('inventory_items').select('id, name, description, unit_price, part_number, vendor_id, cost, min_qty, track_stock, category, active, brand, core_charge, cross_ref').eq('org_id', session.orgId).eq('active', true).order('name').limit(2000),
    sb.from('stock_on_hand').select('item_id, on_hand, low').eq('org_id', session.orgId).limit(2000),
    sb.from('stock_levels').select('item_id, location_id, qty, bin').eq('org_id', session.orgId).limit(5000),
    sb.from('stock_locations').select('id, name, kind, mechanic_id, active').eq('org_id', session.orgId).order('kind').order('name'),
    sb.from('vendors').select('id, name, contact_name, phone, email, notes, active').eq('org_id', session.orgId).order('name'),
    sb.from('purchase_orders').select('id, po_number, vendor_id, location_id, status, notes, ordered_at, expected_at, received_at, created_at, purchase_order_lines(id, item_id, qty_ordered, qty_received, unit_cost)').eq('org_id', session.orgId).order('created_at', { ascending:false }).limit(200)
  ]);
  invState.items = items.data || [];
  invState.onhand = {}; (oh.data || []).forEach(r => invState.onhand[r.item_id] = r);
  invState.levels = lv.data || [];
  invState.locations = locs.data || [];
  invState.vendors = vendors.data || [];
  invState.pos = pos.data || [];
}
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
      ${[['parts','Parts & prices'],['pos','Purchase orders'],['vendors','Vendors'],['locations','Locations']].map(([k, l]) => `<button type="button" class="fleet-tab${invState.tab === k ? ' active' : ''}" data-itab="${k}">${l}${k === 'parts' && low ? ` <span class="inv-low-count">${low} low</span>` : ''}</button>`).join('')}
    </nav>
    <div id="invFormBox" class="hidden"></div>
    <div id="invPanel"></div>`;
  root.querySelectorAll('[data-itab]').forEach(b => b.onclick = () => { invState.tab = b.dataset.itab; refreshInventoryV2(); });
  ({ parts: renderParts, pos: renderPOs, vendors: renderVendors, locations: renderLocations })[invState.tab]();
}
function updateLowStockBadge(n){
  const tab = document.querySelector('.dash-tab[data-target="shop-inventory"] .nav-label');
  if(!tab) return;
  let b = tab.parentElement.querySelector('.nav-low');
  if(n && !b){ b = document.createElement('span'); b.className = 'nav-low'; tab.after(b); }
  if(b){ if(n){ b.textContent = n; b.title = n + ' part' + (n === 1 ? '' : 's') + ' low on stock'; } else b.remove(); }
}
function invForm(html){ const b = document.getElementById('invFormBox'); b.innerHTML = `<div class="card rec-form">${html}</div>`; b.classList.remove('hidden'); b.scrollIntoView({ behavior:'smooth', block:'start' }); const c = b.querySelector('.inv-close'); if(c) c.onclick = () => { b.innerHTML = ''; b.classList.add('hidden'); }; return b; }
function invErr(msg){ const e = document.getElementById('invErr'); if(e) e.textContent = msg; else alert(msg); }

// ---------------- Parts & prices ----------------
function renderParts(){
  const panel = document.getElementById('invPanel');
  panel.innerHTML = `<div class="rec-toolbar">
      <input type="search" id="invSearch" placeholder="Search name, part #, brand, cross-reference, vendor" aria-label="Search parts">
      <label class="rec-check"><input type="checkbox" id="invLowOnly"> Low stock only</label>
      <button type="button" class="ghost-btn" id="invReorder">Reorder low stock</button>
      <button type="button" class="ghost-btn" id="invScan">Scan vendor invoice</button>
      <button type="button" id="invAdd">Add part or service</button>
    </div><div id="invList" class="rec-list"></div>`;
  const draw = () => {
    const q = (document.getElementById('invSearch').value || '').trim().toLowerCase();
    const lowOnly = document.getElementById('invLowOnly').checked;
    const rows = invState.items.filter(i => (!lowOnly || (invState.onhand[i.id] || {}).low) &&
      (!q || [i.name, i.part_number, i.category, vendorName(i.vendor_id), i.description, i.brand, i.cross_ref].some(v => v && v.toLowerCase().includes(q))));
    document.getElementById('invList').innerHTML = rows.length ? rows.map(i => {
      const oh = invState.onhand[i.id] || { on_hand:0, low:false };
      const lv = invState.levels.filter(l => l.item_id === i.id && Number(l.qty) !== 0);
      return `<div class="inv-row${oh.low ? ' is-low' : ''}">
        <div class="rec-main"><b>${esc(i.name)}</b>
          <div class="meta">${[i.part_number ? '#' + i.part_number : '', i.brand, i.category, vendorName(i.vendor_id), Number(i.core_charge) > 0 ? 'Core ' + invMoney(i.core_charge) : ''].filter(Boolean).map(esc).join(' · ') || (i.track_stock ? '' : 'Service / price only')}</div>
          ${i.track_stock && lv.length ? `<div class="meta">${lv.map(l => `${esc(locName(l.location_id))}: <b class="${Number(l.qty) < 0 ? 'neg' : ''}">${qtyFmt(l.qty)}</b>${l.bin ? ' (bin ' + esc(l.bin) + ')' : ''}`).join(' · ')}</div>` : ''}</div>
        <div class="inv-nums"><span><em>Price</em>${invMoney(i.unit_price)}</span>${i.cost != null ? `<span><em>Cost</em>${invMoney(i.cost)}</span>` : ''}
          ${i.track_stock ? `<span><em>On hand</em><b class="${Number(oh.on_hand) < 0 ? 'neg' : ''}">${qtyFmt(oh.on_hand)}</b></span><span><em>Min</em>${qtyFmt(i.min_qty)}</span>${oh.low ? '<span class="badge overdue"><span class="bd"></span>Low</span>' : ''}` : ''}</div>
        <div class="inv-actions"><button type="button" class="text-btn" data-edit="${i.id}">Edit</button>
          ${i.track_stock ? `<button type="button" class="text-btn" data-count="${i.id}">Count</button><button type="button" class="text-btn" data-move="${i.id}">Move</button><button type="button" class="text-btn" data-hist="${i.id}">History</button>` : ''}
          <button type="button" class="text-btn danger" data-del="${i.id}">Remove</button></div></div>`;
    }).join('') : `<div class="empty-note">${invState.items.length ? 'Nothing matches.' : 'No parts or services yet. Add your common parts and services to price estimates faster and track stock.'}</div>`;
    const L = document.getElementById('invList');
    L.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openItemForm(Number(b.dataset.edit)));
    L.querySelectorAll('[data-count]').forEach(b => b.onclick = () => openCountForm(Number(b.dataset.count)));
    L.querySelectorAll('[data-move]').forEach(b => b.onclick = () => openMoveForm(Number(b.dataset.move)));
    L.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => openHistory(Number(b.dataset.hist)));
    L.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if(!confirm('Remove this from your parts and price list? Its history is kept.')) return;
      const { error } = await sb.from('inventory_items').update({ active:false }).eq('id', Number(b.dataset.del));
      if(error){ alert(error.message); return; }
      refreshInventoryV2(); if(typeof populateInventoryPicker === 'function') populateInventoryPicker();
    });
  };
  document.getElementById('invSearch').oninput = draw;
  document.getElementById('invLowOnly').onchange = draw;
  document.getElementById('invAdd').onclick = () => openItemForm(null);
  const scanBtn = document.getElementById('invScan'); if(scanBtn) scanBtn.onclick = () => startInvoiceScan();
  document.getElementById('invReorder').onclick = reorderLowStock;
  draw();
}

function openItemForm(id){
  const i = id ? invState.items.find(x => x.id === id) : null;
  const v = k => i && i[k] != null ? esc(String(i[k])) : '';
  const box = invForm(`<div class="rec-form-head"><h3>${i ? 'Edit ' + esc(i.name) : 'Add a part or service'}</h3><button type="button" class="ghost inv-close">Close</button></div>
    <div class="rec-grid">
      <div class="field"><label>Name *</label><input id="ifName" maxlength="120" value="${v('name')}" placeholder="e.g. Glad hand seal"></div>
      <div class="field"><label>Part number</label><input id="ifPn" maxlength="60" value="${v('part_number')}"></div>
      <div class="field"><label>Category</label><input id="ifCat" maxlength="60" value="${v('category')}" placeholder="e.g. Air system"></div>
      <div class="field"><label>Vendor</label><select id="ifVendor"><option value="">—</option>${invState.vendors.filter(x => x.active || (i && x.id === i.vendor_id)).map(x => `<option value="${x.id}" ${i && i.vendor_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Your cost ($)</label><input id="ifCost" type="number" min="0" step="0.01" value="${v('cost')}"></div>
      <div class="field"><label>Selling price ($) *</label><input id="ifPrice" type="number" min="0" step="0.01" value="${v('unit_price')}"></div>
      <div class="field"><label>Brand</label><input id="ifBrand" maxlength="60" value="${v('brand')}" placeholder="e.g. Haldex"></div>
      <div class="field"><label>Core charge ($)</label><input id="ifCore" type="number" min="0" step="0.01" value="${v('core_charge')}" placeholder="0.00"></div>
      <div class="field rec-span"><label>Cross-reference numbers</label><input id="ifXref" maxlength="300" value="${v('cross_ref')}" placeholder="Other part numbers for the same part, separated by commas"></div>
      <div class="field rec-span"><label>Description</label><input id="ifDesc" maxlength="300" value="${v('description')}"></div>
      <label class="rec-check rec-span"><input type="checkbox" id="ifTrack" ${!i || i.track_stock ? 'checked' : ''}> Track stock for this part (leave unticked for services like "Shop supplies")</label>
      <div class="field"><label>Minimum on hand (low-stock alert)</label><input id="ifMin" type="number" min="0" step="1" value="${i ? Number(i.min_qty) : 0}"></div>
    </div><p class="form-error" id="invErr"></p><div class="job-actions"><button type="button" id="ifSave">${i ? 'Save' : 'Add'}</button></div>`);
  box.querySelector('#ifSave').onclick = async () => {
    const name = document.getElementById('ifName').value.trim(), price = parseFloat(document.getElementById('ifPrice').value);
    const costRaw = document.getElementById('ifCost').value, cost = costRaw === '' ? null : parseFloat(costRaw), min = parseFloat(document.getElementById('ifMin').value) || 0;
    if(!name){ invErr('Enter a name.'); return; }
    if(!(price >= 0)){ invErr('Enter a selling price of 0 or more.'); return; }
    if(cost != null && !(cost >= 0)){ invErr('Cost cannot be negative.'); return; }
    const row = { name, unit_price: price, cost, min_qty: Math.max(0, min), part_number: document.getElementById('ifPn').value.trim() || null,
      category: document.getElementById('ifCat').value.trim() || null, vendor_id: Number(document.getElementById('ifVendor').value) || null,
      description: document.getElementById('ifDesc').value.trim() || null, track_stock: document.getElementById('ifTrack').checked,
      brand: document.getElementById('ifBrand').value.trim() || null, cross_ref: document.getElementById('ifXref').value.trim() || null,
      core_charge: document.getElementById('ifCore').value === '' ? null : parseFloat(document.getElementById('ifCore').value) };
    if(row.core_charge != null && !(row.core_charge >= 0)){ invErr('Core charge cannot be negative.'); return; }
    const res = i ? await sb.from('inventory_items').update(row).eq('id', i.id) : await sb.from('inventory_items').insert([{ ...row, org_id: session.orgId, created_by: session.id }]);
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
        ${receivable && Number(l.qty_received) < Number(l.qty_ordered) ? `<span class="po-recv"><input type="number" min="1" max="${Number(l.qty_ordered) - Number(l.qty_received)}" step="1" value="${Number(l.qty_ordered) - Number(l.qty_received)}" data-rq="${l.id}" aria-label="Quantity to receive"><input type="number" min="0" step="0.01" value="${l.unit_cost != null ? Number(l.unit_cost) : ''}" placeholder="cost" data-rc="${l.id}" aria-label="Unit cost"><button type="button" class="ghost-btn" data-recv="${l.id}">Receive</button></span>` : ''}
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
    sb.from('inventory_items').select('id, name, part_number, unit_price, track_stock').eq('org_id', job.org_id).eq('active', true).order('name').limit(2000),
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
      <button type="button" id="ppAdd">Add part</button></div><p class="form-error" id="ppErr"></p>` : ''}`;
  const add = document.getElementById('ppAdd');
  if(add) add.onclick = async () => {
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
