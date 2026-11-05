// ============================================================
// RelayFleet — Settings → AI phone line (owner). Relay sets the line up in its own Vapi account
// (function voice-provision, migrations 0053–0054) and bills the shop: a monthly fee plus a price per
// minute, agreed with Relay. Relay approves each shop first. The owner only forwards their number.
// ============================================================
const VOICE_DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const VOICE_OUTCOME = { request_created: 'Request taken', transferred: 'Passed to a person', abandoned: 'Hung up', emergency: 'Emergency', in_progress: 'In progress' };
const voiceMoney = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function renderVoiceSettings(){
  const host = document.getElementById('shop-billing'); if(!host || !session || session.role !== 'shop' || session.staffRole !== 'owner') return;
  let box = document.getElementById('voiceSettings');
  if(!box){ box = document.createElement('div'); box.id = 'voiceSettings'; box.dataset.setgroup = 'phone'; host.appendChild(box); if(typeof uxSettingsTabs === 'function') uxSettingsTabs(); }
  const head = `<div class="section-head"><h2>${esc(relayFmt('AI phone line'))}</h2></div>`;
  const [plan, lines, calls, usage] = await Promise.all([
    sb.from('voice_plans').select('allowed, monthly_fee, per_minute').maybeSingle(),
    sb.from('voice_lines').select('id, location_id, phone_number, timezone, open_hour, close_hour, open_days, slot_minutes, capacity, transfer_number, recording_on, active, managed, provision_status').order('created_at'),
    sb.from('voice_calls').select('id, caller_phone, outcome, duration_seconds, started_at').order('started_at', { ascending: false }).limit(10),
    sb.rpc('my_voice_usage', {})]);
  if(lines.error || plan.error){ box.innerHTML = head + `<p class="meta">${esc(relayFmt('Run migrations 0053 and 0054 to use the AI phone line.'))}</p>`; return; }
  const p = plan.data, all = lines.data || [];
  const line = all.find(l => l.managed && ['live', 'provisioning', 'failed'].includes(l.provision_status));
  const intro = `<p class="meta voice-intro">${esc(relayFmt('An AI assistant answers your shop phone in English or Russian, takes the caller\'s details and the problem, and holds a time. A person confirms every booking in Requests. Relay sets everything up for you.'))}</p>`;
  if(!p || !p.allowed){
    box.innerHTML = head + intro + `<div class="card rec-form"><p>${esc(relayFmt('The AI phone line is not turned on for your shop yet.'))}</p><p class="meta">${esc(relayFmt('Ask Relay to turn it on: support@relayfleet.us'))}</p></div>`;
    return;
  }
  const price = `<p class="voice-price">${esc(relayFmt('{fee} a month + {rate} per minute', { fee: voiceMoney(p.monthly_fee), rate: '$' + Number(p.per_minute).toFixed(2) }))}</p>`;
  const locs = (typeof relayLocations !== 'undefined' ? relayLocations : []) || [];
  if(!line || line.provision_status === 'failed'){
    box.innerHTML = head + intro + `<div class="card rec-form voice-start">${price}
      ${line ? `<p class="form-error">${esc(relayFmt('The last setup did not finish. Relay has been told; nothing was charged. You can try again.'))}</p>` : ''}
      <div class="appt-row"><div class="field"><label for="vlLoc">${esc(relayFmt('Location'))}</label><select id="vlLoc">${locs.map(l => `<option value="${l.id}">${esc(l.display_name || l.name)}</option>`).join('') || '<option value="">—</option>'}</select></div>
        <div class="field"><label for="vlArea">${esc(relayFmt('Area code for the new number'))}</label><input id="vlArea" inputmode="numeric" maxlength="3" placeholder="407"></div></div>
      <p class="form-error" id="vlErr" role="alert"></p>
      <div class="job-actions"><button type="button" id="vlStart">${esc(relayFmt(line ? 'Try again' : 'Turn on AI phone line'))}</button></div></div>`;
    box.querySelector('#vlStart').onclick = () => voiceStart(box);
    return;
  }
  if(line.provision_status === 'provisioning'){
    box.innerHTML = head + `<div class="card rec-form"><p><b>${esc(relayFmt('Setting up your AI phone line…'))}</b></p><p class="meta">${esc(relayFmt('This takes about a minute.'))}</p></div>`;
    setTimeout(renderVoiceSettings, 8000); return;
  }
  const u = usage.data || {};
  box.innerHTML = head + `<div class="card rec-form voice-live">
      <div class="voice-number"><span class="meta">${esc(relayFmt('Your AI phone line'))}</span><b data-no-i18n>${esc(line.phone_number)}</b></div>
      <p>${esc(relayFmt('Last step: forward your shop\'s phone to this number (all calls, or only the ones nobody answers). Your phone company or phone system can do this in a few minutes.'))}</p>
      <div class="voice-usage"><div><span>${esc(relayFmt('Calls this month'))}</span><b>${Number(u.calls || 0)}</b></div><div><span>${esc(relayFmt('Minutes'))}</span><b>${Number(u.minutes || 0)}</b></div><div><span>${esc(relayFmt('This month so far'))}</span><b>${voiceMoney(u.total)}</b></div></div>
      ${price}</div>
    ${voiceLineHtml(line)}
    ${(calls.data || []).length ? `<h3 class="voice-calls-h">${esc(relayFmt('Recent calls'))}</h3><div class="voice-calls">${calls.data.map(c => `<div class="voice-call"><span>${esc(c.caller_phone || '—')}</span><span class="meta">${esc(new Date(c.started_at).toLocaleString(relayLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}${c.duration_seconds != null ? ' · ' + esc(relayDur(c.duration_seconds / 60)) : ''}</span><b class="voice-out voice-out-${esc(c.outcome)}">${esc(relayFmt(VOICE_OUTCOME[c.outcome] || c.outcome))}</b></div>`).join('')}</div>` : ''}
    <div class="job-actions voice-off-row"><button type="button" class="text-btn danger" id="vlOff">${esc(relayFmt('Turn off AI phone line'))}</button></div>`;
  box.querySelector('[data-vlsave]').onclick = () => voiceSaveLine(line);
  box.querySelector('#vlOff').onclick = async () => {
    if(!(await relayConfirm({ message: relayFmt('Turn off the AI phone line? The number is released and calls to it stop. Remember to stop forwarding your shop phone to it.'), confirmText: relayFmt('Turn off'), danger: true }))) return;
    const { data, error } = await sb.functions.invoke('voice-provision', { body: { action: 'deprovision', line_id: line.id } });
    if(error || (data && data.ok === false)){ relayFail(error || { message: data.error }, 'Could not turn off the line'); return; }
    recordsToast(relayFmt('AI phone line turned off')); renderVoiceSettings();
  };
}

