// ============================================================
// RelayFleet — Admin → Shops (migration 0058).
// Every shop in one list: archive (reversible) or restore it, and delete it permanently.
// Permanent delete needs the shop archived first, a preview of what will be removed,
// and the shop's exact name typed in. Nothing here changes a shop's data until confirmed.
// ============================================================

let adminShopsState = { rows: [], filter: '' };

function shopMetaLine(r){
  const bits = [r.contact_email || 'no email on file', r.people + ' user' + (r.people === 1 ? '' : 's')];
  if(r.voice_line === 'live') bits.push('AI line on');
  else if(r.voice_line === 'provisioning') bits.push('AI line setting up');
  return bits.join(' · ');
}

function shopStateBadge(r){
  if(r.archived) return '<span class="voice-off">Archived</span>';
  if(r.status === 'approved') return '<span class="voice-on">Approved</span>';
  return `<span class="meta">${esc(r.status || 'unknown')}</span>`;
}

function shopRowHtml(r){
  const aiBlocks = r.voice_line === 'live' || r.voice_line === 'provisioning';
  const archiveBtn = r.archived
    ? `<button type="button" class="ghost-btn" data-shop-restore="${esc(r.org_id)}">Restore</button>`
    : `<button type="button" class="ghost-btn" data-shop-archive="${esc(r.org_id)}" ${aiBlocks ? 'disabled title="Turn off the AI phone line first"' : ''}>Archive</button>`;
  const deleteBtn = `<button type="button" class="text-btn danger" data-shop-delete="${esc(r.org_id)}" ${r.archived ? '' : 'disabled title="Archive the shop first"'}>Delete permanently</button>`;
  return `<div class="voice-admin-row admin-shop-row" data-org="${esc(r.org_id)}" data-name="${esc(r.name)}">
    <div class="va-shop"><b>${esc(r.name)}</b> ${shopStateBadge(r)}<div class="meta">${esc(shopMetaLine(r))}</div>
      ${r.archived_at ? `<div class="meta">Archived ${esc(new Date(r.archived_at).toLocaleDateString('en-US'))}</div>` : ''}</div>
    <div class="va-actions">${archiveBtn}${deleteBtn}</div>
  </div>`;
}

async function renderAdminShops(){
  const box = document.getElementById('adminShopsBox');
  if(!box || !session || session.role !== 'admin') return;
  const { data, error } = await sb.rpc('admin_shops');
  if(error){ box.innerHTML = `<div class="section-head"><h2>Shops</h2></div><p class="form-error">${esc(error.message)}</p>`; return; }
  adminShopsState.rows = data || [];
  const q = adminShopsState.filter.trim().toLowerCase();
  const shown = adminShopsState.rows.filter(r => !q || (r.name || '').toLowerCase().includes(q) || (r.contact_email || '').toLowerCase().includes(q));
  const archived = adminShopsState.rows.filter(r => r.archived).length;
  box.innerHTML = `<div class="section-head"><h2>Shops</h2><span class="meta">${adminShopsState.rows.length} shop${adminShopsState.rows.length === 1 ? '' : 's'} · ${archived} archived</span></div>
    <p class="meta">Archive a shop to switch it off and hide it. Its people can't sign in until you restore it. To delete a shop for good, archive it first, then delete it and type its name.</p>
    <div class="field" style="max-width:320px; margin:12px 0;">
      <label for="adminShopsFilter">Find a shop</label>
      <input type="search" id="adminShopsFilter" value="${esc(adminShopsState.filter)}" placeholder="Name or email">
    </div>
    <div class="voice-admin-list">${shown.map(shopRowHtml).join('') || '<p class="meta">No shops match.</p>'}</div>`;

  const filterEl = document.getElementById('adminShopsFilter');
  filterEl.oninput = () => { adminShopsState.filter = filterEl.value; renderAdminShops(); };
  box.querySelectorAll('[data-shop-archive]').forEach(b => b.onclick = () => archiveShop(b.dataset.shopArchive, b.closest('.admin-shop-row').dataset.name));
  box.querySelectorAll('[data-shop-restore]').forEach(b => b.onclick = () => restoreShop(b.dataset.shopRestore, b.closest('.admin-shop-row').dataset.name));
  box.querySelectorAll('[data-shop-delete]').forEach(b => b.onclick = () => openDeleteShop(b.dataset.shopDelete, b.closest('.admin-shop-row').dataset.name));
}

