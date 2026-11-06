// ============================================================
// RelayFleet — Annual vehicle inspection on the official FMCSA form (49 CFR 396.17).
// This is the digital version of the paper "Annual Vehicle Inspection Report" (J.J. Keller 3128):
// the same header fields, the same 16 sections in three columns, a tick (OK) or cross
// (needs repair) per item, N/A, a repaired date per item, the instructions and the certification line.
// It is used for any inspection started from the built-in template with this name. Loaded after insp.js.
// ============================================================

const FMCSA_TEMPLATE = 'Annual Vehicle Inspection (FMCSA 396.17)';
const FMCSA_COLUMN = { 1:1, 2:1, 3:1, 4:1, 5:1, 6:2, 7:2, 8:2, 9:2, 10:2, 11:2, 12:3, 13:3, 14:3, 15:3, 16:3 };
const FMCSA_VEHICLE_TYPES = ['Tractor', 'Trailer', 'Truck', 'Bus', 'Other'];
const FMCSA_FIELDS = [
  { k:'carrier',   label:'Motor carrier operator', wide:true },
  { k:'address',   label:'Address', wide:true },
  { k:'citystate', label:'City, state, ZIP code', wide:true },
  { k:'vin',       label:'Vehicle identification number' },
  { k:'plate',     label:'License plate' },
  { k:'inspector', label:"Inspector's name (print or sign)" },
  { k:'agency',    label:'Inspection agency / location' },
  { k:'report_no', label:'Report number' },
  { k:'unit_no',   label:'Fleet unit number' },
  { k:'date',      label:'Date', type:'date' }
];

function isFmcsaInspection(insp){ return !!insp && insp.template_name === FMCSA_TEMPLATE; }

// Header values: whatever was saved, else a sensible starting value. Blank values stay blank.
function fmcsaForm(){
  const { insp, job } = inspCurrent;
  const f = Object.assign({}, insp.form || {});
  if(f.carrier === undefined) f.carrier = job.customer || '';
  if(f.agency === undefined) f.agency = (session && session.orgName) || '';
  if(f.inspector === undefined) f.inspector = inspCurrent.inspector || (session && session.name) || '';
  if(f.date === undefined) f.date = String(insp.completed_at || insp.started_at || new Date().toISOString()).slice(0, 10);
  if(!Array.isArray(f.vtype)) f.vtype = [];
  return f;
}

function fmcsaHeaderHtml(f, editable){
  const val = k => esc(f[k] == null ? '' : f[k]);
  const fields = FMCSA_FIELDS.map(d => {
    const inner = editable
      ? `<input id="fm-${d.k}" data-fk="${d.k}" type="${d.type || 'text'}" value="${val(d.k)}" maxlength="200">`
      : `<span class="fmcsa-val">${val(d.k) || '&nbsp;'}</span>`;
    return `<div class="fmcsa-field${d.wide ? ' wide' : ''}"><label${editable ? ` for="fm-${d.k}"` : ''}>${esc(d.label)}</label>${inner}</div>`;
  }).join('');
  const types = FMCSA_VEHICLE_TYPES.map(t => {
    const on = f.vtype.includes(t);
    return editable
      ? `<label class="fmcsa-check"><input type="checkbox" data-vt="${t}" ${on ? 'checked' : ''}> ${t}</label>`
      : `<span class="fmcsa-check">${on ? '☒' : '☐'} ${t}</span>`;
  }).join('');
  const qual = editable
    ? `<label class="fmcsa-check wide"><input type="checkbox" id="fm-qualified" ${f.qualified ? 'checked' : ''}> This inspector meets the qualification requirements in section 396.19.</label>`
    : `<span class="fmcsa-check wide">${f.qualified ? '☒' : '☐'} This inspector meets the qualification requirements in section 396.19.</span>`;
  return `<div class="fmcsa-head" id="fmcsaHeader">
    ${fields}
    <div class="fmcsa-field wide"><span class="fmcsa-lbl">Vehicle type</span><div class="fmcsa-types">${types}</div></div>
    <div class="fmcsa-field wide fmcsa-qual">${qual}</div>
  </div>`;
}

