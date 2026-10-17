// ============================================================
// RelayFleet — Completed work: find a finished job by date, text or number, see what it came to
// (invoice and amount), and open it. The date finder below is shared with Estimates & invoices (docs.js).
// ============================================================
const FIND_PAGE = 25;
// ---------- the date finder ----------
const fdAdd = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fdStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fdTime = d => d ? d.getTime() : null;
function fdParseDate(text){   // 03.03.2026 = day.month.year · 3/3/2026 = month/day/year (US) · 2026-03-03
  const t = String(text || '').trim(); let m, y, mo, d;
  if((m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))){ d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))){ mo = +m[1]; d = +m[2]; y = +m[3]; }
  else if((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))){ y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return null;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;   // 31.02.2026 is not a date
}
function fdParseRange(text){   // one day, or "03.03.2026 - 10.03.2026" / "… to …"
  const parts = String(text || '').trim().split(/\s+(?:-|–|to)\s+/i);
  if(parts.length === 1){ const a = fdParseDate(parts[0]); return a ? { from: a, to: fdAdd(a, 1) } : null; }
  if(parts.length === 2){ const a = fdParseDate(parts[0]), b = fdParseDate(parts[1]); if(a && b) return a <= b ? { from: a, to: fdAdd(b, 1) } : { from: b, to: fdAdd(a, 1) }; }
  return null;
}
function fdQuick(key, now){
  const t = fdStart(now || new Date());
  switch(key){
    case 'today': return { from: t, to: fdAdd(t, 1) };
    case 'yesterday': return { from: fdAdd(t, -1), to: t };
    case 'week': { const mon = fdAdd(t, -((t.getDay() + 6) % 7)); return { from: mon, to: fdAdd(mon, 7) }; }   // Monday to Sunday
    case 'month': return { from: new Date(t.getFullYear(), t.getMonth(), 1), to: new Date(t.getFullYear(), t.getMonth() + 1, 1) };
    case 'lastmonth': return { from: new Date(t.getFullYear(), t.getMonth() - 1, 1), to: new Date(t.getFullYear(), t.getMonth(), 1) };
    default: return { from: null, to: null };
  }
}
const fdDay = d => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
function fdLabel(r){
  if(!r.from && !r.to) return '';
  const last = r.to ? fdAdd(r.to, -1) : null;
  if(r.from && last && fdTime(fdStart(r.from)) === fdTime(fdStart(last))) return fdDay(r.from);
  return (r.from ? fdDay(r.from) : '…') + ' – ' + (last ? fdDay(last) : '…');
}
const fdInputDate = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
const fdFromInput = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fdMoney = n => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// draws the quick buttons and From/To boxes; returns a function that re-syncs them after the dates change from code
function fdRenderDates(box, st, onChange){
  const chips = [['all', 'All time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month']];
  box.innerHTML = `<span class="fd-label">Date</span>${chips.map(([k, l]) => `<button type="button" class="fd-chip" data-fdq="${k}">${l}</button>`).join('')}
    <label class="fd-range">From <input type="date" data-fd="from" aria-label="From date"></label><label class="fd-range">To <input type="date" data-fd="to" aria-label="To date"></label>`;
  const fromEl = box.querySelector('[data-fd="from"]'), toEl = box.querySelector('[data-fd="to"]');
  const mark = () => {
    fromEl.value = fdInputDate(st.from); toEl.value = st.to ? fdInputDate(fdAdd(st.to, -1)) : '';
    const cur = chips.map(c => c[0]).find(k => { const r = fdQuick(k); return fdTime(r.from) === fdTime(st.from) && fdTime(r.to) === fdTime(st.to); });
    box.querySelectorAll('[data-fdq]').forEach(b => b.classList.toggle('active', b.dataset.fdq === cur));
  };
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-fdq]'); if(!b) return; const r = fdQuick(b.dataset.fdq); st.from = r.from; st.to = r.to; mark(); onChange(); });
  box.addEventListener('change', (e) => {
    if(!e.target.closest('[data-fd]')) return;
    const f = fdFromInput(fromEl.value), t = fdFromInput(toEl.value);
    if(f && t && f > t){ st.from = t; st.to = fdAdd(f, 1); } else { st.from = f; st.to = t ? fdAdd(t, 1) : null; }
    mark(); onChange();
  });
  mark(); return mark;
}

