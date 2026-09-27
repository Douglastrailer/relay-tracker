// ============================================================
// RelayFleet — Phase 2: digital inspections.
// Loaded after script.js and ro.js; uses their helpers (sb, session, esc,
// jobStatusBadge, recordsToast, fmtDate, fmtDateTime, openRepairOrder).
// The database enforces who may start, fill in, complete, or see an
// inspection; role checks here only decide which controls to show.
// ============================================================

const RESULT_LABELS = { good:'Good', monitor:'Monitor', repair:'Repair required', na:'N/A' };
const RESULT_SHORT = { good:'Good', monitor:'Monitor', repair:'Repair', na:'N/A' };
const SEVERITY_LABELS = { repair:'Repair', monitor:'Monitor' };
const REC_STATUS_LABELS = { recommended:'Recommended', approved:'Approved', declined:'Declined', done:'Done' };
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

let inspCurrent = null;   // { insp, items, job, editable, photos: {itemId:[...]}}

function resultCounts(items){
  const c = { good:0, monitor:0, repair:0, na:0, blank:0 };
  (items || []).forEach(i => { if(i.result) c[i.result]++; else c.blank++; });
  return c;
}
function countsChipsHtml(c){
  return `<span class="insp-chip r-repair">${c.repair} repair</span><span class="insp-chip r-monitor">${c.monitor} monitor</span><span class="insp-chip r-good">${c.good} good</span>${c.na ? `<span class="insp-chip r-na">${c.na} N/A</span>` : ''}`;
}

