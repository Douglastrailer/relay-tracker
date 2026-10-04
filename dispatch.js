// ============================================================
// RelayFleet — Redesign R3: Dispatch, Accept job, Notification center.
// Database rules (migration 0016) decide who can accept, decline, assign,
// and which notifications each role can read.
// ============================================================

// ================= Dispatch =================
let dispatchMap = null, dispatchLayer = null, dispatchSel = null, dispatchData = null;
const DISPATCH_MPH = 45;
function dEta(mi){ const m = Math.max(1, Math.round(mi / DISPATCH_MPH * 60)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; }
function dAgo(t){ const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000)); return m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.floor(m / 1440) + ' d'; }
function acceptChip(j){
  if(j.declined_at) return `<span class="acc-chip acc-no" title="${esc(j.decline_reason || '')}">Declined — reassign</span>`;
  if(j.accepted_at) return '<span class="acc-chip acc-yes">Accepted</span>';
  if(['new','assigned'].includes(j.status)) return `<span class="acc-chip acc-wait">No answer yet · ${dAgo(j.updated_at || j.created_at)}</span>`;
  return '';
}
async function refreshDispatch(){
  const box = document.getElementById('dispatchCalls');
  if(!box) return;
  const [jRes, mechs, reqRes] = await Promise.all([
    sb.from('jobs').select(JOB_COLUMNS).eq('org_id', session.orgId).eq('job_type', 'mobile').not('status', 'in', '(' + CLOSED_STATUSES.join(',') + ')').order('created_at', { ascending:false }).limit(200),
    fetchOrgMechanics(),
    sb.from('work_requests').select('id', { count:'exact', head:true }).eq('org_id', session.orgId).eq('status', 'pending').eq('job_type', 'mobile')
  ]);
  const calls = jRes.data || [];
  const active = mechs.filter(m => m.active);
  const locs = typeof fetchLocationsFor === 'function' ? await fetchLocationsFor(active.map(m => m.id)) : {};
  const { data: open } = await sb.from('jobs').select('mechanic_id').eq('org_id', session.orgId).not('status', 'in', '(' + CLOSED_STATUSES.join(',') + ')');
  const load = {}; (open || []).forEach(r => load[r.mechanic_id] = (load[r.mechanic_id] || 0) + 1);
  dispatchData = { calls, mechs: active, locs, load };
  if(dispatchSel && !calls.some(c => c.id === dispatchSel)) dispatchSel = null;
  if(!dispatchSel && calls.length) dispatchSel = (calls.find(c => c.declined_at) || calls[0]).id;
  const name = id => (active.find(m => m.id === id) || {}).name || 'Unassigned';
  const live = id => locs[id] && Date.now() - locs[id].updatedAt < 10 * 60000;
  const reqN = reqRes.count || 0;
  document.getElementById('dispatchReq').innerHTML = reqN ? `<button type="button" class="ghost-btn" id="dispReqBtn">${reqN} roadside request${reqN === 1 ? '' : 's'} waiting →</button>` : '';
  const rb = document.getElementById('dispReqBtn'); if(rb) rb.onclick = () => { const t = document.querySelector('.dash-tab[data-target="shop-requests"]'); if(t) t.click(); };
  box.innerHTML = calls.length ? calls.map(j => {
    // No ETA for a declined call: that mechanic is not coming.
    const l = locs[j.mechanic_id], mi = !j.declined_at && l && live(j.mechanic_id) && j.dest_lat ? milesBetween(l.lat, l.lng, j.dest_lat, j.dest_lng) : null;
    return `<div class="disp-call${j.id === dispatchSel ? ' sel' : ''}${j.declined_at ? ' declined' : ''}" data-call="${j.id}" tabindex="0" role="button">
      <div class="disp-call-top"><span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span>${jobStatusBadge(j.status)}<span class="meta">${dAgo(j.created_at)} ago</span></div>
      <div class="disp-call-unit"><b>${esc(j.vehicle || '')}</b> · ${esc(j.customer || '')}</div>
      ${j.complaint ? `<div class="meta">${esc(j.complaint.slice(0, 90))}</div>` : ''}
      <div class="disp-call-mech"><span>${esc(name(j.mechanic_id))}</span>${acceptChip(j)}${mi != null ? `<span class="disp-eta">${mi.toFixed(1)} mi · ETA ${dEta(mi)}</span>` : j.declined_at || live(j.mechanic_id) ? '' : '<span class="meta">not live</span>'}</div>
      ${j.declined_at && j.decline_reason ? `<div class="disp-reason">“${esc(j.decline_reason)}”</div>` : ''}
    </div>`; }).join('') : '<div class="empty-note">No road calls right now.</div>';
  box.querySelectorAll('[data-call]').forEach(c => c.onclick = () => { dispatchSel = Number(c.dataset.call); renderDispatchSide(); box.querySelectorAll('.disp-call').forEach(x => x.classList.toggle('sel', Number(x.dataset.call) === dispatchSel)); drawDispatchMap(); });
  renderDispatchSide();
  drawDispatchMap();
  const st = document.getElementById('dispatchUpdated'); if(st) st.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
}
// Mechanics ranked for the selected call: available and live first, then nearest.
function renderDispatchSide(){
  const side = document.getElementById('dispatchMechs');
  if(!side || !dispatchData) return;
  const { calls, mechs, locs, load } = dispatchData;
  const call = calls.find(c => c.id === dispatchSel);
  const live = id => locs[id] && Date.now() - locs[id].updatedAt < 10 * 60000;
  const rows = mechs.map(m => { const l = locs[m.id]; const mi = call && call.dest_lat && l && live(m.id) ? milesBetween(l.lat, l.lng, call.dest_lat, call.dest_lng) : null; return { m, mi }; })
    .sort((a, b) => ((a.m.availability === 'available') ? 0 : 1) - ((b.m.availability === 'available') ? 0 : 1) || (a.mi ?? 1e9) - (b.mi ?? 1e9) || (load[a.m.id] || 0) - (load[b.m.id] || 0));
  side.innerHTML = `<div class="disp-side-head">${call ? `Mechanics for <b>${esc(call.ro_number || '')}</b> · ${esc(call.vehicle || '')}` : 'Mechanics'}</div>
    ${rows.map(({ m, mi }) => `<div class="disp-mech${call && call.mechanic_id === m.id ? ' current' : ''}">
      <div><b>${esc(m.name)}</b> ${typeof availChip === 'function' ? availChip(m.availability) : ''}${live(m.id) ? '<span class="live-dot" title="Sharing location"></span>' : ''}
        <div class="meta">${mi != null ? mi.toFixed(1) + ' mi away · ETA ' + dEta(mi) : live(m.id) ? 'Live' : 'Location not shared'} · ${load[m.id] || 0} open job${(load[m.id] || 0) === 1 ? '' : 's'}${(m.skills || []).length ? ' · ' + esc(m.skills.slice(0, 3).join(', ')) : ''}</div></div>
      ${call ? (call.mechanic_id === m.id && !call.declined_at ? '<span class="rec-tag">Assigned</span>' : `<button type="button" class="ghost-btn" data-assign="${m.id}">${call.mechanic_id === m.id ? 'Assign again' : 'Assign'}</button>`) : ''}
    </div>`).join('') || '<p class="meta">No active mechanics.</p>'}
    ${call ? `<div class="job-actions"><button type="button" class="ghost-btn" id="dispOpen">Open work order</button></div>` : ''}`;
  side.querySelectorAll('[data-assign]').forEach(b => b.onclick = async () => {
    const m = mechs.find(x => x.id === b.dataset.assign);
    if(!confirm(`Assign ${call.ro_number || 'this call'} to ${m.name}?`)) return;
    const { error } = await sb.from('jobs').update({ mechanic_id: m.id, updated_at: new Date().toISOString() }).eq('id', call.id);
    if(error){ alert('Could not assign: ' + error.message); return; }
    if(typeof notifyKick === 'function') notifyKick();
    recordsToast('Assigned to ' + m.name + ' — waiting for them to accept');
    refreshDispatch();
  });
  const o = document.getElementById('dispOpen'); if(o) o.onclick = () => openRepairOrder(call.id);
}
function drawDispatchMap(){
  const el = document.getElementById('dispatchMap');
  if(!el || !dispatchData || typeof L === 'undefined' || !L.map) return;
  if(!dispatchMap){
    dispatchMap = L.map(el).setView([34.05, -118.25], 9);
    if(typeof addBaseMapToggle === 'function') addBaseMapToggle(dispatchMap);
    else L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(dispatchMap);
    dispatchLayer = L.layerGroup().addTo(dispatchMap);
  }
  dispatchLayer.clearLayers();
  const pts = [];
  const { calls, mechs, locs } = dispatchData;
  calls.filter(c => c.dest_lat).forEach(c => {
    const mk = L.marker([c.dest_lat, c.dest_lng], { icon: pinIcon(c.id === dispatchSel ? 'dest sel' : 'dest') }).bindPopup(`${esc(c.ro_number || '')} · ${esc(c.vehicle || '')}`);
    mk.on('click', () => { dispatchSel = c.id; refreshDispatch(); });
    dispatchLayer.addLayer(mk); pts.push([c.dest_lat, c.dest_lng]);
  });
  mechs.forEach(m => { const l = locs[m.id]; if(!l || Date.now() - l.updatedAt > 10 * 60000) return;
    dispatchLayer.addLayer(L.marker([l.lat, l.lng], { icon: pinIcon('mech') }).bindPopup(esc(m.name))); pts.push([l.lat, l.lng]); });
  const sel = calls.find(c => c.id === dispatchSel), sl = sel && locs[sel.mechanic_id];
  if(sel && sel.dest_lat && sl) dispatchLayer.addLayer(L.polyline([[sl.lat, sl.lng], [sel.dest_lat, sel.dest_lng]], { color:'#1E4DD8', weight:3, dashArray:'6 6' }));
  if(pts.length) try { dispatchMap.fitBounds(pts, { padding:[40, 40], maxZoom:12 }); } catch(_){}
  setTimeout(() => { try { dispatchMap.invalidateSize(); } catch(_){} }, 50);
}

