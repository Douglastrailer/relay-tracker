// ============================================================
// RelayFleet — Settings → AI phone line (migration 0053; function voice-intake). Owner only.
// Set up the line for a location, show its secret once with what the voice provider needs,
// edit opening hours, slots and transfer number, rotate the secret, and see recent calls.
// ============================================================
const VOICE_TZ = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']];
const VOICE_DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const VOICE_OUTCOME = { request_created: 'Request taken', transferred: 'Passed to a person', abandoned: 'Hung up', emergency: 'Emergency', in_progress: 'In progress' };

async function renderVoiceSettings(){
  const host = document.getElementById('shop-billing'); if(!host || !session || session.role !== 'shop' || session.staffRole !== 'owner') return;
  let box = document.getElementById('voiceSettings');
  if(!box){ box = document.createElement('div'); box.id = 'voiceSettings'; box.dataset.setgroup = 'phone'; host.appendChild(box); if(typeof uxSettingsTabs === 'function') uxSettingsTabs(); }
  const [{ data: lines, error }, { data: calls }] = await Promise.all([
    sb.from('voice_lines').select('id, location_id, label, phone_number, timezone, open_hour, close_hour, open_days, slot_minutes, capacity, transfer_number, recording_on, active').order('created_at'),
    sb.from('voice_calls').select('id, caller_phone, outcome, language, started_at').order('started_at', { ascending: false }).limit(10)]);
  if(error){ box.innerHTML = `<div class="section-head"><h2>${esc(relayFmt('AI phone line'))}</h2></div><p class="meta">${esc(relayFmt('Run migration 0053 to use the AI phone line.'))}</p>`; return; }
  const locs = (typeof relayLocations !== 'undefined' ? relayLocations : []) || [];
  const locName = id => { const l = locs.find(x => x.id === id); return l ? (l.display_name || l.name) : ''; };
  box.innerHTML = `<div class="section-head"><h2>${esc(relayFmt('AI phone line'))}</h2></div>
    <p class="meta voice-intro">${esc(relayFmt('An AI assistant answers your shop phone, takes the caller\'s details and the problem, and holds a time. A person confirms every booking in Requests. Set up the line here, then connect it in your voice provider.'))}</p>
    <div id="voiceLines">${(lines || []).map(l => voiceLineHtml(l, locName(l.location_id))).join('') || `<p class="meta">${esc(relayFmt('No AI phone line yet.'))}</p>`}</div>
    <div class="card rec-form voice-new"><h3>${esc(relayFmt('Add an AI phone line'))}</h3>
      <div class="appt-row">
        <div class="field"><label for="vlLoc">${esc(relayFmt('Location'))}</label><select id="vlLoc">${locs.map(l => `<option value="${l.id}">${esc(l.display_name || l.name)}</option>`).join('') || '<option value="">—</option>'}</select></div>
        <div class="field"><label for="vlPhone">${esc(relayFmt('AI line phone number'))}</label><input id="vlPhone" inputmode="tel" maxlength="20" placeholder="+1 407 555 0100"></div>
        <div class="field"><label for="vlTz">${esc(relayFmt('Time zone'))}</label><select id="vlTz">${VOICE_TZ.map(([v, l]) => `<option value="${v}">${esc(relayFmt(l))}</option>`).join('')}</select></div>
      </div>
      <p class="form-error" id="vlErr" role="alert"></p>
      <div class="job-actions"><button type="button" id="vlAdd">${esc(relayFmt('Set up the line'))}</button></div>
      <div id="vlSecret"></div>
    </div>
    ${(calls || []).length ? `<h3 class="voice-calls-h">${esc(relayFmt('Recent calls'))}</h3><div class="voice-calls">${calls.map(c => `<div class="voice-call"><span>${esc(c.caller_phone || '—')}</span><span class="meta">${esc(new Date(c.started_at).toLocaleString(relayLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span><b class="voice-out voice-out-${esc(c.outcome)}">${esc(relayFmt(VOICE_OUTCOME[c.outcome] || c.outcome))}</b></div>`).join('')}</div>` : ''}`;
  box.querySelector('#vlAdd').onclick = async () => {
    const err = m => { box.querySelector('#vlErr').textContent = m || ''; };
    const phone = box.querySelector('#vlPhone').value.trim();
    if(phone.replace(/\D/g, '').length < 7){ err(relayFmt('Enter the phone number of the AI line.')); return; }
    const { data, error: e } = await sb.rpc('create_voice_line', { p_location: Number(box.querySelector('#vlLoc').value) || null, p_phone: phone, p_label: null, p_timezone: box.querySelector('#vlTz').value });
    if(e){ err(friendlyError(e, 'Could not set up the line').message); return; }
    await renderVoiceSettings();
    voiceShowSecret(document.getElementById('vlSecret'), data.line_id, data.secret);
  };
  box.querySelectorAll('[data-vlsave]').forEach(b => b.onclick = () => voiceSaveLine(b.dataset.vlsave));
  box.querySelectorAll('[data-vlrotate]').forEach(b => b.onclick = async () => {
    if(!(await relayConfirm({ message: relayFmt('Make a new secret? The old one stops working at once, so update it in your voice provider straight away.'), confirmText: relayFmt('Make a new secret') }))) return;
    const { data, error: e } = await sb.rpc('rotate_voice_secret', { p_line: b.dataset.vlrotate });
    if(e){ relayFail(e, 'Could not make a new secret'); return; }
    voiceShowSecret(b.closest('.voice-line').querySelector('.voice-secret-slot'), b.dataset.vlrotate, data);
  });
}