function fmcsaItemHtml(it, editable){
  const dis = editable ? '' : 'disabled';
  const notes = /^16\b/.test(it.section || '');   // section 16 "Other" takes a written description
  return `<div class="fmcsa-item${it.result ? ' has-' + it.result : ''}" data-item="${it.id}">
    <button type="button" class="fmcsa-mark fmcsa-ok${it.result === 'good' ? ' on' : ''}" data-r="good" aria-label="OK" aria-pressed="${it.result === 'good'}" ${dis}>✓</button>
    <button type="button" class="fmcsa-mark fmcsa-nr${it.result === 'repair' ? ' on' : ''}" data-r="repair" aria-label="Needs repair" aria-pressed="${it.result === 'repair'}" ${dis}>✕</button>
    <input type="date" class="fmcsa-rdate" value="${esc(it.repaired_date || '')}" aria-label="Repaired date" ${dis}>
    <div class="fmcsa-label">${esc(it.label)}
      <button type="button" class="fmcsa-mark fmcsa-na-btn${it.result === 'na' ? ' on' : ''}" data-r="na" aria-label="Not applicable" aria-pressed="${it.result === 'na'}" ${dis}>N/A</button>
      ${notes ? (editable
        ? `<textarea class="fmcsa-notes" rows="2" maxlength="2000" placeholder="List the condition">${esc(it.notes || '')}</textarea>`
        : (it.notes ? `<div class="fmcsa-notes-ro">${esc(it.notes)}</div>` : '')) : ''}
    </div>
  </div>`;
}

function fmcsaItemsHtml(editable){
  const secs = [];
  inspCurrent.items.forEach(it => {
    let s = secs.find(x => x.name === it.section);
    if(!s){ s = { name: it.section || 'Items', num: parseInt(it.section, 10) || 0, items: [] }; secs.push(s); }
    s.items.push(it);
  });
  const cols = [[], [], []];
  secs.forEach(s => cols[(FMCSA_COLUMN[s.num] || 1) - 1].push(s));
  const colHead = '<div class="fmcsa-colhead"><span>OK</span><span>Needs repair</span><span>Repaired date</span><span>Item</span></div>';
  return `<div class="fmcsa-cols">${cols.map(col => `<div class="fmcsa-col">${colHead}${col.map(s =>
    `<section class="fmcsa-sec"><h4>${esc(s.name.toUpperCase())}</h4>${s.items.map(it => fmcsaItemHtml(it, editable)).join('')}</section>`).join('')}</div>`).join('')}</div>`;
}

function renderFmcsaForm(){
  const body = document.getElementById('inspBody');
  const { items } = inspCurrent;
  const editable = !!inspCurrent.editable;
  const f = fmcsaForm();
  const repairs = items.filter(i => i.result === 'repair').length;
  const passed = !editable && repairs === 0 && items.length > 0 && items.every(i => i.result === 'good' || i.result === 'na');
  body.innerHTML = `${inspHeaderHtml()}
    <div class="fmcsa-sheet">
      <div class="fmcsa-title"><span>ANNUAL VEHICLE INSPECTION REPORT</span>${editable ? '' : '<span class="fmcsa-original">ORIGINAL</span>'}</div>
      ${fmcsaHeaderHtml(f, editable)}
      ${fmcsaItemsHtml(editable)}
      <div class="fmcsa-instructions">INSTRUCTIONS: MARK COLUMN ENTRIES TO VERIFY INSPECTION: ✓ OK, ✕ NEEDS REPAIR, N/A IF ITEMS DO NOT APPLY, REPAIRED DATE IF ITEMS WERE FIXED.</div>
      ${passed
        ? '<p class="fmcsa-cert">CERTIFICATION: THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS FOR THE ANNUAL VEHICLE INSPECTION IN ACCORDANCE WITH 49 CFR PART 396.</p>'
        : `<p class="fmcsa-cert fmcsa-warn">${editable ? 'Certification is printed when every item is marked OK or N/A.' : (repairs ? repairs + ' item' + (repairs === 1 ? '' : 's') + ' still need repair, so this vehicle is not certified as passed.' : 'Not every item is marked, so this report is not certified as passed.')}</p>`}
    </div>
    <div class="insp-footer insp-no-print">
      ${editable
        ? `<span class="insp-progress" id="inspProgress"></span>
           <button type="button" class="ghost-btn" id="inspRestGood">Mark the rest OK</button>
           <button type="button" id="inspComplete">Complete inspection</button>`
        : `${inspCurrent.canReopen ? '<button type="button" class="ghost-btn" id="inspReopen">Reopen for changes</button>' : ''}
           <button type="button" id="inspPrint">Print / Save as PDF</button>`}
    </div>`;
  wireFmcsaForm(editable);
}

