// ============================================================
// RelayFleet — working without a signal (mechanics).
// A mechanic in a dead zone can still press the work buttons, add notes and record parts.
// Each action is kept on the phone, in order, and sent as soon as the signal is back.
//
// Rules that keep this safe:
//  - Only a short list of actions is ever queued. Anything money-related, anything that
//    sends a message to a customer, and anything the mechanic must see the result of is NOT.
//  - Actions are sent one at a time, in the order they were made, so a job's history stays right.
//  - An action the server REFUSES (not a network problem) is dropped and shown to the mechanic,
//    so a bad action can never block the queue forever.
//  - Each action carries the time it actually happened, so the record is honest.
// ============================================================

const OFFLINE_KEY = 'relay.queue.v1';
const OFFLINE_MAX = 200;                      // a sane limit for one shift
const OFFLINE_SENDABLE = { job_action: 1, job_note: 1, use_part: 1 };
let offlineSending = false, offlineQueueCache = null;

function offlineQueue(){
  if(offlineQueueCache) return offlineQueueCache;
  try { offlineQueueCache = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch(_){ offlineQueueCache = []; }
  if(!Array.isArray(offlineQueueCache)) offlineQueueCache = [];
  return offlineQueueCache;
}
function offlineSave(q){
  offlineQueueCache = q.slice(-OFFLINE_MAX);
  try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(offlineQueueCache)); } catch(_){}
  offlineRenderBanner();
}
function offlineCount(){ return offlineQueue().length; }
function offlineClear(){ offlineQueueCache = []; try { localStorage.removeItem(OFFLINE_KEY); } catch(_){} offlineRenderBanner(); }

// a network problem (worth retrying) vs the server saying no (never retry)
function offlineIsNetworkError(err){
  if(!err) return false;
  if(typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = String(err.message || err).toLowerCase();
  if(err.code && /^(42501|23505|23503|P0001)$/.test(String(err.code))) return false;   // refused by the database
  return /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|offline|econnreset|fetch failed/.test(m);
}

function offlineAdd(kind, args, label){
  if(!OFFLINE_SENDABLE[kind]) return null;
  const q = offlineQueue();
  const item = { id: 'q' + Date.now() + Math.random().toString(16).slice(2, 6), kind, args, label: label || kind, at: new Date().toISOString(), tries: 0 };
  q.push(item); offlineSave(q);
  return item;
}

// Try an action; if the phone has no signal, keep it and tell the caller it is waiting.
// Returns { ok } · { queued, item } · { error } — the caller shows the right thing.
async function offlineRun(kind, args, label){
  if(!OFFLINE_SENDABLE[kind]) throw new Error('That action cannot be queued.');
  if(offlineCount() > 0){ const item = offlineAdd(kind, args, label); offlineFlushSoon(); return { queued: true, item }; }   // keep the order
  if(typeof navigator !== 'undefined' && navigator.onLine === false){ const item = offlineAdd(kind, args, label); return { queued: true, item }; }
  let res;
  try { res = await offlineSend({ kind, args, at: new Date().toISOString() }); }
  catch(e){ res = { error: e }; }
  if(res.error && offlineIsNetworkError(res.error)){ const item = offlineAdd(kind, args, label); return { queued: true, item }; }
  if(res.error) return { error: res.error };
  return { ok: true, data: res.data };
}

async function offlineSend(item){
  const a = item.args || {};
  if(item.kind === 'job_action') return await sb.rpc('job_action', { p_job: a.job, p_action: a.action, p_at: item.at });
  if(item.kind === 'job_note') return await sb.from('job_notes').insert([{ job_id: a.job, org_id: a.org_id, body: a.body, created_by: a.created_by, created_at: item.at }]);
  if(item.kind === 'use_part') return await sb.rpc('use_part', { p_job: a.job, p_item: a.item, p_location: a.location, p_qty: a.qty });
  return { error: { message: 'Unknown queued action' } };
}

// Send what is waiting, oldest first, one at a time.
async function offlineFlush(){
  if(offlineSending) return { sent: 0, failed: 0 };
  const q = offlineQueue();
  if(!q.length) return { sent: 0, failed: 0 };
  if(typeof navigator !== 'undefined' && navigator.onLine === false) return { sent: 0, failed: 0, offline: true };
  offlineSending = true; offlineRenderBanner();
  let sent = 0; const refused = [];
  try {
    while(offlineQueue().length){
      const item = offlineQueue()[0];
      let res;
      try { res = await offlineSend(item); } catch(e){ res = { error: e }; }
      if(res && res.error){
        if(offlineIsNetworkError(res.error)) break;                    // still no signal: stop, keep everything
        refused.push({ label: item.label, message: res.error.message });   // the server said no: drop it, never block the rest
        offlineSave(offlineQueue().slice(1));
        continue;
      }
      sent++; offlineSave(offlineQueue().slice(1));
    }
  } finally { offlineSending = false; }
  offlineRenderBanner();
  if(refused.length && typeof alert === 'function'){
    alert('Some work saved on your phone could not be sent:\n\n' + refused.map(r => '• ' + r.label + ' — ' + r.message).join('\n') + '\n\nOpen the job and check it.');
  }
  if(sent){
    if(typeof renderMechJobs === 'function') try { renderMechJobs(); } catch(_){}
    if(typeof renderWorkScreen === 'function' && document.getElementById('workBody')) try { renderWorkScreen(); } catch(_){}
  }
  return { sent, failed: refused.length };
}
let offlineSoon = null;
function offlineFlushSoon(ms){ clearTimeout(offlineSoon); offlineSoon = setTimeout(() => offlineFlush(), ms == null ? 1200 : ms); }

// A bar across the top: how many things are waiting, and whether the phone is offline.
function offlineRenderBanner(){
  const n = offlineCount(), off = typeof navigator !== 'undefined' && navigator.onLine === false;
  let bar = document.getElementById('offlineBar');
  if(!n && !off){ if(bar) bar.remove(); document.body.classList.remove('has-offline-bar'); document.documentElement.style.removeProperty('--offline-bar-h'); return; }
  if(!bar){
    bar = document.createElement('div'); bar.id = 'offlineBar'; bar.className = 'offline-bar'; bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => { if(e.target.closest('[data-offline-send]')) offlineFlush(); });
  }
  bar.classList.toggle('is-off', off);
  // tell the page the bar is there, so the floating button and toasts move up instead of hiding behind it
  document.body.classList.add('has-offline-bar');
  requestAnimationFrame(() => document.documentElement.style.setProperty('--offline-bar-h', bar.offsetHeight ? bar.offsetHeight + 'px' : '48px'));
  const what = n === 1 ? '1 thing' : n + ' things';
  bar.innerHTML = off
    ? `<span>No signal. ${n ? what + ' saved on this phone — they will send when you are back in range.' : 'Your work is saved on this phone.'}</span>`
    : offlineSending ? `<span>Sending ${what}…</span>`
    : `<span>${what} saved on this phone, waiting to send.</span> <button type="button" data-offline-send>Send now</button>`;
}

if(typeof window !== 'undefined'){
  window.addEventListener('online', () => { offlineRenderBanner(); offlineFlushSoon(400); });
  window.addEventListener('offline', offlineRenderBanner);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) offlineFlushSoon(600); });
  setInterval(() => { if(offlineCount()) offlineFlushSoon(0); }, 30000);
  offlineRenderBanner();
  if(offlineCount()) offlineFlushSoon(1500);
}