// ---------------- Repair Order: inspections + recommended repairs ----------------
async function loadRoInspections(job, opts){
  const box = document.getElementById('roInspections');
  const recBox = document.getElementById('roRecommended');
  if(!box) return;
  const [insRes, recRes] = await Promise.all([
    sb.from('inspections').select('id, template_name, status, started_at, completed_at, inspected_by, inspection_items(result)').eq('job_id', job.id).order('started_at', { ascending:false }),
    sb.from('recommended_repairs').select('id, description, severity, status, created_at').eq('job_id', job.id).order('created_at')
  ]);
  const list = insRes.data || [];
  box.innerHTML = `<h4>Inspections</h4>
    ${list.length ? list.map(i => {
      const c = resultCounts(i.inspection_items);
      const done = i.status === 'completed';
      return `<div class="insp-row">
        <div class="insp-row-main"><b>${esc(i.template_name)}</b>
          <div class="meta">${done ? 'Completed ' + fmtDateTime(i.completed_at) : 'In progress · started ' + fmtDateTime(i.started_at)}</div>
          <div class="insp-chips">${countsChipsHtml(c)}${!done && c.blank ? `<span class="insp-chip">${c.blank} left</span>` : ''}</div></div>
        <button type="button" class="insp-open" data-insp="${i.id}">${done ? 'View report' : (opts.canWork ? 'Continue' : 'View')}</button>
      </div>`;
    }).join('') : `<p class="meta">${opts.canWork ? 'No inspections yet.' : 'No completed inspections yet.'}</p>`}
    ${opts.canWork ? `<div class="insp-start"><select id="inspTemplate" aria-label="Checklist"></select><button type="button" id="inspStartBtn">Start inspection</button></div>` : ''}`;
  box.querySelectorAll('.insp-open').forEach(b => b.onclick = () => openInspection(Number(b.dataset.insp)));
  if(opts.canWork) await fillTemplatePicker(job);

  if(recBox){
    const recs = recRes.data || [];
    const canDecide = opts.isShop;
    recBox.innerHTML = `<h4>Recommended repairs</h4>
      ${recs.length ? recs.map(r => `<div class="rec-rep">
          <span class="insp-chip r-${esc(r.severity)}">${esc(SEVERITY_LABELS[r.severity] || r.severity)}</span>
          <span class="rec-rep-text">${esc(r.description)}</span>
          ${canDecide ? `<select class="rec-rep-status" data-rec="${r.id}" aria-label="Status">${Object.keys(REC_STATUS_LABELS).map(k => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${REC_STATUS_LABELS[k]}</option>`).join('')}</select>`
            : `<span class="rec-tag">${esc(REC_STATUS_LABELS[r.status] || r.status)}</span>`}
        </div>`).join('') : '<p class="meta">None yet. Findings marked for repair during an inspection appear here.</p>'}
      ${opts.canWork ? `<div class="insp-start"><input id="recNewText" maxlength="500" placeholder="Add a recommended repair"><button type="button" id="recAddBtn">Add</button></div>` : ''}`;
    recBox.querySelectorAll('.rec-rep-status').forEach(sel => sel.onchange = async () => {
      const { error } = await sb.from('recommended_repairs').update({ status: sel.value }).eq('id', Number(sel.dataset.rec));
      if(error){ alert('Could not update: ' + error.message); return; }
      recordsToast('Marked ' + REC_STATUS_LABELS[sel.value].toLowerCase());
    });
    const add = document.getElementById('recAddBtn');
    if(add) add.onclick = async () => {
      const input = document.getElementById('recNewText');
      const text = input.value.trim();
      if(!text) return;
      add.disabled = true;
      const { error } = await sb.from('recommended_repairs').insert([{ job_id: job.id, description: text }]);
      add.disabled = false;
      if(error){ alert('Could not add: ' + error.message); return; }
      input.value = '';
      recordsToast('Recommended repair added');
      loadRoInspections(job, opts);
    };
  }
  const start = document.getElementById('inspStartBtn');
  if(start) start.onclick = async () => {
    const tid = Number(document.getElementById('inspTemplate').value);
    if(!tid){ alert('Pick a checklist first.'); return; }
    start.disabled = true;
    const { data, error } = await sb.rpc('start_inspection', { p_job: job.id, p_template: tid });
    start.disabled = false;
    if(error){ alert('Could not start the inspection: ' + error.message); return; }
    openInspection(Number(data));
  };
}

async function fillTemplatePicker(job){
  const sel = document.getElementById('inspTemplate');
  if(!sel) return;
  const [tRes, uRes] = await Promise.all([
    sb.from('inspection_templates').select('id, name, unit_type, org_id').eq('active', true).order('name'),
    job.unit_id ? sb.from('units').select('unit_type').eq('id', job.unit_id).maybeSingle() : Promise.resolve({ data:null })
  ]);
  const unitType = uRes.data ? uRes.data.unit_type : null;
  const ts = (tRes.data || []).slice().sort((a, b) => {
    const fit = t => (unitType && t.unit_type === unitType ? 0 : t.unit_type === 'any' ? 1 : 2);
    return fit(a) - fit(b) || (a.org_id ? 0 : 1) - (b.org_id ? 0 : 1) || a.name.localeCompare(b.name);
  });
  sel.innerHTML = ts.map(t => `<option value="${t.id}">${esc(t.name)}${t.org_id ? '' : ' (built-in)'}</option>`).join('') || '<option value="">No checklists available</option>';
}

// ---------------- Inspection screen ----------------
async function openInspection(inspId){
  const overlay = document.getElementById('inspModal');
  const body = document.getElementById('inspBody');
  if(!overlay || !body) return;
  body.innerHTML = '<div class="meta" style="padding:24px;">Loading inspection…</div>';
  overlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const { data: insp, error } = await sb.from('inspections')
    .select('id, job_id, unit_id, template_name, status, odometer, notes, started_at, completed_at, inspected_by').eq('id', inspId).maybeSingle();
  if(error || !insp){ body.innerHTML = '<div class="form-error" style="padding:24px;">This inspection could not be loaded, or you do not have access to it.</div>'; return; }
  const [itemsRes, jobRes, photosRes, byRes] = await Promise.all([
    sb.from('inspection_items').select('id, position, section, label, result, notes, recommend').eq('inspection_id', inspId).order('position'),
    sb.from('jobs').select('id, ro_number, customer, vehicle, mechanic_id, org_id').eq('id', insp.job_id).maybeSingle(),
    sb.from('job_attachments').select('id, file_path, file_name, file_type, inspection_item_id').eq('job_id', insp.job_id).not('inspection_item_id', 'is', null),
    insp.inspected_by ? sb.from('profiles').select('name').eq('id', insp.inspected_by).maybeSingle() : Promise.resolve({ data:null })
  ]);
  const job = jobRes.data || { id: insp.job_id };
  const canWork = session.role === 'admin' || (session.role === 'shop' && job.org_id === session.orgId) || (session.role === 'mechanic' && job.mechanic_id === session.id);
  const photos = {};
  (photosRes.data || []).forEach(p => { (photos[p.inspection_item_id] = photos[p.inspection_item_id] || []).push(p); });
  inspCurrent = { insp, items: itemsRes.data || [], job, photos, inspector: byRes.data ? byRes.data.name : '',
                  editable: canWork && insp.status === 'in_progress', canReopen: insp.status === 'completed' && (session.role === 'shop' || session.role === 'admin') };
  if(inspCurrent.editable) renderInspectionEditor(); else renderInspectionReport();
  loadInspectionThumbs();
}

function inspHeaderHtml(){
  const { insp, job } = inspCurrent;
  return `<div class="insp-head">
    <div><div class="ro-head-num">${esc(job.ro_number || '')}</div>
      <h2>${esc(insp.template_name)}</h2>
      <div class="meta">${esc(job.customer || '')}${job.vehicle ? ' — ' + esc(job.vehicle) : ''} · ${insp.status === 'completed' ? 'completed ' + fmtDateTime(insp.completed_at) : 'started ' + fmtDateTime(insp.started_at)}${inspCurrent.inspector ? ' · ' + esc(inspCurrent.inspector) : ''}</div></div>
  </div>`;
}
function groupBySection(items){
  const groups = [];
  items.forEach(it => {
    const key = it.section || 'Items';
    let g = groups.find(x => x.name === key);
    if(!g){ g = { name:key, items:[] }; groups.push(g); }
    g.items.push(it);
  });
  return groups;
}

function renderInspectionEditor(){
  const body = document.getElementById('inspBody');
  const { insp, items } = inspCurrent;
  body.innerHTML = `${inspHeaderHtml()}
    <div class="insp-meta-row">
      <div class="field"><label>Odometer (miles)</label><input id="inspOdo" type="number" min="0" inputmode="numeric" value="${insp.odometer != null ? insp.odometer : ''}"></div>
      <div class="field insp-notes-field"><label>General notes</label><input id="inspNotes" maxlength="4000" value="${esc(insp.notes || '')}" placeholder="Optional"></div>
    </div>
    ${groupBySection(items).map(g => `<section class="insp-group"><h4>${esc(g.name)}</h4>${g.items.map(itemEditorHtml).join('')}</section>`).join('')}
    <div class="insp-footer">
      <span class="insp-progress" id="inspProgress"></span>
      <button type="button" class="ghost-btn" id="inspRestGood">Mark the rest Good</button>
      <button type="button" id="inspComplete">Complete inspection</button>
    </div>`;
  body.querySelectorAll('.insp-item').forEach(wireItemEditor);
  const odo = document.getElementById('inspOdo');
  odo.onchange = () => saveInspectionField({ odometer: odo.value === '' ? null : Math.max(0, parseInt(odo.value, 10) || 0) });
  const notes = document.getElementById('inspNotes');
  notes.onchange = () => saveInspectionField({ notes: notes.value.trim() || null });
  document.getElementById('inspRestGood').onclick = markRestGood;
  document.getElementById('inspComplete').onclick = completeInspection;
  updateInspProgress();
}

function itemEditorHtml(it){
  const needsDetail = it.result === 'repair' || it.result === 'monitor';
  return `<div class="insp-item${it.result ? ' has-' + it.result : ''}" data-item="${it.id}">
    <div class="insp-item-label">${esc(it.label)}</div>
    <div class="insp-seg" role="group" aria-label="${esc(it.label)}">
      ${['good','monitor','repair','na'].map(r => `<button type="button" class="seg-${r}${it.result === r ? ' on' : ''}" data-r="${r}" aria-pressed="${it.result === r}">${RESULT_SHORT[r]}</button>`).join('')}
    </div>
    <div class="insp-detail${needsDetail ? '' : ' hidden'}">
      <textarea class="insp-note" rows="2" maxlength="2000" placeholder="What did you find?">${esc(it.notes || '')}</textarea>
      <label class="rec-check"><input type="checkbox" class="insp-rec" ${it.recommend ? 'checked' : ''}> Recommend repair</label>
    </div>
    <div class="insp-media">
      <label class="insp-cam">📷 Photo / video<input type="file" accept="image/*,video/*" capture="environment" class="insp-file" hidden></label>
      <span class="insp-thumbs" data-thumbs="${it.id}"></span>
    </div>
  </div>`;
}

function wireItemEditor(el){
  const id = Number(el.dataset.item);
  el.querySelectorAll('.insp-seg button').forEach(b => b.onclick = async () => {
    const it = inspCurrent.items.find(x => x.id === id);
    const r = b.dataset.r;
    const prev = { result: it.result, recommend: it.recommend };
    // Repair-required findings are recommended by default; Monitor is opt-in.
    const recommend = r === 'repair' ? (prev.result === 'repair' ? it.recommend : true) : (r === 'monitor' ? it.recommend && prev.result === 'monitor' : false);
    it.result = r; it.recommend = recommend;
    paintItem(el, it);
    const { error } = await sb.from('inspection_items').update({ result: r, recommend }).eq('id', id);
    if(error){ Object.assign(it, prev); paintItem(el, it); alert('Could not save: ' + error.message); }
  });
  const note = el.querySelector('.insp-note');
  note.onchange = async () => {
    const it = inspCurrent.items.find(x => x.id === id);
    it.notes = note.value.trim() || null;
    const { error } = await sb.from('inspection_items').update({ notes: it.notes }).eq('id', id);
    if(error) alert('Could not save the note: ' + error.message);
  };
  const rec = el.querySelector('.insp-rec');
  rec.onchange = async () => {
    const it = inspCurrent.items.find(x => x.id === id);
    it.recommend = rec.checked;
    const { error } = await sb.from('inspection_items').update({ recommend: it.recommend }).eq('id', id);
    if(error){ rec.checked = !rec.checked; it.recommend = rec.checked; alert('Could not save: ' + error.message); }
  };
  const file = el.querySelector('.insp-file');
  file.onchange = () => uploadItemMedia(id, file);
}

function paintItem(el, it){
  el.className = 'insp-item' + (it.result ? ' has-' + it.result : '');
  el.querySelectorAll('.insp-seg button').forEach(b => { const on = b.dataset.r === it.result; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const detail = el.querySelector('.insp-detail');
  detail.classList.toggle('hidden', !(it.result === 'repair' || it.result === 'monitor'));
  el.querySelector('.insp-rec').checked = !!it.recommend;
  updateInspProgress();
}

function updateInspProgress(){
  const done = inspCurrent.items.filter(i => i.result).length;
  const total = inspCurrent.items.length;
  const p = document.getElementById('inspProgress');
  if(p) p.textContent = `${done} of ${total} checked`;
  const btn = document.getElementById('inspComplete');
  if(btn) btn.disabled = done < total;
  const rest = document.getElementById('inspRestGood');
  if(rest) rest.disabled = done === total;
}

async function saveInspectionField(fields){
  const { error } = await sb.from('inspections').update(fields).eq('id', inspCurrent.insp.id);
  if(error){ alert('Could not save: ' + error.message); return; }
  Object.assign(inspCurrent.insp, fields);
}

async function markRestGood(){
  const blanks = inspCurrent.items.filter(i => !i.result);
  if(!blanks.length) return;
  if(!confirm(`Mark the ${blanks.length} unchecked item${blanks.length === 1 ? '' : 's'} as Good?`)) return;
  const { error } = await sb.from('inspection_items').update({ result: 'good', recommend: false })
    .eq('inspection_id', inspCurrent.insp.id).is('result', null);
  if(error){ alert('Could not save: ' + error.message); return; }
  blanks.forEach(i => { i.result = 'good'; i.recommend = false; });
  document.querySelectorAll('#inspBody .insp-item').forEach(el => paintItem(el, inspCurrent.items.find(x => x.id === Number(el.dataset.item))));
}

async function completeInspection(){
  const btn = document.getElementById('inspComplete');
  btn.disabled = true;
  const { data, error } = await sb.rpc('complete_inspection', { p_inspection: inspCurrent.insp.id });
  if(error){ updateInspProgress(); alert(error.message); return; }
  const n = Number(data) || 0;
  recordsToast(n ? `Inspection complete — ${n} recommended repair${n === 1 ? '' : 's'} added` : 'Inspection complete');
  const jobId = inspCurrent.job.id;
  closeInspection();
  if(typeof openRepairOrder === 'function' && document.getElementById('roModal') && !document.getElementById('roModal').classList.contains('hidden')) openRepairOrder(jobId);
  if(typeof refreshInspectionsPage === 'function') refreshInspectionsPage();
}

// Photos: shrink to at most 1600 px (JPEG) before upload so they send fast on mobile data.
function compressImage(file){
  return new Promise(resolve => {
    if(!/^image\/(jpeg|png|webp|heic|heif)/i.test(file.type) || typeof createImageBitmap !== 'function'){ resolve(file); return; }
    createImageBitmap(file).then(bmp => {
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      c.toBlob(b => resolve(b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type:'image/jpeg' }) : file), 'image/jpeg', 0.8);
    }).catch(() => resolve(file));
  });
}

async function uploadItemMedia(itemId, input){
  let file = input.files[0];
  if(!file) return;
  const isVideo = /^video\//.test(file.type);
  if(isVideo && file.size > MAX_VIDEO_BYTES){ alert('That video is over 50 MB. Record a shorter clip.'); input.value = ''; return; }
  if(!isVideo){
    file = await compressImage(file);
    if(file.size > 10 * 1024 * 1024){ alert('That photo is too big (10 MB max).'); input.value = ''; return; }
  }
  const thumbs = document.querySelector(`[data-thumbs="${itemId}"]`);
  if(thumbs) thumbs.insertAdjacentHTML('beforeend', '<span class="insp-uploading">Uploading…</span>');
  const jobId = inspCurrent.job.id;
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${jobId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await sb.storage.from('job-attachments').upload(path, file);
  if(upErr){ alert('Upload failed: ' + upErr.message); input.value = ''; loadInspectionThumbs(); return; }
  const { data, error } = await sb.from('job_attachments').insert([{ job_id: jobId, uploader_id: session.id, file_path: path, file_name: safeName, file_type: file.type, photo_type: 'general', inspection_item_id: itemId }]).select('id, file_path, file_name, file_type, inspection_item_id');
  input.value = '';
  if(error){ alert('The file uploaded but could not be linked: ' + error.message); return; }
  (inspCurrent.photos[itemId] = inspCurrent.photos[itemId] || []).push(data[0]);
  loadInspectionThumbs();
}

async function loadInspectionThumbs(){
  if(!inspCurrent) return;
  const all = Object.values(inspCurrent.photos).flat();
  if(!all.length){ document.querySelectorAll('[data-thumbs]').forEach(t => t.innerHTML = ''); return; }
  const { data } = await sb.storage.from('job-attachments').createSignedUrls(all.map(p => p.file_path), 3600);
  const urlByPath = {};
  (data || []).forEach(d => { if(d && d.signedUrl) urlByPath[d.path] = d.signedUrl; });
  document.querySelectorAll('[data-thumbs]').forEach(t => {
    const list = inspCurrent.photos[Number(t.dataset.thumbs)] || [];
    t.innerHTML = list.map(p => {
      const url = urlByPath[p.file_path];
      if(!url) return '';
      return /^video\//.test(p.file_type || '')
        ? `<a class="insp-thumb insp-thumb-video" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(p.file_name)}">▶</a>`
        : `<a class="insp-thumb" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="${esc(p.file_name)}" loading="lazy"></a>`;
    }).join('');
  });
}

