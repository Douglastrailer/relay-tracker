// ============================================================
// RelayFleet — one navigation, nine destinations.
// The brief asks for nine places instead of sixteen. Rather than rebuild every panel,
// the existing destinations are GROUPED: the sidebar shows nine, and opening one reveals
// its related screens as sub-tabs across the top of the page. Every panel, every
// data-target and every piece of wiring is untouched — only the way in changes.
// ============================================================
const NAV_GROUPS = [
  { id: 'overview',  label: 'Overview',            tabs: ['shop-overview'] },
  { id: 'work',      label: 'Work orders',         tabs: ['shop-jobs', 'shop-requests', 'shop-floor', 'shop-inspections', 'shop-history', 'shop-pastdue'] },
  { id: 'dispatch',  label: 'Dispatch',            tabs: ['shop-dispatch'] },
  { id: 'customers', label: 'Customers & units',   tabs: ['shop-customers', 'shop-units'] },
  // shops asked for this: decode any VIN, see if it is already a unit, check recalls
  { id: 'vin',       label: 'VIN lookup',          tabs: ['shop-vin'] },
  { id: 'parts',     label: 'Parts & inventory',   tabs: ['shop-inventory'] },
  { id: 'money',     label: 'Estimates & invoices',tabs: ['shop-invoices'] },
  { id: 'team',      label: 'Team & time',         tabs: ['shop-team', 'shop-time'] },
  { id: 'reports',   label: 'Reports',             tabs: ['shop-analytics'] },
  { id: 'settings',  label: 'Settings',            tabs: ['shop-billing', 'shop-integrations'] }
];
// what each sub-tab is called once it is inside a group (shorter, since the group gives the context)
const NAV_SUB_LABELS = {
  'shop-jobs': 'All work orders', 'shop-requests': 'Requests', 'shop-floor': 'Board',
  'shop-inspections': 'Inspections', 'shop-history': 'Completed', 'shop-customers': 'Customers',
  'shop-units': 'Units', 'shop-pastdue': 'Past due', 'shop-team': 'Technicians', 'shop-time': 'Time', 'shop-billing': 'Settings',
  'shop-integrations': 'Integrations', 'shop-invoices': 'Estimates & invoices'
};
let navBuilt = false;

function navGroupFor(target){ return NAV_GROUPS.find(g => g.tabs.includes(target)); }
function navTabButton(target){ return document.querySelector(`.dash-tab[data-target="${target}"]`); }
function navVisibleTabs(group){ return group.tabs.filter(t => { const b = navTabButton(t); return b && !b.classList.contains('hidden'); }); }

