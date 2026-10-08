// ============================================================
// RelayFleet — in-app PDF viewer. A sheet over the app (the app behind it
// blurred), pages drawn with PDF.js so it works inside the iPhone Home
// Screen app too (no new tabs there). Share (incl. Print / Save to Files),
// Download, Close.
// ============================================================
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfViewState = null;

function loadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PDFJS_URL;
    s.onload = () => { if(window.pdfjsLib){ window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(window.pdfjsLib); } else rej(new Error('PDF reader missing')); };
    s.onerror = () => rej(new Error('Could not load the PDF reader'));
    document.head.appendChild(s);
  });
}
function pdfSheet(){
  let o = document.getElementById('pdfSheet');
  if(o) return o;
  document.body.insertAdjacentHTML('beforeend', `<div id="pdfSheet" class="pdf-overlay hidden" role="dialog" aria-modal="true" aria-label="PDF">
    <div class="pdf-card">
      <div class="pdf-head"><b id="pdfTitle">Document</b><span class="meta" id="pdfPages"></span>
        <div class="pdf-actions"><button type="button" class="ghost-btn hidden" id="pdfShare">Share</button><a class="ghost-btn hidden" id="pdfDownload" download>Download</a><button type="button" class="pdf-close" id="pdfClose" aria-label="Close">×</button></div></div>
      <div class="pdf-body" id="pdfBody"></div>
    </div></div>`);
  o = document.getElementById('pdfSheet');
  o.addEventListener('click', (e) => { if(e.target === o) closePdfViewer(); });
  document.getElementById('pdfClose').onclick = closePdfViewer;
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && !o.classList.contains('hidden')) closePdfViewer(); });
  return o;
}
function closePdfViewer(){
  const o = document.getElementById('pdfSheet'); if(!o) return;
  o.classList.add('hidden'); o.classList.remove('open');
  document.body.classList.remove('pdf-open');
  if(pdfViewState && pdfViewState.url) URL.revokeObjectURL(pdfViewState.url);
  pdfViewState = null;
  document.getElementById('pdfBody').innerHTML = '';
}
async function showPdfInApp(blob, title, fileName){
  const o = pdfSheet();
  const body = document.getElementById('pdfBody');
  document.getElementById('pdfTitle').textContent = title || 'Document';
  document.getElementById('pdfPages').textContent = '';
  o.classList.remove('hidden'); requestAnimationFrame(() => o.classList.add('open'));
  document.body.classList.add('pdf-open');
  const url = URL.createObjectURL(blob);
  pdfViewState = { url, blob, fileName };
  // Share (phones: Messages, Mail, Print, Save to Files) — or Download (computers)
  const file = typeof File === 'function' ? new File([blob], fileName, { type:'application/pdf' }) : null;
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files:[file] }));
  const sh = document.getElementById('pdfShare'), dl = document.getElementById('pdfDownload');
  sh.classList.toggle('hidden', !canShare); dl.classList.toggle('hidden', canShare);
  dl.href = url; dl.download = fileName;
  sh.onclick = async () => { try { await navigator.share({ files:[file], title: title || fileName }); } catch(_){} };
  body.innerHTML = '<div class="pdf-wait"><div class="scan-spin"></div>Opening…</div>';
  try {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    if(!pdfViewState || pdfViewState.url !== url) return;            // closed while loading
    body.innerHTML = '';
    document.getElementById('pdfPages').textContent = doc.numPages + ' page' + (doc.numPages === 1 ? '' : 's');
    const width = Math.min(body.clientWidth || 800, 900) - 16;
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    for(let n = 1; n <= doc.numPages; n++){
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * ratio });
      const c = document.createElement('canvas'); c.className = 'pdf-page'; c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(vp.width / ratio) + 'px'; c.setAttribute('aria-label', 'Page ' + n);
      body.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      if(!pdfViewState || pdfViewState.url !== url) return;
    }
  } catch(e){
    // Fallback: the browser's own viewer inside the sheet (works on computers)
    body.innerHTML = `<iframe class="pdf-frame" src="${url}" title="${esc(title || 'PDF')}"></iframe><p class="meta pdf-note">If the document doesn't show, use ${canShare ? 'Share' : 'Download'}.</p>`;
  }
}
// Every "View PDF" / "PDF" button in Relay goes through this.
async function viewInvoicePdfInApp(invoiceId){
  const o = pdfSheet(); const body = document.getElementById('pdfBody');
  o.classList.remove('hidden'); requestAnimationFrame(() => o.classList.add('open')); document.body.classList.add('pdf-open');
  document.getElementById('pdfTitle').textContent = 'Loading…'; document.getElementById('pdfPages').textContent = '';
  ['pdfShare','pdfDownload'].forEach(id => document.getElementById(id).classList.add('hidden'));
  body.innerHTML = '<div class="pdf-wait"><div class="scan-spin"></div>Getting the PDF…</div>';
  const fail = (msg) => { body.innerHTML = `<div class="pdf-wait"><b>Couldn't open the PDF</b><span class="form-error">${esc(msg)}</span></div>`; document.getElementById('pdfTitle').textContent = 'PDF'; };
  try {
    const { data: { session: s } } = await sb.auth.getSession();
    if(!s) return fail('Your session expired. Refresh and sign in again.');
    const [res, meta] = await Promise.all([
      fetch(`${SUPABASE_URL}/functions/v1/get-invoice-pdf?invoiceId=${invoiceId}`, { headers: { Authorization: `Bearer ${s.access_token}`, apikey: SUPABASE_KEY } }),
      sb.from('invoices').select('id, kind, doc_number').eq('id', invoiceId).maybeSingle()]);
    if(!res.ok){ const b = await res.json().catch(() => ({})); return fail(b.error || res.statusText || 'The PDF could not be made.'); }
    const blob = await res.blob();
    const d = (meta && meta.data) || { id: invoiceId };
    const label = (d.kind === 'estimate' ? 'Estimate ' : 'Invoice ') + (d.doc_number || '#' + invoiceId);
    await showPdfInApp(blob, label, (d.doc_number || ((d.kind || 'invoice') + '-' + invoiceId)) + '.pdf');
  } catch(e){ fail(e.message || String(e)); }
}
