// ============================================================
// RelayFleet — Admin → Subscriptions → AI phone lines (migration 0054). For each shop: approve it, set the
// agreed monthly fee and price per minute, see its line, and this month's calls, minutes and charge
// (with what Vapi charged Relay, for comparison). Add the charge to the shop's Relay invoice.
// ============================================================
const vaMoney = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function renderVoiceAdmin(){
  const panel = document.getElementById('admin-subs'); if(!panel || !session || session.role !== 'admin') return;
  let box = document.getElementById('voiceAdminBox');
  if(!box){ box = document.createElement('section'); box.id = 'voiceAdminBox'; box.className = 'voice-admin'; panel.appendChild(box); }
  const { data, error } = await sb.rpc('admin_voice_usage', {});
  if(error){ box.innerHTML = `<div class="section-head"><h2>AI phone lines</h2></div><p class="meta">Run migrations 0053 and 0054 to use the AI phone line.</p>`; return; }
  const rows = (data || []);
  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  box.innerHTML = `<div class="section-head"><h2>AI phone lines</h2><span class="meta">${esc(month)}</span></div>
    <div class="voice-admin-list">${rows.map(r => { const u = r.usage || {}, ln = (r.lines || [])[0];
      return `<div class="voice-admin-row" data-org="${esc(r.org_id)}">
        <div class="va-shop"><b>${esc(r.shop)}</b><span class="meta">${ln ? esc(ln.phone) + ' · ' + esc(ln.status) + (ln.error ? ' — ' + esc(ln.error) : '') : 'No line'}</span></div>
        <label class="va-allow"><input type="checkbox" data-va="allowed" ${r.allowed ? 'checked' : ''}> Approved</label>
        <label class="va-num">Monthly $<input type="number" min="0" step="1" data-va="monthly_fee" value="${Number(r.monthly_fee)}"></label>
        <label class="va-num">Per min $<input type="number" min="0" step="0.01" data-va="per_minute" value="${Number(r.per_minute)}"></label>
        <div class="va-usage"><span>${Number(u.calls || 0)} calls · ${Number(u.minutes || 0)} min</span><b>${vaMoney(u.total)}</b><span class="meta">Vapi cost ${vaMoney(u.provider_cost)}</span></div>
        <button type="button" class="ghost-btn" data-vasave>Save</button></div>`; }).join('') || '<p class="meta">No shops yet.</p>'}</div>
    <p class="meta">Add each shop's charge to its Relay invoice for the month.</p>`;
  box.querySelectorAll('[data-vasave]').forEach(b => b.onclick = async () => {
    const row = b.closest('.voice-admin-row'), v = k => row.querySelector(`[data-va="${k}"]`);
    const rec = { org_id: row.dataset.org, allowed: v('allowed').checked, monthly_fee: Math.max(0, Number(v('monthly_fee').value) || 0), per_minute: Math.max(0, Number(v('per_minute').value) || 0), updated_at: new Date().toISOString() };
    const { error: e } = await sb.from('voice_plans').upsert(rec, { onConflict: 'org_id' });
    if(e){ relayFail(e, 'Could not save'); return; }
    recordsToast('Saved'); renderVoiceAdmin();
  });
}
document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="admin-subs"]')) setTimeout(renderVoiceAdmin, 0); });
