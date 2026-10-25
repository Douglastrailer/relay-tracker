// ============================================================
// RelayFleet — friendlier screens: board toggle, empty-list buttons,
// and a one-time tip the first time each screen is opened.
// ============================================================
const UX_TIPS = {
  'shop-dispatch':  ['Road calls waiting for a mechanic are on the map. Click one, then Assign the nearest available mechanic.', 'road call'],
  'shop-invoices':  ['Estimates are approved by the customer from a link. Approved estimates become invoices with one click.', 'estimate'],
  'shop-inventory': ['Add your common parts once. Scan part finds them by barcode; Scan vendor invoice adds deliveries to stock.', 'parts'],
  'shop-customers': ['Customers are added when you create work orders, or all at once with Import.', 'customer'],
  'shop-units':     ['Open a truck or trailer to see every repair done on it. VIN details fills in the make and model.', 'truck']
};
function uxSeen(k){ try { return localStorage.getItem('relay.tip.' + k) === '1'; } catch(_){ return false; } }
function uxMarkSeen(k){ try { localStorage.setItem('relay.tip.' + k, '1'); } catch(_){} }
function uxShowTip(target){
  const tip = UX_TIPS[target], panel = document.getElementById(target);
  if(!tip || !panel || uxSeen(target) || panel.querySelector('.ux-tip')) return;
  if(!session || session.role !== 'shop') return;
  const el = document.createElement('div'); el.className = 'ux-tip'; el.setAttribute('role', 'note');
  el.innerHTML = '<p></p><div class="ux-tip-acts"><button type="button" class="text-btn ux-more">Show me how</button><button type="button" class="ghost-btn ux-ok">Got it</button></div>';
  el.querySelector('p').textContent = tip[0];
  el.querySelector('.ux-ok').onclick = () => { uxMarkSeen(target); el.remove(); };
  el.querySelector('.ux-more').onclick = () => { uxMarkSeen(target); el.remove(); if(typeof openTraining === 'function') openTraining(tip[1]); };
  panel.insertBefore(el, panel.firstChild);
}
document.addEventListener('click', (e) => {
  const tab = e.target.closest && e.target.closest('.dash-tab[data-target]');
  if(tab) setTimeout(() => uxShowTip(tab.dataset.target), 0);
  const c = e.target.closest && e.target.closest('[data-click]');
  if(c){ const b = document.getElementById(c.dataset.click); if(b) b.click(); }
  if(e.target.closest && e.target.closest('[data-import]')){
    const t = document.querySelector('.dash-tab[data-target="shop-integrations"]'); if(t) t.click();
  }
});
// Dashboard: fold the shop board away (remembered on this browser)
function uxBoard(hidden){
  const b = document.getElementById('shopKanbanBoard'), t = document.getElementById('boardToggle'); if(!b || !t) return;
  b.classList.toggle('hidden', hidden); t.textContent = hidden ? 'Show board' : 'Hide board'; t.setAttribute('aria-expanded', String(!hidden));
}
(function(){
  const t = document.getElementById('boardToggle'); if(!t) return;
  let hidden = false; try { hidden = localStorage.getItem('relay.boardHidden') === '1'; } catch(_){}
  uxBoard(hidden);
  t.onclick = () => { hidden = !hidden; try { localStorage.setItem('relay.boardHidden', hidden ? '1' : '0'); } catch(_){} uxBoard(hidden); };
})();

// ============================================================
// Accessibility: every field gets a label a screen reader can read
// (forms built later — unit form, estimate editor — are labelled as they appear).
// ============================================================
let uxLabelN = 0;
function uxLabelFields(root){
  (root || document).querySelectorAll('.field').forEach(f => {
    const ctl = f.querySelector('input:not([type=hidden]), select, textarea'), lab = f.querySelector('label');
    if(!ctl || !lab || lab.htmlFor || lab.contains(ctl)) return;
    if(f.querySelectorAll('input:not([type=hidden]), select, textarea').length !== 1) return;   // ambiguous: leave alone
    if(!ctl.id) ctl.id = 'fld-' + (++uxLabelN);
    lab.htmlFor = ctl.id;
  });
  // anything still without a name: use its placeholder text ("Description", "Customer"…)
  (root || document).querySelectorAll('input:not([type=hidden]), select, textarea').forEach(c => {
    if(c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || c.title || c.closest('label') || (c.id && document.querySelector('label[for="' + c.id + '"]'))) return;
    const ph = c.getAttribute('placeholder'); if(ph) c.setAttribute('aria-label', ph.replace(/[.…]+$/, '').trim());
  });
  (root || document).querySelectorAll('.modal-overlay:not([role])').forEach(o => { o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); });
}
uxLabelFields();
new MutationObserver((muts) => { for(const m of muts) for(const n of m.addedNodes) if(n.nodeType === 1) uxLabelFields(n.parentNode || n); }).observe(document.body, { childList: true, subtree: true });

