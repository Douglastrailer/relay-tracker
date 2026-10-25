// ============================================================
// RelayFleet — "What's new" (release notes) and a short guided tour of the menu.
// Both live in the ⋯ menu. The tour starts once by itself for a shop owner (after setup),
// can be skipped at any step, and can be taken again any time.
// ============================================================
const RELAY_RELEASES = [
  { date: '2026-10-25', title: 'Separate locations', items: [
    'Each location has its own name, logo, details, rates and terms, printed on its own documents.',
    'Switch locations from the top of the menu. Customers, work orders and invoices are never mixed.',
    'Office staff work in their own location; set who works where in Settings → Locations.'] },
  { date: '2026-10-25', title: 'Fleet customers', items: [
    'Fleet managers open their own account and join your shop with your fleet code.',
    'See and remove your regular fleet customers in Team & time.'] },
  { date: '2026-10-24', title: 'Live tracking links', items: [
    'Share a link from any work order. Customers follow the repair without an account; roadside jobs show the technician on the way.'] },
  { date: '2026-10-24', title: 'Work order panel and board', items: [
    'Every work order shows Order, Customer and Vehicle details on the side.',
    'Board cards show how long a job has been in its stage. Filter the board by technician, roadside or urgent.'] },
  { date: '2026-10-23', title: 'Clearer messages', items: [
    'Errors say what happened and what to do next, instead of technical text.'] }
];
const RELAY_RELEASE_ID = RELAY_RELEASES[0].date + '|' + RELAY_RELEASES[0].title;

function whatsNewSeen(){ try { return localStorage.getItem('relay.whatsnew.seen') === RELAY_RELEASE_ID; } catch(_){ return true; } }
function markWhatsNewDot(){ const b = document.getElementById('whatsNewBtn'); if(b) b.classList.toggle('has-dot', !whatsNewSeen()); }

function openWhatsNew(){
  try { localStorage.setItem('relay.whatsnew.seen', RELAY_RELEASE_ID); } catch(_){}
  markWhatsNewDot();
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form whats-new">${RELAY_RELEASES.map(r => `
      <section class="wn-item"><div class="meta">${esc(new Date(r.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }))}</div>
      <h3>${esc(r.title)}</h3><ul>${r.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('')}</div>`;
  if(typeof openFormSheet === 'function') openFormSheet("What's new in Relay", [body]);
}

// ---- the tour ----
const TOUR_STEPS = [
  { nav: 'overview', title: 'Your day at a glance', text: 'Today\'s numbers and the shop board. Drag a card to move a job; filter the board by technician or roadside.' },
  { nav: 'work', title: 'Work orders', text: 'Every job, from request to invoice. Open one to see its Order, Customer and Vehicle details on the side.' },
  { nav: 'customers', title: 'Customers & units', text: 'Your customers and their trucks and trailers, with every repair ever done on each unit.' },
  { nav: 'money', title: 'Estimates & invoices', text: 'Build estimates, get approvals by link, and turn approved work into invoices.' },
  { nav: 'settings', title: 'Settings', text: 'Your company and locations, rates, warranty terms and customer updates.' }
];
let tourIdx = -1;

function tourTarget(step){
  return document.querySelector(`#shopView [data-navgroup="${step.nav}"]`) || document.querySelector('#shopView .nav-group-btn');
}
function startTour(){
  if(!document.querySelector('#shopView .nav-group-btn')) return;
  tourIdx = 0; showTourStep();
}
function endTour(){
  tourIdx = -1;
  document.querySelectorAll('.tour-pop, .tour-ring').forEach(e => e.remove());
  try { localStorage.setItem('relay.tour.done.' + (session && session.id), '1'); } catch(_){}
}
function showTourStep(){
  document.querySelectorAll('.tour-pop, .tour-ring').forEach(e => e.remove());
  const step = TOUR_STEPS[tourIdx]; if(!step){ endTour(); return; }
  const el = tourTarget(step); if(!el){ endTour(); return; }
  const r = el.getBoundingClientRect();
  const ring = document.createElement('div'); ring.className = 'tour-ring';
  Object.assign(ring.style, { top: (r.top - 4) + 'px', left: (r.left - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px' });
  const pop = document.createElement('div'); pop.className = 'tour-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-labelledby', 'tourTitle');
  const narrow = window.innerWidth < 700;
  Object.assign(pop.style, narrow ? { left: '12px', right: '12px', bottom: '16px' } : { top: Math.max(12, r.top - 8) + 'px', left: (r.right + 16) + 'px' });
  pop.innerHTML = `<div class="meta">Step ${tourIdx + 1} of ${TOUR_STEPS.length}</div><h3 id="tourTitle">${esc(step.title)}</h3><p>${esc(step.text)}</p>
    <div class="tour-actions"><button type="button" class="text-btn" id="tourSkip">Skip tour</button><span>${tourIdx > 0 ? '<button type="button" class="ghost-btn" id="tourBack">Back</button>' : ''}<button type="button" id="tourNext">${tourIdx === TOUR_STEPS.length - 1 ? 'Done' : 'Next'}</button></span></div>`;
  document.body.append(ring, pop);
  pop.querySelector('#tourSkip').onclick = endTour;
  const back = pop.querySelector('#tourBack'); if(back) back.onclick = () => { tourIdx--; showTourStep(); };
  pop.querySelector('#tourNext').onclick = () => { tourIdx++; if(tourIdx >= TOUR_STEPS.length) endTour(); else showTourStep(); };
  pop.querySelector('#tourNext').focus();
}
document.addEventListener('keydown', e => { if(e.key === 'Escape' && tourIdx >= 0) endTour(); });

// the first time a shop owner opens Relay (setup finished), the tour starts by itself
function maybeStartTour(){
  if(!session || session.role !== 'shop' || session.staffRole !== 'owner') return;
  let done = false; try { done = localStorage.getItem('relay.tour.done.' + session.id) === '1'; } catch(_){ done = true; }
  if(done || document.getElementById('setupGate')) return;
  setTimeout(() => { if(!document.getElementById('setupGate') && tourIdx < 0) startTour(); }, 1500);
}

function initHelpExtras(){
  const menu = document.getElementById('moreMenu'); if(!menu || document.getElementById('whatsNewBtn')) return;
  const lo = document.getElementById('logoutBtn');
  const wn = Object.assign(document.createElement('button'), { id: 'whatsNewBtn', type: 'button', textContent: "What's new" });
  const tb = Object.assign(document.createElement('button'), { id: 'tourBtn', type: 'button', textContent: 'Take the tour' });
  menu.insertBefore(wn, lo); menu.insertBefore(tb, lo);
  wn.onclick = () => { menu.classList.add('hidden'); openWhatsNew(); };
  tb.onclick = () => { menu.classList.add('hidden'); if(session && session.role === 'shop') startTour(); };
  tb.classList.toggle('hidden', !(session && session.role === 'shop'));
  markWhatsNewDot();
}
