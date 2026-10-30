// ============================================================
// RelayFleet — the header tools: Recent · New (+) · Messages · (Notifications) · Account avatar.
// Recent, New and Messages are for shop staff; the avatar (initials + account menu) is for everyone.
// ============================================================
const HDR_ICONS = {
  recent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>'
};
const RECENT_MAX = 10;
let hdrOpen = null;

function hdrKey(k){ return 'relay.' + k + '.' + (session && session.id); }
function initials(name){ const p = String(name || '').trim().split(/\s+/).filter(Boolean); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }

// ---- Recent: what this person opened last ----
function rememberRecent(kind, id){
  if(!id) return;
  let list = []; try { list = JSON.parse(localStorage.getItem(hdrKey('recent')) || '[]'); } catch(_){}
  list = [{ kind, id: Number(id), at: Date.now() }].concat(list.filter(x => !(x.kind === kind && x.id === Number(id)))).slice(0, RECENT_MAX);
  try { localStorage.setItem(hdrKey('recent'), JSON.stringify(list)); } catch(_){}
}
function wrapForRecent(fnName, kind){
  const f = window[fnName]; if(typeof f !== 'function' || f.__recent) return;
  const w = function(id){ rememberRecent(kind, id); return f.apply(this, arguments); };
  w.__recent = true; window[fnName] = w;
}
async function renderRecent(panel){
  let list = []; try { list = JSON.parse(localStorage.getItem(hdrKey('recent')) || '[]'); } catch(_){}
  if(!list.length){ panel.innerHTML = '<div class="hdr-empty">Work orders, customers and units you open will show here.</div>'; return; }
  const ids = k => list.filter(x => x.kind === k).map(x => x.id);
  const [jobs, custs, units] = await Promise.all([
    ids('job').length ? sb.from('jobs').select('id, ro_number, customer, vehicle').in('id', ids('job')) : Promise.resolve({ data: [] }),
    ids('customer').length ? sb.from('customers').select('id, company_name').in('id', ids('customer')) : Promise.resolve({ data: [] }),
    ids('unit').length ? sb.from('units').select('id, unit_number, make, model').in('id', ids('unit')) : Promise.resolve({ data: [] })]);
  const find = (arr, id) => (arr.data || []).find(r => r.id === id);
  const rows = list.map(x => {
    const r = find(x.kind === 'job' ? jobs : x.kind === 'customer' ? custs : units, x.id); if(!r) return '';   // gone, or in another location
    const [kindLabel, title, sub] = x.kind === 'job' ? ['Work order', r.ro_number || '#' + r.id, [r.customer, r.vehicle].filter(Boolean).join(' · ')]
      : x.kind === 'customer' ? ['Customer', r.company_name, ''] : ['Unit', r.unit_number, [r.make, r.model].filter(Boolean).join(' ')];
    return `<button type="button" class="hdr-row" data-rk="${x.kind}" data-rid="${x.id}"><span class="hdr-kind">${kindLabel}</span><b>${esc(title || '')}</b>${sub ? `<span class="meta">${esc(sub)}</span>` : ''}</button>`;
  }).join('');
  panel.innerHTML = `<div class="hdr-head">Recently opened</div>${rows || '<div class="hdr-empty">Nothing recent in this location.</div>'}`;
  panel.querySelectorAll('[data-rk]').forEach(b => b.onclick = () => {
    closeHdr(); const id = Number(b.dataset.rid);
    if(b.dataset.rk === 'job') openRepairOrder(id); else if(b.dataset.rk === 'customer') openCustomerProfile(id); else openUnitHistory(id);
  });
}

// ---- New (+): start something from anywhere ----
const HDR_NEW = [
  ['Work order', 'shop-jobs', 'createJobBtn'],
  ['Estimate or invoice', 'shop-invoices', 'docNewBtn'],
  ['Customer', 'shop-customers', 'addCustomerBtn'],
  ['Unit (truck or trailer)', 'shop-units', 'addUnitBtn']];
function renderNew(panel){
  panel.innerHTML = '<div class="hdr-head">Create new</div>' + HDR_NEW.filter(([, , btn]) => document.getElementById(btn)).map(([label, target, btn]) => `<button type="button" class="hdr-row hdr-new" data-np="${target}" data-nb="${btn}">${HDR_ICONS.plus}<b>${esc(label)}</b></button>`).join('');
  panel.querySelectorAll('[data-nb]').forEach(b => b.onclick = () => {
    closeHdr();
    if(typeof goToPanel === 'function') goToPanel(b.dataset.np);
    setTimeout(() => { const t = document.getElementById(b.dataset.nb); if(t) t.click(); }, 60);
  });
}