// ---------- Completed work ----------
const cwState = { from: null, to: null, q: '', type: '', offset: 0, seq: 0, fromSearch: false };
let cwWired = false, cwMark = () => {};
const cwEsc = s => esc(s == null ? '' : s);
function cwRowHtml(r){
  const mech = typeof historyMechName === 'function' ? historyMechName(r.mechanic_id) : '';
  const inv = r.invoice_id
    ? `<button type="button" class="link cw-inv" data-inv="${r.invoice_id}" title="Open the invoice PDF">${cwEsc(r.doc_number)}</button> <span class="badge ${r.inv_status === 'paid' ? 'arrived' : r.inv_status === 'draft' ? 'pending' : 'waiting'}"><span class="bd"></span>${r.inv_status === 'paid' ? 'Paid' : r.inv_status === 'draft' ? 'Draft' : 'Unpaid'}</span>`
    : '<span class="badge waiting"><span class="bd"></span>No invoice yet</span>';
  const done = [r.complaint, r.diagnosis].filter(Boolean).join(' — ');
  return `<tr class="cw-row" data-id="${r.id}" tabindex="0" title="Open this work order">
    <td><b class="mono">${cwEsc(r.ro_number)}</b><div class="meta">${cwEsc(new Date(r.done_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))}${r.job_type === 'inshop' ? '' : ' · road call'}</div></td>
    <td><b>${cwEsc(r.customer)}</b><div class="meta">${cwEsc(r.vehicle)}${mech ? ' · ' + cwEsc(mech) : ''}</div></td>
    <td class="cw-what">${cwEsc(done.length > 120 ? done.slice(0, 117) + '…' : done) || '<span class="meta">No notes</span>'}${r.parts_count ? `<div class="meta">${r.parts_count} part${r.parts_count === 1 ? '' : 's'} used</div>` : ''}</td>
    <td>${inv}</td>
    <td class="num">${r.invoice_id ? '<b>' + fdMoney(r.total) + '</b>' : '<span class="meta">—</span>'}</td></tr>`;
}
function cwActiveChips(){
  const box = document.getElementById('cwActive'); if(!box) return;
  const items = [];
  const lab = fdLabel(cwState); if(lab) items.push(['date', 'Done: ' + lab]);
  if(cwState.type) items.push(['type', cwState.type === 'inshop' ? 'In-shop' : 'Mobile / dispatch']);
  box.innerHTML = items.map(([k, l]) => `<button type="button" class="fd-active-chip" data-clear="${k}" aria-label="Remove filter: ${cwEsc(l)}">${cwEsc(l)} <span aria-hidden="true">✕</span></button>`).join('');
}
async function cwLoad(reset){
  const body = document.getElementById('fullHistoryList'); if(!body) return;
  const mySeq = ++cwState.seq;
  if(reset){ cwState.offset = 0; body.innerHTML = '<tr><td colspan="5" class="meta">Loading…</td></tr>'; }
  const { data, error } = await sb.rpc('completed_work_page', { p_from: cwState.from ? cwState.from.toISOString() : null, p_to: cwState.to ? cwState.to.toISOString() : null,
    p_search: cwState.q || null, p_type: cwState.type || null, p_offset: cwState.offset, p_limit: FIND_PAGE });
  if(mySeq !== cwState.seq) return;   // a newer search is already on its way
  const more = document.getElementById('historyLoadMoreBtn'), end = document.getElementById('historyEndNote'), sum = document.getElementById('cwSummary');
  if(error){ body.innerHTML = `<tr><td colspan="5"><div class="form-error">Couldn't load completed work: ${cwEsc(error.message)}</div></td></tr>`; if(more) more.classList.add('hidden'); return; }
  const rows = data.rows || [], count = Number(data.count || 0);
  if(reset) body.innerHTML = '';
  if(!rows.length && reset) body.innerHTML = `<tr><td colspan="5"><div class="empty-note">No completed jobs match${cwState.from || cwState.to || cwState.q || cwState.type ? '. <button type="button" class="link" data-clear="all">Clear the filters</button>' : ' yet.'}</div></td></tr>`;
  else body.insertAdjacentHTML('beforeend', rows.map(cwRowHtml).join(''));
  cwState.offset += rows.length;
  const left = Math.max(0, count - cwState.offset);
  if(more){ more.classList.toggle('hidden', left === 0); more.textContent = `Load more (${left} left)`; }
  if(end) end.classList.toggle('hidden', left > 0 || count === 0);
  if(sum) sum.textContent = count ? `${count} job${count === 1 ? '' : 's'}${fdLabel(cwState) ? ' · ' + fdLabel(cwState) : ''} · invoiced ${fdMoney(data.invoiced)} · paid ${fdMoney(data.paid)}` : '';
  cwActiveChips();
}
function initCompletedWork(){
  const dates = document.getElementById('cwDates'); if(!dates) return;
  if(!cwWired){
    cwWired = true;
    cwMark = fdRenderDates(dates, cwState, () => { cwState.fromSearch = false; cwLoad(true); cwActiveChips(); });
    let t = null; const search = document.getElementById('historySearchInput');
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const text = search.value.trim(), r = fdParseRange(text);
        if(r){ cwState.from = r.from; cwState.to = r.to; cwState.q = ''; cwState.fromSearch = true; }   // a typed date becomes a date filter
        else { if(cwState.fromSearch){ cwState.from = null; cwState.to = null; cwState.fromSearch = false; } cwState.q = text; }
        cwMark(); cwLoad(true);
      }, 300);
    });
    document.getElementById('historyTypeFilter').addEventListener('change', (e) => { cwState.type = e.target.value; cwLoad(true); });
    document.getElementById('historyLoadMoreBtn').onclick = () => cwLoad(false);
    document.getElementById('shop-history').addEventListener('click', (e) => {
      const clr = e.target.closest('[data-clear]');
      if(clr){
        const k = clr.dataset.clear;
        if(k === 'date' || k === 'all'){ cwState.from = null; cwState.to = null; cwState.fromSearch = false; if(search.value.trim() && fdParseRange(search.value.trim())) search.value = ''; }
        if(k === 'type' || k === 'all'){ cwState.type = ''; document.getElementById('historyTypeFilter').value = ''; }
        if(k === 'all'){ cwState.q = ''; search.value = ''; }
        cwMark(); cwLoad(true); return;
      }
      const inv = e.target.closest('.cw-inv'); if(inv){ e.stopPropagation(); if(typeof viewInvoicePdf === 'function') viewInvoicePdf(Number(inv.dataset.inv)); return; }
      const row = e.target.closest('.cw-row'); if(row && typeof openRepairOrder === 'function') openRepairOrder(Number(row.dataset.id));
    });
    document.getElementById('shop-history').addEventListener('keydown', (e) => { if(e.key === 'Enter' && e.target.classList && e.target.classList.contains('cw-row')) e.target.click(); });
  }
  return (typeof refreshHistoryMechCache === 'function' ? Promise.resolve(refreshHistoryMechCache()) : Promise.resolve()).then(() => cwLoad(true));
}
