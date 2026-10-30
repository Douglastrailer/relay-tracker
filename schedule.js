// ============================================================
// RelayFleet — Schedule: the shop's calendar of appointments (migration 0049).
// Week and day views on an hour grid. Every appointment is placed by its exact start and end;
// appointments that overlap sit side by side; a line marks the current time. The visible hours
// grow to include every appointment, so nothing is ever hidden or squeezed. Tapping an empty time
// books there (to the nearest 15 minutes). An appointment becomes a work order in one step, and
// the customer is reminded by email the day before.
// ============================================================
const SCH = { view: null, anchor: null, startHour: 7, endHour: 18, px: 56, items: [], mechs: [], loading: false };
const SCH_DAY = 86400000;
function schDay(d){ const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function schAdd(d, days){ const x = new Date(d); x.setDate(x.getDate() + days); return x; }
function schRange(){
  if(SCH.view === 'day') return [SCH.anchor, schAdd(SCH.anchor, 1)];
  const start = schAdd(SCH.anchor, -((SCH.anchor.getDay() + 6) % 7));   // weeks start on Monday
  return [start, schAdd(start, 7)];
}
function schTime(d){ return d.toLocaleTimeString(relayLocale(), { hour: 'numeric', minute: '2-digit' }); }
function schLabel(d){ return d.toLocaleString(relayLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
// the time written into the customer's reminder email: always English, like the rest of the email
function schEmailLabel(d){ return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function schMinutes(d){ return d.getHours() * 60 + d.getMinutes(); }

async function renderSchedule(){
  const panel = document.getElementById('shop-schedule'); if(!panel || !session) return;
  if(!SCH.view) SCH.view = window.innerWidth < 760 ? 'day' : 'week';
  SCH.anchor = schDay(SCH.anchor || new Date());   // always midnight: day boundaries, today and every position depend on it
  if(!panel.querySelector('.sch-bar')){
    panel.innerHTML = `<div class="section-head"><h2>Schedule</h2></div>
      <div class="sch-bar">
        <div class="sch-nav"><button type="button" class="ghost-btn" id="schPrev" aria-label="Previous">‹</button><button type="button" class="ghost-btn" id="schToday">Today</button><button type="button" class="ghost-btn" id="schNext" aria-label="Next">›</button></div>
        <h3 id="schTitle" aria-live="polite"></h3>
        <div class="sch-views" role="radiogroup" aria-label="View"><button type="button" role="radio" data-schview="day">Day</button><button type="button" role="radio" data-schview="week">Week</button></div>
        <button type="button" id="schNew">+ New appointment</button>
      </div>
      <div id="schGrid">${typeof skelRows === 'function' ? skelRows(6) : ''}</div>`;
    panel.querySelector('#schPrev').onclick = () => { SCH.anchor = schAdd(SCH.anchor, SCH.view === 'day' ? -1 : -7); renderSchedule(); };
    panel.querySelector('#schNext').onclick = () => { SCH.anchor = schAdd(SCH.anchor, SCH.view === 'day' ? 1 : 7); renderSchedule(); };
    panel.querySelector('#schToday').onclick = () => { SCH.anchor = schDay(new Date()); renderSchedule(); };
    panel.querySelectorAll('[data-schview]').forEach(b => b.onclick = () => { SCH.view = b.dataset.schview; renderSchedule(); });
    panel.querySelector('#schNew').onclick = () => { const t = new Date(); t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0); openAppointmentForm(null, SCH.view === 'day' ? new Date(SCH.anchor.getTime() + schMinutes(t) * 60000) : t); };
  }
  panel.querySelectorAll('[data-schview]').forEach(b => { const on = b.dataset.schview === SCH.view; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
  const [from, to] = schRange();
  const last = schAdd(to, -1);
  panel.querySelector('#schTitle').textContent = SCH.view === 'day'
    ? SCH.anchor.toLocaleDateString(relayLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : from.toLocaleDateString(relayLocale(), { month: 'short', day: 'numeric' }) + ' – ' + last.toLocaleDateString(relayLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
  const seq = (SCH.seq = (SCH.seq || 0) + 1);
  const [res, mres] = await Promise.all([
    sb.from('appointments').select('*').lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).neq('status', 'cancelled').order('starts_at'),
    SCH.mechs.length ? Promise.resolve({ data: SCH.mechs }) : sb.from('profiles').select('id, name, active').eq('org_id', session.orgId).eq('role', 'mechanic').order('name')
  ]);
  if(seq !== SCH.seq) return;   // a newer view was asked for meanwhile
  if(res.error){ panel.querySelector('#schGrid').innerHTML = `<p class="form-error">${esc(friendlyError(res.error, 'The schedule could not load').message)}</p>`; return; }
  SCH.items = res.data || []; SCH.mechs = mres.data || [];
  drawScheduleGrid(from, SCH.view === 'day' ? 1 : 7);
}

// lay out one day's appointments: clusters of overlapping ones share the width side by side
function schLayout(items){
  const sorted = items.slice().sort((a, b) => a.s - b.s || b.e - a.e);
  const out = []; let cluster = [], clusterEnd = -1;
  const flush = () => { const cols = []; cluster.forEach(it => { let c = cols.findIndex(end => end <= it.s); if(c < 0){ c = cols.length; cols.push(0); } cols[c] = it.e; it.col = c; }); cluster.forEach(it => { it.cols = cols.length; out.push(it); }); cluster = []; };
  sorted.forEach(it => { if(cluster.length && it.s >= clusterEnd) flush(), clusterEnd = -1; cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e); });
  if(cluster.length) flush();
  return out;
}

function drawScheduleGrid(from, days){
  const grid = document.getElementById('schGrid'); if(!grid) return;
  // the visible hours include every appointment shown, so each one sits at its exact time
  let sh = 7, eh = 18;
  SCH.items.forEach(a => { const s = new Date(a.starts_at), e = new Date(a.ends_at);
    if(e - from > 0 && s - schAdd(from, days) < 0){ sh = Math.min(sh, s < from ? 0 : s.getHours()); eh = Math.max(eh, (e >= schAdd(schDay(s), 1) ? 24 : Math.ceil((schMinutes(e)) / 60))); } });
  SCH.startHour = sh; SCH.endHour = Math.min(24, Math.max(eh, sh + 1));
  const px = SCH.px, total = (SCH.endHour - SCH.startHour) * px, today = schDay(new Date()).getTime();
  const mech = id => (SCH.mechs.find(m => m.id === id) || {}).name || '';
  let cols = '';
  for(let i = 0; i < days; i++){
    const day = schAdd(from, i), dayEnd = schAdd(day, 1);
    const dayItems = SCH.items.map(a => ({ a, sd: new Date(a.starts_at), ed: new Date(a.ends_at) }))
      .filter(x => x.ed > day && x.sd < dayEnd)
      .map(x => ({ a: x.a, s: Math.max(0, (Math.max(x.sd, day) - day) / 60000), e: Math.min(1440, (Math.min(x.ed, dayEnd) - day) / 60000), startsBefore: x.sd < day, endsAfter: x.ed > dayEnd }));
    const blocks = schLayout(dayItems).map(it => {
      const top = (it.s - SCH.startHour * 60) / 60 * px, h = Math.max(22, (it.e - it.s) / 60 * px);
      const a = it.a, st = a.status;
      return `<button type="button" class="sch-ev sch-${st}" data-appt="${a.id}" style="top:${top.toFixed(1)}px;height:${h.toFixed(1)}px;left:calc(${(100 / it.cols * it.col).toFixed(3)}% + 2px);width:calc(${(100 / it.cols).toFixed(3)}% - 4px)"
        aria-label="${esc(relayFmt('{from} to {to}', { from: schTime(new Date(a.starts_at)), to: schTime(new Date(a.ends_at)) }) + ', ' + a.customer_name + (a.reason ? ', ' + a.reason : ''))}">
        <span class="sch-ev-time">${it.startsBefore ? '… ' : ''}${esc(schTime(new Date(a.starts_at)))} – ${esc(schTime(new Date(a.ends_at)))}${it.endsAfter ? ' …' : ''}</span>
        <b>${esc(a.customer_name)}</b>${a.unit_label ? ` <span class="sch-ev-unit">${esc(a.unit_label)}</span>` : ''}
        ${a.reason ? `<span class="sch-ev-reason">${esc(a.reason)}</span>` : ''}
        ${a.mechanic_id ? `<span class="sch-ev-tech">${esc(mech(a.mechanic_id))}</span>` : ''}
        ${st === 'converted' ? '<span class="sch-ev-badge">Work order started</span>' : st === 'checked_in' ? '<span class="sch-ev-badge">Checked in</span>' : st === 'no_show' ? '<span class="sch-ev-badge">No-show</span>' : ''}
      </button>`;
    }).join('');
    const isToday = day.getTime() === today;
    const nowTop = isToday ? (schMinutes(new Date()) - SCH.startHour * 60) / 60 * px : -1;
    cols += `<div class="sch-col${isToday ? ' is-today' : ''}" data-day="${day.getTime()}" style="height:${total}px">${blocks}${nowTop >= 0 && nowTop <= total ? `<div class="sch-now" style="top:${nowTop.toFixed(1)}px" aria-hidden="true"></div>` : ''}</div>`;
  }
  const heads = Array.from({ length: days }, (_, i) => { const d = schAdd(from, i); return `<div class="sch-head${d.getTime() === today ? ' is-today' : ''}">${esc(d.toLocaleDateString(relayLocale(), { weekday: 'short' }))}<b>${d.getDate()}</b></div>`; }).join('');
  const hours = Array.from({ length: SCH.endHour - SCH.startHour }, (_, i) => { const d = new Date(2000, 0, 1, SCH.startHour + i); return `<div class="sch-hour" style="height:${px}px">${esc(d.toLocaleTimeString(relayLocale(), { hour: 'numeric' }))}</div>`; }).join('');
  grid.innerHTML = `<div class="sch-wrap sch-days-${days}" style="--sch-hour:${px}px">
      <div class="sch-heads"><div class="sch-gutter-head"></div>${heads}</div>
      <div class="sch-body"><div class="sch-gutter">${hours}</div>${cols}</div>
    </div>${SCH.items.length ? '' : '<p class="meta sch-empty">No appointments here yet. Tap a time to book one.</p>'}`;
  grid.querySelectorAll('.sch-col').forEach(col => col.addEventListener('click', e => {
    if(e.target.closest('.sch-ev')) return;
    const r = col.getBoundingClientRect();
    const mins = SCH.startHour * 60 + Math.floor(((e.clientY - r.top) / px * 60) / 15) * 15;   // the nearest 15 minutes above the tap
    openAppointmentForm(null, new Date(Number(col.dataset.day) + Math.max(0, Math.min(1439, mins)) * 60000));
  }));
  grid.querySelectorAll('[data-appt]').forEach(b => b.onclick = () => openAppointment(Number(b.dataset.appt)));
}

// ---- booking and editing ----
async function openAppointmentForm(appt, at){
  const start = appt ? new Date(appt.starts_at) : (at || new Date());
  const durMin = appt ? Math.round((new Date(appt.ends_at) - start) / 60000) : 60;
  const pad = n => String(n).padStart(2, '0');
  const dateVal = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, timeVal = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const durs = [[30, '30 min'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [480, 'All day (8 hours)']];
  if(!durs.some(d => d[0] === durMin)) durs.push([durMin, durMin + ' min']);
  const { data: custs } = await sb.from('customers').select('id, company_name').eq('active', true).order('company_name').limit(1000);
  const box = document.createElement('div');
  box.innerHTML = `<div class="card rec-form appt-form">
    <div class="field"><label for="apCust">Customer</label><select id="apCust"><option value="">— Type a name below —</option>${(custs || []).map(c => `<option value="${c.id}" ${appt && appt.customer_id === c.id ? 'selected' : ''}>${esc(c.company_name)}</option>`).join('')}</select></div>
    <div class="field" id="apNameWrap"><label for="apName">Customer name</label><input id="apName" maxlength="160" value="${appt && !appt.customer_id ? esc(appt.customer_name) : ''}" placeholder="For a customer not in Relay yet"></div>
    <div class="field"><label for="apUnit">Unit</label><select id="apUnit"><option value="">—</option></select><input id="apUnitText" maxlength="80" placeholder="Unit number" value="${appt && !appt.unit_id && appt.unit_label ? esc(appt.unit_label) : ''}"></div>
    <div class="field"><label for="apReason">Reason for the visit</label><input id="apReason" maxlength="500" value="${appt && appt.reason ? esc(appt.reason) : ''}" placeholder="e.g. PM service, brakes"></div>
    <div class="appt-row"><div class="field"><label for="apDate">Date</label><input type="date" id="apDate" value="${dateVal}"></div>
      <div class="field"><label for="apTime">Start</label><input type="time" id="apTime" step="900" value="${timeVal}"></div>
      <div class="field"><label for="apDur">Length</label><select id="apDur">${durs.map(([m, l]) => `<option value="${m}" ${m === durMin ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label for="apTech">Technician</label><select id="apTech"><option value="">Not assigned yet</option>${SCH.mechs.filter(m => m.active || (appt && appt.mechanic_id === m.id)).map(m => `<option value="${m.id}" ${appt && appt.mechanic_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="apNotes">Notes</label><textarea id="apNotes" rows="2" maxlength="2000">${appt && appt.notes ? esc(appt.notes) : ''}</textarea></div>
    <label class="appt-check"><input type="checkbox" id="apRemind" ${!appt || appt.remind ? 'checked' : ''}> Email the customer a reminder the day before</label>
    <p class="form-error" id="apErr" role="alert"></p>
    <div class="job-actions"><button type="button" id="apSave">${appt ? 'Save changes' : 'Book appointment'}</button></div></div>`;
  openFormSheet(appt ? 'Edit appointment' : 'New appointment', [box]);
  const custSel = box.querySelector('#apCust'), unitSel = box.querySelector('#apUnit'), unitText = box.querySelector('#apUnitText');
  const loadUnits = async () => {
    box.querySelector('#apNameWrap').classList.toggle('hidden', !!custSel.value);
    if(!custSel.value){ unitSel.classList.add('hidden'); unitText.classList.remove('hidden'); return; }
    const { data: units } = await sb.from('units').select('id, unit_number, make, model').eq('customer_id', Number(custSel.value)).eq('active', true).order('unit_number');
    unitSel.innerHTML = '<option value="">—</option>' + (units || []).map(u => `<option value="${u.id}" data-label="${esc(u.unit_number)}" ${appt && appt.unit_id === u.id ? 'selected' : ''}>${esc([u.unit_number, u.make, u.model].filter(Boolean).join(' · '))}</option>`).join('');
    unitSel.classList.toggle('hidden', !(units || []).length); unitText.classList.toggle('hidden', !!(units || []).length);
  };
  custSel.onchange = loadUnits; await loadUnits();
  box.querySelector('#apSave').onclick = async () => {
    const err = m => { box.querySelector('#apErr').textContent = m || ''; };
    const custId = custSel.value ? Number(custSel.value) : null;
    const name = custId ? custSel.selectedOptions[0].textContent : box.querySelector('#apName').value.trim();
    if(!name){ err('Choose a customer or type their name.'); return; }
    const d = box.querySelector('#apDate').value, t = box.querySelector('#apTime').value;
    if(!d || !t){ err('Choose the date and start time.'); return; }
    const [y, mo, da] = d.split('-').map(Number), [hh, mm] = t.split(':').map(Number);
    const s = new Date(y, mo - 1, da, hh, mm, 0, 0), e = new Date(s.getTime() + Number(box.querySelector('#apDur').value) * 60000);
    const unitId = !unitSel.classList.contains('hidden') && unitSel.value ? Number(unitSel.value) : null;
    const row = { customer_id: custId, customer_name: name, unit_id: unitId,
      unit_label: unitId ? unitSel.selectedOptions[0].dataset.label : (unitText.value.trim() || null),
      reason: box.querySelector('#apReason').value.trim() || null, notes: box.querySelector('#apNotes').value.trim() || null,
      starts_at: s.toISOString(), ends_at: e.toISOString(), starts_label: schEmailLabel(s),
      mechanic_id: box.querySelector('#apTech').value || null, remind: box.querySelector('#apRemind').checked };
    const btn = box.querySelector('#apSave'); btn.disabled = true; err('');
    const res = appt ? await sb.from('appointments').update(row).eq('id', appt.id) : await sb.from('appointments').insert([{ ...row, org_id: session.orgId }]);
    btn.disabled = false;
    if(res.error){ err(friendlyError(res.error, 'Could not save the appointment').message); return; }
    closeFormSheet(); recordsToast(appt ? 'Appointment updated' : 'Appointment booked for ' + schLabel(s));
    SCH.anchor = schDay(s); renderSchedule();
  };
}

// ---- an appointment: what it is, and what can be done with it ----
async function openAppointment(id){
  const a = SCH.items.find(x => x.id === id); if(!a) return;
  const mech = (SCH.mechs.find(m => m.id === a.mechanic_id) || {}).name;
  const open = ['scheduled', 'checked_in'].includes(a.status);
  const box = document.createElement('div');
  box.innerHTML = `<div class="card rec-form appt-detail">
    <p class="appt-when"><b>${esc(schLabel(new Date(a.starts_at)))}</b> – ${esc(schTime(new Date(a.ends_at)))}</p>
    <p><b>${esc(a.customer_name)}</b>${a.unit_label ? ' · ' + esc(a.unit_label) : ''}</p>
    ${a.reason ? `<p>${esc(a.reason)}</p>` : ''}${a.notes ? `<p class="meta">${esc(a.notes)}</p>` : ''}
    <p class="meta"><span>Technician: ${esc(mech || relayFmt('not assigned yet'))}</span>${a.remind ? `<span> · </span><span>${a.reminder_sent_at ? 'Reminder sent' : 'Reminder the day before'}</span>` : ''}</p>
    ${open && !a.mechanic_id ? `<div class="field"><label for="apStartTech">Technician for the work order</label><select id="apStartTech"><option value="">Choose…</option>${SCH.mechs.filter(m => m.active).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>` : ''}
    <p class="form-error" id="apDErr" role="alert"></p>
    <div class="job-actions appt-actions">
      ${open ? '<button type="button" id="apStart">Start work order</button>' : ''}
      ${a.status === 'converted' && a.job_id ? '<button type="button" id="apOpenWo">Open work order</button>' : ''}
      ${open ? '<button type="button" class="ghost-btn" id="apEdit">Edit or move</button>' : ''}
      ${a.status === 'scheduled' ? '<button type="button" class="ghost-btn" id="apCheckin">Checked in</button><button type="button" class="ghost-btn" id="apNoShow">No-show</button>' : ''}
      ${open ? '<button type="button" class="text-btn danger" id="apCancel">Cancel appointment</button>' : ''}
    </div></div>`;
  openFormSheet('Appointment', [box]);
  const err = m => { box.querySelector('#apDErr').textContent = m || ''; };
  const set = async (status, msg) => { const { error } = await sb.from('appointments').update({ status }).eq('id', a.id); if(error){ err(friendlyError(error, 'Could not update the appointment').message); return; } closeFormSheet(); recordsToast(msg); renderSchedule(); };
  const on = (sel, f) => { const b = box.querySelector(sel); if(b) b.onclick = f; };
  on('#apStart', async () => {
    const pick = box.querySelector('#apStartTech'); const mechId = a.mechanic_id || (pick && pick.value) || null;
    if(!mechId){ err('Choose a technician for the work order.'); return; }
    const { data: jobId, error } = await sb.rpc('start_work_order', { p_appointment: a.id, p_mechanic: mechId });
    if(error){ err(friendlyError(error, 'Could not start the work order').message); return; }
    closeFormSheet(); recordsToast('Work order started'); renderSchedule();
    if(typeof refreshShopData === 'function') refreshShopData();
    if(jobId && typeof openRepairOrder === 'function') openRepairOrder(jobId);
  });
  on('#apOpenWo', () => { closeFormSheet(); openRepairOrder(a.job_id); });
  on('#apEdit', () => { closeFormSheet(); openAppointmentForm(a); });
  on('#apCheckin', () => set('checked_in', 'Checked in'));
  on('#apNoShow', () => set('no_show', 'Marked as a no-show'));
  on('#apCancel', async () => { if(!(await relayConfirm({ message: 'Cancel this appointment? It leaves the calendar, and no reminder is sent.', confirmText: 'Cancel appointment', cancelText: 'Keep it', danger: true }))) return; set('cancelled', 'Appointment cancelled'); });
}

// the calendar draws itself whenever its screen opens
document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="shop-schedule"]')) setTimeout(renderSchedule, 0); });
