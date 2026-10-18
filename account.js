// ============================================================
// RelayFleet — Export all my data, and two-factor sign-in.
// ============================================================

// ---------- Export: one click, everything the shop owns ----------
function exportFilename(ext){
  const name = ((typeof session !== 'undefined' && session && session.orgName) || 'relay').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${name}-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
function downloadBlob(name, text, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// rows of objects → one CSV, with the columns in a sensible order
function objectsToCsv(rows){
  if(!rows || !rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const esc2 = v => /[",\r\n]/.test(cell(v)) ? '"' + cell(v).replace(/"/g, '""') + '"' : cell(v);
  return [cols.join(','), ...rows.map(r => cols.map(c => esc2(r[c])).join(','))].join('\r\n');
}
async function exportShopData(format){
  const btn = document.getElementById('exportBtn'), note = document.getElementById('exportNote');
  if(btn){ btn.disabled = true; btn.textContent = 'Gathering your data…'; }
  if(note) note.textContent = '';
  const { data, error } = await sb.rpc('export_shop_data');
  if(btn){ btn.disabled = false; btn.textContent = 'Download everything'; }
  if(error || !data){ if(note){ note.className = 'form-error'; note.textContent = error ? error.message : 'The export could not be prepared.'; } return null; }
  const counts = ['customers', 'units', 'work_orders', 'documents', 'parts', 'time_entries', 'inspections']
    .map(k => `${(data[k] || []).length} ${k.replace(/_/g, ' ')}`).join(' · ');
  if(format === 'csv'){
    // one CSV per list, in a plain text bundle a spreadsheet can open
    const parts = Object.keys(data).filter(k => Array.isArray(data[k]) && data[k].length)
      .map(k => `### ${k} (${data[k].length})\r\n${objectsToCsv(data[k])}`);
    downloadBlob(exportFilename('csv'), '\ufeff' + parts.join('\r\n\r\n'), 'text/csv');
  } else {
    downloadBlob(exportFilename('json'), JSON.stringify(data, null, 2), 'application/json');
  }
  if(note){ note.className = 'meta'; note.textContent = 'Downloaded: ' + counts + '.'; }
  return data;
}
function initExportUI(){
  const box = document.getElementById('exportBox');
  if(!box || !session || session.role !== 'shop' || session.staffRole !== 'owner'){ if(box) box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<div class="section-head"><h3>Your data</h3></div>
    <p class="meta">Everything this shop owns — customers, units, work orders, estimates, invoices, parts, stock, time and inspections — in one file. Yours to keep, with no lock-in.</p>
    <div class="job-actions"><button type="button" id="exportBtn">Download everything</button>
      <select id="exportFormat" aria-label="File type"><option value="json">One file (JSON)</option><option value="csv">Spreadsheet (CSV)</option></select></div>
    <p class="meta" id="exportNote"></p>`;
  document.getElementById('exportBtn').onclick = () => exportShopData(document.getElementById('exportFormat').value);
}

// ---------- Two-factor sign-in ----------
// Uses Supabase's own app-code (TOTP) support: an authenticator app on the phone.
let mfaBusy = false;
async function mfaFactors(){
  try { const { data, error } = await sb.auth.mfa.listFactors(); if(error) return { error }; 
    const all = (data && (data.totp || data.all)) || []; return { factors: all.filter(f => f.factor_type === 'totp' || !f.factor_type) };
  } catch(e){ return { error: e }; }
}
async function renderMfaBox(){
  const box = document.getElementById('mfaBox');
  if(!box || !session || !(session.role === 'shop' || session.role === 'admin')){ if(box) box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const { factors, error } = await mfaFactors();
  if(error){ box.innerHTML = `<div class="section-head"><h3>Two-step sign-in</h3></div><p class="form-error">${esc(error.message || 'Could not check this.')}</p>`; return; }
  const on = (factors || []).filter(f => f.status === 'verified');
  box.innerHTML = `<div class="section-head"><h3>Two-step sign-in</h3>${on.length ? '<span class="badge arrived"><span class="bd"></span>On</span>' : ''}</div>
    <p class="meta">A code from an app on your phone, as well as your password. It protects your customers' details and your billing.</p>
    <p class="form-error" id="mfaErr"></p>
    ${on.length
      ? `<div class="job-actions"><button type="button" class="ghost-btn" id="mfaOff">Turn off two-step sign-in</button></div>`
      : `<div class="job-actions"><button type="button" id="mfaOn">Set up two-step sign-in</button></div>`}
    <div id="mfaSetup"></div>`;
  const err = m => { const e = document.getElementById('mfaErr'); if(e) e.textContent = m || ''; };
  const onBtn = document.getElementById('mfaOn');
  if(onBtn) onBtn.onclick = async () => {
    if(mfaBusy) return; mfaBusy = true; err(''); onBtn.disabled = true;
    const { data, error: e2 } = await sb.auth.mfa.enroll({ factorType: 'totp' });
    mfaBusy = false; onBtn.disabled = false;
    if(e2){ err(e2.message); return; }
    const qr = data.totp && data.totp.qr_code, secret = data.totp && data.totp.secret;
    document.getElementById('mfaSetup').innerHTML = `
      <ol class="mfa-steps">
        <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>Scan this square, or type the code underneath it.</li>
        <li>Type the 6-digit number the app shows, to finish.</li>
      </ol>
      ${qr ? `<img class="mfa-qr" src="${esc(qr)}" alt="Square to scan with your authenticator app" width="180" height="180">` : ''}
      ${secret ? `<p class="meta mono">${esc(secret)}</p>` : ''}
      <div class="field"><label for="mfaCode">The 6-digit number</label><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="mono"></div>
      <div class="job-actions"><button type="button" id="mfaVerify">Finish</button><button type="button" class="ghost-btn" id="mfaCancel">Cancel</button></div>`;
    document.getElementById('mfaCancel').onclick = async () => { await sb.auth.mfa.unenroll({ factorId: data.id }); renderMfaBox(); };
    document.getElementById('mfaVerify').onclick = async () => {
      const code = (document.getElementById('mfaCode').value || '').replace(/\D/g, '');
      if(code.length !== 6){ err('Type the 6-digit number from your app.'); return; }
      const btn = document.getElementById('mfaVerify'); btn.disabled = true; btn.textContent = 'Checking…';
      const ch = await sb.auth.mfa.challenge({ factorId: data.id });
      if(ch.error){ err(ch.error.message); btn.disabled = false; btn.textContent = 'Finish'; return; }
      const v = await sb.auth.mfa.verify({ factorId: data.id, challengeId: ch.data.id, code });
      btn.disabled = false; btn.textContent = 'Finish';
      if(v.error){ err(v.error.message); return; }
      if(typeof recordsToast === 'function') recordsToast('Two-step sign-in is on');
      renderMfaBox();
    };
  };
  const offBtn = document.getElementById('mfaOff');
  if(offBtn) offBtn.onclick = async () => {
    if(!confirm('Turn off two-step sign-in? Your account will be protected by your password alone.')) return;
    err(''); offBtn.disabled = true;
    for(const f of on){ const { error: e3 } = await sb.auth.mfa.unenroll({ factorId: f.id }); if(e3){ err(e3.message); offBtn.disabled = false; return; } }
    if(typeof recordsToast === 'function') recordsToast('Two-step sign-in is off');
    renderMfaBox();
  };
}

// At sign-in: if this account uses two-step, ask for the code before going in.
async function mfaSignInStep(){
  try {
    const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if(error || !data) return { ok: true };                        // nothing to do
    if(data.currentLevel === data.nextLevel) return { ok: true };  // already satisfied
    const { factors } = await mfaFactors();
    const f = (factors || []).find(x => x.status === 'verified');
    if(!f) return { ok: true };
    return { needsCode: true, factorId: f.id };
  } catch(_){ return { ok: true }; }
}
async function mfaSubmitCode(factorId, code){
  const clean = String(code || '').replace(/\D/g, '');
  if(clean.length !== 6) return { error: { message: 'Type the 6-digit number from your app.' } };
  const ch = await sb.auth.mfa.challenge({ factorId });
  if(ch.error) return { error: ch.error };
  const v = await sb.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: clean });
  if(v.error) return { error: v.error };
  return { ok: true };
}
