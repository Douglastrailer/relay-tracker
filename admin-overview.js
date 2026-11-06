// ============================================================
// RelayFleet — Admin → Overview (2026 layout) and lazy loading of admin screens.
//
// Only the screen that is open loads. Opening a tab loads that tab, the 2-minute
// refresh and live updates refresh only the open tab, and nothing else is fetched
// until someone opens it. Overview = KPI row, Shops beside AI phone lines,
// "Needs your attention", then the map and billing.
// ============================================================

function adminActiveTab(){
  const t = document.querySelector('#adminView .dash-tab.active');
  return t ? t.dataset.target : 'admin-overview';
}

// Every admin screen's loader. Shops and AI phone lines wire their own tab clicks
// (admin-console.js, voice-admin.js), so they are not listed here.
async function runAdminTabLoad(tab){
  if(!session || session.role !== 'admin') return;
  switch(tab){
    case 'admin-overview':
      await Promise.all([
        loadAdminOverview(),
        typeof renderAdminShopMap === 'function' ? renderAdminShopMap() : null,
        typeof renderShopUsage === 'function' ? renderShopUsage() : null,
        typeof renderAdminPlans === 'function' ? renderAdminPlans() : null
      ]);
      return;
    case 'admin-subs':     if(typeof renderSubscriptions === 'function') return renderSubscriptions(); return;
    case 'admin-settings': if(typeof renderAdminSettings === 'function') return renderAdminSettings(); return;
    case 'admin-feedback': if(typeof renderAdminFeedback === 'function') return renderAdminFeedback(); return;
    case 'admin-accounts':
    case 'admin-requests':
    case 'admin-jobs':
      return refreshAdminData();   // people screens: script.js
    default: return;
  }
}

async function loadAdminOverview(){
  const stats = document.getElementById('adminStats'); if(!stats) return;
  const [att, shops, activeRes] = await Promise.all([
    sb.rpc('admin_attention'),
    sb.rpc('admin_shops'),
    sb.from('jobs').select('*', { count:'exact', head:true }).not('status', 'in', '(' + CLOSED_STATUSES.join(',') + ')')
  ]);
  if(shops.error){
    stats.innerHTML = `<p class="form-error">Could not load the overview: ${esc(shops.error.message)}</p>`;
    return;
  }
  // admin_attention comes from migration 0059. Until it is run, the counts below show 0 and the note says why.
  const a = att.error ? null : (att.data || {});
  const rows = shops.data || [];
  const active = rows.filter(r => !r.archived);
  const approved = active.filter(r => r.status === 'approved');
  const pending = (a && a.pending_requests) || [];
  const failed = (a && a.failed_lines) || [];
  const linesOn = (a && a.lines_on) || [];
  const busy = (a && a.lines_busy) || 0;
  const overdue = (a && a.overdue) || [];
  const overdueCount = (a && a.overdue_count) || 0;
  const overdueTotal = Number((a && a.overdue_total) || 0);
  const attentionCount = pending.length + failed.length + overdueCount;

  stats.innerHTML = `
    <div class="stat-box"><b>${approved.length}</b><span>Shops approved</span></div>
    <div class="stat-box"><b>${linesOn.length}</b><span>AI phone lines on</span></div>
    <div class="stat-box"><b>${activeRes.count || 0}</b><span>Active jobs</span></div>
    <div class="stat-box"><b>${attentionCount}</b><span>Needs your attention</span></div>`;
  if(att.error){
    stats.insertAdjacentHTML('afterend', `<p class="meta admin-ov-note">Run migration 0059 to see requests, failed lines and overdue invoices. (${esc(att.error.message || 'error')})</p>`);
  }

  const reqBadge = document.getElementById('requestsBadge');
  if(reqBadge){
    if(pending.length){ reqBadge.textContent = pending.length; reqBadge.classList.remove('hidden'); }
    else reqBadge.classList.add('hidden');
  }

  renderOverviewShops(active, rows.length - active.length);
  renderOverviewLines(linesOn, busy, failed);
  renderOverviewAttention({ pending, failed, overdue, overdueCount, overdueTotal, total: attentionCount });
  wireOverviewGo();
}

function overviewLineLabel(voiceLine){
  if(voiceLine === 'live') return '<span class="voice-on">On</span>';
  if(voiceLine === 'provisioning') return '<span class="meta">Setting up</span>';
  if(voiceLine === 'failed') return '<span class="voice-off">Failed</span>';
  return '<span class="meta">Off</span>';
}

