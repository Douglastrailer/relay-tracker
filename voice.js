// ============================================================
// RelayFleet — R9 voice commands for mechanics (hands-free).
// Uses the phone browser's own speech recognition; commands run through
// the same actions as the work screen buttons, and only the actions the
// screen allows right now. Completing a job and adding parts are confirmed
// first (say "yes" or tap). Relay answers out loud.
// ============================================================
const VOICE_NUM = { a:1, an:1, one:1, two:2, to:2, too:2, three:3, four:4, for:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, couple:2, pair:2 };
const VOICE_ACTIONS = { start_drive:'Drive timer started. Drive safe.', arrived:'Marked on site.', start_diagnosis:'Diagnosis started.', start_repair:'Repair started, timer running.',
  pause:'Paused.', resume:'Back on the clock.', wait_parts:'Marked waiting for parts. Timer stopped.', quality_check:'Quality check started.', complete:'Job completed. Nice work.' };
const VOICE_HELP = 'You can say: start driving, arrived, start diagnosis, start repair, pause, resume, waiting for parts, quality check, job done, add two brake drums, note followed by your note, take a photo, navigate, or accept job.';

function parseVoice(raw){
  let t = String(raw || '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if(!t) return { intent:'unknown' };
  if(/^(yes|yeah|yep|yup|confirm|do it|correct|sure|ok|okay)( please)?$/.test(t)) return { intent:'yes' };
  if(/^(no|nope|cancel|stop|never ?mind|don'?t)( please)?$/.test(t)) return { intent:'no' };
  const note = t.match(/^(?:add (?:a )?note|note|notes|write down|leave a note)[: ]+(.+)$/);
  if(note) return { intent:'note', text: String(raw).replace(/^\s*(add (a )?note|notes?|write down|leave a note)[:,]?\s*/i, '').trim() || note[1] };
  if(/\b(help|what can i say|commands)\b/.test(t)) return { intent:'help' };
  if(/\b(take|add|snap) (a )?(photo|picture|pic)\b|^(photo|picture|camera)$/.test(t)) return { intent:'photo' };
  if(/\b(navigate|directions|take me there|how do i get there)\b/.test(t)) return { intent:'navigate' };
  if(/\baccept\b.*\b(job|call)\b|^accept( it)?$|\btake the (job|call)\b/.test(t)) return { intent:'accept' };
  const part = t.match(/^(?:add|use|used|install|installed|put on)\s+(?:part\s+)?(.+)$/);
  if(part && !/\bnote\b/.test(part[1])){
    let rest = part[1].trim(), qty = 1;
    const m = rest.match(/^(\d+(?:\.\d+)?|a couple of|a couple|a pair of|a pair|[a-z]+)\s+(?:of\s+)?(.+)$/);
    if(m){ const w = m[1].replace(/^a (couple|pair)( of)?$/, '$1'); if(/^\d/.test(w)){ qty = Number(w); rest = m[2]; } else if(VOICE_NUM[w] != null){ qty = VOICE_NUM[w]; rest = m[2]; } }
    const qm = rest.match(/^(.+?)\s+(?:quantity|qty|times|x)\s+(\d+)$/); if(qm){ rest = qm[1]; qty = Number(qm[2]); }
    return { intent:'part', qty, query: rest.replace(/^(the|some)\s+/, '').trim() };
  }
  if(/\b(start|begin)\b.*\b(driv|drive|heading|route)|\b(on my way|heading (out|there)|leaving now|en route|driving)\b/.test(t)) return { intent:'start_drive' };
  if(/\b(arrived|i'?m here|i am here|on site|onsite|got here|at the truck|at the site)\b/.test(t)) return { intent:'arrived' };
  if(/\b(start|begin)\b.*\bdiagnos|^diagnos(is|ing)$/.test(t)) return { intent:'start_diagnosis' };
  if(/\b(waiting|wait|need|needs)\b.*\bparts?\b/.test(t)) return { intent:'wait_parts' };
  if(/\b(quality check|q ?c|final check|inspect(ing)? my work)\b/.test(t)) return { intent:'quality_check' };
  if(/\b(start|begin)\b.*\b(repair|work|working|fixing|the job)\b|^(start repair|repairing)$/.test(t)) return { intent:'start_repair' };
  if(/\b(resume|continue|back to work|keep going)\b/.test(t)) return { intent:'resume' };
  if(/\b(pause|break|stop (the )?timer|take a break|lunch)\b/.test(t)) return { intent:'pause' };
  if(/\b(job (is )?done|all done|finished|complete|completed|wrap(ped)? (it )?up|done with (this|the) job)\b/.test(t)) return { intent:'complete' };
  return { intent:'unknown' };
}
function voiceSay(text){
  const out = document.getElementById('voiceSaid'); if(out) out.textContent = text;
  try { if('speechSynthesis' in window){ window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 1.05; window.speechSynthesis.speak(u); } } catch(_){}
}
function voiceSupported(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

let voiceCtx = null;   // { job, allowed:[actions], pending:{...} }
let voiceRec = null;
function renderVoiceBar(job, buttons){
  const body = document.getElementById('workBody');
  if(!body || !session || session.role !== 'mechanic') return;
  voiceCtx = { job, allowed: (buttons || []).map(b => b.action), pending: null };
  let bar = document.getElementById('voiceBar');
  if(!bar){ body.insertAdjacentHTML('afterbegin', '<div id="voiceBar" class="voice-bar"></div>'); bar = document.getElementById('voiceBar'); }
  bar.innerHTML = voiceSupported()
    ? `<button type="button" class="voice-mic" id="voiceMic" aria-label="Speak a command"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span id="voiceMicLabel">Tap and speak</span></button>
       <div class="voice-out"><div id="voiceHeard" class="voice-heard"></div><div id="voiceSaid" class="voice-said">Try “start repair” or “add two brake drums”.</div></div><div id="voiceConfirm"></div>`
    : '<div class="voice-off">Voice commands need Chrome or Safari. The buttons below work as usual.</div>';
  const mic = document.getElementById('voiceMic'); if(mic) mic.onclick = () => voiceListen();
}
function voiceListen(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return;
  if(voiceRec){ try { voiceRec.stop(); } catch(_){} return; }
  try { if('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch(_){}
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
  voiceRec = rec;
  const mic = document.getElementById('voiceMic'), lab = document.getElementById('voiceMicLabel'), heard = document.getElementById('voiceHeard');
  if(mic) mic.classList.add('rec'); if(lab) lab.textContent = 'Listening…';
  let finalText = '';
  rec.onresult = (e) => { const t = [...e.results].map(r => r[0].transcript).join(' '); if(heard) heard.textContent = '“' + t + '”'; if([...e.results].some(r => r.isFinal)) finalText = t; };
  rec.onerror = (e) => { if(e && e.error === 'not-allowed') voiceSay('Allow the microphone for Relay in your phone settings to use voice.'); };
  rec.onend = () => { voiceRec = null; if(mic) mic.classList.remove('rec'); if(lab) lab.textContent = 'Tap and speak'; if(finalText) handleVoice(finalText); };
  try { rec.start(); } catch(_){ voiceRec = null; }
}
async function handleVoice(text){
  const ctx = voiceCtx; if(!ctx) return;
  const cmd = parseVoice(text);
  const heard = document.getElementById('voiceHeard'); if(heard) heard.textContent = '“' + text + '”';
  // answering a question we asked
  if(ctx.pending){
    if(cmd.intent === 'yes'){ const p = ctx.pending; ctx.pending = null; renderVoiceConfirm(); return p.run(); }
    if(cmd.intent === 'no'){ ctx.pending = null; renderVoiceConfirm(); return voiceSay('Cancelled.'); }
    ctx.pending = null; renderVoiceConfirm();
  }
  const job = ctx.job;
  if(cmd.intent === 'help') return voiceSay(VOICE_HELP);
  if(cmd.intent === 'unknown' || cmd.intent === 'yes' || cmd.intent === 'no') return voiceSay("Sorry, I didn't catch that. Say help to hear the commands.");
  if(VOICE_ACTIONS[cmd.intent]){
    if(!ctx.allowed.includes(cmd.intent)) return voiceSay("You can't do that right now on this job.");
    if(cmd.intent === 'complete') return voiceAsk(`Complete ${job.ro_number || 'this job'}?`, async () => { await doWorkAction(job, 'complete', null, { confirmed:true }); voiceSay(VOICE_ACTIONS.complete); });
    await doWorkAction(job, cmd.intent, null, { confirmed:true });
    const err = document.getElementById('workError');
    return voiceSay(err && err.textContent ? err.textContent : VOICE_ACTIONS[cmd.intent]);
  }
  if(cmd.intent === 'accept'){
    if(job.mechanic_id !== session.id || job.accepted_at || !['new','assigned'].includes(job.status)) return voiceSay('There is nothing to accept on this job.');
    const { error } = await sb.rpc('respond_to_assignment', { p_job: job.id, p_accept: true });
    if(error) return voiceSay(error.message);
    voiceSay('Job accepted.'); return renderWorkScreen();
  }
  if(cmd.intent === 'navigate'){
    if(!(job.job_type === 'mobile' && job.dest_lat)) return voiceSay('This job has no breakdown location.');
    voiceSay('Opening directions.'); window.open(`https://www.google.com/maps/dir/?api=1&destination=${job.dest_lat},${job.dest_lng}`, '_blank'); return;
  }
  if(cmd.intent === 'note'){
    if(!cmd.text) return voiceSay('Say note, then what you want to write.');
    return voiceAsk(`Add note: ${cmd.text}?`, async () => { await addJobComment(job.id, cmd.text); voiceSay('Note added.'); });
  }
  if(cmd.intent === 'photo'){
    voiceSay('Opening the camera.');
    await openRepairOrder(job.id);
    if(typeof showWoTab === 'function') showWoTab('photos');
    const inp = document.querySelector('#roBody [data-pane="photos"] input[type="file"]'); if(inp) inp.click();
    return;
  }
  if(cmd.intent === 'part'){
    if(isClosedStatus(job.status)) return voiceSay('This job is closed.');
    const it = await voiceFindPart(cmd.query);
    if(!it) return voiceSay(`I couldn't find ${cmd.query} in the parts list. Add it from the work order instead.`);
    if(it.many) return voiceSay(`More than one part matches ${cmd.query}. Say the part number.`);
    return voiceAsk(`Add ${cmd.qty} ${it.name}${it.part_number ? ', part ' + it.part_number : ''}?`, async () => {
      const { error } = await sb.rpc('use_part', { p_job: job.id, p_item: it.id, p_location: null, p_qty: cmd.qty });
      voiceSay(error ? error.message : `Added ${cmd.qty} ${it.name}.`);
    });
  }
}
async function voiceFindPart(q){
  const { data } = await sb.from('inventory_items').select('id, name, part_number').eq('org_id', session.orgId).eq('active', true).limit(5000);
  const items = data || [];
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const pn = norm(q);
  const byPn = pn.length >= 3 ? items.filter(i => norm(i.part_number) === pn) : [];
  if(byPn.length === 1) return byPn[0];
  const sing = w => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
  const words = String(q).toLowerCase().split(/\s+/).filter(w => w.length > 1).map(sing);
  const hits = items.filter(i => { const n = String(i.name).toLowerCase(); return words.length && words.every(w => n.includes(w)); });
  if(hits.length === 1) return hits[0];
  if(hits.length > 1){ const exact = hits.filter(i => sing(String(i.name).toLowerCase()) === words.join(' ')); return exact.length === 1 ? exact[0] : { many:true }; }
  return null;
}
function voiceAsk(question, run){
  voiceCtx.pending = { question, run };
  renderVoiceConfirm();
  voiceSay(question + ' Say yes or no.');
  // listen for the answer once the question has been spoken
  setTimeout(() => { if(voiceCtx && voiceCtx.pending && !voiceRec) voiceListen(); }, 1800);
}
function renderVoiceConfirm(){
  const box = document.getElementById('voiceConfirm'); if(!box) return;
  const p = voiceCtx && voiceCtx.pending;
  box.innerHTML = p ? `<div class="voice-confirm"><b>${esc(p.question)}</b><div><button type="button" id="voiceYes">Yes</button><button type="button" class="ghost-btn" id="voiceNo">No</button></div></div>` : '';
  if(p){
    document.getElementById('voiceYes').onclick = () => { const q = voiceCtx.pending; voiceCtx.pending = null; renderVoiceConfirm(); q.run(); };
    document.getElementById('voiceNo').onclick = () => { voiceCtx.pending = null; renderVoiceConfirm(); voiceSay('Cancelled.'); };
  }
}