// ============================================================
// Drafts: a half-filled New work order survives a closed tab or a lost signal.
// Kept on this phone for 24 hours, per signed-in user, and wiped at sign-out.
// ============================================================
const WO_DRAFT_FIELDS = ['njCustomer', 'njVehicle', 'njIssue', 'njVin', 'njUnitType', 'njPriority', 'njDrivable'];
const woDraftKey = () => 'relay.draft.wo.' + ((session && session.id) || '');
function woDraftSave(){
  if(!session || !session.id) return;
  const box = document.getElementById('woCreateBox'); if(!box) return;
  const d = { at: Date.now(), type: (box.querySelector('[data-jobtype].active') || {}).dataset ? box.querySelector('[data-jobtype].active').dataset.jobtype : 'mobile', safety: !!(document.getElementById('njSafety') || {}).checked };
  WO_DRAFT_FIELDS.forEach(id => { const el = document.getElementById(id); d[id] = el ? el.value : ''; });
  const typed = ['njCustomer', 'njVehicle', 'njIssue', 'njVin'].some(id => (d[id] || '').trim());
  try { if(typed) localStorage.setItem(woDraftKey(), JSON.stringify(d)); else localStorage.removeItem(woDraftKey()); } catch(_){}
}
function woDraftClear(){
  try { Object.keys(localStorage).filter(k => k.startsWith('relay.draft.wo.')).forEach(k => localStorage.removeItem(k)); } catch(_){}
  const n = document.getElementById('woDraftNote'); if(n) n.remove();
}
function woDraftRestore(){
  let d; try { d = JSON.parse(localStorage.getItem(woDraftKey()) || 'null'); } catch(_){ d = null; }
  if(!d || Date.now() - d.at > 24 * 3600 * 1000){ try { localStorage.removeItem(woDraftKey()); } catch(_){} return false; }
  const cust = document.getElementById('njCustomer'); if(!cust || ['njCustomer', 'njVehicle', 'njIssue'].some(id => (document.getElementById(id) || {}).value)) return false;   // never overwrite what is on screen
  const tb = document.querySelector('#woCreateBox [data-jobtype="' + d.type + '"]'); if(tb) tb.click();
  WO_DRAFT_FIELDS.forEach(id => { const el = document.getElementById(id); if(el && d[id] != null && d[id] !== '') el.value = d[id]; });
  const sf = document.getElementById('njSafety'); if(sf) sf.checked = !!d.safety;
  if(!document.getElementById('woDraftNote')){
    const note = document.createElement('div'); note.id = 'woDraftNote'; note.className = 'ux-tip'; note.setAttribute('role', 'status');
    note.innerHTML = '<p>Your unsaved work order was restored.</p><div class="ux-tip-acts"><button type="button" class="text-btn" id="woDraftClear">Start fresh</button></div>';
    cust.closest('.field').parentNode.insertBefore(note, cust.closest('.field'));
    note.querySelector('#woDraftClear').onclick = () => { woDraftClear(); WO_DRAFT_FIELDS.forEach(id => { const el = document.getElementById(id); if(el && el.tagName !== 'SELECT') el.value = ''; }); };
  }
  return true;
}
(function(){
  const box = document.getElementById('woCreateBox'); if(!box) return;
  box.addEventListener('input', woDraftSave); box.addEventListener('change', woDraftSave);
  new MutationObserver(() => { if(!box.classList.contains('hidden')) woDraftRestore(); }).observe(box, { attributes: true, attributeFilter: ['class'] });
})();

// ============================================================
// Settings as tabs: one section at a time instead of one long page.
// The sections themselves are drawn by other files; this only groups them and shows one.
// ============================================================
const SETTINGS_TABS = [['company', 'Company & rates'], ['plan', 'Plan & billing'], ['locations', 'Locations'], ['updates', 'Customer updates'], ['costs', 'Technician costs'], ['bays', 'Shop bays']];
const SETTINGS_GROUP = { planBox:'plan', exportBox:'plan', mfaBox:'plan', locSettings:'locations', notifySettings:'updates', techCostBox:'costs', baySettings:'bays' };
function uxSettingsTabs(){
  const panel = document.getElementById('shop-billing'); if(!panel) return;
  const kids = [...panel.children].filter(c => !c.classList.contains('settings-tabs'));
  kids.forEach(k => { const g = SETTINGS_GROUP[k.id] || (k.classList.contains('section') ? 'company' : null); if(g) k.dataset.setgroup = g; });
  const present = SETTINGS_TABS.filter(([g]) => kids.some(k => k.dataset.setgroup === g));
  let bar = panel.querySelector(':scope > .settings-tabs');
  if(!bar){ bar = document.createElement('nav'); bar.className = 'fleet-tabs settings-tabs'; bar.setAttribute('aria-label', 'Settings sections'); panel.insertBefore(bar, panel.firstChild); }
  let active = 'company'; try { active = localStorage.getItem('relay.settingsTab') || 'company'; } catch(_){}
  if(!present.some(([g]) => g === active)) active = present.length ? present[0][0] : 'company';
  const html = present.map(([g, l]) => `<button type="button" class="fleet-tab${g === active ? ' active' : ''}" data-settab="${g}" aria-pressed="${g === active}">${l}</button>`).join('');
  if(bar.dataset.sig !== html){ bar.innerHTML = html; bar.dataset.sig = html; }
  bar.classList.toggle('hidden', present.length < 2);
  kids.forEach(k => { if(k.dataset.setgroup) k.classList.toggle('hidden', k.dataset.setgroup !== active); });
  if(typeof renderNavSubs === 'function') renderNavSubs();   // the same sections in the sidebar
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-settab]'); if(!b) return;
  try { localStorage.setItem('relay.settingsTab', b.dataset.settab); } catch(_){}
  uxSettingsTabs();
});
(function(){
  const panel = document.getElementById('shop-billing'); if(!panel) return;
  let q = false; new MutationObserver(() => { if(q) return; q = true; requestAnimationFrame(() => { q = false; uxSettingsTabs(); }); }).observe(panel, { childList:true });
  uxSettingsTabs();
})();