async function voiceStart(box){
  const err = m => { box.querySelector('#vlErr').textContent = m || ''; };
  const area = box.querySelector('#vlArea').value.trim();
  if(area && !/^[2-9][0-9]{2}$/.test(area)){ err(relayFmt('Enter a 3-digit US area code, or leave it empty.')); return; }
  const btn = box.querySelector('#vlStart'); btn.disabled = true; btn.textContent = relayFmt('Setting up… about a minute'); err('');
  const { data, error } = await sb.functions.invoke('voice-provision', { body: { action: 'provision', location_id: Number(box.querySelector('#vlLoc').value) || null, area_code: area || null } });
  if(error || !data || data.ok === false){
    btn.disabled = false; btn.textContent = relayFmt('Turn on AI phone line');
    err((data && data.error) || friendlyError(error, 'Could not set up the line').message); return;
  }
  recordsToast(relayFmt('Your AI phone line is ready: {n}', { n: data.number }));
  renderVoiceSettings();
}

function voiceLineHtml(l){
  const hours = Array.from({ length: 25 }, (_, h) => h);
  const hourLabel = h => new Date(2000, 0, 1, h % 24).toLocaleTimeString(relayLocale(), { hour: 'numeric' }) + (h === 24 ? ' ' + relayFmt('(midnight)') : '');
  return `<div class="card rec-form voice-line" data-vl="${l.id}"><h3>${esc(relayFmt('When the AI answers'))}</h3>
    <div class="appt-row">
      <div class="field"><label>${esc(relayFmt('Opens'))}</label><select data-f="open_hour">${hours.slice(0, 24).map(h => `<option value="${h}" ${h === l.open_hour ? 'selected' : ''}>${esc(hourLabel(h))}</option>`).join('')}</select></div>
      <div class="field"><label>${esc(relayFmt('Closes'))}</label><select data-f="close_hour">${hours.slice(1).map(h => `<option value="${h}" ${h === l.close_hour ? 'selected' : ''}>${esc(hourLabel(h))}</option>`).join('')}</select></div>
      <div class="field"><label>${esc(relayFmt('Slot length'))}</label><select data-f="slot_minutes">${[30, 60, 90, 120, 180, 240].map(m => `<option value="${m}" ${m === l.slot_minutes ? 'selected' : ''}>${m} min</option>`).join('')}</select></div>
    </div>
    <fieldset class="voice-days"><legend>${esc(relayFmt('Open days'))}</legend>${VOICE_DAYS.map(([d, n]) => `<label><input type="checkbox" data-day="${d}" ${(l.open_days || []).includes(d) ? 'checked' : ''}> ${esc(relayFmt(n))}</label>`).join('')}</fieldset>
    <div class="appt-row">
      <div class="field"><label>${esc(relayFmt('Jobs at the same time'))}</label><input type="number" min="1" max="50" data-f="capacity" value="${l.capacity}"></div>
      <div class="field"><label>${esc(relayFmt('Transfer calls to'))}</label><input inputmode="tel" maxlength="20" data-f="transfer_number" value="${esc(l.transfer_number || '')}" placeholder="+1 407 555 0111"></div>
      <div class="field"><label>${esc(relayFmt('Recording'))}</label><select data-f="recording_on"><option value="true" ${l.recording_on ? 'selected' : ''}>${esc(relayFmt('On (the caller is told)'))}</option><option value="false" ${!l.recording_on ? 'selected' : ''}>${esc(relayFmt('Off'))}</option></select></div>
    </div>
    <div class="job-actions"><button type="button" data-vlsave="${l.id}">${esc(relayFmt('Save'))}</button></div></div>`;
}

