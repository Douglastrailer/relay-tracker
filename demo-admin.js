// ============================================================
// RelayFleet — demo requests from the landing page, for the Relay admin (migration 0052).
// At the top of Admin → Requests: who asked, how to reach them, the best time to call, and a status.
// New requests arrive live, with a short notice.
// ============================================================
const DEMO_KIND = { repair_shop: 'Repair shop', mobile: 'Mobile service', both: 'Shop and mobile' };
const DEMO_STATUS = [['new', 'New'], ['contacted', 'Contacted'], ['booked', 'Demo booked'], ['closed', 'Closed']];

async function renderDemoRequests(){
  const panel = document.getElementById('admin-requests'); if(!panel || !session || session.role !== 'admin') return;
  let box = document.getElementById('demoRequestsBox');
  if(!box){ box = document.createElement('section'); box.id = 'demoRequestsBox'; box.className = 'demo-box'; panel.prepend(box); }
  if(!box.dataset.ready){ box.innerHTML = `<div class="section-head"><h2>Demo requests</h2></div><div id="demoList">${typeof skelRows === 'function' ? skelRows(3) : ''}</div>`; box.dataset.ready = '1'; }
  const { data, error } = await sb.from('demo_requests').select('*').order('created_at', { ascending: false }).limit(100);
  const list = document.getElementById('demoList'); if(!list) return;
  if(error){ list.innerHTML = `<p class="form-error">${esc(friendlyError(error, 'Could not load demo requests').message)}</p>`; return; }
  const rows = data || [];
  const open = rows.filter(r => r.status === 'new').length;
  box.querySelector('h2').textContent = open ? relayFmt('Demo requests ({n} new)', { n: open }) : relayFmt('Demo requests');
  const when = v => new Date(v).toLocaleString(relayLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const items = rows.map(r => ({ key: 'd' + r.id, html: `<div class="demo-row${r.status === 'new' ? ' is-new' : ''}" data-demo="${r.id}">
      <div class="demo-who"><b>${esc(r.name)}</b>${r.business ? `<span>${esc(r.business)}</span>` : ''}<span class="meta">${esc(relayFmt(DEMO_KIND[r.kind] || r.kind))} · ${esc(when(r.created_at))}</span></div>
      <div class="demo-reach">${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}${r.best_time ? `<span class="meta">${esc(relayFmt('Best time: {t}', { t: r.best_time }))}</span>` : ''}</div>
      <label class="demo-status"><span class="sr-only">${esc(relayFmt('Status'))}</span><select data-demostatus="${r.id}">${DEMO_STATUS.map(([v, l]) => `<option value="${v}" ${r.status === v ? 'selected' : ''}>${esc(relayFmt(l))}</option>`).join('')}</select></label>
    </div>` }));
  if(typeof patchChildren === 'function') patchChildren(list, items, `<p class="meta">${esc(relayFmt('No demo requests yet. They arrive here from the landing page.'))}</p>`);
  list.querySelectorAll('[data-demostatus]').forEach(s => s.onchange = async () => {
    const { error: e } = await sb.from('demo_requests').update({ status: s.value, handled_at: s.value === 'new' ? null : new Date().toISOString() }).eq('id', Number(s.dataset.demostatus));
    if(e){ relayFail(e, 'Could not update the request'); return; }
    renderDemoRequests();
  });
}

// live: a new request shows up straight away, with a notice
function watchDemoRequests(){
  if(!session || session.role !== 'admin' || window.__demoWatch || typeof sb === 'undefined') return;
  window.__demoWatch = sb.channel('relay-demo-requests')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'demo_requests' }, (p) => {
      const r = p.new || {};
      if(typeof recordsToast === 'function') recordsToast(relayFmt('New demo request from {name}', { name: r.name || '' }));
      renderDemoRequests();
    })
    .subscribe();
}
document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="admin-requests"]')) setTimeout(renderDemoRequests, 0); });