async function archiveShop(orgId, name){
  if(!(await relayConfirm({ message: `Archive ${name}? Its people will be switched off and can't sign in until you restore the shop. Nothing is deleted.`, confirmText: 'Archive shop', danger: true }))) return;
  const { data, error } = await sb.rpc('admin_archive_shop', { p_org: orgId, p_archived: true });
  if(error){ relayFail(error, 'Could not archive the shop'); return; }
  recordsToast(`Archived. ${data.people_switched_off} people switched off.`); renderAdminShops();
}

async function restoreShop(orgId, name){
  if(!(await relayConfirm({ message: `Restore ${name}? Its people will be switched back on.`, confirmText: 'Restore shop' }))) return;
  const { data, error } = await sb.rpc('admin_archive_shop', { p_org: orgId, p_archived: false });
  if(error){ relayFail(error, 'Could not restore the shop'); return; }
  recordsToast(`Restored. ${data.people_switched_on} people switched back on.`); renderAdminShops();
}

// ---------- Permanent delete: preview, then type the exact name ----------
function openDeleteShop(orgId, name){
  const wrap = document.createElement('div');
  wrap.className = 'relay-dlg-backdrop';
  wrap.innerHTML = `<div class="relay-dlg relay-dlg-confirm" role="alertdialog" aria-modal="true" aria-labelledby="dsTitle">
    <h2 id="dsTitle">Delete ${esc(name)} permanently?</h2>
    <div id="dsImpact" class="meta">Checking what would be removed…</div>
    <p class="meta"><b>This cannot be undone.</b> Every job, invoice, customer, unit, payment and person linked to this shop will be removed. Login accounts stay in Supabase Auth and can be removed there.</p>
    <div class="field"><label for="dsName">Type the shop name to confirm: <b>${esc(name)}</b></label>
      <input type="text" id="dsName" autocomplete="off"></div>
    <p class="form-error" id="dsErr"></p>
    <div class="relay-dlg-actions"><button type="button" class="relay-dlg-no" id="dsCancel">Cancel</button><button type="button" class="relay-dlg-yes is-danger" id="dsGo" disabled>Delete permanently</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('#dsCancel').onclick = close;
  const nameEl = wrap.querySelector('#dsName'), go = wrap.querySelector('#dsGo'), err = wrap.querySelector('#dsErr');
  nameEl.oninput = () => { go.disabled = nameEl.value.trim() !== name.trim(); };

  sb.rpc('admin_shop_impact', { p_org: orgId }).then(({ data, error }) => {
    const el = wrap.querySelector('#dsImpact');
    if(error){ el.textContent = 'Could not check: ' + error.message; return; }
    const total = (data || []).reduce((s, t) => s + Number(t.rows || 0), 0);
    el.innerHTML = total
      ? `Would remove ${total} row${total === 1 ? '' : 's'} across ${(data || []).length} table${(data || []).length === 1 ? '' : 's'}: ` +
        (data || []).map(t => `${esc(String(t.table).replace(/^public\./, ''))} (${t.rows})`).join(', ') + '.'
      : 'Nothing is linked to this shop except the shop itself.';
  });

  go.onclick = async () => {
    go.disabled = true; err.textContent = '';
    const { data, error } = await sb.rpc('admin_delete_shop', { p_org: orgId, p_confirm_name: nameEl.value });
    if(error){ err.textContent = error.message; go.disabled = false; return; }
    close();
    recordsToast(`${data.deleted} deleted (${data.rows_removed} rows removed).`);
    renderAdminShops();
  };
  nameEl.focus();
}

document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="admin-shops"]')) setTimeout(renderAdminShops, 0); });
