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
    sb.from('voice_calls').select('id, line_id, caller_phone, language, outcome, duration_seconds, started_at, request_id, provider_call_id').order('started_at', { ascending: false }).limit(50),
    sb.rpc('my_voice_usage', {})]);
  if(lines.error || plan.error){ box.innerHTML = head + `<p class="meta">${esc(relayFmt('Run migrations 0053 and 0054 to use the AI phone line.'))}</p>`; return; }
  const p = plan.data, all = lines.data || [];
  // A line counts only when Relay has really set it up and it is answering: managed, live and active.
  // Old hand-made entries (status "manual") were never connected to the AI and are ignored.
  // The live line wins over earlier failed attempts: before, a failed first try hid the working number.
  const liveLines = all.filter(l => l.managed && l.provision_status === 'live' && l.active !== false && l.phone_number);
  const pending = all.filter(l => l.managed && ['provisioning', 'failed'].includes(l.provision_status));
  const line = liveLines[0] || pending.find(l => l.provision_status === 'provisioning') || pending[pending.length - 1];
  const intro = `<p class="meta voice-intro">${esc(relayFmt('An AI assistant answers your shop phone in English or Russian, takes the caller\'s details and the problem, and holds a time. A person confirms every booking in Requests. Relay sets everything up for you.'))}</p>`;
  if((!p || !p.allowed) && !liveLines.length){
    box.innerHTML = head + intro + `<div class="card rec-form"><p>${esc(relayFmt('The AI phone line is not turned on for your shop yet.'))}</p><p class="meta">${esc(relayFmt('Ask Relay to turn it on: support@relayfleet.us'))}</p></div>`;
    return;
  }
  const price = p ? `<p class="voice-price">${esc(relayFmt('{fee} a month + {rate} per minute', { fee: voiceMoney(p.monthly_fee), rate: '$' + Number(p.per_minute).toFixed(2) }))}</p>` : '';
  const locs = (typeof relayLocations !== 'undefined' ? relayLocations : []) || [];
  if(!liveLines.length && (!line || line.provision_status === 'failed')){
    box.innerHTML = head + intro + `<div class="card rec-form voice-start">${price}
      ${line ? `<p class="form-error">${esc(relayFmt('The last setup did not finish. Relay has been told; nothing was charged. You can try again.'))}</p>` : ''}
      <div class="appt-row"><div class="field"><label for="vlLoc">${esc(relayFmt('Location'))}</label><select id="vlLoc">${locs.map(l => `<option value="${l.id}">${esc(l.display_name || l.name)}</option>`).join('') || '<option value="">—</option>'}</select></div>
        <div class="field"><label for="vlArea">${esc(relayFmt('Area code for the new number'))}</label><input id="vlArea" inputmode="numeric" maxlength="3" placeholder="407"></div></div>
      <p class="form-error" id="vlErr" role="alert"></p>
      <div class="job-actions"><button type="button" id="vlStart">${esc(relayFmt(line ? 'Try again' : 'Turn on AI phone line'))}</button></div></div>`;
    box.querySelector('#vlStart').onclick = () => voiceStart(box);
    return;
  }
  if(!liveLines.length && line.provision_status === 'provisioning'){
    box.innerHTML = head + `<div class="card rec-form"><p><b>${esc(relayFmt('Setting up your AI phone line…'))}</b></p><p class="meta">${esc(relayFmt('This takes about a minute.'))}</p></div>`;
    setTimeout(renderVoiceSettings, 8000); return;
  }
  const u = usage.data || {};
  const locName = id => { const l = locs.find(x => x.id === id); return l ? (l.display_name || l.name) : ''; };
  voiceCallsState.rows = calls.data || [];
  box.innerHTML = head + liveLines.map(l => `<div class="card voice-hero" data-vhero="${esc(l.id)}">
      <div class="voice-hero-main">
        <div class="voice-number"><span class="meta">${esc(relayFmt('Your AI phone line'))}${liveLines.length > 1 && locName(l.location_id) ? ' · ' + esc(locName(l.location_id)) : ''}</span>
          <b data-no-i18n>${esc(voicePretty(l.phone_number))}</b></div>
        <span class="voice-live-pill"><i></i>${esc(relayFmt('Answering calls'))}</span>
      </div>
      <div class="voice-hero-actions">
        <button type="button" class="ghost-btn" data-vcopy="${esc(l.phone_number)}">${esc(relayFmt('Copy number'))}</button>
        <a class="ghost-btn" href="tel:${esc(l.phone_number)}" data-no-i18n>${esc(relayFmt('Call it to test'))}</a>
      </div>
      <details class="voice-help"><summary>${esc(relayFmt('How to send your shop\'s calls to it'))}</summary>
        <p>${esc(relayFmt('Last step: forward your shop\'s phone to this number (all calls, or only the ones nobody answers). Your phone company or phone system can do this in a few minutes.'))}</p></details>
    </div>`).join('') + `
    <div class="voice-usage"><div><span>${esc(relayFmt('Calls this month'))}</span><b>${Number(u.calls || 0)}</b></div><div><span>${esc(relayFmt('Minutes'))}</span><b>${Number(u.minutes || 0)}</b></div><div><span>${esc(relayFmt('This month so far'))}</span><b>${voiceMoney(u.total)}</b></div></div>
    ${price}
    <div id="voiceCallsBox"></div>
    ${liveLines.map(l => voiceLineHtml(l) + (l.managed ? `<div class="job-actions voice-off-row"><button type="button" class="text-btn danger" data-vloff="${esc(l.id)}">${esc(relayFmt('Turn off AI phone line'))}</button></div>` : '')).join('')}`;
  box.querySelectorAll('[data-vcopy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.vcopy); recordsToast(relayFmt('Number copied')); } catch(_){ relayNotice(b.dataset.vcopy); } });
  box.querySelectorAll('[data-vlsave]').forEach(b => b.onclick = () => voiceSaveLine(liveLines.find(l => String(l.id) === b.dataset.vlsave)));
  box.querySelectorAll('[data-vloff]').forEach(b => b.onclick = async () => {
    if(!(await relayConfirm({ message: relayFmt('Turn off the AI phone line? The number is released and calls to it stop. Remember to stop forwarding your shop phone to it.'), confirmText: relayFmt('Turn off'), danger: true }))) return;
    const { data, error } = await sb.functions.invoke('voice-provision', { body: { action: 'deprovision', line_id: b.dataset.vloff } });
    if(error || (data && data.ok === false)){ relayFail(error || { message: data.error }, 'Could not turn off the line'); return; }
    recordsToast(relayFmt('AI phone line turned off')); renderVoiceSettings();
  });
  renderVoiceCalls();
}

