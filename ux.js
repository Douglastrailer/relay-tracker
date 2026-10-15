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
