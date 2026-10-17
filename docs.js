// ============================================================
// RelayFleet — Estimates & invoices: tabs, search and the date finder, as a table (25 at a time)
// instead of one long list. "+ New invoice" opens the old form in the blurred sheet.
// ============================================================
const DOC_TABS = [['all', 'All'], ['estimates', 'Estimates'], ['invoices', 'Invoices'], ['unpaid', 'Unpaid'], ['paid', 'Paid']];
const docState = { tab: 'all', from: null, to: null, q: '', offset: 0, seq: 0, fromSearch: false };
let docWired = false, docMark = () => {};
function docStatus(d){
  if(d.kind === 'estimate') return ({ draft: ['pending', 'Draft'], sent: ['waiting', 'Sent'], approved: ['arrived', 'Approved'], declined: ['cancelled', 'Declined'], changes_requested: ['waiting', 'Changes requested'], converted: ['arrived', 'Invoiced'] })[d.status] || ['pending', d.status];
  if(d.status === 'paid') return ['arrived', 'Paid'];
  if(d.status === 'draft') return ['pending', 'Draft'];
  return d.due_date && new Date(d.due_date + 'T23:59:59') < new Date() ? ['overdue', 'Overdue'] : ['waiting', 'Unpaid'];
}
function docRowHtml(d){
  const [cls, label] = docStatus(d);
  const menu = (d.kind === 'invoice' && d.status === 'unpaid' ? `<button type="button" class="text-btn doc-paid" data-id="${d.id}">Mark paid</button>` : '') + (d.status === 'draft' ? `<button type="button" class="text-btn danger doc-del" data-id="${d.id}">Delete draft</button>` : '');
  return `<tr class="cw-row doc-row" data-id="${d.id}" tabindex="0" title="Open">
    <td><span class="doc-kind-tag">${d.kind === 'estimate' ? 'EST' : 'INV'}</span> <b class="mono">${cwEsc(d.doc_number || '#' + d.id)}</b></td>
    <td><b>${cwEsc(d.customer_name)}</b>${d.unit_number ? `<div class="meta">Unit ${cwEsc(d.unit_number)}</div>` : ''}</td>
    <td>${cwEsc(new Date(d.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))}${d.kind === 'invoice' && d.status === 'paid' && d.paid_at ? `<div class="meta">paid ${cwEsc(new Date(d.paid_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</div>` : ''}</td>
    <td><span class="badge ${cls}"><span class="bd"></span>${cwEsc(label)}</span></td>
    <td class="num"><b>${fdMoney(d.total)}</b></td>
    <td class="cw-acts"><button type="button" class="text-btn doc-pdf" data-id="${d.id}">PDF</button>${menu ? `<details class="row-more"><summary aria-label="More actions">More</summary><div class="row-menu">${menu}</div></details>` : ''}</td></tr>`;
}
function docTabsHtml(){ return DOC_TABS.map(([k, l]) => `<button type="button" class="fleet-tab${docState.tab === k ? ' active' : ''}" data-doctab="${k}" aria-pressed="${docState.tab === k}">${l}</button>`).join(''); }
// mode: true = a fresh search (shows "Loading…"), false = add the next page, 'quiet' = a background refresh that keeps
// the same tab, search and number of rows, never flashes, and never replaces a good table with an error
async function refreshDocsTable(mode){
  const body = document.getElementById('invoiceList'); if(!body) return;
  if(!docWired && document.getElementById('docTabs')) return initDocsTable();   // however the table is first drawn, connect its tabs, search, buttons and row clicks first
  if(mode === undefined) mode = true;
  const quiet = mode === 'quiet', reset = mode === true || quiet;
  const startAt = reset ? 0 : docState.offset, size = quiet ? Math.max(FIND_PAGE, docState.offset) : FIND_PAGE;
  const mySeq = ++docState.seq;
  if(mode === true){ docState.offset = 0; body.innerHTML = '<tr><td colspan="6" class="meta">Loading…</td></tr>'; }
  let q = sb.from('invoices').select('id, doc_number, job_id, kind, status, customer_name, unit_number, created_at, paid_at, due_date, total', { count: 'exact' }).eq('org_id', session.orgId);
  if(docState.tab === 'estimates') q = q.eq('kind', 'estimate');
  else if(docState.tab === 'invoices') q = q.eq('kind', 'invoice');
  else if(docState.tab === 'unpaid') q = q.eq('kind', 'invoice').eq('status', 'unpaid');
  else if(docState.tab === 'paid') q = q.eq('kind', 'invoice').eq('status', 'paid');
  if(docState.from) q = q.gte('created_at', docState.from.toISOString());
  if(docState.to) q = q.lt('created_at', docState.to.toISOString());
  const s = docState.q.replace(/[,()%*\\]/g, ' ').trim();
  if(s) q = q.or(`doc_number.ilike.%${s}%,customer_name.ilike.%${s}%,unit_number.ilike.%${s}%`);
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(startAt, startAt + size - 1);
  if(mySeq !== docState.seq) return;
  const more = document.getElementById('docLoadMore'), sum = document.getElementById('docSummary');
  if(error && quiet && body.querySelector('.doc-row')){ console.error('refreshDocsTable', error); return; }   // a failed background refresh keeps a good table on screen (with nothing on screen, the error is shown)
  if(error){ body.innerHTML = `<tr><td colspan="6"><div class="form-error">Estimates and invoices couldn't be loaded: ${cwEsc(error.message)}</div></td></tr>`; if(more) more.classList.add('hidden'); return; }   // an error never looks like an empty list
  const rows = data || [];
  if(reset) body.innerHTML = '';
  if(!rows.length && reset) body.innerHTML = `<tr><td colspan="6"><div class="empty-note">${docState.q || docState.from || docState.to || docState.tab !== 'all' ? 'Nothing matches. <button type="button" class="link" data-docclear>Clear the filters</button>' : 'No estimates or invoices yet. Create one from a work order, or use + New invoice.'}</div></td></tr>`;
  else body.insertAdjacentHTML('beforeend', rows.map(docRowHtml).join(''));
  docState.offset = startAt + rows.length;
  const total = count == null ? docState.offset : count, left = Math.max(0, total - docState.offset);
  if(more){ more.classList.toggle('hidden', left === 0); more.textContent = `Load more (${left} left)`; }
  if(sum) sum.textContent = total ? `${total} document${total === 1 ? '' : 's'}${fdLabel(docState) ? ' · ' + fdLabel(docState) : ''}` : '';
  const act = document.getElementById('docActive'); if(act) act.innerHTML = fdLabel(docState) ? `<button type="button" class="fd-active-chip" data-docdate="1">Date: ${cwEsc(fdLabel(docState))} <span aria-hidden="true">✕</span></button>` : '';
}
function docNewClose(){ const b = document.getElementById('docNewBox'); if(b) b.classList.add('hidden'); }
function initDocsTable(){
  const tabs = document.getElementById('docTabs'); if(!tabs) return;
  if(!docWired){
    docWired = true;
    docMark = fdRenderDates(document.getElementById('docDates'), docState, () => { docState.fromSearch = false; refreshDocsTable(true); });
    const search = document.getElementById('docSearch'); let t = null;
    search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => {
      const text = search.value.trim(), r = fdParseRange(text);
      if(r){ docState.from = r.from; docState.to = r.to; docState.q = ''; docState.fromSearch = true; }
      else { if(docState.fromSearch){ docState.from = null; docState.to = null; docState.fromSearch = false; } docState.q = text; }
      docMark(); refreshDocsTable(true); }, 300); });
    tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-doctab]'); if(!b) return; docState.tab = b.dataset.doctab; tabs.innerHTML = docTabsHtml(); refreshDocsTable(true); });
    document.getElementById('docNewBtn').onclick = () => { const b = document.getElementById('docNewBox'); if(b) b.classList.remove('hidden'); };
    document.getElementById('docLoadMore').onclick = () => refreshDocsTable(false);
    document.getElementById('shop-invoices').addEventListener('click', async (e) => {
      if(e.target.closest('[data-docclear]')){ Object.assign(docState, { tab: 'all', from: null, to: null, q: '', fromSearch: false }); search.value = ''; tabs.innerHTML = docTabsHtml(); docMark(); refreshDocsTable(true); return; }
      if(e.target.closest('[data-docdate]')){ docState.from = null; docState.to = null; docState.fromSearch = false; if(fdParseRange(search.value.trim())) search.value = ''; docMark(); refreshDocsTable(true); return; }
      const pdf = e.target.closest('.doc-pdf'); if(pdf){ e.stopPropagation(); if(typeof viewInvoicePdf === 'function') viewInvoicePdf(Number(pdf.dataset.id)); return; }
      const paid = e.target.closest('.doc-paid'); if(paid){ e.stopPropagation(); if(typeof markInvoicePaid === 'function') await markInvoicePaid(Number(paid.dataset.id)); refreshDocsTable(true); return; }
      const del = e.target.closest('.doc-del'); if(del){ e.stopPropagation(); if(typeof deleteInvoiceDraft === 'function') await deleteInvoiceDraft(Number(del.dataset.id)); refreshDocsTable(true); return; }
      if(e.target.closest('summary, .row-menu, button, a, input, label')) return;
      const row = e.target.closest('.doc-row'); if(row && typeof openEstimateEditor === 'function') openEstimateEditor(Number(row.dataset.id));
    });
    document.getElementById('shop-invoices').addEventListener('keydown', (e) => { if(e.key === 'Enter' && e.target.classList && e.target.classList.contains('doc-row')) e.target.click(); });
  }
  tabs.innerHTML = docTabsHtml();
  return refreshDocsTable(true);
}
