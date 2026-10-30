// ============================================================
// RelayFleet — live updates for everything on screen (migration 0050).
// When something changes anywhere — a customer approves or declines an estimate, a payment comes in,
// an appointment is booked, a message is posted — the screens showing it update by themselves,
// quickly and without flicker (only what changed is redrawn). Bursts of changes are combined into
// one update a moment later. What each person receives is still limited by their access.
// ============================================================
const LIVE = { timers: {}, seen: new Set() };
function liveSoon(key, fn, ms){ clearTimeout(LIVE.timers[key]); LIVE.timers[key] = setTimeout(fn, ms == null ? 250 : ms); }
function livePanelOpen(id){ const p = document.getElementById(id); return !!(p && !p.classList.contains('hidden')); }
function liveMoney(n){ return '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function liveOnce(key){ if(LIVE.seen.has(key)) return false; LIVE.seen.add(key); if(LIVE.seen.size > 500) LIVE.seen.clear(); return true; }

// estimates and invoices
function liveInvoice(payload){
  const row = payload.new || {}, old = payload.old || {};
  // the customer answered: say so straight away
  if(row.kind === 'estimate' && row.status !== old.status && (row.status === 'approved' || row.status === 'declined') && liveOnce('est' + row.id + row.status)){
    const who = row.approved_by_name ? ' ' + relayFmt('by {name}', { name: row.approved_by_name }) : '';
    if(typeof recordsToast === 'function') recordsToast(relayFmt(row.status === 'approved' ? 'Estimate {doc} approved' : 'Estimate {doc} declined', { doc: row.doc_number || '' }) + who);
  }
  liveSoon('docs', () => { if(livePanelOpen('shop-invoices') && typeof refreshDocsTable === 'function') refreshDocsTable('quiet'); });
  liveOpenWorkOrder(row.job_id);
  if(typeof refreshCurrentView === 'function') refreshCurrentView();   // the board and lists (the work order may have moved)
}
// payments
function livePayment(payload){
  const row = payload.new || {};
  if(payload.eventType === 'INSERT' && liveOnce('pay' + row.id) && typeof recordsToast === 'function') recordsToast(relayFmt('Payment received: {amount}', { amount: liveMoney(row.amount) }));
  liveSoon('docs', () => { if(livePanelOpen('shop-invoices') && typeof refreshDocsTable === 'function') refreshDocsTable('quiet'); });
  liveSoon('reports', () => { if(livePanelOpen('shop-analytics') && typeof refreshAnalyticsV2 === 'function') refreshAnalyticsV2(); }, 800);
}
// appointments
function liveAppointment(){ liveSoon('schedule', () => { if(livePanelOpen('shop-schedule') && typeof renderSchedule === 'function') renderSchedule(); }); }
// messages on work orders
function liveComment(payload){
  const row = payload.new || {};
  liveSoon('msgs', () => { if(typeof refreshMsgBadge === 'function') refreshMsgBadge(); });
  if(row.job_id && document.getElementById('comment-list-' + row.job_id) && typeof renderCommentList === 'function') liveSoon('chat' + row.job_id, () => renderCommentList(row.job_id), 150);
}
// an open work order: its estimates and its side panel follow along, without reopening it
function liveOpenWorkOrder(jobId){
  if(!jobId || typeof roCurrentJob === 'undefined' || !roCurrentJob || roCurrentJob.id !== jobId) return;
  const ro = document.getElementById('roModal'); if(!ro || ro.classList.contains('hidden')) return;
  liveSoon('ro' + jobId, async () => {
    const { data: job } = await sb.from('jobs').select('*').eq('id', jobId).maybeSingle();
    if(!job || !roCurrentJob || roCurrentJob.id !== jobId) return;
    Object.assign(roCurrentJob, job);
    if(typeof loadRoEstimates === 'function') loadRoEstimates(job);
    if(typeof renderWoSide === 'function') renderWoSide(job);
  });
}
// work orders: the open one follows along too (the board and lists are refreshed by the existing handler)
function liveJob(payload){ const row = payload.new || {}; if(row.id) liveOpenWorkOrder(row.id); }

// called when the live channel is set up (script.js)
function addLiveTables(channel){
  if(!session || session.role !== 'shop' || !session.orgId) return channel;
  const f = { filter: 'org_id=eq.' + session.orgId };
  return channel
    .on('postgres_changes', Object.assign({ event: '*', schema: 'public', table: 'invoices' }, f), liveInvoice)
    .on('postgres_changes', Object.assign({ event: '*', schema: 'public', table: 'payments' }, f), livePayment)
    .on('postgres_changes', Object.assign({ event: '*', schema: 'public', table: 'appointments' }, f), liveAppointment)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_comments' }, liveComment)
    .on('postgres_changes', Object.assign({ event: 'UPDATE', schema: 'public', table: 'jobs' }, f), liveJob);
}