// ================= Accept job (mechanic) =================
function acceptBlockHtml(job){
  // Only the lead technician answers the assignment; helpers just work the job.
  if(isClosedStatus(job.status) || !['new','assigned'].includes(job.status) || job.mechanic_id !== session.id) return '';
  if(job.declined_at) return `<div class="accept-box declined"><b>You said you can't take this job.</b><div class="meta">The shop will reassign it.${job.decline_reason ? ' Your reason: “' + esc(job.decline_reason) + '”' : ''}</div></div>`;
  if(job.accepted_at) return '';
  return `<div class="accept-box"><b>New job for you</b><div class="accept-btns"><button type="button" class="accept-yes" data-accept="${job.id}">Accept job</button><button type="button" class="ghost-btn" data-decline="${job.id}">Can't take it</button></div></div>`;
}
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-accept]');
  if(a){ a.disabled = true; const { error } = await sb.rpc('respond_to_assignment', { p_job: Number(a.dataset.accept), p_accept: true }); a.disabled = false;
    if(error){ alert(error.message); return; } recordsToast('Job accepted'); if(typeof renderMechJobs === 'function') renderMechJobs(); if(typeof renderWorkScreen === 'function' && typeof workJobId !== 'undefined' && workJobId) renderWorkScreen(); return; }
  const d = e.target.closest('[data-decline]');
  if(d){ const reason = prompt('Why can\'t you take this job? (The shop will see this.)');
    if(reason === null) return;
    const { error } = await sb.rpc('respond_to_assignment', { p_job: Number(d.dataset.decline), p_accept: false, p_reason: reason });
    if(error){ alert(error.message); return; } recordsToast('The shop has been told'); if(typeof renderMechJobs === 'function') renderMechJobs(); }
});

