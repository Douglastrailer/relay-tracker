// ============================================================
// RelayFleet — Phase 4: technician time, availability, skills.
// Loaded after script.js, ro.js, insp.js and est.js. Every mechanic
// button calls job_action() in the database, which stops/starts timers,
// moves the job's status and sets availability in one step.
// ============================================================

const AVAIL_LABELS = { available:'Available', busy:'Busy', off_duty:'Off duty', offline:'Offline' };
const KIND_LABELS = { drive:'Drive', labor:'Labor' };
let workJobId = null, workTimer = null;

function fmtMins(m){ m = Math.max(0, Math.round(Number(m) || 0)); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; }
function fmtClock(sec){ sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
function availChip(a){ return `<span class="avail-chip av-${esc(a || 'offline')}">${esc(AVAIL_LABELS[a] || 'Offline')}</span>`; }

// Which big buttons make sense next, given the job and whether a timer runs.
function workButtons(job, running){
  const B = (action, label, cls) => ({ action, label, cls: cls || '' });
  const s = job.status, mobile = job.job_type === 'mobile';
  if(s === 'waiting_approval') return running ? [B('pause', 'Pause')] : [];
  if(s === 'new' || s === 'assigned') return mobile ? [B('start_drive', 'Start drive', 'go'), B('arrived', 'Arrived')] : [B('start_diagnosis', 'Start diagnosis', 'go'), B('start_repair', 'Start repair')];
  if(s === 'en_route') return running ? [B('arrived', 'Arrived', 'go'), B('pause', 'Pause')] : [B('start_drive', 'Continue drive', 'go'), B('arrived', 'Arrived')];
  if(s === 'on_site') return [B('start_diagnosis', 'Start diagnosis', 'go'), B('start_repair', 'Start repair')];
  if(s === 'diagnosing') return running ? [B('start_repair', 'Start repair', 'go'), B('wait_parts', 'Waiting for parts'), B('pause', 'Pause')]
                                        : [B('resume', 'Resume diagnosis', 'go'), B('start_repair', 'Start repair'), B('wait_parts', 'Waiting for parts')];
  if(s === 'repairing') return running ? [B('complete', 'Complete', 'done'), B('quality_check', 'Quality check'), B('wait_parts', 'Waiting for parts'), B('pause', 'Pause')]
                                       : [B('resume', 'Resume repair', 'go'), B('wait_parts', 'Waiting for parts'), B('complete', 'Complete', 'done')];
  if(s === 'quality_control') return running ? [B('complete', 'Complete', 'done'), B('pause', 'Pause')] : [B('resume', 'Resume', 'go'), B('complete', 'Complete', 'done')];
  if(s === 'waiting_parts') return [B('start_repair', 'Parts are here — start repair', 'go'), B('start_diagnosis', 'Back to diagnosis')];
  return [];
}

// ---------------- Work screen (mechanic) ----------------
async function openWorkScreen(jobId){
  workJobId = jobId;
  const o = document.getElementById('workModal');
  o.classList.remove('hidden'); document.body.classList.add('modal-open');
  await renderWorkScreen();
}
async function renderWorkScreen(){
  const body = document.getElementById('workBody');
  if(!workJobId || !body) return;
  const [jobRes, runRes, sumRes] = await Promise.all([
    sb.from('jobs').select(JOB_COLUMNS).eq('id', workJobId).maybeSingle(),
    sb.from('time_entries').select('id, job_id, kind, started_at').eq('mechanic_id', session.id).is('ended_at', null).maybeSingle(),
    sb.from('job_time_summary').select('drive_minutes, labor_minutes').eq('job_id', workJobId).maybeSingle()
  ]);
  const job = jobRes.data;
  if(!job){ body.innerHTML = '<p class="form-error">This job could not be loaded.</p>'; return; }
  const run = runRes.data;
  const runningHere = run && run.job_id === job.id;
  const sum = sumRes.data || { drive_minutes:0, labor_minutes:0 };
  const buttons = isClosedStatus(job.status) ? [] : workButtons(job, runningHere);
  const waitingNote = job.status === 'waiting_approval' ? '<p class="work-note">Waiting for the customer to approve the estimate. Repair can start once it is approved.</p>'
    : job.requires_authorization && !job.authorized_at && !job.authorization_override_at ? '<p class="work-note">Customer approval is needed before repair.</p>' : '';
  body.innerHTML = `
    <div class="work-head">
      <div class="ro-head-num">${esc(job.ro_number || '')}</div>
      <h2>${esc(job.customer)} — ${esc(job.vehicle)}</h2>
      ${job.complaint ? `<p class="work-complaint">${esc(job.complaint)}</p>` : ''}
      <div>${jobStatusBadge(job.status)}</div>
    </div>
    <div class="work-clock${runningHere ? ' on' : ''}">
      <div class="work-clock-label">${runningHere ? (run.kind === 'drive' ? 'Driving' : 'On the clock') : run ? 'Timer running on another job' : 'Timer stopped'}</div>
      <div class="work-clock-time" id="workClock" data-start="${runningHere ? esc(run.started_at) : ''}">${runningHere ? fmtClock((Date.now() - new Date(run.started_at)) / 1000) : '0:00'}</div>
      <div class="work-clock-sub">This job so far: ${sum.drive_minutes ? 'drive ' + fmtMins(sum.drive_minutes) + ' · ' : ''}labor ${fmtMins(sum.labor_minutes)}</div>
    </div>
    ${typeof acceptBlockHtml === 'function' ? acceptBlockHtml(job) : ''}
    ${waitingNote}
    <p class="form-error" id="workError"></p>
    <div class="work-buttons">${buttons.map(b => `<button type="button" class="work-btn ${b.cls}" data-action="${b.action}">${esc(b.label)}</button>`).join('') || (isClosedStatus(job.status) ? '<p class="meta">This job is closed.</p>' : '')}</div>
    <div class="work-links">
      <button type="button" class="ghost-btn j-open-ro" data-job="${job.id}">Work order, inspection &amp; photos</button>
      ${job.job_type === 'mobile' && job.dest_lat ? `<a class="ghost-btn" href="https://www.google.com/maps/dir/?api=1&destination=${job.dest_lat},${job.dest_lng}" target="_blank" rel="noopener">Directions</a>` : ''}
    </div>`;
  body.querySelectorAll('.work-btn').forEach(b => b.onclick = () => doWorkAction(job, b.dataset.action, b));
  clearInterval(workTimer);
  if(runningHere) workTimer = setInterval(() => {
    const c = document.getElementById('workClock');
    if(!c || !c.dataset.start){ clearInterval(workTimer); return; }
    c.textContent = fmtClock((Date.now() - new Date(c.dataset.start)) / 1000);
  }, 1000);
}
async function doWorkAction(job, action, btn){
  if(action === 'complete' && !confirm('Mark this job complete?')) return;
  document.querySelectorAll('#workBody .work-btn').forEach(b => b.disabled = true);
  const { error } = await sb.rpc('job_action', { p_job: job.id, p_action: action });
  if(error){
    document.getElementById('workError').textContent = error.message;
    document.querySelectorAll('#workBody .work-btn').forEach(b => b.disabled = false);
    return;
  }
  // Heading out on a road call: turn on live GPS if it isn't already.
  if(action === 'start_drive' && typeof watchId !== 'undefined' && watchId === null){
    const g = document.getElementById('goLiveBtn'); if(g) g.click();
  }
  if(action === 'complete' && typeof showCompleteToast === 'function') showCompleteToast(job);
  syncAvailabilitySelect();
  if(typeof notifyKick === 'function') notifyKick();
  await renderWorkScreen();
  if(typeof renderMechJobs === 'function') renderMechJobs();
}
function closeWorkScreen(){
  clearInterval(workTimer); workJobId = null;
  document.getElementById('workModal').classList.add('hidden');
  const ro = document.getElementById('roModal');
  if(!ro || ro.classList.contains('hidden')) document.body.classList.remove('modal-open');
}

// Availability select on the mechanic screen (Busy is set automatically by the timer).
async function syncAvailabilitySelect(){
  const sel = document.getElementById('mechStatus');
  if(!sel || session.role !== 'mechanic') return;
  const { data } = await sb.from('profiles').select('availability').eq('id', session.id).maybeSingle();
  if(data && [...sel.options].some(o => o.value === data.availability)) sel.value = data.availability;
}
function initWorkUI(){
  const sel = document.getElementById('mechStatus');
  if(sel) sel.addEventListener('change', async () => {
    const { error } = await sb.from('profiles').update({ availability: sel.value }).eq('id', session.id);
    if(error) alert('Could not update your status: ' + error.message);
  });
  syncAvailabilitySelect();
}

// ---------------- Repair Order: time section ----------------
async function loadRoTime(job, opts){
  const box = document.getElementById('roTime');
  if(!box) return;
  if(!opts.canWork){ box.classList.add('hidden'); return; }
  const [sumRes, entRes] = await Promise.all([
    sb.from('job_time_summary').select('*').eq('job_id', job.id).maybeSingle(),
    sb.from('time_entries').select('id, mechanic_id, kind, started_at, ended_at, source, edited_at').eq('job_id', job.id).order('started_at').limit(200)
  ]);
  const s = sumRes.data || {};
  const entries = entRes.data || [];
  const ids = [...new Set(entries.map(e => e.mechanic_id))];
  const names = {};
  if(ids.length){ (await sb.from('profiles').select('id, name').in('id', ids)).data?.forEach(p => names[p.id] = p.name); }
  box.classList.remove('hidden');
  box.innerHTML = `<h4>Time</h4>
    <div class="time-stats">
      <div><span>Drive</span><b>${fmtMins(s.drive_minutes)}</b></div>
      <div><span>Labor</span><b>${fmtMins(s.labor_minutes)}</b></div>
      <div><span>Waiting</span><b>${fmtMins(s.wait_minutes)}</b></div>
      <div><span>Open to ${isClosedStatus(job.status) ? 'done' : 'now'}</span><b>${fmtMins(s.total_minutes)}</b></div>
    </div>
    ${entries.length ? `<div class="time-mini">${entries.map(e => `<div><span>${esc(KIND_LABELS[e.kind])}</span><span>${esc(names[e.mechanic_id] || '')}</span><span>${fmtDateTime(e.started_at)} → ${e.ended_at ? new Date(e.ended_at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '<b>running</b>'}</span><span>${fmtMins(((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 60000)}${e.edited_at || e.source === 'manual' ? ' <em class="meta">edited</em>' : ''}</span></div>`).join('')}</div>` : '<p class="meta">No time recorded yet.</p>'}
    ${session.role === 'mechanic' && job.mechanic_id === session.id && !isClosedStatus(job.status) ? `<button type="button" class="work-open" data-job="${job.id}">Open work screen</button>` : ''}`;
}

// ---------------- Time tab (shop) ----------------
let timeEntries = [], timeMechanics = [], timeEditingId = null;
function timeRange(){
  const r = document.getElementById('timeRange').value;
  const now = new Date(), start = new Date(now); start.setHours(0, 0, 0, 0);
  if(r === 'custom'){
    const f = document.getElementById('timeFrom').value, t = document.getElementById('timeTo').value;
    return { from: f ? new Date(f + 'T00:00:00') : start, to: t ? new Date(t + 'T23:59:59') : now };
  }
  const days = { today:0, '7':6, '30':29 }[r] || 0;
  start.setDate(start.getDate() - days);
  return { from: start, to: now };
}
async function refreshTimePage(){
  const box = document.getElementById('timeEntriesList');
  if(!box) return;
  const custom = document.getElementById('timeRange').value === 'custom';
  document.getElementById('timeCustom').classList.toggle('hidden', !custom);
  const { from, to } = timeRange();
  const [mRes, eRes, runRes] = await Promise.all([
    sb.from('profiles').select('id, name, availability, active').eq('role', 'mechanic').eq('org_id', session.orgId).order('name'),
    sb.from('time_entries').select('id, job_id, mechanic_id, kind, started_at, ended_at, source, note, edited_at, jobs(ro_number, customer, vehicle)')
      .eq('org_id', session.orgId).gte('started_at', from.toISOString()).lte('started_at', to.toISOString()).order('started_at', { ascending:false }).limit(1000),
    sb.from('time_entries').select('id, job_id, mechanic_id, kind, started_at, jobs(ro_number, customer)').eq('org_id', session.orgId).is('ended_at', null)
  ]);
  timeMechanics = mRes.data || [];
  timeEntries = eRes.data || [];
  const mech = document.getElementById('timeMechanic');
  const keep = mech.value;
  mech.innerHTML = '<option value="">All mechanics</option>' + timeMechanics.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  mech.value = keep;
  const name = id => (timeMechanics.find(m => m.id === id) || {}).name || 'Mechanic';
  const mins = e => ((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 60000;
  const rows = timeEntries.filter(e => !mech.value || e.mechanic_id === mech.value);
  // Per-mechanic totals
  const tot = {};
  rows.forEach(e => { const t = tot[e.mechanic_id] = tot[e.mechanic_id] || { drive:0, labor:0, jobs:new Set() }; t[e.kind] += mins(e); t.jobs.add(e.job_id); });
  const running = runRes.data || [];
  document.getElementById('timeSummary').innerHTML = timeMechanics.filter(m => m.active && (!mech.value || m.id === mech.value)).map(m => {
    const t = tot[m.id] || { drive:0, labor:0, jobs:new Set() };
    const r = running.find(x => x.mechanic_id === m.id);
    return `<div class="time-card"><div class="time-card-head"><b>${esc(m.name)}</b>${availChip(m.availability)}</div>
      <div class="time-stats"><div><span>Labor</span><b>${fmtMins(t.labor)}</b></div><div><span>Drive</span><b>${fmtMins(t.drive)}</b></div><div><span>Jobs</span><b>${t.jobs.size}</b></div></div>
      <div class="meta">${r ? `On the clock now: ${esc((r.jobs || {}).ro_number || '')} ${esc((r.jobs || {}).customer || '')} since ${new Date(r.started_at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}` : 'Not on the clock'}</div></div>`;
  }).join('') || '<div class="empty-note">No mechanics yet.</div>';
  box.innerHTML = rows.length ? `<div class="time-table">${rows.map(e => `<div class="time-row">
      <span>${new Date(e.started_at).toLocaleDateString(undefined, { month:'short', day:'numeric' })}</span>
      <span>${esc(name(e.mechanic_id))}</span>
      <span>${esc((e.jobs || {}).ro_number || '')} <span class="meta">${esc((e.jobs || {}).customer || '')}</span></span>
      <span class="rec-tag">${esc(KIND_LABELS[e.kind])}</span>
      <span>${new Date(e.started_at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })} → ${e.ended_at ? new Date(e.ended_at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }) : '<b>running</b>'}</span>
      <b>${fmtMins(mins(e))}</b>
      <span>${e.edited_at || e.source === 'manual' ? '<em class="meta">edited</em>' : ''}</span>
      <span class="time-actions">${typeof can !== 'function' || can('time_admin') ? `<button type="button" class="text-btn" data-edit-time="${e.id}">Edit</button><button type="button" class="text-btn danger" data-del-time="${e.id}">Delete</button>` : ''}</span>
    </div>`).join('')}</div>` : '<div class="empty-note">No time recorded in this period.</div>';
  box.querySelectorAll('[data-edit-time]').forEach(b => b.onclick = () => openTimeForm(Number(b.dataset.editTime)));
  box.querySelectorAll('[data-del-time]').forEach(b => b.onclick = async () => {
    if(!confirm('Delete this time entry? This is recorded in the activity log.')) return;
    const { error } = await sb.from('time_entries').delete().eq('id', Number(b.dataset.delTime));
    if(error){ alert(error.message); return; }
    refreshTimePage();
  });
  if(typeof renderAttendance === 'function') renderAttendance(from, to, timeEntries, timeMechanics);
}
function toLocalInput(d){ const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); }
async function openTimeForm(id){
  timeEditingId = id || null;
  const e = id ? timeEntries.find(x => x.id === id) : null;
  const jobs = (await sb.from('jobs').select('id, ro_number, customer, vehicle').eq('org_id', session.orgId).order('created_at', { ascending:false }).limit(100)).data || [];
  if(e && !jobs.some(j => j.id === e.job_id)) jobs.unshift({ id: e.job_id, ro_number: (e.jobs || {}).ro_number, customer: (e.jobs || {}).customer, vehicle: '' });
  const box = document.getElementById('timeFormBox');
  const start = e ? new Date(e.started_at) : new Date(Date.now() - 3600e3);
  const end = e && e.ended_at ? new Date(e.ended_at) : e ? new Date() : new Date();
  box.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>${e ? 'Correct time entry' : 'Add time'}</h3><button type="button" class="ghost" id="tfCloseTime">Close</button></div>
    <div class="rec-grid">
      <div class="field"><label>Mechanic</label><select id="teMech" ${e ? 'disabled' : ''}>${timeMechanics.map(m => `<option value="${m.id}" ${e && e.mechanic_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Type</label><select id="teKind">${Object.keys(KIND_LABELS).map(k => `<option value="${k}" ${e && e.kind === k ? 'selected' : ''}>${KIND_LABELS[k]}</option>`).join('')}</select></div>
      <div class="field rec-span"><label>Job</label><select id="teJob" ${e ? 'disabled' : ''}>${jobs.map(j => `<option value="${j.id}" ${e && e.job_id === j.id ? 'selected' : ''}>${esc(j.ro_number || '#' + j.id)} — ${esc(j.customer)} ${esc(j.vehicle || '')}</option>`).join('')}</select></div>
      <div class="field"><label>Start</label><input type="datetime-local" id="teStart" value="${toLocalInput(start)}"></div>
      <div class="field"><label>End</label><input type="datetime-local" id="teEnd" value="${toLocalInput(end)}"></div>
      <div class="field rec-span"><label>Note (why the change)</label><input id="teNote" maxlength="500" value="${esc(e && e.note || '')}"></div>
    </div><p class="form-error" id="teError"></p>
    <div class="job-actions"><button type="button" id="teSave">${e ? 'Save correction' : 'Add time'}</button></div></div>`;
  box.classList.remove('hidden'); box.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('tfCloseTime').onclick = () => { box.innerHTML = ''; box.classList.add('hidden'); };
  document.getElementById('teSave').onclick = async () => {
    const err = document.getElementById('teError'); err.textContent = '';
    const s = new Date(document.getElementById('teStart').value), en = new Date(document.getElementById('teEnd').value);
    if(isNaN(s) || isNaN(en)){ err.textContent = 'Enter a start and an end time.'; return; }
    if(en <= s){ err.textContent = 'The end must be after the start.'; return; }
    if(en - s > 24 * 3600e3){ err.textContent = 'One entry can be at most 24 hours.'; return; }
    const row = { kind: document.getElementById('teKind').value, started_at: s.toISOString(), ended_at: en.toISOString(), note: document.getElementById('teNote').value.trim() || null };
    const res = e ? await sb.from('time_entries').update(row).eq('id', e.id)
                  : await sb.from('time_entries').insert([{ ...row, org_id: session.orgId, job_id: Number(document.getElementById('teJob').value), mechanic_id: document.getElementById('teMech').value, source: 'manual' }]);
    if(res.error){ err.textContent = res.error.message; return; }
    recordsToast(e ? 'Time corrected' : 'Time added');
    box.innerHTML = ''; box.classList.add('hidden');
    refreshTimePage();
  };
}
function downloadTimeCsv(){
  const name = id => (timeMechanics.find(m => m.id === id) || {}).name || '';
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['Date','Mechanic','Work order','Customer','Type','Start','End','Minutes','Edited'].map(q).join(',')];
  timeEntries.forEach(e => lines.push([new Date(e.started_at).toLocaleDateString(), name(e.mechanic_id), (e.jobs || {}).ro_number, (e.jobs || {}).customer, KIND_LABELS[e.kind],
    new Date(e.started_at).toLocaleString(), e.ended_at ? new Date(e.ended_at).toLocaleString() : 'running',
    Math.round(((e.ended_at ? new Date(e.ended_at) : new Date()) - new Date(e.started_at)) / 60000), e.edited_at || e.source === 'manual' ? 'yes' : ''].map(q).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type:'text/csv' }));
  a.download = 'relay-time-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}
function initTimeUI(){
  const r = document.getElementById('timeRange');
  if(!r) return;
  ['timeRange','timeMechanic','timeFrom','timeTo'].forEach(id => document.getElementById(id).onchange = refreshTimePage);
  document.getElementById('addTimeBtn').onclick = () => openTimeForm(null);
  if(typeof can === 'function' && !can('time_admin')) document.getElementById('addTimeBtn').classList.add('hidden');
  document.getElementById('timeCsvBtn').onclick = downloadTimeCsv;
  document.querySelectorAll('.dash-tab[data-target="shop-time"]').forEach(t => t.addEventListener('click', refreshTimePage));
}

// ---------------- Team: availability and skills ----------------
async function openSkillsEditor(mech){
  const cat = ((await sb.from('organizations').select('skill_catalog').eq('id', session.orgId).maybeSingle()).data || {}).skill_catalog || [];
  const all = [...new Set([...cat, ...(mech.skills || [])])];
  const box = document.getElementById('skillsEditor');
  box.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>Skills — ${esc(mech.name)}</h3><button type="button" class="ghost" id="skClose">Close</button></div>
    <div class="skill-grid">${all.map(s => `<label class="rec-check"><input type="checkbox" value="${esc(s)}" ${(mech.skills || []).includes(s) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div>
    <div class="insp-start"><input id="skNew" maxlength="40" placeholder="Add a skill to your shop's list"><button type="button" id="skAdd">Add</button></div>
    <p class="form-error" id="skError"></p><div class="job-actions"><button type="button" id="skSave">Save skills</button></div></div>`;
  box.classList.remove('hidden'); box.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('skClose').onclick = () => { box.innerHTML = ''; box.classList.add('hidden'); };
  document.getElementById('skAdd').onclick = async () => {
    const v = document.getElementById('skNew').value.trim();
    if(!v) return;
    if(!cat.includes(v)){
      const { error } = await sb.from('organizations').update({ skill_catalog: [...cat, v] }).eq('id', session.orgId);
      if(error){ document.getElementById('skError').textContent = error.message; return; }
    }
    mech.skills = [...new Set([...(mech.skills || []), v])];
    openSkillsEditor(mech);
  };
  document.getElementById('skSave').onclick = async () => {
    const skills = [...box.querySelectorAll('.skill-grid input:checked')].map(i => i.value);
    const { error } = await sb.from('profiles').update({ skills }).eq('id', mech.id);
    if(error){ document.getElementById('skError').textContent = error.message; return; }
    recordsToast('Skills saved'); box.innerHTML = ''; box.classList.add('hidden');
    if(typeof renderTeamList === 'function') renderTeamList();
    if(typeof populateMechanicSelect === 'function') populateMechanicSelect();
  };
}

document.addEventListener('click', (e) => {
  const w = e.target.closest('.j-work, .work-open');
  if(w && w.dataset.job){ e.preventDefault(); openWorkScreen(Number(w.dataset.job)); return; }
  if(e.target.id === 'workModal' || e.target.closest('#workClose')) closeWorkScreen();
});
document.addEventListener('keydown', (e) => {
  const o = document.getElementById('workModal');
  if(e.key === 'Escape' && o && !o.classList.contains('hidden')){ e.stopImmediatePropagation(); closeWorkScreen(); }
}, true);