// +14075550199 → +1 (407) 555-0199 (other numbers are shown as they are)
function voicePretty(n){ const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(String(n || '')); return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : String(n || ''); }

// ---- Calls: who called, what happened, and the recording ----
const voiceCallsState = { rows: [], filter: 'all', open: null, media: {} };
const VOICE_FILTERS = [['all', 'All'], ['request_created', 'Request taken'], ['transferred', 'Passed to a person'], ['abandoned', 'Hung up'], ['emergency', 'Emergency']];
function renderVoiceCalls(){
  const box = document.getElementById('voiceCallsBox'); if(!box) return;
  const st = voiceCallsState, all = st.rows;
  const rows = st.filter === 'all' ? all : all.filter(c => c.outcome === st.filter);
  const when = c => new Date(c.started_at).toLocaleString(relayLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const dur = c => c.duration_seconds != null ? Math.floor(c.duration_seconds / 60) + ':' + String(c.duration_seconds % 60).padStart(2, '0') : '';
  const lang = c => ({ en: 'English', ru: 'Russian', es: 'Spanish' })[c.language] || '';
  const mediaHtml = c => { const m = st.media[c.id];
    if(!m) return `<div class="voice-media"><p class="meta">${esc(relayFmt('Loading the recording…'))}</p></div>`;
    if(m.error) return `<div class="voice-media"><p class="form-error">${esc(m.error)}</p></div>`;
    return `<div class="voice-media">
      ${m.recording_url ? `<audio controls preload="none" src="${esc(m.recording_url)}"></audio><a class="text-btn" href="${esc(m.recording_url)}" target="_blank" rel="noopener noreferrer">${esc(relayFmt('Open recording in a new tab'))}</a>` : `<p class="meta">${esc(relayFmt(m.note || 'No recording was kept for this call.'))}</p>`}
      ${m.summary ? `<h4>${esc(relayFmt('Summary'))}</h4><p data-no-i18n>${esc(m.summary)}</p>` : ''}
      ${m.transcript ? `<h4>${esc(relayFmt('What was said'))}</h4><pre class="voice-transcript" data-no-i18n>${esc(m.transcript)}</pre>` : ''}</div>`; };
  box.innerHTML = `<div class="voice-calls-head"><h3 class="voice-calls-h">${esc(relayFmt('Calls'))}</h3><span class="meta">${esc(relayFmt(all.length >= 50 ? 'Latest 50' : '{n} in total', { n: all.length }))}</span></div>
    ${all.length ? `<div class="fd-dates voice-filters" role="group" aria-label="${esc(relayFmt('Show'))}">${VOICE_FILTERS.map(([k, l]) => `<button type="button" class="fd-chip${st.filter === k ? ' active' : ''}" data-vfilter="${k}" aria-pressed="${st.filter === k}">${esc(relayFmt(l))}</button>`).join('')}</div>` : ''}
    <div class="voice-calls">${rows.map(c => `<div class="voice-call-wrap${st.open === c.id ? ' is-open' : ''}"><div class="voice-call">
        <div class="voice-call-who"><b data-no-i18n>${c.caller_phone ? `<a href="tel:${esc(c.caller_phone)}">${esc(voicePretty(c.caller_phone))}</a>` : '—'}</b>
          <span class="meta">${esc(when(c))}${dur(c) ? ' · ' + esc(dur(c)) : ''}${lang(c) ? ' · ' + esc(relayFmt(lang(c))) : ''}</span></div>
        <span class="rec-tag voice-out-${esc(c.outcome)}">${esc(relayFmt(VOICE_OUTCOME[c.outcome] || c.outcome))}</span>
        <button type="button" class="ghost-btn voice-listen" data-vlisten="${c.id}" aria-expanded="${st.open === c.id}">${esc(relayFmt(st.open === c.id ? 'Close' : 'Listen'))}</button>
      </div>${st.open === c.id ? mediaHtml(c) : ''}</div>`).join('') || `<div class="empty-note">${esc(relayFmt(all.length ? 'No calls like that.' : 'No calls yet. Calls to your AI phone line appear here, with the recording.'))}</div>`}</div>`;
  box.querySelectorAll('[data-vfilter]').forEach(b => b.onclick = () => { st.filter = b.dataset.vfilter; st.open = null; renderVoiceCalls(); });
  box.querySelectorAll('[data-vlisten]').forEach(b => b.onclick = async () => {
    const id = Number(b.dataset.vlisten);
    if(st.open === id){ st.open = null; renderVoiceCalls(); return; }
    st.open = id; renderVoiceCalls();
    if(st.media[id] && !st.media[id].error) return;
    const { data, error } = await sb.functions.invoke('voice-provision', { body: { action: 'call', call_id: id } });
    st.media[id] = (error || !data || data.ok === false) ? { error: (data && data.error) || relayFmt('The recording could not be loaded. Try again in a moment.') } : data;
    if(st.open === id) renderVoiceCalls();
  });
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