// ================= Notification center =================
// Alerts are written by the database (migration 0016) and filtered by role:
// shop staff see shop alerts (billing/inventory ones only with that
// permission); a mechanic sees the jobs assigned to them.
const NOTIF_TONE = { new_request:'info', estimate_approved:'ok', estimate_declined:'crit', estimate_changes_requested:'warn', job_accepted:'ok', job_declined:'crit',
                     arrived:'info', completed:'ok', invoice_paid:'ok', parts_received:'info', low_stock:'warn', customer_message:'info', job_assigned:'info' };
let notifItems = [], notifRead = new Set(), notifChannel = null, notifLastTop = null;
async function loadNotifications(){
  const { data } = await sb.from('shop_notifications').select('id, kind, title, body, job_id, invoice_id, request_id, created_at')
    .order('created_at', { ascending:false }).limit(40);
  notifItems = data || [];
  const ids = notifItems.map(n => n.id);
  const { data: reads } = ids.length ? await sb.from('notification_reads').select('notification_id').in('notification_id', ids) : { data:[] };
  notifRead = new Set((reads || []).map(r => r.notification_id));
  // A pop-up for the newest alert, if the person turned them on and the tab is in the background.
  const top = notifItems[0];
  if(top && notifLastTop !== null && top.id > notifLastTop && !notifRead.has(top.id) && document.hidden && 'Notification' in window && Notification.permission === 'granted'){
    try { const pop = new Notification(top.title, { body: top.body || '', tag: 'relay-' + top.id }); pop.onclick = () => { window.focus(); notifAction(top).go(); }; } catch(_){}
  }
  notifLastTop = top ? top.id : 0;
  renderNotifBadge();
  const panel = document.getElementById('notifPanel');
  if(panel && !panel.classList.contains('hidden')) renderNotifPanel();
}
function unreadCount(){ return notifItems.filter(n => !notifRead.has(n.id)).length; }
function renderNotifBadge(){
  const b = document.getElementById('notifCount'); if(!b) return;
  const n = unreadCount(); b.textContent = n > 9 ? '9+' : String(n); b.classList.toggle('hidden', !n);
  const btn = document.getElementById('notifBell'); if(btn) btn.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
}
function renderNotifPanel(){
  const p = document.getElementById('notifPanel');
  const canPop = 'Notification' in window && Notification.permission === 'default';
  p.innerHTML = `<div class="notif-head"><b>Notifications</b>${unreadCount() ? '<button type="button" class="text-btn" id="notifReadAll">Mark all read</button>' : ''}</div>
    ${canPop ? '<button type="button" class="notif-pop" id="notifPopOn">Show alerts on this device while Relay is open</button>' : ''}
    <div class="notif-list">${notifItems.length ? notifItems.map(n => `<button type="button" class="notif-item${notifRead.has(n.id) ? '' : ' unread'}" data-n="${n.id}">
      <span class="notif-dot tone-${NOTIF_TONE[n.kind] || 'info'}" aria-hidden="true"></span>
      <span class="notif-text"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span>` : ''}<em>${dAgo(n.created_at)} ago${notifAction(n).label ? ' · ' + esc(notifAction(n).label) : ''}</em></span></button>`).join('') : '<div class="notif-empty">No notifications yet.</div>'}</div>`;
  const ra = document.getElementById('notifReadAll'); if(ra) ra.onclick = markAllRead;
  const po = document.getElementById('notifPopOn'); if(po) po.onclick = async () => { try { await Notification.requestPermission(); } catch(_){} renderNotifPanel(); };
  p.querySelectorAll('[data-n]').forEach(b => b.onclick = async () => {
    const n = notifItems.find(x => x.id === Number(b.dataset.n));
    closeNotifPanel();
    if(!notifRead.has(n.id)){ notifRead.add(n.id); renderNotifBadge(); sb.rpc('mark_notifications_read', { p_ids: [n.id] }); }
    notifAction(n).go();
  });
}
function notifAction(n){
  const panel = t => () => { const x = document.querySelector(`.dash-tab[data-target="${t}"]`); if(x) x.click(); };
  if(n.kind === 'new_request') return { label:'Open requests', go: panel('shop-requests') };
  if(['estimate_approved','estimate_declined','estimate_changes_requested','invoice_paid'].includes(n.kind) && n.invoice_id && typeof openEstimateEditor === 'function')
    return { label: n.kind === 'invoice_paid' ? 'Open invoice' : 'Open work order', go: () => (n.job_id ? openRepairOrder(n.job_id) : openEstimateEditor(n.invoice_id)) };
  if(['low_stock','parts_received'].includes(n.kind)) return { label:'Open inventory', go: panel('shop-inventory') };
  if(n.kind === 'job_declined') return { label:'Reassign in Dispatch', go: () => { dispatchSel = n.job_id; panel('shop-dispatch')(); } };
  if(n.kind === 'job_assigned' && typeof openWorkScreen === 'function') return { label:'Open job', go: () => openWorkScreen(n.job_id) };
  if(n.job_id) return { label:'Open work order', go: () => openRepairOrder(n.job_id) };
  return { label:'', go: () => {} };
}
async function markAllRead(){
  notifItems.forEach(n => notifRead.add(n.id));
  renderNotifBadge(); renderNotifPanel();
  await sb.rpc('mark_notifications_read', { p_ids: null });
}
function closeNotifPanel(){ const p = document.getElementById('notifPanel'); if(p) p.classList.add('hidden'); const b = document.getElementById('notifBell'); if(b) b.setAttribute('aria-expanded', 'false'); }
let notifInitDone = false;
async function initNotifications(){
  const wrap = document.getElementById('notifWrap');
  if(!wrap) return;
  if(!['shop','admin','mechanic'].includes(session.role) || !session.orgId){ wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  if(!notifInitDone){
    notifInitDone = true;
    document.getElementById('notifBell').onclick = (e) => {
      e.stopPropagation();
      const p = document.getElementById('notifPanel'); const open = p.classList.contains('hidden');
      p.classList.toggle('hidden', !open); document.getElementById('notifBell').setAttribute('aria-expanded', String(open));
      if(open) renderNotifPanel();
    };
    document.addEventListener('click', (e) => { if(!e.target.closest('#notifWrap')) closeNotifPanel(); });
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeNotifPanel(); });
  }
  await loadNotifications();
  // New alerts arrive live; a slow refresh covers any gap.
  if(!notifChannel && sb.channel) notifChannel = sb.channel('relay-notifications')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'shop_notifications', filter:'org_id=eq.' + session.orgId }, () => loadNotifications()).subscribe();
  if(typeof everyWhileVisible === 'function') everyWhileVisible(loadNotifications, 180000);
}

function initDispatchUI(){
  document.querySelectorAll('.dash-tab[data-target="shop-dispatch"]').forEach(t => t.addEventListener('click', () => { refreshDispatch(); }));
  if(typeof everyWhileVisible === 'function') everyWhileVisible(() => { if(typeof panelVisible === 'function' && panelVisible('shop-dispatch')) refreshDispatch(); }, 30000);
  initNotifications();
}
