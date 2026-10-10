// ============================================================
// RelayFleet — Natasha, smarter (D).
// 1. Daily briefing: built straight from the shop's data (no AI → instant,
//    free and exact). Shown the first time Natasha opens each day.
// 2. "Draft with Natasha": drafts an estimate from the complaint and the
//    mechanic's diagnosis. Prices come from the shop's own list and labor rate
//    (decided on the server). It opens as a DRAFT — nothing is sent.
// ============================================================
async function natashaBriefing(){
  if(!session || session.role !== 'shop' || !session.orgId) return null;
  const org = session.orgId, now = new Date(), dayAgo = new Date(Date.now() - 864e5).toISOString(), today = now.toISOString().slice(0, 10);
  const [waitAppr, parts, done, overdue, road, low] = await Promise.all([
    sb.from('invoices').select('id, doc_number, customer_name, sent_at').eq('org_id', org).eq('kind', 'estimate').eq('status', 'sent').lt('sent_at', dayAgo).order('sent_at').limit(50),
    sb.from('jobs').select('id, ro_number, vehicle').eq('org_id', org).eq('status', 'waiting_parts').limit(50),
    sb.from('jobs').select('id, ro_number, vehicle').eq('org_id', org).eq('status', 'complete').limit(50),
    sb.from('invoices').select('id, total, amount_paid').eq('org_id', org).eq('kind', 'invoice').in('status', ['unpaid', 'sent']).lt('due_date', today).limit(1000),
    sb.from('jobs').select('id').eq('org_id', org).eq('job_type', 'mobile').in('status', ['assigned', 'en_route', 'on_site', 'diagnosing', 'repairing']).limit(100),
    sb.from('stock_on_hand').select('item_id').eq('org_id', org).eq('low', true).limit(200)]);
  const n = r => (r.data || []).length;
  const owed = (overdue.data || []).reduce((t, i) => t + Number(i.total || 0) - Number(i.amount_paid || 0), 0);
  const items = [];
  if(n(waitAppr)) items.push({ tab:'shop-invoices', tone:'warn', text:`${n(waitAppr)} estimate${n(waitAppr) === 1 ? '' : 's'} waiting more than a day for approval`, sub:(waitAppr.data || []).slice(0, 3).map(d => (d.doc_number || '#' + d.id) + ' ' + (d.customer_name || '')).join(' · ') });
  if(n(parts)) items.push({ tab:'shop-jobs', tone:'warn', text:`${n(parts)} job${n(parts) === 1 ? '' : 's'} waiting for parts`, sub:(parts.data || []).slice(0, 3).map(j => (j.ro_number || '') + ' ' + (j.vehicle || '')).join(' · ') });
  if(n(done)) items.push({ tab:'shop-jobs', tone:'go', text:`${n(done)} completed job${n(done) === 1 ? '' : 's'} not invoiced yet`, sub:'Turn them into invoices to get paid.' });
  if(n(overdue)) items.push({ tab:'shop-invoices', tone:'bad', text:`${n(overdue)} overdue invoice${n(overdue) === 1 ? '' : 's'} · $${Math.round(owed).toLocaleString()} owed`, sub:'' });
  if(n(road)) items.push({ tab:'shop-dispatch', tone:'go', text:`${n(road)} road call${n(road) === 1 ? '' : 's'} live right now`, sub:'' });
  if(n(low)) items.push({ tab:'shop-inventory', tone:'warn', text:`${n(low)} part${n(low) === 1 ? '' : 's'} low on stock`, sub:'' });
  return items;
}
async function renderNatashaBriefing(force){
  const panel = document.getElementById('assistPanel'), log = document.getElementById('assistLog');
  if(!panel || !log || !session || session.role !== 'shop') return;
  const key = 'relay.brief.' + session.id, day = new Date().toISOString().slice(0, 10);
  let seen = null; try { seen = localStorage.getItem(key); } catch(_){}
  if(!force && seen === day) return;
  let box = document.getElementById('natBrief');
  if(!box){ box = document.createElement('div'); box.id = 'natBrief'; box.className = 'nat-brief'; log.parentNode.insertBefore(box, log); }
  box.innerHTML = '<p class="meta">Getting today\'s briefing…</p>';
  const items = await natashaBriefing();
  if(!items){ box.remove(); return; }
  const hour = new Date().getHours(), hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  box.innerHTML = `<div class="nat-brief-head"><b>${hello}${session.name ? ', ' + esc(String(session.name).split(' ')[0]) : ''}. Here's today:</b><button type="button" class="text-btn" id="natBriefClose" aria-label="Hide briefing">×</button></div>
    ${items.length ? items.map(i => `<button type="button" class="nat-item nat-${i.tone}" data-tab="${i.tab}"><span>${esc(i.text)}</span>${i.sub ? `<em>${esc(i.sub)}</em>` : ''}</button>`).join('') : '<p class="nat-clear">All clear — nothing is waiting on you right now.</p>'}`;
  box.querySelectorAll('.nat-item').forEach(b => b.onclick = () => { const t = document.querySelector(`.dash-tab[data-target="${b.dataset.tab}"]`); if(t) t.click(); document.getElementById('assistPanel').classList.add('hidden'); });
  document.getElementById('natBriefClose').onclick = () => box.remove();
  try { localStorage.setItem(key, day); } catch(_){}
}
function initNatasha(){
  const panel = document.getElementById('assistPanel'); if(!panel || panel._natWatch) return;
  panel._natWatch = new MutationObserver(() => { if(!panel.classList.contains('hidden')) renderNatashaBriefing(false); });
  panel._natWatch.observe(panel, { attributes:true, attributeFilter:['class'] });
  const head = panel.querySelector('.assist-head');
  if(head && !document.getElementById('natBriefBtn') && session && session.role === 'shop') head.insertAdjacentHTML('beforeend', '<button type="button" class="text-btn" id="natBriefBtn">Today\'s briefing</button>');
  const bb = document.getElementById('natBriefBtn'); if(bb) bb.onclick = () => renderNatashaBriefing(true);
}