function voiceLineHtml(l, locName){
  const hours = Array.from({ length: 25 }, (_, h) => h);
  const hourLabel = h => new Date(2000, 0, 1, h % 24).toLocaleTimeString(relayLocale(), { hour: 'numeric' }) + (h === 24 ? ' ' + relayFmt('(midnight)') : '');
  return `<div class="card rec-form voice-line" data-vl="${l.id}">
    <div class="voice-line-head"><b>${esc(l.phone_number)}</b><span class="meta">${esc(locName || '')} · ${esc(l.timezone)}</span>${l.active ? `<span class="voice-on">${esc(relayFmt('On'))}</span>` : `<span class="voice-off">${esc(relayFmt('Off'))}</span>`}</div>
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
    <label class="appt-check"><input type="checkbox" data-f="active" ${l.active ? 'checked' : ''}> ${esc(relayFmt('The AI answers this line'))}</label>
    <div class="job-actions"><button type="button" data-vlsave="${l.id}">${esc(relayFmt('Save'))}</button><button type="button" class="ghost-btn" data-vlrotate="${l.id}">${esc(relayFmt('Make a new secret'))}</button></div>
    <div class="voice-secret-slot"></div>
  </div>`;
}

async function voiceSaveLine(id){
  const card = document.querySelector(`.voice-line[data-vl="${id}"]`); if(!card) return;
  const v = f => card.querySelector(`[data-f="${f}"]`);
  const row = { open_hour: Number(v('open_hour').value), close_hour: Number(v('close_hour').value), slot_minutes: Number(v('slot_minutes').value),
    capacity: Math.max(1, Math.min(50, Number(v('capacity').value) || 1)), transfer_number: v('transfer_number').value.trim() || null,
    recording_on: v('recording_on').value === 'true', active: v('active').checked,
    open_days: [...card.querySelectorAll('[data-day]')].filter(c => c.checked).map(c => Number(c.dataset.day)) };
  if(row.close_hour <= row.open_hour){ relayNotice(relayFmt('The closing time must be after the opening time.')); return; }
  if(!row.open_days.length){ relayNotice(relayFmt('Choose the days the shop is open.')); return; }
  const { error } = await sb.from('voice_lines').update(row).eq('id', id);
  if(error){ relayFail(error, 'Could not save the line'); return; }
  recordsToast(relayFmt('AI phone line saved'));
}

// the secret, once, with everything the voice provider needs
function voiceShowSecret(slot, lineId, secret){
  if(!slot) return;
  const url = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '') + '/functions/v1/voice-intake';
  slot.innerHTML = `<div class="voice-secret" role="status">
    <b>${esc(relayFmt('Copy these into your voice provider now. The secret is shown only once.'))}</b>
    <dl><dt>${esc(relayFmt('Server address'))}</dt><dd><code data-no-i18n>${esc(url)}</code></dd>
    <dt>${esc(relayFmt('Line id'))}</dt><dd><code data-no-i18n>${esc(lineId)}</code></dd>
    <dt>${esc(relayFmt('Secret (header x-relay-voice-secret)'))}</dt><dd><code data-no-i18n>${esc(secret)}</code></dd>
    <dt>${esc(relayFmt('Tools'))}</dt><dd><code data-no-i18n>lookup_customer, free_slots, create_request, report_emergency, transfer_to_human, end_call</code></dd></dl>
    <button type="button" class="ghost-btn" data-copysecret>${esc(relayFmt('Copy all'))}</button></div>`;
  slot.querySelector('[data-copysecret]').onclick = async () => {
    try { await navigator.clipboard.writeText(`Server address: ${url}\nLine id: ${lineId}\nHeader x-relay-voice-secret: ${secret}`); recordsToast(relayFmt('Copied')); } catch(_){ relayNotice(relayFmt('Select the text and copy it.')); }
  };
}
document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="shop-billing"], [data-settab="phone"], [data-navfly="set:phone"]')) setTimeout(renderVoiceSettings, 0); });
