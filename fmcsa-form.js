// ============================================================
// RelayFleet — Annual vehicle inspection on the official FMCSA form (49 CFR 396.17).
// Entry is step by step on a phone or tablet: vehicle details, then one screen per section
// (16 in all) with large OK / Repair / N/A buttons, then a review. The printed and PDF copy
// keeps the paper form layout (J.J. Keller 3128). Loaded after insp.js.
// ============================================================

const FMCSA_TEMPLATE = 'Annual Vehicle Inspection (FMCSA 396.17)';
const FMCSA_COLUMN = { 1:1, 2:1, 3:1, 4:1, 5:1, 6:2, 7:2, 8:2, 9:2, 10:2, 11:2, 12:3, 13:3, 14:3, 15:3, 16:3 };
const FMCSA_VEHICLE_TYPES = ['Tractor', 'Trailer', 'Truck', 'Bus', 'Other'];
const FMCSA_FIELDS = [
  { k:'carrier',   label:'Motor carrier operator', wide:true },
  { k:'address',   label:'Address', wide:true },
  { k:'citystate', label:'City, state, ZIP code', wide:true },
  { k:'vin',       label:'Vehicle identification number (VIN)' },
  { k:'plate',     label:'License plate' },
  { k:'inspector', label:"Inspector's name" },
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

// The sections in paper order, each with its items.
function fmcsaSections(){
  const secs = [];
  inspCurrent.items.forEach(it => {
    let s = secs.find(x => x.name === it.section);
    if(!s){ s = { name: it.section || 'Items', num: parseInt(it.section, 10) || 0, items: [] }; secs.push(s); }
    s.items.push(it);
  });
  return secs;
}

function fmcsaCounts(){
  const items = inspCurrent.items;
  return {
    total: items.length,
    ok: items.filter(i => i.result === 'good').length,
    repair: items.filter(i => i.result === 'repair').length,
    na: items.filter(i => i.result === 'na').length,
    blank: items.filter(i => !i.result).length
  };
}

// ---------- the step-by-step entry ----------
// Steps: 0 = vehicle details, 1..n = one per section, n+1 = review.
function fmcsaStepCount(){ return fmcsaSections().length + 2; }

function renderFmcsaForm(){
  if(inspCurrent.editable) renderFmcsaWizard();
  else renderFmcsaReport();
}

function renderFmcsaWizard(){
  const body = document.getElementById('inspBody');
  if(inspCurrent.fwStep === undefined) inspCurrent.fwStep = 0;
  const { insp, job } = inspCurrent;
  body.innerHTML = `<div class="fw-mini"><b>${esc(job.ro_number || '')}</b> ${esc(job.customer || '')}${job.vehicle ? ' — ' + esc(job.vehicle) : ''} <span class="meta">· ${esc(insp.template_name === FMCSA_TEMPLATE ? 'FMCSA 396.17' : insp.template_name)}</span></div>
    <div class="fw" id="fwRoot">
      <div class="fw-top">
        <div class="fw-steps" id="fwSteps"></div>
        <div class="fw-bar"><div class="fw-bar-fill" id="fwBarFill"></div></div>
        <div class="fw-progress-line"><span class="insp-progress" id="inspProgress"></span></div>
      </div>
      <div class="fw-body" id="fwBody"></div>
      <div class="fw-nav">
        <button type="button" class="fw-btn fw-btn-ghost" id="fwBack">Back</button>
        <button type="button" class="fw-btn fw-btn-primary" id="fwNext">Next</button>
      </div>
    </div>`;
  const root = document.getElementById('fwRoot');
  root.addEventListener('click', fmcsaClick);
  root.addEventListener('change', fmcsaChange);
  document.getElementById('fwBack').onclick = () => fmcsaGo(inspCurrent.fwStep - 1);
  document.getElementById('fwNext').onclick = () => fmcsaGo(inspCurrent.fwStep + 1);
  fmcsaRender();
}

function fmcsaGo(step){
  const max = fmcsaStepCount() - 1;
  inspCurrent.fwStep = Math.max(0, Math.min(max, step));
  fmcsaRender();
  const top = document.getElementById('fwRoot');
  if(top) top.scrollIntoView({ block:'start' });
}

// Redraws the step body, the step chips, the bar and the buttons.
function fmcsaRender(){
  const n = fmcsaSections().length;
  const step = inspCurrent.fwStep;
  const secs = fmcsaSections();
  const body = document.getElementById('fwBody');
  if(!body) return;
  if(step === 0) body.innerHTML = fmcsaDetailsHtml();
  else if(step <= n) body.innerHTML = fmcsaSectionHtml(secs[step - 1], step, n);
  else body.innerHTML = fmcsaReviewHtml();
  fmcsaRefreshChrome();
  const back = document.getElementById('fwBack'), next = document.getElementById('fwNext');
  if(back) back.disabled = step === 0;
  if(next){
    next.style.display = step === n + 1 ? 'none' : '';
    next.textContent = step === n ? 'Review' : 'Next';
  }
}

// Step chips, progress bar and the "N of M checked" line. Runs after every mark.
function fmcsaRefreshChrome(){
  const n = fmcsaSections().length;
  const secs = fmcsaSections();
  const step = inspCurrent.fwStep;
  const chips = [`<button type="button" class="fw-step${step === 0 ? ' on' : ''}" data-go="0">Details</button>`];
  secs.forEach((s, i) => {
    const done = s.items.every(x => x.result);
    const bad = s.items.some(x => x.result === 'repair');
    const cls = (step === i + 1 ? ' on' : '') + (bad ? ' bad' : done ? ' done' : '');
    chips.push(`<button type="button" class="fw-step${cls}" data-go="${i + 1}">${s.num || i + 1}</button>`);
  });
  chips.push(`<button type="button" class="fw-step${step === n + 1 ? ' on' : ''}" data-go="${n + 1}">Review</button>`);
  const steps = document.getElementById('fwSteps');
  if(steps) steps.innerHTML = chips.join('');
  const c = fmcsaCounts();
  const fill = document.getElementById('fwBarFill');
  if(fill) fill.style.width = (c.total ? Math.round((c.total - c.blank) / c.total * 100) : 0) + '%';
  const prog = document.getElementById('inspProgress');
  if(prog) prog.textContent = `${c.total - c.blank} of ${c.total} checked${c.repair ? ' · ' + c.repair + ' to repair' : ''}`;
  updateInspProgress();
}

function fmcsaDetailsHtml(){
  const f = fmcsaForm();
  const val = k => esc(f[k] == null ? '' : f[k]);
  const fields = FMCSA_FIELDS.map(d => `<label class="fw-field${d.wide ? ' wide' : ''}"><span>${esc(d.label)}</span>
      <input data-fk="${d.k}" type="${d.type || 'text'}" value="${val(d.k)}" maxlength="200" autocomplete="off"></label>`).join('');
  const types = FMCSA_VEHICLE_TYPES.map(t => `<label class="fw-chip"><input type="checkbox" data-vt="${t}" ${f.vtype.includes(t) ? 'checked' : ''}><span>${t}</span></label>`).join('');
  return `<div class="fw-section" id="fmcsaHeader">
    <h2 class="fw-h">Vehicle details</h2>
    <p class="fw-sub">Fill these in once. They print on the report.</p>
    <div class="fw-fields">${fields}</div>
    <div class="fw-label-block"><span>Vehicle type</span><div class="fw-chips">${types}</div></div>
    <label class="fw-qual"><input type="checkbox" id="fm-qualified" ${f.qualified ? 'checked' : ''}><span>This inspector meets the qualification requirements in section 396.19.</span></label>
  </div>`;
}

function fmcsaSectionHtml(s, step, n){
  const done = s.items.filter(x => x.result).length;
  return `<div class="fw-section" data-section="${step}">
    <h2 class="fw-h">${esc(s.name)}</h2>
    <p class="fw-sub">Section ${step} of ${n} · ${done} of ${s.items.length} checked</p>
    <button type="button" class="fw-allok" data-allok="${step}" ${done === s.items.length ? 'disabled' : ''}>All OK in this section</button>
    <div class="fw-cards">${s.items.map(fmcsaCardHtml).join('')}</div>
  </div>`;
}

function fmcsaCardHtml(it){
  const isNr = it.result === 'repair';
  const notes = /^16\b/.test(it.section || '');
  return `<div class="fw-card${it.result ? ' has-' + it.result : ''}" data-item="${it.id}">
    <div class="fw-item">${esc(it.label)}</div>
    <div class="fw-marks">
      <button type="button" class="fw-m fw-m-ok${it.result === 'good' ? ' on' : ''}" data-mark="good" aria-pressed="${it.result === 'good'}">✓ OK</button>
      <button type="button" class="fw-m fw-m-nr${isNr ? ' on' : ''}" data-mark="repair" aria-pressed="${isNr}">✕ Repair</button>
      <button type="button" class="fw-m fw-m-na${it.result === 'na' ? ' on' : ''}" data-mark="na" aria-pressed="${it.result === 'na'}">N/A</button>
    </div>
    ${isNr ? `<label class="fw-repair">Repaired on <input type="date" class="fw-rdate" value="${esc(it.repaired_date || '')}"></label>` : ''}
    ${notes ? `<textarea class="fw-notes" rows="2" maxlength="2000" placeholder="Describe the condition">${esc(it.notes || '')}</textarea>` : ''}
  </div>`;
}

function fmcsaReviewHtml(){
  const c = fmcsaCounts();
  const secs = fmcsaSections();
  const repairs = inspCurrent.items.filter(i => i.result === 'repair');
  const blankBySection = secs.map((s, i) => ({ s, i: i + 1, n: s.items.filter(x => !x.result).length })).filter(x => x.n);
  return `<div class="fw-section">
    <h2 class="fw-h">Review</h2>
    <div class="fw-summary">
      <div><b>${c.ok}</b><span>OK</span></div>
      <div class="rep"><b>${c.repair}</b><span>Repair</span></div>
      <div><b>${c.na}</b><span>N/A</span></div>
      <div class="${c.blank ? 'warn' : ''}"><b>${c.blank}</b><span>Not checked</span></div>
    </div>
    ${repairs.length ? `<h3 class="fw-h3">Needs repair</h3><ul class="fw-list">${repairs.map(i => `<li>${esc(i.section ? i.section.replace(/^\d+\.\s*/, '') + ': ' : '')}${esc(i.label)}${i.repaired_date ? ' · repaired ' + esc(i.repaired_date) : ' · not repaired yet'}</li>`).join('')}</ul>` : '<p class="fw-ok-line">Nothing needs repair.</p>'}
    ${blankBySection.length ? `<h3 class="fw-h3">Still to check</h3><div class="fw-chips">${blankBySection.map(b => `<button type="button" class="fw-chip-btn" data-go="${b.i}">${b.i}. ${esc(b.s.name.replace(/^\d+\.\s*/, ''))} (${b.n})</button>`).join('')}</div>
      <button type="button" class="fw-btn fw-btn-ghost fw-wide" id="inspRestGood">Mark the rest OK</button>` : ''}
    <p class="fw-cert">${repairs.length || c.blank ? 'Not certified yet. Every item must be checked, and any repair must be fixed and dated before the vehicle is passed.' : 'Certification: this vehicle has passed all the inspection items for the annual vehicle inspection in accordance with 49 CFR Part 396.'}</p>
    <button type="button" class="fw-btn fw-btn-primary fw-wide" id="inspComplete" ${c.blank ? 'disabled' : ''}>Complete inspection</button>
  </div>`;
}

// One click handler for the whole wizard (the screen is redrawn often).
function fmcsaClick(e){
  const go = e.target.closest('[data-go]');
  if(go){ fmcsaGo(Number(go.dataset.go)); return; }
  const all = e.target.closest('[data-allok]');
  if(all){ fmcsaAllOk(Number(all.dataset.allok)); return; }
  const m = e.target.closest('[data-mark]');
  if(m){ fmcsaMark(m.closest('.fw-card'), m.dataset.mark); return; }
  if(e.target.closest('#inspRestGood')){ fmcsaMarkRestOk(); return; }
  if(e.target.closest('#inspComplete')){ completeInspection(); return; }
}

function fmcsaChange(e){
  const t = e.target;
  if(t.matches('[data-fk], [data-vt], #fm-qualified')){ fmcsaSaveHeader(); return; }
  if(t.matches('.fw-rdate')){
    const card = t.closest('.fw-card'); fmcsaSaveItem(card, { repaired_date: t.value || null }, 'Could not save the date');
    return;
  }
  if(t.matches('.fw-notes')){
    const card = t.closest('.fw-card'); fmcsaSaveItem(card, { notes: t.value.trim() || null }, 'Could not save the note');
  }
}

// Tap the same mark again to clear it. Needs repair opens a repaired date.
async function fmcsaMark(card, r){
  if(!card) return;
  const it = inspCurrent.items.find(x => x.id === Number(card.dataset.item));
  if(!it) return;
  const next = it.result === r ? null : r;
  const prev = { result: it.result, recommend: it.recommend };
  it.result = next;
  it.recommend = next === 'repair';   // a needs-repair item is recommended by default, like the other forms
  card.outerHTML = fmcsaCardHtml(it);
  fmcsaRefreshChrome();
  const { error } = await sb.from('inspection_items').update({ result: next, recommend: it.recommend }).eq('id', it.id);
  if(error){ Object.assign(it, prev); fmcsaRerenderCard(it.id); relayFail(error, 'Could not save'); }
}

function fmcsaRerenderCard(id){
  const el = document.querySelector(`#fwRoot .fw-card[data-item="${id}"]`);
  const it = inspCurrent.items.find(x => x.id === id);
  if(el && it){ el.outerHTML = fmcsaCardHtml(it); fmcsaRefreshChrome(); }
}

async function fmcsaSaveItem(card, fields, failMsg){
  if(!card) return;
  const it = inspCurrent.items.find(x => x.id === Number(card.dataset.item));
  if(!it) return;
  const { error } = await sb.from('inspection_items').update(fields).eq('id', it.id);
  if(error){ relayFail(error, failMsg || 'Could not save'); return; }
  Object.assign(it, fields);
}

// Fills only the unchecked items in the section; items already marked keep their result.
async function fmcsaAllOk(step){
  const secs = fmcsaSections();
  const s = secs[step - 1]; if(!s) return;
  const blanks = s.items.filter(x => !x.result);
  if(!blanks.length) return;
  await Promise.all(blanks.map(x => sb.from('inspection_items').update({ result: 'good', recommend: false }).eq('id', x.id)));
  blanks.forEach(x => { x.result = 'good'; x.recommend = false; });
  fmcsaRender();
}

async function fmcsaMarkRestOk(){
  const blanks = inspCurrent.items.filter(i => !i.result);
  if(!blanks.length) return;
  if(!(await relayConfirm({ message: `Mark the ${blanks.length} unchecked item${blanks.length === 1 ? '' : 's'} as OK?` }))) return;
  const { error } = await sb.from('inspection_items').update({ result: 'good', recommend: false })
    .eq('inspection_id', inspCurrent.insp.id).is('result', null);
  if(error){ relayFail(error, 'Could not save'); return; }
  blanks.forEach(i => { i.result = 'good'; i.recommend = false; });
  fmcsaRender();
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

// ---------- the printable report (read-only, paper layout) ----------
function fmcsaSheetHeaderHtml(f){
  const val = k => esc(f[k] == null ? '' : f[k]);
  const fields = FMCSA_FIELDS.map(d => `<div class="fmcsa-field${d.wide ? ' wide' : ''}"><label>${esc(d.label)}</label><span class="fmcsa-val">${val(d.k) || '&nbsp;'}</span></div>`).join('');
  const types = FMCSA_VEHICLE_TYPES.map(t => `<span class="fmcsa-check">${f.vtype.includes(t) ? '☒' : '☐'} ${t}</span>`).join('');
  return `<div class="fmcsa-head">
    ${fields}
    <div class="fmcsa-field wide"><span class="fmcsa-lbl">Vehicle type</span><div class="fmcsa-types">${types}</div></div>
    <div class="fmcsa-field wide fmcsa-qual"><span class="fmcsa-check wide">${f.qualified ? '☒' : '☐'} This inspector meets the qualification requirements in section 396.19.</span></div>
  </div>`;
}

function fmcsaSheetItemHtml(it){
  return `<div class="fmcsa-item${it.result ? ' has-' + it.result : ''}">
    <span class="fmcsa-mark fmcsa-ok${it.result === 'good' ? ' on' : ''}">${it.result === 'good' ? '✓' : ''}</span>
    <span class="fmcsa-mark fmcsa-nr${it.result === 'repair' ? ' on' : ''}">${it.result === 'repair' ? '✕' : ''}</span>
    <span class="fmcsa-rdate">${it.repaired_date ? esc(it.repaired_date) : ''}</span>
    <div class="fmcsa-label">${esc(it.label)}${it.result === 'na' ? ' <span class="fmcsa-na">N/A</span>' : ''}${it.notes ? `<div class="fmcsa-notes-ro">${esc(it.notes)}</div>` : ''}</div>
  </div>`;
}

function fmcsaSheetItemsHtml(){
  const cols = [[], [], []];
  fmcsaSections().forEach(s => cols[(FMCSA_COLUMN[s.num] || 1) - 1].push(s));
  const colHead = '<div class="fmcsa-colhead"><span>OK</span><span>Needs repair</span><span>Repaired date</span><span>Item</span></div>';
  return `<div class="fmcsa-cols">${cols.map(col => `<div class="fmcsa-col">${colHead}${col.map(s =>
    `<section class="fmcsa-sec"><h4>${esc(s.name.toUpperCase())}</h4>${s.items.map(fmcsaSheetItemHtml).join('')}</section>`).join('')}</div>`).join('')}</div>`;
}

function renderFmcsaReport(){
  const body = document.getElementById('inspBody');
  const items = inspCurrent.items;
  const repairs = items.filter(i => i.result === 'repair').length;
  const passed = repairs === 0 && items.length > 0 && items.every(i => i.result === 'good' || i.result === 'na');
  body.innerHTML = `${inspHeaderHtml()}
    <div class="fmcsa-sheet">
      <div class="fmcsa-title"><span>ANNUAL VEHICLE INSPECTION REPORT</span><span class="fmcsa-original">ORIGINAL</span></div>
      ${fmcsaSheetHeaderHtml(fmcsaForm())}
      ${fmcsaSheetItemsHtml()}
      <div class="fmcsa-instructions">INSTRUCTIONS: MARK COLUMN ENTRIES TO VERIFY INSPECTION: ✓ OK, ✕ NEEDS REPAIR, N/A IF ITEMS DO NOT APPLY, REPAIRED DATE IF ITEMS WERE FIXED.</div>
      ${passed
        ? '<p class="fmcsa-cert">CERTIFICATION: THIS VEHICLE HAS PASSED ALL THE INSPECTION ITEMS FOR THE ANNUAL VEHICLE INSPECTION IN ACCORDANCE WITH 49 CFR PART 396.</p>'
        : `<p class="fmcsa-cert fmcsa-warn">${repairs ? repairs + ' item' + (repairs === 1 ? '' : 's') + ' still need repair, so this vehicle is not certified as passed.' : 'Not every item is marked, so this report is not certified as passed.'}</p>`}
    </div>
    <div class="insp-footer insp-no-print">
      ${inspCurrent.canReopen ? '<button type="button" class="ghost-btn" id="inspReopen">Reopen for changes</button>' : ''}
      <button type="button" id="inspPrint">Print / Save as PDF</button>
    </div>`;
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
