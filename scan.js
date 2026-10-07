// ============================================================
// RelayFleet — receive parts from a photo of a vendor invoice.
// 1) photo/PDF → scan-invoice reads it (nothing saved yet)
// 2) the person reviews every line: match, new part, or skip
// 3) receive_vendor_bill puts it all into stock in one step
// ============================================================
let scanState = null;
const scanMoney = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });

function scanShrink(file){
  // Invoices have small print: keep more detail than ordinary photos.
  return new Promise(resolve => {
    if(!/^image\//i.test(file.type) || typeof createImageBitmap !== 'function'){ resolve(file); return; }
    createImageBitmap(file).then(bmp => {
      const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      c.toBlob(b => resolve(b ? new File([b], 'invoice.jpg', { type:'image/jpeg' }) : file), 'image/jpeg', 0.85);
    }).catch(() => resolve(file));
  });
}
const fileToBase64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(f); });

function startInvoiceScan(){
  let input = document.getElementById('scanFile');
  if(!input){
    input = document.createElement('input'); input.type = 'file'; input.id = 'scanFile'; input.accept = 'image/*,application/pdf'; input.setAttribute('capture', 'environment'); input.hidden = true;
    document.body.appendChild(input);
  }
  input.value = '';
  input.onchange = () => { if(input.files[0]) scanFile(input.files[0]); };
  input.click();
}
async function scanFile(file){
  openScanModal('<div class="scan-wait"><div class="scan-spin"></div><b>Reading the invoice…</b><span>This takes about 10–20 seconds.</span></div>');
  try {
    const f = file.type === 'application/pdf' ? file : await scanShrink(file);
    if(f.size > 6.5 * 1024 * 1024) throw new Error('That file is too large. Use a photo, or a PDF under 6 MB.');
    const [data, locs, items] = await Promise.all([fileToBase64(f),
      sb.from('stock_locations').select('id, name, kind').eq('org_id', session.orgId).eq('active', true).order('kind').order('name'),
      sb.from('inventory_items').select('id, name, part_number').eq('org_id', session.orgId).eq('active', true).order('name').limit(10000)]);
    const { data: out, error } = await sb.functions.invoke('scan-invoice', { body: { data, media_type: f.type || 'image/jpeg' } });
    let msg = out && out.error;
    if(error){ msg = error.message; try { const b = error.context && typeof error.context.json === 'function' ? await error.context.clone().json() : null; if(b && b.error) msg = b.error; } catch(_){} if(error.context && error.context.status === 404) msg = 'Scanning is not set up yet (no Edge Function named "scan-invoice").';
      // No answer at all: usually the function isn't deployed, or it crashes on start-up (e.g. core.ts missing).
      if(error.name === 'FunctionsFetchError' || /Failed to send a request/i.test(error.message || '')) msg = 'Couldn\'t reach the scanning service. In Supabase, check that an Edge Function named exactly "scan-invoice" is deployed with both files (index.ts and core.ts), then try again.'; }
    if(msg) throw new Error(msg);
    scanState = { scan: out, locs: locs.data || [], items: items.data || [] };
    scanState.lines = out.lines.map(l => ({ ...l, include: l.kind === 'part' && l.qty > 0, choice: l.match ? String(l.match.item_id) : 'new',
      sell: l.unit_cost != null ? Math.round(l.unit_cost * 1.4 * 100) / 100 : null }));
    renderScanReview();
  } catch(e){
    openScanModal(`<div class="scan-wait"><b>Couldn't read that invoice</b><span class="form-error">${esc(e.message || String(e))}</span><div class="job-actions"><button type="button" id="scanRetry">Try another photo</button><button type="button" class="ghost-btn" id="scanCancel">Close</button></div></div>`);
    document.getElementById('scanRetry').onclick = () => { closeScanModal(); startInvoiceScan(); };
    document.getElementById('scanCancel').onclick = closeScanModal;
  }
}
function scanItemLabel(id){ const it = scanState.items.find(i => i.id === Number(id)); return it ? (it.part_number ? it.part_number + ' — ' : '') + it.name : ''; }
function renderScanReview(){
  const s = scanState.scan, L = scanState.lines;
  const picked = L.filter(l => l.include);
  const value = picked.reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const isNew = l => l.choice === 'new';
  openScanModal(`
    <h2 class="scan-title">Review the invoice</h2>
    <p class="meta">Check each line. Nothing goes into stock until you click <b>Receive</b>.</p>
    <div class="rec-grid scan-head">
      <div class="field"><label>Vendor</label><input id="scVendor" maxlength="120" value="${esc(s.vendor_name || '')}">${s.vendor_id ? '<span class="scan-ok">Existing vendor</span>' : s.vendor_name ? '<span class="scan-new">New vendor — will be added</span>' : ''}</div>
      <div class="field"><label>Invoice #</label><input id="scNumber" maxlength="60" value="${esc(s.invoice_number || '')}"></div>
      <div class="field"><label>Invoice date</label><input id="scDate" type="date" value="${esc(s.invoice_date || '')}"></div>
      <div class="field"><label>Put the parts in</label><select id="scLoc">${scanState.locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
    </div>
    <datalist id="scItems">${scanState.items.map(i => `<option value="${esc((i.part_number ? i.part_number + ' — ' : '') + i.name)}"></option>`).join('')}</datalist>
    <div class="scan-lines">
      ${L.map((l, i) => `<div class="scan-line${l.include ? '' : ' off'}${l.kind !== 'part' ? ' charge' : ''}" data-i="${i}">
        <label class="scan-inc"><input type="checkbox" data-f="include" ${l.include ? 'checked' : ''} aria-label="Receive this line"></label>
        <div class="scan-what">
          <div class="scan-read"><b>${esc(l.part_number || '—')}</b> ${esc(l.description || '')}${l.kind !== 'part' ? ` <span class="rec-tag">${esc(l.kind.replace('_', ' '))} — not stock</span>` : ''}</div>
          ${l.kind === 'part' ? `<div class="scan-match">
            <select data-f="choice" aria-label="Which part">
              ${l.match ? `<option value="${l.match.item_id}" ${l.choice === String(l.match.item_id) ? 'selected' : ''}>Matched: ${esc(scanItemLabel(l.match.item_id))} (by ${esc(l.match.by)})</option>` : ''}
              ${l.choice !== 'new' && (!l.match || l.choice !== String(l.match.item_id)) ? `<option value="${esc(l.choice)}" selected>${esc(scanItemLabel(l.choice))}</option>` : ''}
              <option value="new" ${isNew(l) ? 'selected' : ''}>New part — add to inventory</option>
              <option value="pick">Choose another part…</option>
            </select>
            ${l.picking ? `<input list="scItems" data-f="pick" placeholder="Type a part # or name" class="scan-pick">` : ''}
            ${isNew(l) ? `<input data-f="description" maxlength="200" value="${esc(l.description || '')}" aria-label="New part name" placeholder="Part name">` : ''}
          </div>` : ''}
        </div>
        <div class="scan-nums">
          <div class="field"><label>Qty</label><input type="number" min="0" step="any" data-f="qty" value="${l.qty ?? ''}"></div>
          <div class="field"><label>Cost each</label><input type="number" min="0" step="0.01" data-f="unit_cost" value="${l.unit_cost ?? ''}"></div>
          ${isNew(l) && l.kind === 'part' ? `<div class="field"><label>Sell price</label><input type="number" min="0" step="0.01" data-f="sell" value="${l.sell ?? ''}"></div>` : ''}
        </div></div>`).join('') || '<p class="meta">No lines were found on this invoice.</p>'}
    </div>
    <p class="form-error" id="scErr"></p>
    <div class="scan-foot"><span>${picked.length} line${picked.length === 1 ? '' : 's'} · ${scanMoney(value)} at cost${s.total != null ? ` · invoice total ${scanMoney(s.total)}` : ''}</span>
      <div class="job-actions"><button type="button" class="ghost-btn" id="scCancel">Cancel</button><button type="button" id="scGo" ${picked.length ? '' : 'disabled'}>Receive ${picked.length} line${picked.length === 1 ? '' : 's'} into stock</button></div></div>`);
  const body = document.getElementById('scanBody');
  body.querySelectorAll('.scan-line').forEach(row => {
    const l = L[Number(row.dataset.i)];
    row.querySelectorAll('[data-f]').forEach(el => {
      el.onchange = () => {
        const f = el.dataset.f;
        if(f === 'include') l.include = el.checked;
        else if(f === 'choice'){ if(el.value === 'pick'){ l.picking = true; } else { l.choice = el.value; l.picking = false; } }
        else if(f === 'pick'){ const it = scanState.items.find(i => (i.part_number ? i.part_number + ' — ' : '') + i.name === el.value); if(it){ l.choice = String(it.id); l.picking = false; } }
        else if(['qty','unit_cost','sell'].includes(f)) l[f] = el.value === '' ? null : Number(el.value);
        else l[f] = el.value;
        renderScanReview();
      };
    });
  });
  document.getElementById('scCancel').onclick = closeScanModal;
  document.getElementById('scGo').onclick = () => receiveScan(false);
}
async function receiveScan(force){
  const err = document.getElementById('scErr'); err.textContent = '';
  const picked = scanState.lines.filter(l => l.include);
  const bad = picked.find(l => !(Number(l.qty) > 0) || (l.unit_cost != null && l.unit_cost < 0) || (l.choice === 'new' && !String(l.description || '').trim()));
  if(bad){ err.textContent = 'Each line you receive needs a quantity above 0' + (bad.choice === 'new' ? ' and a part name' : '') + '.'; return; }
  const vendor = document.getElementById('scVendor').value.trim();
  if(!vendor){ err.textContent = 'Enter the vendor name.'; return; }
  const lines = picked.map(l => l.choice === 'new'
    ? { name: l.description, part_number: l.part_number, brand: l.brand, qty: l.qty, unit_cost: l.unit_cost, sell_price: l.sell }
    : { item_id: Number(l.choice), qty: l.qty, unit_cost: l.unit_cost });
  const btn = document.getElementById('scGo'); btn.disabled = true; btn.textContent = 'Receiving…';
  const { error } = await sb.rpc('receive_vendor_bill', { p_vendor_name: vendor, p_bill_number: document.getElementById('scNumber').value.trim() || null,
    p_bill_date: document.getElementById('scDate').value || null, p_total: scanState.scan.total, p_location: Number(document.getElementById('scLoc').value),
    p_lines: lines, p_vendor_id: scanState.scan.vendor_id && vendor.toLowerCase() === String(scanState.scan.vendor_name || '').toLowerCase() ? scanState.scan.vendor_id : null, p_force: force });
  if(error){
    btn.disabled = false; btn.textContent = `Receive ${picked.length} line${picked.length === 1 ? '' : 's'} into stock`;
    if(/^DUPLICATE: /.test(error.message)){
      if(confirm(error.message.replace(/^DUPLICATE: /, '') + '\n\nReceive it again anyway? Stock will be added a second time.')) return receiveScan(true);
      return;
    }
    err.textContent = error.message; return;
  }
  closeScanModal();
  recordsToast(`Received ${picked.length} line${picked.length === 1 ? '' : 's'} into stock`);
  if(typeof refreshInventoryV2 === 'function') refreshInventoryV2();
}
function openScanModal(html){
  document.getElementById('scanBody').innerHTML = html;
  document.getElementById('scanModal').classList.remove('hidden'); document.body.classList.add('modal-open');
}
function closeScanModal(){ document.getElementById('scanModal').classList.add('hidden'); document.body.classList.remove('modal-open'); scanState = null; }
document.addEventListener('click', (e) => { if(e.target.id === 'scanModal' || e.target.closest('#scanClose')) closeScanModal(); });
