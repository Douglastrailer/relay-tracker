// ============================================================
// RelayFleet — R7 Profitability: profit per job, customer and mechanic.
// Numbers come from job_profit() in the database (migration 0024).
// Technician costs (pay) are set in Settings and never shown to mechanics.
// ============================================================
const pfMoney = n => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits:0 });
const pfPct = n => n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits:1 }) + '%';
let pfState = { data:null };

async function refreshProfit(rg){
  const root = document.getElementById('anRoot');
  if(!root || !rg || !(typeof can !== 'function' || can('analytics'))) return;
  let box = document.getElementById('profitBox');
  if(!box){ box = document.createElement('div'); box.id = 'profitBox'; box.className = 'section'; root.appendChild(box); }
  box.innerHTML = '<div class="section-head"><h2>Profitability</h2></div><p class="meta">Calculating…</p>';
  const loc = typeof currentLocationId === 'function' ? currentLocationId() : null;
  const { data, error } = await sb.rpc('job_profit', loc ? { p_from: rg.from.toISOString(), p_to: rg.to.toISOString(), p_location: loc } : { p_from: rg.from.toISOString(), p_to: rg.to.toISOString() });
  if(error){ box.innerHTML = `<div class="section-head"><h2>Profitability</h2></div><p class="form-error">${esc(error.message)}</p>`; return; }
  pfState.data = data;
  renderProfit();
}
function renderProfit(){
  const box = document.getElementById('profitBox'), d = pfState.data;
  if(!box || !d) return;
  const s = d.summary || {};
  const tile = (label, value, sub, cls) => `<div class="an-tile${cls ? ' ' + cls : ''}"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  const notes = [];
  if(s.rate_missing) notes.push('Some technicians have no cost per hour, so their labor counts as free. <button type="button" class="text-btn" id="pfGoSettings">Set technician costs</button>');
  if(Number(s.parts_cost_unknown_jobs) > 0) notes.push(`${s.parts_cost_unknown_jobs} job${s.parts_cost_unknown_jobs === 1 ? '' : 's'} billed parts that weren't recorded on the work order, so their parts cost is unknown and their profit is overstated. Add parts to work orders to fix this going forward.`);
  const table = (key, title, heads, rows, empty) => `<div class="an-block"><div class="section-head"><h3>${title}</h3>${rows.length ? `<button type="button" class="text-btn" data-pfcsv="${key}">Download CSV</button>` : ''}</div>
    ${rows.length ? `<div class="an-scroll"><table class="an-table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<p class="meta">${empty}</p>`}</div>`;
  const mcls = m => m == null ? '' : Number(m) < 15 ? 'neg' : Number(m) >= 40 ? 'pos' : '';
  box.innerHTML = `<div class="section-head"><h2>Profitability</h2><span class="meta">${Number(s.jobs || 0).toLocaleString()} invoiced jobs · revenue excludes sales tax</span></div>
    ${notes.map(n => `<div class="pf-note">${n}</div>`).join('')}
    <div class="an-tiles">
      ${tile('Gross profit', pfMoney(s.profit), 'margin ' + pfPct(s.margin_pct), Number(s.profit) < 0 ? 'neg' : '')}
      ${tile('Revenue', pfMoney(s.revenue), 'labor ' + pfMoney(s.labor_rev) + ' · parts ' + pfMoney(s.parts_rev))}
      ${tile('Parts margin', pfPct(s.parts_margin_pct), 'parts cost ' + pfMoney(s.parts_cost))}
      ${tile('Labor cost', pfMoney(s.labor_cost), (s.worked_h || 0) + ' h worked · ' + (s.drive_h || 0) + ' h driving')}
      ${tile('Labor recovery', s.recovery_pct == null ? '—' : s.recovery_pct + '%', (s.billed_h || 0) + ' h billed of ' + (s.worked_h || 0) + ' h worked', s.recovery_pct != null && s.recovery_pct < 85 ? 'neg' : '')}
    </div>
    ${(d.locations || []).length > 1 ? table('locations', 'By location', ['Location','Jobs','Revenue','Cost','Profit','Margin'],
      d.locations.map(l => `<tr><td>${esc(l.name)}</td><td>${l.jobs}</td><td>${pfMoney(l.revenue)}</td><td>${pfMoney(l.cost)}</td><td><b>${pfMoney(l.profit)}</b></td><td class="${mcls(l.margin_pct)}">${pfPct(l.margin_pct)}</td></tr>`), '') : ''}
    ${table('customers', 'By customer', ['Customer','Jobs','Revenue','Cost','Profit','Margin'],
      (d.customers || []).map(c => `<tr><td>${esc(c.name)}</td><td>${c.jobs}</td><td>${pfMoney(c.revenue)}</td><td>${pfMoney(c.cost)}</td><td><b>${pfMoney(c.profit)}</b></td><td class="${mcls(c.margin_pct)}">${pfPct(c.margin_pct)}</td></tr>`), 'No invoiced work in this period.')}
    ${table('technicians', 'By technician', ['Technician','Jobs','Worked','Billed','Recovery','Labor revenue','Labor cost','Labor profit'],
      (d.technicians || []).map(t => `<tr><td>${esc(t.name || '—')}${t.rate_missing ? ' <span class="rec-tag">no cost set</span>' : ''}</td><td>${t.jobs}</td><td>${t.worked_h} h</td><td>${t.billed_h} h</td><td class="${t.recovery_pct != null && t.recovery_pct < 85 ? 'neg' : ''}">${t.recovery_pct == null ? '—' : t.recovery_pct + '%'}</td><td>${pfMoney(t.labor_rev)}</td><td>${pfMoney(t.labor_cost)}</td><td><b>${pfMoney(t.labor_profit)}</b></td></tr>`), 'No labor time in this period.')}
    ${table('least', 'Least profitable jobs', ['Work order','Customer','Unit','Job','Revenue','Cost','Profit','Margin'],
      (d.least_profitable || []).map(j => `<tr class="pf-job" data-job="${j.id}"><td><span class="ro-num">${esc(j.ro_number || '#' + j.id)}</span></td><td>${esc(j.customer || '')}</td><td>${esc(j.vehicle || '')}</td><td>${esc(j.complaint || '')}${j.parts_cost_unknown ? ' <span class="rec-tag">parts cost unknown</span>' : ''}</td><td>${pfMoney(j.revenue)}</td><td>${pfMoney(j.cost)}</td><td><b class="${Number(j.profit) < 0 ? 'neg' : ''}">${pfMoney(j.profit)}</b></td><td class="${mcls(j.margin_pct)}">${pfPct(j.margin_pct)}</td></tr>`), 'No invoiced work in this period.')}`;
  box.querySelectorAll('.pf-job').forEach(r => r.onclick = () => openRepairOrder(Number(r.dataset.job)));
  box.querySelectorAll('[data-pfcsv]').forEach(b => b.onclick = () => downloadProfitCsv(b.dataset.pfcsv));
  const gs = document.getElementById('pfGoSettings'); if(gs) gs.onclick = () => { const t = document.querySelector('.dash-tab[data-target="shop-billing"]'); if(t) t.click(); };
}
function downloadProfitCsv(key){
  const d = pfState.data || {};
  const rows = key === 'locations' ? [['Location','Jobs','Revenue','Cost','Profit','Margin %']].concat((d.locations || []).map(l => [l.name, l.jobs, l.revenue, l.cost, l.profit, l.margin_pct]))
    : key === 'customers' ? [['Customer','Jobs','Revenue','Cost','Profit','Margin %']].concat((d.customers || []).map(c => [c.name, c.jobs, c.revenue, c.cost, c.profit, c.margin_pct]))
    : key === 'technicians' ? [['Technician','Jobs','Worked h','Drive h','Billed h','Recovery %','Labor revenue','Labor cost','Labor profit']].concat((d.technicians || []).map(t => [t.name, t.jobs, t.worked_h, t.drive_h, t.billed_h, t.recovery_pct, t.labor_rev, t.labor_cost, t.labor_profit]))
    : [['Work order','Customer','Unit','Job','Revenue','Cost','Profit','Margin %','Parts cost unknown']].concat((d.least_profitable || []).map(j => [j.ro_number, j.customer, j.vehicle, j.complaint, j.revenue, j.cost, j.profit, j.margin_pct, j.parts_cost_unknown ? 'yes' : '']));
  downloadCsv('relay-profit-' + key + '.csv', rows);
}

