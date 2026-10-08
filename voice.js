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
  // questions about this job, answered out loud
  if(/\b(what'?s|what is) (wrong|the (problem|complaint|issue))|\bwhat'?s the (problem|complaint|issue)\b|\bwhy is (it|the truck|the trailer) here\b/.test(t)) return { intent:'ask_complaint' };
  if(/\bwho'?s the customer\b|\bwho is the customer\b|\bwhose (truck|trailer|unit)\b|\bwhat (truck|trailer|unit) is (this|it)\b/.test(t)) return { intent:'ask_unit' };
  if(/\bwhere'?s the (truck|trailer|unit|breakdown|customer)\b|\bwhere is the (truck|trailer|unit|breakdown)\b|\bhow far\b|\bwhat'?s the address\b|\bwhat is the address\b/.test(t)) return { intent:'ask_where' };
  if(/\bhow long have i\b|\bhow much time\b|\bhow long (is|has) (the|my) timer\b|\bmy time\b/.test(t)) return { intent:'ask_time' };
  if(/\bwhat parts\b|\bparts (are )?on (this|the) job\b|\bwhich parts\b/.test(t)) return { intent:'ask_parts' };
  if(/\bwhat'?s the status\b|\bwhat is the status\b|\bwhat'?s next\b|\bwhat should i do( next)?\b|\bwhere am i at\b/.test(t)) return { intent:'ask_status' };
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
// Short sounds, made in the browser (no audio files): like Siri / Google.
let voiceAudio = null;
function voiceTone(kind){
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return;
    voiceAudio = voiceAudio || new AC(); if(voiceAudio.state === 'suspended') voiceAudio.resume();
    const notes = { listen:[[784, 0], [1175, 0.11]], stop:[[1047, 0], [698, 0.1]], ok:[[1319, 0]], error:[[330, 0], [262, 0.14]] }[kind] || [];
    const now = voiceAudio.currentTime;
    notes.forEach(([freq, at]) => {
      const o = voiceAudio.createOscillator(), g = voiceAudio.createGain();
      o.type = kind === 'error' ? 'triangle' : 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + at); g.gain.exponentialRampToValueAtTime(0.22, now + at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
      o.connect(g); g.connect(voiceAudio.destination); o.start(now + at); o.stop(now + at + 0.18);
    });
  } catch(_){}
}
function voicePickVoice(){
  try {
    const vs = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
    const pref = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Ava', 'Allison', 'Karen'];
    for(const name of pref){ const v = vs.find(x => x.name && x.name.includes(name)); if(v) return v; }
    return vs.find(x => /^en(-|_)US/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang)) || null;
  } catch(_){ return null; }
}
function voiceSay(text, tone){
  if(tone) voiceTone(tone);
  const out = document.getElementById('voiceSaid'); if(out) out.textContent = text;
  try { if('speechSynthesis' in window){ window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 1.03; const v = voicePickVoice(); if(v) u.voice = v; window.speechSynthesis.speak(u); } } catch(_){}
}
// iPhone only plays sound/speech started from a tap: unlock both on the first tap.
function voiceUnlock(){
  try { const AC = window.AudioContext || window.webkitAudioContext; if(AC){ voiceAudio = voiceAudio || new AC(); if(voiceAudio.state === 'suspended') voiceAudio.resume(); } } catch(_){}
  try { if('speechSynthesis' in window && !voiceUnlock.done){ const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); voiceUnlock.done = true; } } catch(_){}
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
  voiceUnlock();
  voiceTone('listen');
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
  voiceRec = rec;
  const mic = document.getElementById('voiceMic'), lab = document.getElementById('voiceMicLabel'), heard = document.getElementById('voiceHeard');
  if(mic) mic.classList.add('rec'); if(lab) lab.textContent = 'Listening…';
  let finalText = '';
  rec.onresult = (e) => { const t = [...e.results].map(r => r[0].transcript).join(' '); if(heard) heard.textContent = '“' + t + '”'; if([...e.results].some(r => r.isFinal)) finalText = t; };
  let blocked = false;
  rec.onerror = (e) => { if(e && e.error === 'not-allowed'){ blocked = true; voiceSay('Allow the microphone for Relay in your phone settings to use voice.', 'error'); } };
  rec.onend = () => { voiceRec = null; if(mic) mic.classList.remove('rec'); if(lab) lab.textContent = 'Tap and speak'; voiceTone('stop');
    if(finalText) handleVoice(finalText); else if(!blocked) voiceSay("I didn't hear anything. Tap and try again."); };
  // wait for the chime to finish so the microphone doesn't hear it
  setTimeout(() => { if(voiceRec !== rec) return; try { rec.start(); } catch(_){ voiceRec = null; } }, 280);
}
async function handleVoice(text){
  const ctx = voiceCtx; if(!ctx) return;
  const cmd = parseVoice(text);
  const heard = document.getElementById('voiceHeard'); if(heard) heard.textContent = '“' + text + '”';
  // answering a question we asked
  if(ctx.pending){
    if(cmd.intent === 'yes'){ const p = ctx.pending; ctx.pending = null; renderVoiceConfirm(); return p.run(); }
    if(cmd.intent === 'no'){ ctx.pending = null; renderVoiceConfirm(); return voiceSay('Cancelled.', 'stop'); }
    ctx.pending = null; renderVoiceConfirm();
  }
  const job = ctx.job;
  if(cmd.intent === 'help') return voiceSay(VOICE_HELP);
  if(cmd.intent.startsWith('ask_')) return voiceAnswer(cmd.intent, job);
  if(cmd.intent === 'unknown' && voiceLooksLikeQuestion(text)) return voiceAskRelay(text, job);
  if(cmd.intent === 'unknown' || cmd.intent === 'yes' || cmd.intent === 'no') return voiceSay("Sorry, I didn't catch that. Say help to hear the commands.", 'error');
  if(VOICE_ACTIONS[cmd.intent]){
    if(!ctx.allowed.includes(cmd.intent)) return voiceSay("You can't do that right now on this job.", 'error');
    if(cmd.intent === 'complete') return voiceAsk(`Complete ${job.ro_number || 'this job'}?`, async () => { await doWorkAction(job, 'complete', null, { confirmed:true }); voiceSay(VOICE_ACTIONS.complete, 'ok'); });
    await doWorkAction(job, cmd.intent, null, { confirmed:true });
    const err = document.getElementById('workError');
    return err && err.textContent ? voiceSay(err.textContent, 'error') : voiceSay(VOICE_ACTIONS[cmd.intent], 'ok');
  }
  if(cmd.intent === 'accept'){
    if(job.mechanic_id !== session.id || job.accepted_at || !['new','assigned'].includes(job.status)) return voiceSay('There is nothing to accept on this job.');
    const { error } = await sb.rpc('respond_to_assignment', { p_job: job.id, p_accept: true });
    if(error) return voiceSay(error.message);
    voiceSay('Job accepted.', 'ok'); return renderWorkScreen();
  }
  if(cmd.intent === 'navigate'){
    if(!(job.job_type === 'mobile' && job.dest_lat)) return voiceSay('This job has no breakdown location.');
    voiceSay('Opening directions.'); window.open(`https://www.google.com/maps/dir/?api=1&destination=${job.dest_lat},${job.dest_lng}`, '_blank'); return;
  }
  if(cmd.intent === 'note'){
    if(!cmd.text) return voiceSay('Say note, then what you want to write.');
    return voiceAsk(`Add note: ${cmd.text}?`, async () => { await addJobComment(job.id, cmd.text); voiceSay('Note added.', 'ok'); });
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
    if(!it) return voiceSay(`I couldn't find ${cmd.query} in the parts list. Add it from the work order instead.`, 'error');
    if(it.many) return voiceSay(`More than one part matches ${cmd.query}. Say the part number.`, 'error');
    return voiceAsk(`Add ${cmd.qty} ${it.name}${it.part_number ? ', part ' + it.part_number : ''}?`, async () => {
      const { error } = await sb.rpc('use_part', { p_job: job.id, p_item: it.id, p_location: null, p_qty: cmd.qty });
      voiceSay(error ? error.message : `Added ${cmd.qty} ${it.name}.`, error ? 'error' : 'ok');
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

// ---------- answers about this job ----------
const VOICE_STATUS = { new:'new', assigned:'assigned to you, not started', en_route:'on the way', on_site:'on site', diagnosing:'being diagnosed', waiting_approval:'waiting for the customer to approve the estimate',
  waiting_parts:'waiting for parts', repairing:'being repaired', quality_control:'in quality check', complete:'completed', invoiced:'invoiced', paid:'paid' };
function voiceLooksLikeQuestion(t){ t = String(t).trim().toLowerCase(); return /^(what|how|where|who|when|which|why|is|are|was|were|do|does|did|can|could|should|has|have|tell me|show me|find)\b/.test(t) || t.split(/\s+/).length >= 5; }
async function voiceAnswer(intent, job){
  if(intent === 'ask_complaint') return voiceSay(job.complaint ? `The complaint is: ${job.complaint}.` : 'There is no complaint written on this job.', 'ok');
  if(intent === 'ask_unit') return voiceSay(`${job.vehicle || 'This unit'}, for ${job.customer || 'the customer'}. Work order ${String(job.ro_number || '').replace(/^WO-0*/, '')}.`, 'ok');
  if(intent === 'ask_where'){
    if(!(job.job_type === 'mobile' && job.dest_lat)) return voiceSay(`${job.vehicle || 'The unit'} is an in-shop job.`, 'ok');
    const me = typeof fetchLocation === 'function' ? await fetchLocation(session.id) : null;
    if(!me || me.lat == null) return voiceSay('I do not have your location yet. Go live or say navigate for directions.', 'error');
    const mi = milesBetween(me.lat, me.lng, job.dest_lat, job.dest_lng);
    const min = Math.max(1, Math.round(mi / 45 * 60));
    return voiceSay(`The truck is about ${mi < 10 ? mi.toFixed(1) : Math.round(mi)} miles away, around ${min} minute${min === 1 ? '' : 's'}. Say navigate for directions.`, 'ok');
  }
  if(intent === 'ask_time'){
    const { data } = await sb.from('job_time_summary').select('drive_minutes, labor_minutes').eq('job_id', job.id).maybeSingle();
    const lab = Math.round((data && data.labor_minutes) || 0), drv = Math.round((data && data.drive_minutes) || 0);
    const fmt = m => (m >= 60 ? Math.floor(m / 60) + ' hour' + (Math.floor(m / 60) === 1 ? '' : 's') + (m % 60 ? ' ' + (m % 60) + ' minutes' : '') : m + ' minutes');
    return voiceSay(`On this job: ${fmt(lab)} of labor${drv ? ' and ' + fmt(drv) + ' driving' : ''}.`, 'ok');
  }
  if(intent === 'ask_parts'){
    const { data } = await sb.from('job_parts').select('qty, returned_qty, inventory_items(name)').eq('job_id', job.id);
    const rows = (data || []).map(r => ({ q: Number(r.qty) - Number(r.returned_qty || 0), n: (r.inventory_items || {}).name })).filter(r => r.q > 0 && r.n);
    return voiceSay(rows.length ? 'Parts on this job: ' + rows.map(r => `${r.q} ${r.n}`).join(', ') + '.' : 'No parts on this job yet.', 'ok');
  }
  if(intent === 'ask_status'){
    const allowed = (voiceCtx && voiceCtx.allowed) || [];
    const next = { start_drive:'start driving', arrived:'mark arrived', start_diagnosis:'start diagnosis', start_repair:'start repair', resume:'resume', quality_check:'quality check', complete:'say job done' };
    const can = allowed.map(a => next[a]).filter(Boolean).slice(0, 2);
    return voiceSay(`This job is ${VOICE_STATUS[job.status] || job.status}.${can.length ? ' You can ' + can.join(' or ') + '.' : ''}`, 'ok');
  }
}
// Anything else: ask Relay's assistant (read-only for mechanics) and read the answer out loud.
async function voiceAskRelay(text, job){
  const said = document.getElementById('voiceSaid'); if(said) said.textContent = 'Thinking…';
  try {
    const q = `About ${job.ro_number || 'this job'} (${job.vehicle || ''}, ${job.customer || ''}): ${text}`;
    const { data, error } = await sb.functions.invoke('assistant', { body: { messages: [{ role:'user', content: q }] } });
    if(error || !data || data.error || !data.reply) return voiceSay("Sorry, I couldn't get an answer for that. Say help to hear what I can do.", 'error');
    const clean = String(data.reply).replace(/\*\*/g, '').replace(/\bWO-0*(\d+)/g, 'work order $1').replace(/[#`_]/g, '').replace(/\s*\n+\s*[-•]?\s*/g, '. ').slice(0, 600);
    return voiceSay(clean, 'ok');
  } catch(_){ return voiceSay("Sorry, I couldn't reach Relay right now.", 'error'); }
}
