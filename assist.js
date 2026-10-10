// ============================================================
// RelayFleet — Redesign R4b: the assistant panel ("Natasha", formerly "Ask Relay").
// Questions go to the assistant Edge Function, which looks things up
// through the person's own login. Proposed changes come back here and
// only happen after the person confirms, through the app's normal paths.
// ============================================================

let assistMsgs = [];          // conversation sent to the assistant (text only)
let assistBusy = false;
const ASSIST_SUGGEST = { shop:['Jobs waiting for parts', 'Unpaid invoices', 'Open road calls', 'Who is available?'],
  mechanic:['My open jobs', 'Jobs waiting for parts', 'Open road calls'], fleet:['Which of my trucks are in the shop?', 'What do I owe?', 'Recent repairs'] };
const assistSuggest = () => ASSIST_SUGGEST[session && ['mechanic','fleet'].includes(session.role) ? session.role : 'shop'];

function assistTextHtml(t){
  // Escape, then: **bold**, line breaks, and WO numbers become links.
  return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\b((?:WO|RO)-\d{6})\b/g, '<button type="button" class="assist-wo" data-wo="$1">$1</button>')
    .replace(/\n/g, '<br>');
}
function assistRender(){
  const log = document.getElementById('assistLog');
  if(!log) return;
  log.innerHTML = (assistMsgs.length ? '' : `<div class="assist-hello"><b>Ask about your shop.</b><span>${session && ['mechanic','fleet'].includes(session.role) ? 'I look things up in Relay for you.' : 'I look things up in Relay and can prepare work orders, estimates and technician changes for you to confirm.'}</span>
      <div class="assist-sugg">${assistSuggest().map(s => `<button type="button" class="assist-chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`)
    + assistMsgs.map((m, i) => `<div class="assist-msg ${m.role}">${m.role === 'user' ? esc(m.content) : assistTextHtml(m.content || '')}
        ${m.action ? assistActionHtml(m.action, i) : ''}${m.error ? `<div class="assist-err">${esc(m.error)}</div>` : ''}</div>`).join('')
    + (assistBusy ? '<div class="assist-msg assistant assist-typing"><span></span><span></span><span></span></div>' : '');
  log.scrollTop = log.scrollHeight;
  log.querySelectorAll('[data-q]').forEach(b => b.onclick = () => assistAsk(b.dataset.q));
  log.querySelectorAll('.assist-wo').forEach(b => b.onclick = () => assistOpenWo(b.dataset.wo));
  log.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => assistConfirm(Number(b.dataset.confirm)));
  log.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => { const m = assistMsgs[Number(b.dataset.cancel)]; m.action.done = 'cancelled'; assistRender(); });
}
function assistActionHtml(a, i){
  const x = a.input || {};
  const what = a.tool === 'propose_new_work_order' ? `New ${x.roadside ? 'roadside' : 'in-shop'} work order: <b>${esc(x.customer || '')}</b> · ${esc(x.unit || '')} — ${esc(x.complaint || '')}`
    : a.tool === 'propose_add_technician' ? `Add <b>${esc(x.technician || '')}</b> to ${esc(x.work_order || '')}`
    : a.tool === 'propose_estimate' ? `Start an estimate on <b>${esc(x.work_order || '')}</b>` : esc(a.tool);
  return `<div class="assist-action"><div>${what}</div>${a.done ? `<em>${a.done === 'cancelled' ? 'Cancelled' : esc(a.done)}</em>`
    : `<div class="assist-action-btns"><button type="button" data-confirm="${i}">${a.tool === 'propose_new_work_order' ? 'Open the form' : 'Confirm'}</button><button type="button" class="ghost-btn" data-cancel="${i}">Cancel</button></div>`}</div>`;
}
async function assistFindJob(wo){
  const m = String(wo || '').match(/(?:wo|ro)?[-#\s]*0*(\d{1,9})/i);
  if(!m) return null;
  const n = m[1].padStart(6, '0');
  const { data } = await sb.from('jobs').select(JOB_COLUMNS).eq('org_id', session.orgId).in('ro_number', ['WO-' + n, 'RO-' + n]).limit(1);
  return (data || [])[0] || null;
}
async function assistOpenWo(wo){ const j = await assistFindJob(wo); if(j) openRepairOrder(j.id); }
async function assistConfirm(i){
  const m = assistMsgs[i], a = m.action, x = a.input || {};
  const done = (t) => { a.done = t; assistRender(); };
  try {
    if(a.tool === 'propose_new_work_order'){
      // Opens the normal form, filled in; the person checks it and clicks Create.
      const t = document.querySelector('.dash-tab[data-target="shop-jobs"]'); if(t) t.click();
      const box = document.getElementById('woCreateBox'), nb = document.getElementById('woNewBtn');
      if(box){ box.classList.remove('hidden'); if(nb) nb.textContent = 'Close'; }
      // Same bridge the "accept a request" flow uses to set the job type on this form.
      if(typeof window.__setJobTypeUI === 'function') window.__setJobTypeUI(x.roadside ? 'mobile' : 'inshop');
      const set = (id, v) => { const el = document.getElementById(id); if(el && v){ el.value = v; el.dispatchEvent(new Event('input')); } };
      set('njCustomer', x.customer); set('njVehicle', x.unit); set('njIssue', x.complaint);
      closeAssist();
      return done('Form opened — check it and click Create');
    }
    const job = await assistFindJob(x.work_order);
    if(!job) return done('No work order with that number');
    if(a.tool === 'propose_add_technician'){
      const mechs = (await fetchOrgMechanics()).filter(p => p.active);
      const q = String(x.technician || '').toLowerCase();
      const hit = mechs.filter(p => p.name.toLowerCase().includes(q));
      if(hit.length !== 1) return done(hit.length ? 'More than one technician matches — add them from the work order' : 'No technician by that name');
      if(hit[0].id === job.mechanic_id) return done(hit[0].name + ' is already the lead');
      const { error } = await sb.from('job_technicians').insert([{ job_id: job.id, profile_id: hit[0].id }]);
      if(error) return done(error.code === '23505' ? hit[0].name + ' is already on it' : error.message);
      if(typeof refreshCurrentView === 'function') refreshCurrentView();
      return done(`Added ${hit[0].name} to ${job.ro_number}`);
    }
    if(a.tool === 'propose_estimate'){
      if(typeof can === 'function' && !can('billing')) return done('Your role does not include estimates');
      closeAssist(); newEstimateForJob(job);
      return done('Estimate opened');
    }
  } catch(e){ done('Could not do that: ' + (e.message || e)); }
}
async function assistAsk(q){
  q = String(q || '').trim();
  if(!q || assistBusy) return;
  assistMsgs.push({ role:'user', content:q });
  assistBusy = true; assistRender();
  const history = assistMsgs.filter(m => m.content).slice(-12).map(m => ({ role: m.role, content: m.content }));
  try {
    const { data, error } = await sb.functions.invoke('assistant', { body: { messages: history } });
    // On an error status, Supabase only says "non-2xx"; the real reason is in the response body.
    let msg = data && data.error;
    if(error){
      msg = error.message;
      try { const body = error.context && typeof error.context.json === 'function' ? await error.context.clone().json() : null; if(body && body.error) msg = body.error; } catch(_){}
      if(error.context && error.context.status === 404) msg = 'The assistant function is not deployed yet (no Edge Function named "assistant").';
    }
    if(msg) assistMsgs.push({ role:'assistant', content:'', error: msg });
    else assistMsgs.push({ role:'assistant', content: data.reply || (data.action ? '' : 'No answer.'), action: data.action || null });
  } catch(e){ assistMsgs.push({ role:'assistant', content:'', error:'Could not reach the assistant. Check your connection.' }); }
  assistBusy = false; assistRender();
}
// Voice: the browser's own speech recognition (Chrome, Edge, Safari).
let assistRec = null;
function assistVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('assistMic');
  if(!SR){ alert('Voice input isn\'t available in this browser. Try Chrome or Safari.'); return; }
  if(assistRec){ assistRec.stop(); return; }
  assistRec = new SR(); assistRec.lang = 'en-US'; assistRec.interimResults = true;
  const input = document.getElementById('assistInput');
  assistRec.onresult = (e) => { input.value = [...e.results].map(r => r[0].transcript).join(' '); };
  assistRec.onend = () => { btn.classList.remove('rec'); const v = input.value.trim(); assistRec = null; if(v){ input.value = ''; assistAsk(v); } };
  assistRec.onerror = () => { btn.classList.remove('rec'); assistRec = null; };
  btn.classList.add('rec'); assistRec.start();
}
function openAssist(){ document.getElementById('assistPanel').classList.remove('hidden'); assistRender(); document.getElementById('assistInput').focus(); }
function closeAssist(){ const p = document.getElementById('assistPanel'); if(p) p.classList.add('hidden'); }
function initAssist(){
  const fab = document.getElementById('assistFab');
  if(!fab) return;
  // Everyone signed in: what each person can see is decided by their own login.
  const allowed = !!session && ['shop','admin','mechanic','fleet'].includes(session.role);
  fab.classList.toggle('hidden', !allowed);
  if(!allowed) return;
  fab.onclick = () => (document.getElementById('assistPanel').classList.contains('hidden') ? openAssist() : closeAssist());
  document.getElementById('assistClose').onclick = closeAssist;
  document.getElementById('assistNew').onclick = () => { assistMsgs = []; assistRender(); };
  document.getElementById('assistMic').onclick = assistVoice;
  document.getElementById('assistForm').onsubmit = (e) => { e.preventDefault(); const i = document.getElementById('assistInput'); const v = i.value; i.value = ''; assistAsk(v); };
}