// ---------------- Report (read-only, printable) ----------------
function renderInspectionReport(){
  const body = document.getElementById('inspBody');
  const { insp, items } = inspCurrent;
  const c = resultCounts(items);
  const findings = items.filter(i => i.result === 'repair').concat(items.filter(i => i.result === 'monitor'));
  body.innerHTML = `${inspHeaderHtml()}
    <div class="insp-summary">${countsChipsHtml(c)}${insp.odometer != null ? `<span class="meta">Odometer ${Number(insp.odometer).toLocaleString()} mi</span>` : ''}</div>
    ${insp.status !== 'completed' ? '<p class="insp-banner">This inspection is still in progress.</p>' : ''}
    ${insp.notes ? `<p class="insp-gen-notes">${esc(insp.notes)}</p>` : ''}
    <section class="insp-group"><h4>Findings</h4>
      ${findings.length ? findings.map(it => `<div class="insp-finding r-${it.result}">
          <div><span class="insp-chip r-${it.result}">${RESULT_LABELS[it.result]}</span> <b>${esc(it.section ? it.section + ': ' : '')}${esc(it.label)}</b></div>
          ${it.notes ? `<p>${esc(it.notes)}</p>` : ''}
          <span class="insp-thumbs" data-thumbs="${it.id}"></span></div>`).join('') : '<p class="meta">No problems found.</p>'}
    </section>
    ${groupBySection(items).map(g => `<section class="insp-group"><h4>${esc(g.name)}</h4>
      <table class="insp-table">${g.items.map(it => `<tr><td>${esc(it.label)}${it.notes && it.result !== 'repair' && it.result !== 'monitor' ? `<div class="meta">${esc(it.notes)}</div>` : ''}</td><td class="insp-res r-${it.result || 'blank'}">${it.result ? RESULT_LABELS[it.result] : '—'}</td></tr>`).join('')}</table></section>`).join('')}
    <div class="insp-footer insp-no-print">
      ${inspCurrent.canReopen ? '<button type="button" class="ghost-btn" id="inspReopen">Reopen for changes</button>' : ''}
      <button type="button" id="inspPrint">Print / Save as PDF</button>
    </div>`;
  document.getElementById('inspPrint').onclick = () => { document.body.classList.add('printing-insp'); window.print(); setTimeout(() => document.body.classList.remove('printing-insp'), 500); };
  const reopen = document.getElementById('inspReopen');
  if(reopen) reopen.onclick = async () => {
    if(!confirm('Reopen this inspection so it can be corrected? Recommendations already approved or declined stay as they are.')) return;
    const { error } = await sb.from('inspections').update({ status: 'in_progress' }).eq('id', insp.id);
    if(error){ alert('Could not reopen: ' + error.message); return; }
    openInspection(insp.id);
  };
}

