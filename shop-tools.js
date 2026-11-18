// ============================================================
// RelayFleet — shop tools (migration 0065):
//   * delete any estimate or invoice (drafts, sent, unpaid, paid), with a clear warning,
//   * print estimates, invoices and work orders,
//   * a search box over the parts list wherever a price list dropdown appears.
// ============================================================

// ---------- Delete an estimate or invoice ----------
async function deleteDocument(id, info){
  let d = info && info.status ? info : null;
  if(!d){ const { data } = await sb.from('invoices').select('id, kind, status, doc_number, total, amount_paid').eq('id', id).maybeSingle(); d = data; }
  if(!d){ relayNotice('That document no longer exists.'); return false; }
  const est = d.kind === 'estimate';
  const label = (est ? 'estimate ' : 'invoice ') + (d.doc_number || '#' + d.id);
  const paid = Number(d.amount_paid || 0);
  const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let msg = `Delete ${label}? This cannot be undone.`;
  if(!est && paid > 0) msg = `Delete ${label}? It has ${money(paid)} in recorded payments. Those payment records are deleted with it, and your reports will no longer count them. This cannot be undone.`;
  else if(d.status && d.status !== 'draft') msg = `Delete ${label}? The customer may already have a copy, and ${est ? 'their approval link' : 'their link'} will stop working. This cannot be undone.`;
  if(!(await relayConfirm({ title: 'Delete ' + (est ? 'estimate' : 'invoice'), message: msg, confirmText: 'Delete', danger: true }))) return false;
  const { data, error } = await sb.rpc('delete_document', { p_id: id });
  if(error){
    const missing = /delete_document|schema cache|does not exist/i.test(error.message || '');
    if(missing && d.status === 'draft'){   // before the database update, drafts can still go the old way
      const r = await sb.from('invoices').delete().eq('id', id);
      if(r.error){ relayFail(r.error, 'Could not delete'); return false; }
    } else {
      if(missing) relayNotice('Deleting sent or paid documents needs the database update 0065_shop_control.sql. Ask Relay to run it.', { kind: 'error' });
      else relayFail(error, 'Could not delete');
      return false;
    }
  }
  if(typeof recordsToast === 'function') recordsToast(`${est ? 'Estimate' : 'Invoice'} ${d.doc_number || ''} deleted`.replace('  ', ' '));
  if(typeof refreshCurrentView === 'function') refreshCurrentView();
  return true;
}

// ---------- Printing ----------
const relayIsPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''));

// Prints a PDF. Computers: the print dialog opens straight away. Phones and tablets: the share sheet,
// which has Print (iPhone and iPad cannot print a PDF from inside a web page).
async function printPdfBlob(blob, fileName){
  if(relayIsPhone()){
    const file = typeof File === 'function' ? new File([blob], fileName || 'document.pdf', { type: 'application/pdf' }) : null;
    if(file && navigator.canShare && navigator.canShare({ files: [file] })){ try { await navigator.share({ files: [file], title: fileName }); } catch(_){} return; }
    const url = URL.createObjectURL(blob); window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 60000); return;
  }
  const url = URL.createObjectURL(blob);
  const old = document.getElementById('relayPrintFrame'); if(old) old.remove();
  const f = document.createElement('iframe');
  f.id = 'relayPrintFrame'; f.title = 'Print'; f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
  f.onload = () => { setTimeout(() => {
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch(_){ window.open(url, '_blank'); }   // a browser that will not print a framed PDF: open it, print from there
  }, 250); };
  f.src = url; document.body.appendChild(f);
  setTimeout(() => { URL.revokeObjectURL(url); f.remove(); }, 10 * 60 * 1000);
}

// The PDF for one estimate or invoice, made by the server (the same one the customer gets).
async function fetchDocumentPdf(invoiceId){
  const { data: { session: s } } = await sb.auth.getSession();
  if(!s) throw new Error('Your session expired. Refresh and sign in again.');
  const [res, meta] = await Promise.all([
    fetch(`${SUPABASE_URL}/functions/v1/get-invoice-pdf?invoiceId=${invoiceId}`, { headers: { Authorization: `Bearer ${s.access_token}`, apikey: SUPABASE_KEY } }),
    sb.from('invoices').select('id, kind, doc_number').eq('id', invoiceId).maybeSingle()]);
  if(!res.ok){ const b = await res.json().catch(() => ({})); throw new Error(b.error || res.statusText || 'The PDF could not be made.'); }
  const d = (meta && meta.data) || { id: invoiceId };
  return { blob: await res.blob(), label: (d.kind === 'estimate' ? 'Estimate ' : 'Invoice ') + (d.doc_number || '#' + invoiceId), fileName: (d.doc_number || ((d.kind || 'invoice') + '-' + invoiceId)) + '.pdf' };
}