// ---- Messages: work order messages from other people ----
async function loadMessages(){
  const { data } = await sb.from('job_comments').select('id, job_id, body, created_at, author_id, profiles:author_id(name), jobs(ro_number, customer, vehicle)').neq('author_id', session.id).order('created_at', { ascending: false }).limit(25);
  return data || [];
}
async function refreshMsgBadge(){
  const b = document.getElementById('hdrMsgCount'); if(!b || !session) return;
  let seen = 0; try { seen = Number(localStorage.getItem(hdrKey('msgseen')) || 0); } catch(_){}
  const list = await loadMessages();
  const n = list.filter(m => new Date(m.created_at).getTime() > seen).length;
  b.textContent = n > 9 ? '9+' : String(n); b.classList.toggle('hidden', n === 0);
  const btn = document.getElementById('hdrBtn-msg'); if(btn) btn.setAttribute('aria-label', n ? `Messages, ${n} new` : 'Messages');
}
async function renderMessages(panel){
  panel.innerHTML = skelRows(3);
  const list = await loadMessages();
  let seen = 0; try { seen = Number(localStorage.getItem(hdrKey('msgseen')) || 0); } catch(_){}
  try { localStorage.setItem(hdrKey('msgseen'), String(Date.now())); } catch(_){}
  refreshMsgBadge();
  if(!list.length){ panel.innerHTML = '<div class="hdr-head">Messages</div><div class="hdr-empty">No messages yet. Messages on work orders show here.</div>'; return; }
  const ago = ts => { const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000); return m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
  panel.innerHTML = '<div class="hdr-head">Messages</div>' + list.map(m => `<button type="button" class="hdr-row hdr-msg${new Date(m.created_at).getTime() > seen ? ' is-new' : ''}" data-mj="${m.job_id}">
      <span class="hdr-kind">${esc((m.jobs && m.jobs.ro_number) || 'Work order')} · ${esc(ago(m.created_at))}</span>
      <b>${esc((m.profiles && m.profiles.name) || 'Someone')}</b><span class="hdr-msg-body">${esc(m.body.length > 110 ? m.body.slice(0, 108) + '…' : m.body)}</span></button>`).join('');
  panel.querySelectorAll('[data-mj]').forEach(b => b.onclick = () => { closeHdr(); openRepairOrder(Number(b.dataset.mj)); });
}

// ---- panels ----
function closeHdr(){ document.querySelectorAll('.hdr-panel').forEach(p => p.classList.add('hidden')); document.querySelectorAll('.hdr-btn').forEach(b => b.setAttribute('aria-expanded', 'false')); hdrOpen = null; }
function toggleHdr(which, render){
  const panel = document.getElementById('hdrPanel-' + which), btn = document.getElementById('hdrBtn-' + which);
  if(hdrOpen === which){ closeHdr(); return; }
  closeHdr(); hdrOpen = which;
  panel.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true');
  render(panel);
}
document.addEventListener('click', e => { if(hdrOpen && !e.target.closest('.hdr-tool')) closeHdr(); });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && hdrOpen){ const b = document.getElementById('hdrBtn-' + hdrOpen); closeHdr(); if(b) b.focus(); } });

function hdrTool(id, icon, label, extra){
  return `<div class="hdr-tool"><button type="button" class="hdr-btn" id="hdrBtn-${id}" aria-haspopup="true" aria-expanded="false" aria-label="${label}" title="${label}">${icon}${extra || ''}</button><div class="hdr-panel hidden" id="hdrPanel-${id}" role="dialog" aria-label="${label}"></div></div>`;
}