// ---------------- Draft an estimate ----------------
async function natashaDraftEstimate(job, btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Natasha is drafting…'; }
  const reset = () => { if(btn){ btn.disabled = false; btn.textContent = 'Draft with Natasha'; } };
  try {
    const { data, error } = await sb.functions.invoke('assistant', { body: { mode:'draft_estimate', job_id: job.id } });
    let msg = data && data.error;
    if(error){ msg = error.message; try { const b = error.context && typeof error.context.json === 'function' ? await error.context.clone().json() : null; if(b && b.error) msg = b.error; } catch(_){} }
    if(msg){ alert(msg); return reset(); }
    if(!data.lines || !data.lines.length){ alert('Natasha couldn\'t suggest any lines from this diagnosis.' + (data.note ? '\n\n' + data.note : '')); return reset(); }
    const id = await newEstimateForJob(job, { open:false });
    if(!id) return reset();
    const { error: e2 } = await sb.rpc('replace_invoice_items', { p_invoice: id, p_items: data.lines.map(l => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, item_type: l.item_type, taxable: l.taxable, recommended_repair_id: null })) });
    if(e2){ alert('The draft was created but its lines could not be saved: ' + e2.message); }
    reset();
    if(typeof showWoTab === 'function') showWoTab('billing');
    await openEstimateEditor(id);
    const note = [data.note, (data.dropped || []).length ? 'Left out (not in your parts list or unclear): ' + data.dropped.join(', ') + '.' : ''].filter(Boolean).join(' ');
    recordsToast('Draft estimate ready — review it before sending');
    if(note){ const box = document.getElementById('estErr') || document.getElementById('estBody'); if(box) box.insertAdjacentHTML('afterbegin', `<div class="nat-note"><b>Natasha:</b> ${esc(note)}</div>`); }
  } catch(e){ alert(e.message || String(e)); reset(); }
}
document.addEventListener('click', (e) => { const b = e.target.closest('#woActDraft'); if(b && window.__woJob) natashaDraftEstimate(window.__woJob, b); });