async function printDocument(invoiceId){
  if(typeof recordsToast === 'function') recordsToast('Getting it ready to print…');
  try { const p = await fetchDocumentPdf(invoiceId); await printPdfBlob(p.blob, p.fileName); }
  catch(e){ relayNotice('Could not print: ' + (e && e.message ? e.message : String(e)), { kind: 'error' }); }
}

// Prints any HTML as its own clean page (work orders), with everything else on screen hidden.
function printHtml(html, title){
  let root = document.getElementById('relayPrintRoot');
  if(!root){ root = document.createElement('div'); root.id = 'relayPrintRoot'; document.body.appendChild(root); }
  root.innerHTML = html;
  const oldTitle = document.title; if(title) document.title = title;   // the browser uses it as the file name for "Save as PDF"
  document.body.classList.add('printing-doc');
  const done = () => { document.body.classList.remove('printing-doc'); root.innerHTML = ''; document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(() => { if(document.body.classList.contains('printing-doc')) done(); }, 1500); }, 60);
}

// ---------- Work order: a printable sheet for the shop floor or the customer ----------
async function printWorkOrder(jobId){
  if(typeof recordsToast === 'function') recordsToast('Getting the work order ready…');
  const e = typeof esc === 'function' ? esc : (s => String(s == null ? '' : s));
  const { data: job, error } = await sb.from('jobs').select(typeof JOB_COLUMNS === 'string' ? JOB_COLUMNS : '*').eq('id', jobId).maybeSingle();
  if(error || !job){ relayFail(error || 'This work order could not be loaded.', 'Could not print'); return; }
  const [cust, unit, parts, org, loc, mech, docs, recs] = await Promise.all([
    job.customer_id ? sb.from('customers').select('company_name, contact_name, phone, email, billing_address').eq('id', job.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    job.unit_id ? sb.from('units').select('unit_number, unit_type, vin, year, make, model, plate, plate_state, odometer').eq('id', job.unit_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('job_parts').select('qty, returned_qty, unit_price, inventory_items(name, part_number)').eq('job_id', jobId),
    sb.from('organizations').select('name, billing_address, billing_phone, billing_email, logo_path').eq('id', job.org_id).maybeSingle(),
    job.location_id ? sb.from('shop_locations').select('display_name, name, address, phone, email, logo_path').eq('id', job.location_id).maybeSingle() : Promise.resolve({ data: null }),
    job.mechanic_id ? sb.from('profiles').select('name').eq('id', job.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('invoices').select('kind, doc_number, status, total').eq('job_id', jobId).order('created_at'),
    sb.from('recommended_repairs').select('description, severity, status').eq('job_id', jobId)
  ]);
  const o = org.data || {}, l = loc.data || {}, c = cust.data, u = unit.data;
  const shopName = l.display_name || o.name || 'Repair shop';
  const logo = (l.logo_path || o.logo_path) && typeof billingLogoPublicUrl === 'function' ? billingLogoPublicUrl(l.logo_path || o.logo_path) : '';
  const fmt = d => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const unitLine = u ? [u.unit_number ? 'Unit ' + u.unit_number : '', [u.year, u.make, u.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : (job.vehicle || '');
  const unitFacts = u ? [u.vin ? 'VIN ' + u.vin : '', u.plate ? 'Plate ' + u.plate + (u.plate_state ? ' ' + u.plate_state : '') : '', (job.odometer || u.odometer) != null ? Number(job.odometer || u.odometer).toLocaleString() + ' mi' : ''].filter(Boolean).join(' · ') : '';
  const partRows = (parts.data || []).map(p => ({ n: p.inventory_items || {}, q: Number(p.qty) - Number(p.returned_qty || 0) })).filter(p => p.q > 0);
  const status = String(job.status || '').replace(/_/g, ' ');
  const blank = n => Array.from({ length: n }, () => '<div class="pw-line"></div>').join('');
  const html = `<article class="pw-sheet">
    <header class="pw-head">
      <div class="pw-shop">${logo ? `<img src="${e(logo)}" alt="" class="pw-logo">` : ''}<div><b>${e(shopName)}</b>
        <div>${e(l.address || o.billing_address || '')}</div><div>${e([l.phone || o.billing_phone, l.email || o.billing_email].filter(Boolean).join(' · '))}</div></div></div>
      <div class="pw-doc"><div class="pw-kind">WORK ORDER</div><div class="pw-num">${e(job.ro_number || '#' + job.id)}</div>
        <div>Opened ${e(fmt(job.created_at))}</div>${job.completed_at ? `<div>Completed ${e(fmt(job.completed_at))}</div>` : ''}<div>Status: ${e(status)}</div></div>
    </header>
    <section class="pw-grid">
      <div class="pw-box"><h4>Customer</h4><b>${e(c ? c.company_name : job.customer)}</b>
        ${c ? `<div>${e([c.contact_name, c.phone].filter(Boolean).join(' · '))}</div><div>${e(c.email || '')}</div>` : ''}</div>
      <div class="pw-box"><h4>Unit</h4><b>${e(unitLine || '—')}</b><div>${e(unitFacts)}</div>
        <div>${job.job_type === 'inshop' ? 'In shop' : 'Roadside'}${mech.data ? ' · Technician: ' + e(mech.data.name) : ''}</div></div>
    </section>
    <section class="pw-box"><h4>Complaint</h4><p>${e(job.complaint || '') || '&nbsp;'}</p>${job.complaint ? '' : blank(2)}</section>
    <section class="pw-box"><h4>Cause and correction</h4><p>${e(job.diagnosis || '')}</p>${job.fault_codes ? `<p><b>Fault codes:</b> ${e(Array.isArray(job.fault_codes) ? job.fault_codes.join(', ') : job.fault_codes)}</p>` : ''}${job.diagnosis ? '' : blank(4)}</section>
    <section class="pw-box"><h4>Parts</h4>
      <table class="pw-table"><thead><tr><th>Part</th><th>Part #</th><th class="num">Qty</th></tr></thead><tbody>
        ${partRows.length ? partRows.map(p => `<tr><td>${e(p.n.name || 'Part')}</td><td>${e(p.n.part_number || '')}</td><td class="num">${p.q}</td></tr>`).join('') : '<tr><td>&nbsp;</td><td></td><td></td></tr><tr><td>&nbsp;</td><td></td><td></td></tr><tr><td>&nbsp;</td><td></td><td></td></tr>'}
      </tbody></table></section>
    ${(recs.data || []).length ? `<section class="pw-box"><h4>Recommended repairs</h4><ul>${recs.data.map(r => `<li>${e(r.description)}${r.severity ? ' (' + e(r.severity) + ')' : ''} — ${e(r.status)}</li>`).join('')}</ul></section>` : ''}
    ${(docs.data || []).length ? `<section class="pw-box"><h4>Estimates and invoices</h4><div>${docs.data.map(d => `${d.kind === 'estimate' ? 'Estimate' : 'Invoice'} ${e(d.doc_number || '')} · ${e(d.status)} · $${Number(d.total || 0).toFixed(2)}`).join('<br>')}</div></section>` : ''}
    <section class="pw-sign">
      <div><div class="pw-line"></div>Technician signature &amp; date</div>
      <div><div class="pw-line"></div>Customer signature &amp; date</div>
    </section>
    <footer class="pw-foot">Printed ${e(fmt(new Date()))} from Relay</footer>
  </article>`;
  printHtml(html, 'Work order ' + (job.ro_number || job.id));
}

// ---------- A search box over a parts / price list dropdown ----------
// Wraps a <select> whose options are parts. Typing filters by name, part number, brand or any
// extra words in the option's data-search. Picking one sets the select and fires "change",
// so whatever already listens to the select keeps working.
function relaySearchableSelect(sel, opts){
  if(!sel || sel.dataset.searchable === 'on') return;
  opts = opts || {};
  const items = [...sel.options].filter(o => o.value).map(o => ({ value: o.value, label: o.textContent.trim(), sub: o.dataset.sub || '', hay: (o.textContent + ' ' + (o.dataset.search || '')).toLowerCase() }));
  if(!items.length) return;
  sel.dataset.searchable = 'on';
  const wrap = document.createElement('div'); wrap.className = 'rss';
  const lid = 'rss' + Math.random().toString(36).slice(2, 8);
  wrap.innerHTML = `<svg class="rss-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" class="rss-in" role="combobox" aria-expanded="false" aria-controls="${lid}" aria-autocomplete="list" autocomplete="off"
      placeholder="${(opts.placeholder || 'Search parts: name, part number or brand').replace(/"/g, '&quot;')}" aria-label="${(opts.label || sel.getAttribute('aria-label') || 'Search the price list').replace(/"/g, '&quot;')}">
    <ul class="rss-list hidden" id="${lid}" role="listbox"></ul>`;
  sel.insertAdjacentElement('beforebegin', wrap);
  sel.classList.add('hidden'); sel.setAttribute('aria-hidden', 'true'); sel.tabIndex = -1;
  const inp = wrap.querySelector('.rss-in'), list = wrap.querySelector('.rss-list');
  let shown = [], active = -1;
  const e = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mark = (text, q) => { if(!q) return e(text); const i = text.toLowerCase().indexOf(q); return i < 0 ? e(text) : e(text.slice(0, i)) + '<mark>' + e(text.slice(i, i + q.length)) + '</mark>' + e(text.slice(i + q.length)); };
  const draw = () => {
    const q = inp.value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
    shown = items.filter(it => words.every(w => it.hay.includes(w)))
      .sort((a, b) => (b.label.toLowerCase().startsWith(q) ? 1 : 0) - (a.label.toLowerCase().startsWith(q) ? 1 : 0)).slice(0, 60);
    active = shown.length ? 0 : -1;
    list.innerHTML = shown.length ? shown.map((it, i) => `<li role="option" id="${lid}-${i}" class="rss-opt${i === active ? ' on' : ''}" data-i="${i}" aria-selected="${i === active}"><span class="rss-label">${mark(it.label, words[0] || '')}</span>${it.sub ? `<span class="rss-sub">${e(it.sub)}</span>` : ''}</li>`).join('')
      : `<li class="rss-none">No part matches “${e(inp.value.trim())}”.</li>`;
    if(items.length > shown.length && shown.length === 60) list.insertAdjacentHTML('beforeend', '<li class="rss-none">Keep typing to narrow the list…</li>');
    list.classList.remove('hidden'); inp.setAttribute('aria-expanded', 'true');
    inp.setAttribute('aria-activedescendant', active >= 0 ? `${lid}-${active}` : '');
  };
  const close = () => { list.classList.add('hidden'); inp.setAttribute('aria-expanded', 'false'); };
  const move = d => { if(!shown.length) return; active = (active + d + shown.length) % shown.length;
    list.querySelectorAll('.rss-opt').forEach((li, i) => { li.classList.toggle('on', i === active); li.setAttribute('aria-selected', i === active); });
    const li = list.querySelector('.rss-opt.on'); if(li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    inp.setAttribute('aria-activedescendant', `${lid}-${active}`); };
  const pick = i => { const it = shown[i]; if(!it) return; sel.value = it.value; inp.value = ''; close(); sel.dispatchEvent(new Event('change', { bubbles: true })); };
  inp.addEventListener('focus', draw);
  inp.addEventListener('input', draw);
  inp.addEventListener('keydown', ev => {
    if(ev.key === 'ArrowDown'){ ev.preventDefault(); if(list.classList.contains('hidden')) draw(); else move(1); }
    else if(ev.key === 'ArrowUp'){ ev.preventDefault(); move(-1); }
    else if(ev.key === 'Enter'){ if(!list.classList.contains('hidden') && active >= 0){ ev.preventDefault(); pick(active); } }
    else if(ev.key === 'Escape'){ close(); }
  });
  list.addEventListener('mousedown', ev => ev.preventDefault());   // keep focus in the box while choosing
  list.addEventListener('click', ev => { const li = ev.target.closest('.rss-opt'); if(li) pick(Number(li.dataset.i)); });
  inp.addEventListener('blur', () => setTimeout(close, 120));
  return wrap;
}