// ---- the account avatar (all roles): initials, and the account menu with who/where at the top ----
function initAvatar(){
  const btn = document.getElementById('moreMenuBtn'), who = document.getElementById('whoBox'), menu = document.getElementById('moreMenu');
  if(!btn || !who || !menu || !session) return;
  who.classList.add('who-compact');
  btn.classList.add('hdr-avatar'); btn.textContent = initials(session.name);
  let head = document.getElementById('acctHead');
  if(!head){ head = document.createElement('div'); head.id = 'acctHead'; head.className = 'acct-head'; menu.prepend(head); }
  const roleLabel = session.role === 'shop' ? ({ owner: 'Shop owner', office: 'Office', service_writer: 'Service writer' }[session.staffRole] || 'Shop staff') : session.role === 'mechanic' ? 'Mechanic' : session.role === 'fleet' ? 'Fleet manager' : session.role === 'admin' ? 'Relay admin' : '';
  const org = (document.getElementById('whoOrg') || {}).textContent || session.company || '';
  const loc = typeof chosenLocation === 'function' && chosenLocation() && (window.relayAllLocations || []).length > 1 ? (chosenLocation().display_name || chosenLocation().name) : '';
  btn.setAttribute('aria-label', (loc ? 'Account and location: ' : 'Account: ') + (session.name || '') + (loc ? ', ' + loc : ''));
  head.innerHTML = `<span class="acct-avatar" aria-hidden="true">${esc(initials(session.name))}</span><div><b>${esc(session.name || '')}</b><span>${esc([roleLabel, org].filter(Boolean).join(' · '))}</span>${loc ? `<span>${esc(loc)}</span>` : ''}</div>`;
}

function initHeaderTools(){
  if(!session) return;
  initAvatar(); renderAvatarLocations();
  if(session.role !== 'shop' || document.getElementById('hdrTools')) return;
  const notif = document.getElementById('notifWrap'); if(!notif) return;
  const box = document.createElement('div'); box.id = 'hdrTools'; box.className = 'hdr-tools';
  box.innerHTML = hdrTool('recent', HDR_ICONS.recent, 'Recently opened') + hdrTool('new', HDR_ICONS.plus, 'Create new') +
    hdrTool('msg', HDR_ICONS.chat, 'Messages', '<span class="notif-count hidden" id="hdrMsgCount"></span>');
  notif.parentElement.insertBefore(box, notif);
  document.getElementById('hdrBtn-recent').onclick = e => { e.stopPropagation(); toggleHdr('recent', renderRecent); };
  document.getElementById('hdrBtn-new').onclick = e => { e.stopPropagation(); toggleHdr('new', renderNew); };
  const mb = document.getElementById('hdrBtn-msg'); mb.onclick = e => { e.stopPropagation(); toggleHdr('msg', renderMessages); };
  wrapForRecent('openRepairOrder', 'job'); wrapForRecent('openCustomerProfile', 'customer'); wrapForRecent('openUnitHistory', 'unit');
  refreshMsgBadge();
  if(typeof everyWhileVisible === 'function') everyWhileVisible(refreshMsgBadge, 60000);
}

// ---- the location switch, inside the account menu ----
// The owner picks the location here; office staff see their own. A small label next to the
// avatar always says which location is open, and opens the same menu.
function renderAvatarLocations(){
  const menu = document.getElementById('moreMenu'), btn = document.getElementById('moreMenuBtn');
  if(!menu || !session) return;
  let sec = document.getElementById('acctLoc'), pill = document.getElementById('locPill');
  const locs = (typeof relayLocations !== 'undefined' ? relayLocations : []) || [];
  const cur = typeof chosenLocation === 'function' ? chosenLocation() : null;
  if(session.role !== 'shop' || locs.length < 2 || !cur){ if(sec) sec.remove(); if(pill) pill.remove(); return; }
  const name = l => l.display_name || l.name;
  if(!sec){ sec = document.createElement('div'); sec.id = 'acctLoc'; sec.className = 'acct-loc'; const head = document.getElementById('acctHead'); if(head) head.after(sec); else menu.prepend(sec); }
  const owner = session.staffRole === 'owner';
  sec.innerHTML = `<div class="acct-loc-h">Location</div>` + (owner
    ? locs.map(l => `<button type="button" role="menuitemradio" aria-checked="${l.id === cur.id}" class="acct-loc-opt${l.id === cur.id ? ' is-on' : ''}" data-acctloc="${l.id}"><span class="acct-tick" aria-hidden="true">${l.id === cur.id ? '✓' : ''}</span>${esc(name(l))}</button>`).join('')
    : `<div class="acct-loc-fixed">${esc(name(cur))}<span class="meta">Your location</span></div>`);
  sec.querySelectorAll('[data-acctloc]').forEach(b => b.onclick = () => { const id = Number(b.dataset.acctloc); if(id !== cur.id && typeof switchLocation === 'function') switchLocation(id); else menu.classList.add('hidden'); });
  if(pill) pill.remove();   // the switch lives only inside the avatar menu
  initAvatar();   // refresh the location line at the top of the menu
}