function closeInspection(){
  const o = document.getElementById('inspModal');
  if(o) o.classList.add('hidden');
  if(!document.getElementById('roModal') || document.getElementById('roModal').classList.contains('hidden')) document.body.classList.remove('modal-open');
  inspCurrent = null;
}

// ---------------- Inspections tab (shop) ----------------
let inspHistory = [];
async function refreshInspectionsPage(){
  const box = document.getElementById('inspectionsList');
  if(!box) return;
  const { data, error } = await sb.from('inspections')
    .select('id, template_name, status, started_at, completed_at, job_id, jobs(ro_number, customer, vehicle), inspection_items(result)')
    .eq('org_id', session.orgId).order('started_at', { ascending:false }).limit(300);
  if(error){ box.innerHTML = '<div class="form-error">Could not load inspections.</div>'; return; }
  inspHistory = data || [];
  renderInspectionsList();
  refreshTemplatesList();
}
function renderInspectionsList(){
  const box = document.getElementById('inspectionsList');
  const q = (document.getElementById('inspSearch').value || '').trim().toLowerCase();
  const onlyRepairs = document.getElementById('inspOnlyRepairs').checked;
  const rows = inspHistory.filter(i => {
    const j = i.jobs || {};
    const c = resultCounts(i.inspection_items);
    if(onlyRepairs && !c.repair) return false;
    return !q || [j.ro_number, j.customer, j.vehicle, i.template_name].some(v => v && String(v).toLowerCase().includes(q));
  });
  document.getElementById('inspCount').textContent = rows.length + (rows.length === 1 ? ' inspection' : ' inspections');
  box.innerHTML = rows.length ? rows.map(i => {
    const j = i.jobs || {}; const c = resultCounts(i.inspection_items);
    return `<button type="button" class="rec-row" data-insp="${i.id}">
      <div class="rec-main"><b>${esc(j.customer || '')} — ${esc(j.vehicle || '')}</b>
        <div class="meta">${esc(j.ro_number || '')} · ${esc(i.template_name)} · ${fmtDate(i.completed_at || i.started_at)}</div></div>
      <div class="rec-side">${countsChipsHtml(c)}${i.status === 'completed' ? '' : '<span class="rec-tag">In progress</span>'}</div></button>`;
  }).join('') : `<div class="empty-note">${inspHistory.length ? 'No inspections match.' : 'No inspections yet. Start one from any repair order.'}</div>`;
  box.querySelectorAll('[data-insp]').forEach(b => b.onclick = () => openInspection(Number(b.dataset.insp)));
}