async function voiceSaveLine(l){
  const card = document.querySelector(`.voice-line[data-vl="${l.id}"]`); if(!card) return;
  const v = f => card.querySelector(`[data-f="${f}"]`);
  const row = { open_hour: Number(v('open_hour').value), close_hour: Number(v('close_hour').value), slot_minutes: Number(v('slot_minutes').value),
    capacity: Math.max(1, Math.min(50, Number(v('capacity').value) || 1)), transfer_number: v('transfer_number').value.trim() || null, recording_on: v('recording_on').value === 'true',
    open_days: [...card.querySelectorAll('[data-day]')].filter(c => c.checked).map(c => Number(c.dataset.day)) };
  if(row.close_hour <= row.open_hour){ relayNotice(relayFmt('The closing time must be after the opening time.')); return; }
  if(!row.open_days.length){ relayNotice(relayFmt('Choose the days the shop is open.')); return; }
  const { error } = await sb.from('voice_lines').update(row).eq('id', l.id);
  if(error){ relayFail(error, 'Could not save the line'); return; }
  // the assistant itself needs the new transfer number or recording setting
  if(l.managed && (row.transfer_number !== (l.transfer_number || null) || row.recording_on !== l.recording_on)){
    const { data, error: e } = await sb.functions.invoke('voice-provision', { body: { action: 'sync', line_id: l.id } });
    if(e || (data && data.ok === false)){ relayFail(e || { message: data.error }, 'Saved, but the AI could not be updated'); return; }
  }
  recordsToast(relayFmt('AI phone line saved'));
  Object.assign(l, row);
}
document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="shop-billing"], [data-settab="phone"], [data-navfly="set:phone"]')) setTimeout(renderVoiceSettings, 0); });
