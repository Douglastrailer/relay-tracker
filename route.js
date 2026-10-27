// ============================================================
// RelayFleet — come back to the same place after a refresh.
// Where the person is (screen, section, open work order) is kept in the address after '#',
// e.g. relayfleet.us/#v=shop-inventory&s=reorder&wo=41. On refresh it is restored during
// sign-in, before the loading screen lifts, so the home page never flashes first.
// The address is replaced, not added to, so the browser's Back button behaves as before.
// Password-reset links (#access_token=…) are never touched.
// ============================================================
let routeRestoring = false;

function readRoute(){
  if(!/^#v=/.test(location.hash)) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const v = p.get('v'), s = p.get('s'), wo = Number(p.get('wo'));
  if(!v || !/^[a-z0-9-]{2,40}$/.test(v)) return null;
  return { v, s: s && /^[a-z0-9_-]{1,30}$/.test(s) ? s : null, wo: Number.isInteger(wo) && wo > 0 ? wo : null };
}
const routeAtLoad = readRoute();   // read once when the page loads, before anything can change it
// called at the start of sign-in, before any screen is drawn: the saved section is set first,
// so each screen is drawn once, straight at the right place
function prepareRoute(){
  const r = routeAtLoad || readRoute(); if(!r || !r.s) return;
  if(r.v === 'shop-inventory' && typeof invState !== 'undefined') invState.tab = r.s;
  if(r.v === 'shop-billing'){ try { localStorage.setItem('relay.settingsTab', r.s); } catch(_){} }
}

function currentRoute(){
  if(typeof session === 'undefined' || !session) return null;
  const r = {};
  if(session.role === 'fleet'){ const t = document.querySelector('#fleetView .fleet-tab.active[data-ftab]'); if(t) r.v = t.dataset.ftab; }
  else if(session.role === 'shop' || session.role === 'admin'){
    const t = document.querySelector(`#${session.role === 'shop' ? 'shopView' : 'adminView'} .dash-tab.active:not(.nav-group-btn)`); if(t) r.v = t.dataset.target;
  } else return null;   // mechanics have a single screen
  if(r.v === 'shop-inventory' && typeof invState !== 'undefined' && invState.tab) r.s = invState.tab;
  if(r.v === 'shop-billing'){ try { const s = localStorage.getItem('relay.settingsTab'); if(s) r.s = s; } catch(_){} }
  const ro = document.getElementById('roModal');
  if(ro && !ro.classList.contains('hidden') && typeof roCurrentJob !== 'undefined' && roCurrentJob && roCurrentJob.id) r.wo = roCurrentJob.id;
  return r;
}

function saveRoute(){
  if(routeRestoring || (typeof inRecoveryFlow !== 'undefined' && inRecoveryFlow)) return;
  if(location.hash && !/^#v=/.test(location.hash)) return;   // someone else's address (a password-reset link): leave it
  const r = currentRoute(); if(!r || !r.v) return;
  const p = new URLSearchParams(); p.set('v', r.v); if(r.s) p.set('s', r.s); if(r.wo) p.set('wo', String(r.wo));
  const h = '#' + p.toString();
  if(location.hash !== h) history.replaceState(history.state, '', location.pathname + location.search + h);
}
let routeTimer = null;
function saveRouteSoon(){ clearTimeout(routeTimer); routeTimer = setTimeout(saveRoute, 80); }

// called at the end of sign-in: open the saved place, if there is one this person can see
function restoreRoute(){
  const r = routeAtLoad || readRoute();
  if(!r || typeof session === 'undefined' || !session || session.role === 'mechanic') return false;
  routeRestoring = true;
  try {
    if(session.role === 'fleet'){
      if(typeof showFleetTab === 'function' && document.querySelector(`#fleetView .fleet-tab[data-ftab="${r.v}"]`)) showFleetTab(r.v);
    } else {
      const tab = document.querySelector(`#${session.role === 'shop' ? 'shopView' : 'adminView'} .dash-tab[data-target="${r.v}"]:not(.nav-group-btn)`);
      if(tab && !tab.classList.contains('hidden')){
        // set the section first, so the screen is drawn once, straight at the right place
        if(r.v === 'shop-inventory' && r.s && typeof invState !== 'undefined') invState.tab = r.s;
        if(r.v === 'shop-billing' && r.s){ try { localStorage.setItem('relay.settingsTab', r.s); } catch(_){} }
        const g = typeof navGroupFor === 'function' ? navGroupFor(r.v) : null;
        if(g && typeof navOpen === 'function') navOpen(g.id, r.v); else tab.click();
      }
      if(r.wo && typeof openRepairOrder === 'function'){
        // reopen the work order only if this person can still see it (it may be in another location now)
        sb.from('jobs').select('id').eq('id', r.wo).maybeSingle().then(({ data }) => { if(data) openRepairOrder(r.wo); }).catch(() => {});
      }
    }
  } finally { setTimeout(() => { routeRestoring = false; saveRoute(); }, 600); }
  return true;
}

if(typeof window !== 'undefined'){
  // any move around the app updates the address (tabs, sections, sidebar items, opening or closing a work order)
  document.addEventListener('click', saveRouteSoon);
  document.addEventListener('keyup', e => { if(e.key === 'Escape' || e.key === 'Enter') saveRouteSoon(); });
  // signing out forgets the place, so the next person on this device starts at home
  document.addEventListener('click', e => { if(e.target.closest && e.target.closest('#logoutBtn, #setupOut')) history.replaceState(null, '', location.pathname + location.search); }, true);
}
