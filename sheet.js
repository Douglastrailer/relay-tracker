// ============================================================
// RelayFleet — form sheets: "New work order" (shop) and "Request service"
// (fleet) open over the page with everything behind blurred. The existing
// forms are MOVED into the sheet (and back), so all their behaviour —
// lookups, pickers, the map pin, validation — stays exactly the same.
// ============================================================
let formSheet = null;   // { nodes:[{ node, parent, marker }], onClose }
function sheetEl(){
  let o = document.getElementById('formSheet');
  if(o) return o;
  document.body.insertAdjacentHTML('beforeend', `<div id="formSheet" class="form-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="formSheetTitle">
    <div class="form-card"><div class="form-head"><b id="formSheetTitle"></b><button type="button" class="pdf-close" id="formSheetClose" aria-label="Close">×</button></div>
    <div class="form-body" id="formSheetBody"></div></div></div>`);
  o = document.getElementById('formSheet');
  o.addEventListener('click', (e) => { if(e.target === o) closeFormSheet(); });
  document.getElementById('formSheetClose').onclick = () => closeFormSheet();
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && formSheet) closeFormSheet(); });
  return o;
}
function openFormSheet(title, nodes, onClose){
  if(formSheet) closeFormSheet(true);
  const o = sheetEl(), body = document.getElementById('formSheetBody');
  document.getElementById('formSheetTitle').textContent = title;
  const moved = nodes.filter(Boolean).map(node => { const marker = document.createComment('sheet-home'); node.parentNode.insertBefore(marker, node); body.appendChild(node); return { node, marker }; });
  formSheet = { nodes: moved, onClose };
  o.classList.remove('hidden'); requestAnimationFrame(() => o.classList.add('open'));
  document.body.classList.add('sheet-open');
  body.scrollTop = 0;
  // maps inside the form were measured while hidden
  setTimeout(() => { try { if(typeof pinMapObj !== 'undefined' && pinMapObj) pinMapObj.invalidateSize(); } catch(_){} }, 260);
  const first = body.querySelector('input:not([type=hidden]):not([disabled]), textarea, select'); if(first && !('ontouchstart' in window)) setTimeout(() => first.focus(), 120);
}
function closeFormSheet(silent){
  if(!formSheet) return;
  const s = formSheet; formSheet = null;
  s.nodes.forEach(({ node, marker }) => { marker.parentNode.insertBefore(node, marker); marker.remove(); });
  const o = document.getElementById('formSheet'); o.classList.add('hidden'); o.classList.remove('open');
  document.body.classList.remove('sheet-open');
  if(typeof s.onClose === 'function') s.onClose(silent);
}

// ---------- shop: New work order ----------
// Every way of opening the form (the button, Ask Relay, a customer profile,
// the setup checklist) un-hides #woCreateBox — so watch that one box.
function initWoSheet(){
  const box = document.getElementById('woCreateBox');
  if(!box || box._sheetWatch) return;
  box._sheetWatch = new MutationObserver(() => {
    const open = !box.classList.contains('hidden');
    const inSheet = !!(formSheet && formSheet.nodes.some(n => n.node === box));
    if(open && !inSheet) openFormSheet('New work order', [box], () => {
      box.classList.add('hidden');
      const nb = document.getElementById('woNewBtn'); if(nb) nb.textContent = '+ New work order';
    });
    else if(!open && inSheet) closeFormSheet();
  });
  box._sheetWatch.observe(box, { attributes:true, attributeFilter:['class'] });
}

// ---------- fleet: Request service ----------
async function openFleetRequest(orgId, shopName){
  const cards = ['requestFormCard', 'requestSuccessCard', 'requestInvalidCard'].map(id => document.getElementById(id));
  if(!cards[0]) return;
  cards[0].classList.remove('hidden'); cards[1].classList.add('hidden'); cards[2].classList.add('hidden');
  const err = document.getElementById('requestError'); if(err) err.textContent = '';
  openFormSheet(shopName ? 'Request service from ' + shopName : 'Request service', cards, () => {
    // after a sent request, start fresh next time
    if(!cards[1].classList.contains('hidden')) ['reqVehicle','reqIssue','reqEta','reqAddressInput'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  });
  // prefill who is asking
  const set = (id, v) => { const el = document.getElementById(id); if(el && !el.value && v) el.value = v; };
  set('reqCustomerName', session && session.name); set('reqCompanyName', session && session.company);
  try {
    const { data } = await sb.from('profiles').select('phone, email').eq('id', session.id).maybeSingle();
    if(data){ set('reqCustomerPhone', data.phone); set('reqCustomerEmail', data.email); }
  } catch(_){}
  if(typeof initPublicRequestPage === 'function') await initPublicRequestPage(orgId);
  const t = document.getElementById('requestTitle'); if(t) document.getElementById('formSheetTitle').textContent = t.textContent;
}
// any [data-reqorg] button (My shops, Find shops map cards) opens the in-app request sheet
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-reqorg]');
  if(!b) return;
  e.preventDefault();
  openFleetRequest(b.dataset.reqorg, b.dataset.reqname || '');
});