// Templates: built-ins can be duplicated; a shop's own can be edited.
// Editing uses plain lines: "Section: Item" (the section part is optional).
let inspTemplates = [];
async function refreshTemplatesList(){
  const box = document.getElementById('templatesList');
  if(!box) return;
  const { data } = await sb.from('inspection_templates').select('id, org_id, name, unit_type, items, active').order('name');
  inspTemplates = data || [];
  box.innerHTML = inspTemplates.map(t => `<div class="rec-row tpl-row${t.active ? '' : ' is-inactive'}">
      <div class="rec-main"><b>${esc(t.name)}</b><div class="meta">${t.org_id ? 'Your checklist' : 'Built-in'} · ${esc(t.unit_type === 'any' ? 'Any unit' : t.unit_type === 'truck' ? 'Trucks' : 'Trailers')} · ${t.items.length} items${t.active ? '' : ' · inactive'}</div></div>
      <div class="rec-side">${t.org_id ? `<button type="button" class="ghost-btn" data-edit-tpl="${t.id}">Edit</button>` : ''}<button type="button" class="ghost-btn" data-copy-tpl="${t.id}">Duplicate</button></div>
    </div>`).join('');
  box.querySelectorAll('[data-edit-tpl]').forEach(b => b.onclick = () => openTemplateForm(Number(b.dataset.editTpl), false));
  box.querySelectorAll('[data-copy-tpl]').forEach(b => b.onclick = () => openTemplateForm(Number(b.dataset.copyTpl), true));
}
function itemsToLines(items){ return items.map(i => (i.section ? i.section + ': ' : '') + i.label).join('\n'); }
function linesToItems(text){
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const k = l.indexOf(':');
    return k > 0 && k <= 60 ? { section: l.slice(0, k).trim(), label: l.slice(k + 1).trim() } : { section: '', label: l };
  }).filter(i => i.label);
}
function openTemplateForm(id, duplicate){
  const src = id ? inspTemplates.find(t => t.id === id) : null;
  const editing = src && !duplicate;
  const box = document.getElementById('templateFormBox');
  box.innerHTML = `<div class="card rec-form">
    <div class="rec-form-head"><h3>${editing ? 'Edit checklist' : 'New checklist'}</h3><button type="button" class="ghost" id="tfClose">Close</button></div>
    <div class="rec-grid">
      <div class="field"><label>Name *</label><input id="tfName" maxlength="100" value="${src ? esc(duplicate ? src.name + ' (copy)' : src.name) : ''}"></div>
      <div class="field"><label>For</label><select id="tfType">${[['trailer','Trailers'],['truck','Trucks'],['any','Any unit']].map(([v, l]) => `<option value="${v}" ${(src ? src.unit_type : 'trailer') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field rec-span"><label>Items — one per line, "Section: Item"</label><textarea id="tfItems" rows="14" class="mono">${src ? esc(itemsToLines(src.items)) : 'Brakes: Brake shoes and drums\nLights: Brake lights'}</textarea></div>
      ${editing ? `<label class="rec-check"><input type="checkbox" id="tfActive" ${src.active ? 'checked' : ''}> Active (shown when starting an inspection)</label>` : ''}
    </div>
    <p class="meta">Changes apply to new inspections. Inspections already started keep the items they started with.</p>
    <p class="form-error" id="tfError"></p>
    <div class="job-actions"><button type="button" id="tfSave">${editing ? 'Save checklist' : 'Create checklist'}</button></div></div>`;
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior:'smooth', block:'start' });
  document.getElementById('tfClose').onclick = () => { box.innerHTML = ''; box.classList.add('hidden'); };
  document.getElementById('tfSave').onclick = async () => {
    const err = document.getElementById('tfError'); err.textContent = '';
    const name = document.getElementById('tfName').value.trim();
    const items = linesToItems(document.getElementById('tfItems').value);
    if(!name){ err.textContent = 'Give the checklist a name.'; return; }
    if(!items.length){ err.textContent = 'Add at least one item.'; return; }
    if(items.length > 200){ err.textContent = 'A checklist can have at most 200 items.'; return; }
    const row = { name, unit_type: document.getElementById('tfType').value, items };
    if(editing) row.active = document.getElementById('tfActive').checked;
    const res = editing ? await sb.from('inspection_templates').update(row).eq('id', src.id)
                        : await sb.from('inspection_templates').insert([{ ...row, org_id: session.orgId }]);
    if(res.error){ err.textContent = res.error.code === '23505' ? 'You already have a checklist with that name.' : res.error.message; return; }
    recordsToast(editing ? 'Checklist saved' : 'Checklist created');
    box.innerHTML = ''; box.classList.add('hidden');
    refreshTemplatesList();
  };
}

function initInspectionsUI(){
  const s = document.getElementById('inspSearch');
  if(s){
    s.oninput = renderInspectionsList;
    document.getElementById('inspOnlyRepairs').onchange = renderInspectionsList;
    document.getElementById('newTemplateBtn').onclick = () => openTemplateForm(null, false);
    refreshInspectionsPage();
    document.querySelectorAll('.dash-tab[data-target="shop-inspections"]').forEach(t => t.addEventListener('click', refreshInspectionsPage));
  }
}

document.addEventListener('click', (e) => {
  if(e.target.id === 'inspModal' || e.target.closest('#inspClose')) closeInspection();
});
document.addEventListener('keydown', (e) => {
  const o = document.getElementById('inspModal');
  if(e.key === 'Escape' && o && !o.classList.contains('hidden')){ e.stopImmediatePropagation(); closeInspection(); }
}, true);