function renderOverviewShops(active, archivedCount){
  const box = document.getElementById('adminOvShops'); if(!box) return;
  const shown = active.slice(0, 10);
  box.innerHTML = `<div class="section-head"><h2>Shops</h2>
      <span class="meta">${active.length} active${archivedCount ? ' · ' + archivedCount + ' archived' : ''}</span>
      <button type="button" class="ghost-btn" data-go="admin-shops">All shops</button></div>
    <div class="cw-wrap"><table class="cw-table"><thead><tr><th>Shop</th><th>Status</th><th>AI line</th><th>People</th></tr></thead><tbody>
      ${shown.map(r => `<tr><td><b>${esc(r.name)}</b><div class="meta">${esc(r.contact_email || 'no email on file')}</div></td>
        <td>${shopStateBadge(r)}</td><td>${overviewLineLabel(r.voice_line)}</td><td>${Number(r.people) || 0}</td></tr>`).join('')
        || '<tr><td colspan="4" class="meta">No shops yet.</td></tr>'}
    </tbody></table></div>`;
}

function renderOverviewLines(linesOn, busy, failed){
  const box = document.getElementById('adminOvLines'); if(!box) return;
  box.innerHTML = `<div class="section-head"><h2>AI phone lines</h2>
      <span class="meta">${linesOn.length} on${busy ? ' · ' + busy + ' setting up' : ''}${failed.length ? ' · ' + failed.length + ' failed' : ''}</span>
      <button type="button" class="ghost-btn" data-go="admin-lines">Manage</button></div>
    <div class="voice-admin-list">
      ${linesOn.map(l => `<div class="voice-admin-row"><div class="va-shop"><b>${esc(l.name)}</b> <span class="voice-on">on</span></div></div>`).join('')
        || '<p class="meta">No AI phone line is on right now.</p>'}
    </div>`;
}

function renderOverviewAttention({ pending, failed, overdue, overdueCount, overdueTotal, total }){
  const box = document.getElementById('adminOvAttention'); if(!box) return;
  const items = [
    ...pending.map(p => ({ tone:'warn', text:`${p.name} asked to join Relay`, action:'Review', go:'admin-requests' })),
    ...failed.map(f => ({ tone:'danger', text:`${f.name}: the AI phone line failed to set up`, action:'Open AI phone lines', go:'admin-lines' })),
    ...overdue.slice(0, 10).map(o => ({ tone:'warn',
      text:`${o.shop}: ${o.customer} owes $${Number(o.total).toFixed(2)} on ${o.doc_number || 'an invoice'}, ${o.days_late} day${o.days_late === 1 ? '' : 's'} late` }))
  ];
  const more = overdueCount > 10 ? `<div class="att-row"><span class="att-dot"></span><div class="att-text meta">${overdueCount - 10} more overdue · $${overdueTotal.toFixed(2)} in total</div></div>` : '';
  box.innerHTML = `<div class="section-head"><h2>Needs your attention</h2><span class="meta">${total} item${total === 1 ? '' : 's'}</span></div>
    <div class="att-box">
      ${items.map(i => `<div class="att-row"><span class="att-dot ${i.tone}"></span><div class="att-text">${esc(i.text)}</div>
        ${i.action ? `<button type="button" class="ghost-btn" data-go="${i.go}">${esc(i.action)}</button>` : ''}</div>`).join('')}
      ${more}
      ${items.length || more ? '' : '<div class="att-row"><span class="att-dot ok"></span><div class="att-text meta">Nothing needs you right now.</div></div>'}
    </div>`;
}

// "All shops", "Manage", "Review" buttons open the matching admin tab.
function wireOverviewGo(){
  document.querySelectorAll('#admin-overview [data-go]').forEach(b => b.onclick = () => {
    const tab = document.querySelector(`#adminView .dash-tab[data-target="${b.dataset.go}"]`);
    if(tab) tab.click();
  });
}

// Opening any admin tab loads only that screen.
document.addEventListener('click', e => {
  const tab = e.target.closest && e.target.closest('#adminView .dash-tab');
  if(!tab) return;
  setTimeout(() => runAdminTabLoad(tab.dataset.target), 0);
});