// ================= Settings: technician costs =================
async function renderTechCosts(){
  const box = document.getElementById('techCostBox');
  if(!box || !(typeof can !== 'function' || can('settings'))) return;
  const [o, people, costs] = await Promise.all([
    sb.from('organizations').select('tech_cost_rate').eq('id', session.orgId).maybeSingle(),
    sb.from('profiles').select('id, name, role').eq('org_id', session.orgId).eq('active', true).in('role', ['mechanic']).order('name'),
    sb.from('tech_costs').select('profile_id, hourly_cost').eq('org_id', session.orgId)]);
  const cost = id => { const c = (costs.data || []).find(x => x.profile_id === id); return c ? c.hourly_cost : ''; };
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Technician costs</h2></div><div class="card new-job-form" style="max-width:640px;">
    <p class="meta" style="margin-top:0;">What a technician costs you per hour (wage plus payroll taxes and benefits). Used only for profit in Reports; mechanics never see it.</p>
    <div class="field"><label>Shop default cost per hour ($)</label><input type="number" id="tcDefault" min="0" max="1000" step="0.01" value="${o.data && o.data.tech_cost_rate != null ? o.data.tech_cost_rate : ''}" placeholder="e.g. 38.00"></div>
    ${(people.data || []).map(p => `<div class="ro-inv tc-row"><span>${esc(p.name)}</span><input type="number" min="0" max="1000" step="0.01" data-tc="${p.id}" value="${cost(p.id)}" placeholder="default" aria-label="Cost per hour for ${esc(p.name)}"></div>`).join('') || '<p class="meta">No mechanics yet.</p>'}
    <p class="form-error" id="tcErr"></p><div class="job-actions"><button type="button" id="tcSave">Save costs</button></div></div>`;
  document.getElementById('tcSave').onclick = async () => {
    const err = document.getElementById('tcErr'); err.textContent = '';
    const dv = document.getElementById('tcDefault').value;
    const rate = dv === '' ? null : Number(dv);
    if(rate != null && !(rate >= 0 && rate <= 1000)){ err.textContent = 'Enter a cost between $0 and $1,000 an hour.'; return; }
    const r1 = await sb.from('organizations').update({ tech_cost_rate: rate }).eq('id', session.orgId);
    if(r1.error){ err.textContent = r1.error.message; return; }
    for(const inp of document.querySelectorAll('#techCostBox [data-tc]')){
      const v = inp.value === '' ? null : Number(inp.value);
      if(String(v ?? '') === String(cost(inp.dataset.tc) === '' ? '' : Number(cost(inp.dataset.tc)))) continue;
      const { error } = await sb.rpc('set_tech_cost', { p_profile: inp.dataset.tc, p_rate: v });
      if(error){ err.textContent = error.message; return; }
    }
    recordsToast('Technician costs saved'); renderTechCosts();
  };
}
function initProfitUI(){
  const st = document.getElementById('notifySettings');
  if(st && !document.getElementById('techCostBox')){ st.insertAdjacentHTML('afterend', '<div id="techCostBox"></div>'); }
  document.querySelectorAll('.dash-tab[data-target="shop-billing"]').forEach(t => t.addEventListener('click', renderTechCosts));
  renderTechCosts();
}
