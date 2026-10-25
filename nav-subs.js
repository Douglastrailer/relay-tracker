// ============================================================
// RelayFleet — sub-items under every sidebar group.
// Hovering a group (or tabbing onto it) opens its screens and sections underneath; the group
// you are in stays open with the current item marked. Choosing an item works exactly like the
// buttons at the top of the page, which stay on phones and tablets.
//   - most groups list their screens (Work orders: All, Requests, Board, …)
//   - Parts & inventory lists its sections (Parts & prices, Low stock, …)
//   - Settings lists its sections (Company & rates, …) and then Integrations
// ============================================================
const INV_SECTIONS = [['parts', 'Parts & prices'], ['reorder', 'Low stock'], ['count', 'Count'], ['cores', 'Cores'], ['pos', 'Purchase orders'], ['vendors', 'Vendors'], ['locations', 'Locations']];

function navCurrentTarget(){ const t = document.querySelector('#shopView .dash-tab.active:not(.nav-group-btn)'); return t ? t.dataset.target : null; }

// the items for one group: [key, label, isCurrent, badgeHtml]
function navFlyItems(group, cur){
  const label = t => (typeof NAV_SUB_LABELS !== 'undefined' && NAV_SUB_LABELS[t]) || ((navTabButton(t) || {}).title) || t;
  const badge = t => { const b = navTabButton(t) && navTabButton(t).querySelector('.nav-badge:not(.hidden)'); return b && b.textContent.trim() ? `<span class="nav-sub-badge">${esc(b.textContent.trim())}</span>` : ''; };
  const tabs = typeof navVisibleTabs === 'function' ? navVisibleTabs(group) : group.tabs;
  if(group.id === 'settings'){
    const sec = [...document.querySelectorAll('#shop-billing > .settings-tabs [data-settab]')];
    const items = sec.map(b => ['set:' + b.dataset.settab, b.textContent, cur === 'shop-billing' && b.classList.contains('active'), '']);
    if(tabs.includes('shop-integrations')) items.push(['tab:shop-integrations', label('shop-integrations'), cur === 'shop-integrations', '']);
    return items.length >= 2 ? items : [];
  }
  if(group.id === 'parts' && tabs.includes('shop-inventory')){
    const now = typeof invState !== 'undefined' ? invState.tab : 'parts';
    return INV_SECTIONS.map(([k, l]) => ['inv:' + k, l, cur === 'shop-inventory' && now === k, '']);
  }
  return tabs.length >= 2 ? tabs.map(t => ['tab:' + t, label(t), t === cur, badge(t)]) : [];
}

function renderNavSubs(){
  if(typeof NAV_GROUPS === 'undefined') return;
  const cur = navCurrentTarget();
  NAV_GROUPS.forEach(group => {
    const btn = document.querySelector(`#shopView .nav-group-btn[data-navgroup="${group.id}"]`); if(!btn) return;
    const items = navFlyItems(group, cur);
    let wrap = btn.closest('.nav-fly-wrap');
    if(!items.length){ if(wrap){ const l = wrap.querySelector('.nav-fly'); if(l) l.remove(); wrap.classList.remove('is-open'); btn.removeAttribute('aria-expanded'); } return; }
    if(!wrap){ wrap = document.createElement('div'); wrap.className = 'nav-fly-wrap'; btn.parentElement.insertBefore(wrap, btn); wrap.appendChild(btn); }
    let list = wrap.querySelector('.nav-fly');
    if(!list){ list = document.createElement('div'); list.className = 'nav-fly'; list.id = 'navFly-' + group.id; list.setAttribute('role', 'group'); list.setAttribute('aria-label', group.label); wrap.appendChild(list); btn.setAttribute('aria-controls', list.id); }
    const html = items.map(([key, l, on, b]) => `<button type="button" class="nav-fly-item${on ? ' is-on' : ''}" data-navfly="${esc(key)}"${on ? ' aria-current="true"' : ''}><span>${esc(l)}</span>${b}</button>`).join('');
    if(list.dataset.sig !== html){ list.innerHTML = html; list.dataset.sig = html; }
    const inGroup = !!cur && group.tabs.includes(cur);
    wrap.classList.toggle('is-open', inGroup);
    btn.setAttribute('aria-expanded', String(inGroup));
  });
}

// choosing an item: go to the screen, then the section
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-navfly]'); if(!b) return;
  const [kind, val] = b.dataset.navfly.split(':');
  // go through the sidebar's own navOpen, so the group highlight, titles and loading all follow
  const open = (target) => { const g = typeof navGroupFor === 'function' ? navGroupFor(target) : null;
    if(g && typeof navOpen === 'function') navOpen(g.id, target); else if(typeof goToPanel === 'function') goToPanel(target); };
  if(kind === 'tab'){ open(val); }
  else if(kind === 'set'){
    try { localStorage.setItem('relay.settingsTab', val); } catch(_){}
    open('shop-billing');
    if(typeof uxSettingsTabs === 'function') uxSettingsTabs();
  } else if(kind === 'inv'){
    open('shop-inventory');
    if(typeof invState !== 'undefined'){ invState.tab = val; if(typeof refreshInventoryV2 === 'function') refreshInventoryV2(); }
  }
  if(document.body.classList.contains('nav-open') && typeof window.matchMedia === 'function' && window.matchMedia('(max-width:900px)').matches) document.body.classList.remove('nav-open');
  setTimeout(renderNavSubs, 30);
});
// keep the lists in step with where the person is, however they got there
document.addEventListener('click', (e) => { if(e.target.closest && e.target.closest('.dash-tab, .nav-group-btn, [data-settab], [data-itab], [data-subtab]')) setTimeout(renderNavSubs, 30); });
