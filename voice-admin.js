// ============================================================
// RelayFleet — Admin → Subscriptions → AI phone lines (migrations 0054, function voice-provision).
// For each shop: approve it, set its monthly fee and price per minute, turn its AI phone line on or off
// (Relay runs it in Relay's Vapi account), and see this month's calls, minutes and charge, with Vapi's cost.
// ============================================================
const vaMoney = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function renderVoiceAdmin(){
  // Shown on the main Admin page (Overview), so it does not depend on opening Subscriptions.
  const panel = document.getElementById('admin-overview'); if(!panel || !session || session.role !== 'admin') return;
  let box = document.getElementById('voiceAdminBox');
  if(!box){ box = document.createElement('section'); box.id = 'voiceAdminBox'; box.className = 'voice-admin'; panel.appendChild(box); }
  const { data, error } = await sb.rpc('admin_voice_usage', {});
  if(error){ box.innerHTML = `<div class="section-head"><h2>AI phone lines</h2></div><p class="meta">Run migration 0054 (and 0053) to use the AI phone lines. (${esc(error.message || 'error')})</p>`; return; }
  const rows = data || [];
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  box.innerHTML = `<div class="section-head"><h2>AI phone lines</h2><span class="meta">${esc(month)}</span></div>
    <p class="meta">Approve a shop and set its price, then turn its line on. Relay sets up the phone number and assistant; the shop forwards its phone to the new number.</p>
    <div class="voice-admin-list">${rows.map(r => {
      const u = r.usage || {}, live = (r.lines || []).find(l => l.status === 'live'), busy = (r.lines || []).find(l => l.status === 'provisioning');
      const failed = !live && !busy ? (r.lines || []).find(l => l.status === 'failed') : null;
      const status = live ? `<span class="voice-on">${esc(live.phone)} · on</span>` : busy ? `<span class="meta">Setting up…</span>` : failed ? `<span class="voice-off">Failed: ${esc(failed.error || 'unknown error')}</span>` : `<span class="meta">Off</span>`;
      const action = live
        ? `<button type="button" class="text-btn danger" data-vaoff="${esc(r.org_id)}" data-line="${esc(live.id || '')}">Turn off</button>`
        : busy ? '' : `<span class="va-on"><input type="text" inputmode="numeric" maxlength="3" placeholder="Area code" data-va="area" aria-label="Area code for ${esc(r.shop)}"><button type="button" class="ghost-btn" data-vaon="${esc(r.org_id)}" ${r.allowed ? '' : 'disabled title="Approve the shop first"'}>Turn on</button></span>`;
      return `<div class="voice-admin-row" data-org="${esc(r.org_id)}">
        <div class="va-shop"><b>${esc(r.shop)}</b>${status}</div>
        <label class="va-allow"><input type="checkbox" data-va="allowed" ${r.allowed ? 'checked' : ''}> Approved</label>
        <label class="va-num">Monthly $<input type="number" min="0" step="1" data-va="monthly_fee" value="${Number(r.monthly_fee)}"></label>
        <label class="va-num">Per min $<input type="number" min="0" step="0.01" data-va="per_minute" value="${Number(r.per_minute)}"></label>
        <div class="va-usage"><span>${Number(u.calls || 0)} calls · ${Number(u.minutes || 0)} min</span><b>${vaMoney(u.total)}</b><span class="meta">Vapi cost ${vaMoney(u.provider_cost)}</span></div>
        <div class="va-actions"><button type="button" class="ghost-btn" data-vasave>Save</button>${action}</div>
      </div>`; }).join('') || '<p class="meta">No shops yet.</p>'}</div>
    <p class="meta">Add each shop's charge to its Relay invoice for the month.</p>`;

  box.querySelectorAll('[data-vasave]').forEach(b => b.onclick = async () => {
    const row = b.closest('.voice-admin-row'), v = k => row.querySelector(`[data-va="${k}"]`);
    const rec = { org_id: row.dataset.org, allowed: v('allowed').checked, monthly_fee: Math.max(0, Number(v('monthly_fee').value) || 0), per_minute: Math.max(0, Number(v('per_minute').value) || 0), updated_at: new Date().toISOString() };
    const { error: e } = await sb.from('voice_plans').upsert(rec, { onConflict: 'org_id' });
    if(e){ relayFail(e, 'Could not save'); return; }
    recordsToast('Saved'); renderVoiceAdmin();
  });
  box.querySelectorAll('[data-vaon]').forEach(b => b.onclick = async () => {
    const row = b.closest('.voice-admin-row'), area = row.querySelector('[data-va="area"]').value.replace(/\D/g, '');
    if(area.length !== 3){ relayNotice('Enter a 3-digit area code for the new number.'); return; }
    if(!(await relayConfirm({ message: `Turn on the AI phone line for ${row.querySelector('b').textContent}? Relay will buy a number with area code ${area} in its Vapi account. Save the price first if you changed it.`, confirmText: 'Turn on' }))) return;
    b.disabled = true; b.textContent = 'Setting up…';
    const { data, error: e } = await sb.functions.invoke('voice-provision', { body: { action: 'provision', org_id: b.dataset.vaon, area_code: area } });
    if(e || (data && data.ok === false)){ relayFail(e || { message: data.error }, 'Could not turn on the line'); renderVoiceAdmin(); return; }
    recordsToast(`AI phone line on: ${data.phone_number}`); renderVoiceAdmin();
  });
  box.querySelectorAll('[data-vaoff]').forEach(b => b.onclick = async () => {
    if(!(await relayConfirm({ message: 'Turn off this AI phone line? The number is released and calls stop being answered by the AI.', confirmText: 'Turn off', danger: true }))) return;
    const { data, error: e } = await sb.functions.invoke('voice-provision', { body: { action: 'deprovision', org_id: b.dataset.vaoff, line_id: b.dataset.line } });
    if(e || (data && data.ok === false)){ relayFail(e || { message: data.error }, 'Could not turn off the line'); return; }
    recordsToast('AI phone line is off'); renderVoiceAdmin();
  });
}
document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="admin-overview"]')) setTimeout(renderVoiceAdmin, 0); });