function wireFmcsaForm(editable){
  const body = document.getElementById('inspBody');
  if(editable){
    body.querySelectorAll('#fmcsaHeader [data-fk], #fmcsaHeader [data-vt], #fmcsaHeader #fm-qualified').forEach(el => el.onchange = fmcsaSaveHeader);
    body.querySelectorAll('.fmcsa-item').forEach(el => {
      el.querySelectorAll('.fmcsa-mark').forEach(b => b.onclick = () => fmcsaMark(el, b.dataset.r));
      const d = el.querySelector('.fmcsa-rdate');
      d.onchange = () => fmcsaSaveItem(el, { repaired_date: d.value || null }, 'Could not save the date');
      const n = el.querySelector('.fmcsa-notes');
      if(n) n.onchange = () => fmcsaSaveItem(el, { notes: n.value.trim() || null }, 'Could not save the note');
    });
    document.getElementById('inspRestGood').onclick = fmcsaMarkRestOk;
    document.getElementById('inspComplete').onclick = completeInspection;
    updateInspProgress();
  } else {
    const print = document.getElementById('inspPrint');
    if(print) print.onclick = () => { document.body.classList.add('printing-insp'); window.print(); setTimeout(() => document.body.classList.remove('printing-insp'), 500); };
    const reopen = document.getElementById('inspReopen');
    if(reopen) reopen.onclick = async () => {
      if(!(await relayConfirm({ message: 'Reopen this inspection so it can be corrected? Recommendations already approved or declined stay as they are.' }))) return;
      const { error } = await sb.from('inspections').update({ status: 'in_progress' }).eq('id', inspCurrent.insp.id);
      if(error){ relayFail(error, 'Could not reopen'); return; }
      openInspection(inspCurrent.insp.id);
    };
  }
}

// Tick (OK), cross (needs repair) or N/A. Tapping the same mark again clears it.
async function fmcsaMark(el, r){
  const it = inspCurrent.items.find(x => x.id === Number(el.dataset.item));
  if(!it) return;
  const next = it.result === r ? null : r;
  const prev = { result: it.result, recommend: it.recommend };
  it.result = next;
  it.recommend = next === 'repair';   // a needs-repair item is recommended by default, like the other forms
  fmcsaPaintRow(el, it);
  const { error } = await sb.from('inspection_items').update({ result: next, recommend: it.recommend }).eq('id', it.id);
  if(error){ Object.assign(it, prev); fmcsaPaintRow(el, it); relayFail(error, 'Could not save'); }
}

async function fmcsaSaveItem(el, fields, failMsg){
  const it = inspCurrent.items.find(x => x.id === Number(el.dataset.item));
  if(!it) return;
  const { error } = await sb.from('inspection_items').update(fields).eq('id', it.id);
  if(error){ relayFail(error, failMsg || 'Could not save'); return; }
  Object.assign(it, fields);
}

function fmcsaPaintRow(el, it){
  el.className = 'fmcsa-item' + (it.result ? ' has-' + it.result : '');
  el.querySelectorAll('.fmcsa-mark').forEach(b => { const on = b.dataset.r === it.result; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  updateInspProgress();
}

// Saves every header field at once; the form is a small object, so one write is enough.
async function fmcsaSaveHeader(){
  const form = {};
  document.querySelectorAll('#fmcsaHeader [data-fk]').forEach(el => { form[el.dataset.fk] = el.value.trim() || null; });
  form.vtype = [...document.querySelectorAll('#fmcsaHeader [data-vt]:checked')].map(e => e.dataset.vt);
  const q = document.getElementById('fm-qualified');
  form.qualified = !!(q && q.checked);
  await saveInspectionField({ form });
}

async function fmcsaMarkRestOk(){
  const blanks = inspCurrent.items.filter(i => !i.result);
  if(!blanks.length) return;
  if(!(await relayConfirm({ message: `Mark the ${blanks.length} unchecked item${blanks.length === 1 ? '' : 's'} as OK?` }))) return;
  const { error } = await sb.from('inspection_items').update({ result: 'good', recommend: false })
    .eq('inspection_id', inspCurrent.insp.id).is('result', null);
  if(error){ relayFail(error, 'Could not save'); return; }
  blanks.forEach(i => { i.result = 'good'; i.recommend = false; });
  document.querySelectorAll('#inspBody .fmcsa-item').forEach(el => {
    const it = inspCurrent.items.find(x => x.id === Number(el.dataset.item));
    if(it) fmcsaPaintRow(el, it);
  });
}
