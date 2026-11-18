// ============================================================
// RelayFleet — Admin → Shops: archive, restore and permanent delete (migration 0058).
// The table itself is drawn by admin-shops.js; these are the actions its rows call.
// Permanent delete needs the shop archived first, a preview of what will be removed,
// and the shop's exact name typed in. Nothing here changes a shop's data until confirmed.
// ============================================================

// A shop's state in a word (the Overview's shop list uses it).
function shopStateBadge(r){
  if(r.archived) return '<span class="voice-off">Archived</span>';
  if(r.status === 'approved') return '<span class="voice-on">Approved</span>';
  return `<span class="meta">${esc(r.status || 'unknown')}</span>`;
}

// The Shops screen is the shared shop table (admin-shops.js): every control on one row.
async function renderAdminShops(){
  if(typeof renderShopTable === 'function') return renderShopTable('adminShopsBox');
}
const shopsChanged = () => (typeof refreshShopTables === 'function' ? refreshShopTables() : renderAdminShops());

async function archiveShop(orgId, name){
  if(!(await relayConfirm({ message: `Archive ${name}? Its people will be switched off and can't sign in until you restore the shop. Nothing is deleted.`, confirmText: 'Archive shop', danger: true }))) return;
  const { data, error } = await sb.rpc('admin_archive_shop', { p_org: orgId, p_archived: true });
  if(error){ relayFail(error, 'Could not archive the shop'); return; }
  recordsToast(`Archived. ${data.people_switched_off} people switched off.`); shopsChanged();
}

async function restoreShop(orgId, name){
  if(!(await relayConfirm({ message: `Restore ${name}? Its people will be switched back on.`, confirmText: 'Restore shop' }))) return;
  const { data, error } = await sb.rpc('admin_archive_shop', { p_org: orgId, p_archived: false });
  if(error){ relayFail(error, 'Could not restore the shop'); return; }
  recordsToast(`Restored. ${data.people_switched_on} people switched back on.`); shopsChanged();
}

// ---------- Permanent delete: preview, then type the exact name ----------
// An active shop is archived first (after a confirm), then the permanent-delete dialog opens.
async function openDeleteShop(orgId, name, archived){
  if(!archived){
    if(!(await relayConfirm({ message: `${name} is active. Archive it now and then delete it? Its people will be switched off first.`, confirmText: 'Archive and continue', danger: true }))) return;
    const { error } = await sb.rpc('admin_archive_shop', { p_org: orgId, p_archived: true });
    if(error){ relayFail(error, 'Could not archive the shop'); return; }
    shopsChanged();
  }
  openDeleteShopDialog(orgId, name);
}
function openDeleteShopDialog(orgId, name){
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
    shopsChanged();
  };
  nameEl.focus();
}

document.addEventListener('click', e => { if(e.target.closest && e.target.closest('.dash-tab[data-target="admin-shops"]')) setTimeout(renderAdminShops, 0); });