// Opens a destination. Sub-tabs simply click the original tab button, so every
// existing behaviour — loading, titles, badges — happens exactly as before.
function navOpen(groupId, target){
  const group = NAV_GROUPS.find(g => g.id === groupId); if(!group) return;
  const tabs = navVisibleTabs(group); if(!tabs.length) return;
  const want = target && tabs.includes(target) ? target : tabs[0];
  const btn = navTabButton(want); if(!btn) return;
  btn.click();
  if(want === 'shop-vin' && typeof vinMount === 'function') vinMount(document.getElementById('shop-vin'));
  try { localStorage.setItem('relay.nav.' + groupId, want); } catch(_){}
  navPaint(groupId, want);
}
// Phase 4: no duplicate controls. A toolbar button that just opens a screen now reachable
// as a sub-tab is removed, so there is one way in, not two.
const NAV_DUPLICATES = [['shop-jobs', '#woRequestsBtn'], ['shop-jobs', '[data-target="shop-requests"].ghost-btn']];
function navHideDuplicates(){
  NAV_DUPLICATES.forEach(([panel, sel]) => {
    const p = document.getElementById(panel); if(!p) return;
    p.querySelectorAll(sel).forEach(b => b.classList.add('hidden'));
  });
  // any toolbar button whose only job is to open a sibling sub-tab
  document.querySelectorAll('#shopView .dash-panel .rec-toolbar button, #shopView .dash-panel .wo-toolbar button').forEach(b => {
    const label = (b.textContent || '').trim();
    const sub = [...document.querySelectorAll('#navSubTabs .nav-sub')].find(s => s.textContent.trim() === label);
    if(sub && !b.id.includes('New')) b.classList.add('hidden');
  });
}
function navPaint(groupId, target){
  document.querySelectorAll('[data-navgroup]').forEach(b => {
    const on = b.dataset.navgroup === groupId;
    b.classList.toggle('active', on);
    if(on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const group = NAV_GROUPS.find(g => g.id === groupId);
  const bar = document.getElementById('navSubTabs'); if(!bar || !group) return;
  const tabs = navVisibleTabs(group);
  if(tabs.length < 2){ bar.classList.add('hidden'); bar.innerHTML = ''; return; }   // one screen needs no sub-tabs
  bar.classList.remove('hidden');
  bar.innerHTML = tabs.map(t => {
    const src = navTabButton(t), badge = src && src.querySelector('.nav-badge:not(.hidden)');
    const label = NAV_SUB_LABELS[t] || (src ? src.title : t);
    return `<button type="button" class="nav-sub${t === target ? ' active' : ''}" data-subtab="${t}" data-group="${group.id}" aria-current="${t === target ? 'page' : 'false'}">${esc(label)}${badge ? ` <span class="nav-sub-badge">${esc(badge.textContent.trim())}</span>` : ''}</button>`;
  }).join('');
  navHideDuplicates();
  if(typeof renderNavSubs === 'function') renderNavSubs();   // the sidebar follows the screen
}
function buildNav(){
  const host = document.querySelector('#shopView .dash-tabs'); if(!host || navBuilt) return;
  if(!document.querySelector('#shopView .dash-tab')) return;
  navBuilt = true;
  // the original tab buttons stay in the page (everything still clicks them) but are hidden
  host.classList.add('nav-grouped');
  const list = document.createElement('div');
  list.className = 'nav-groups';
  list.innerHTML = NAV_GROUPS.map(g => {
    const first = navTabButton(g.tabs[0]);
    const ico = first ? (first.querySelector('.nav-ico') || {}).outerHTML || '' : '';
    return `<button type="button" class="dash-tab nav-group-btn" data-navgroup="${g.id}" title="${esc(g.label)}">${ico}<span class="nav-label">${esc(g.label)}</span><span class="nav-badge hidden" data-gbadge="${g.id}"></span></button>`;
  }).join('');
  host.insertBefore(list, host.firstChild);
  list.addEventListener('click', e => { const b = e.target.closest('[data-navgroup]'); if(b) navOpen(b.dataset.navgroup, (() => { try { return localStorage.getItem('relay.nav.' + b.dataset.navgroup); } catch(_){ return null; } })()); });
  // the sub-tab bar sits at the top of the page content
  const view = document.getElementById('shopView');
  if(!document.getElementById('navSubTabs')){
    const bar = document.createElement('nav');
    bar.id = 'navSubTabs'; bar.className = 'nav-subtabs hidden'; bar.setAttribute('aria-label', 'Sections');
    const header = view.querySelector('.page-header') || view.querySelector('.dash-panel');
    view.insertBefore(bar, header && header.parentElement === view ? header.nextSibling : view.firstChild);
    bar.addEventListener('click', e => { const b = e.target.closest('[data-subtab]'); if(b) navOpen(b.dataset.group, b.dataset.subtab); });
  }
  navRollUpBadges();
  const open = document.querySelector('#shopView .dash-tab.active:not(.nav-group-btn)');
  const g = open ? navGroupFor(open.dataset.target) : NAV_GROUPS[0];
  navPaint(g ? g.id : 'overview', open ? open.dataset.target : 'shop-overview');
  if(typeof renderNavSubs === 'function') setTimeout(renderNavSubs, 0);
}
// a count on a hidden sub-tab still needs to be seen on its group
function navRollUpBadges(){
  NAV_GROUPS.forEach(g => {
    let total = 0;
    g.tabs.forEach(t => { const b = navTabButton(t); const badge = b && b.querySelector('.nav-badge'); if(badge && !badge.classList.contains('hidden')) total += Number((badge.textContent || '').replace(/\D/g, '')) || 0; });
    const gb = document.querySelector(`[data-gbadge="${g.id}"]`);
    // Only touch the page when the number really changed: writing the same text again is itself
    // a change, which this file is watching for — that would loop forever and freeze the screen.
    const want = total ? String(total) : '';
    if(gb && gb.textContent !== want) gb.textContent = want;
    if(gb && gb.classList.contains('hidden') !== !total) gb.classList.toggle('hidden', !total);
  });
}
if(typeof window !== 'undefined'){
  document.addEventListener('DOMContentLoaded', buildNav);
  let navQueued = false;
  new MutationObserver((records) => {
    // ignore changes the navigation made to its own group badges
    if(records.every(r => { const el = r.target.nodeType === 3 ? r.target.parentElement : r.target; return el && el.closest && el.closest('[data-gbadge]'); })) return;
    if(navQueued) return; navQueued = true;
    requestAnimationFrame(() => { navQueued = false; buildNav(); if(navBuilt) navRollUpBadges(); });   // at most once per frame
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}
