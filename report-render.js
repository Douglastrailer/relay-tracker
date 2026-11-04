// ============================================================
// RelayFleet — the inspection report, one layout for the app and the shared link.
// Used by insp.js (inside the app) and inspection-report.html (the link a customer opens).
// It only builds HTML from the data it is given; it has no other dependencies.
// ============================================================
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmtDate = v => { if(!v) return '—'; const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' }); };
  const fmtStamp = v => { if(!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-US', { month:'2-digit', day:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); };

  // pass · attention · defective · repaired · na  (repaired = a repair or monitor item whose recommended repair is done)
  function statusOf(it){
    if(it.result === 'good') return 'pass';
    if(!it.result || it.result === 'na') return 'na';
    if(it.repair_status === 'done') return 'repaired';
    return it.result === 'repair' ? 'defective' : 'attention';
  }
  const LABEL = { pass:'Pass', attention:'Attention', defective:'Defective', repaired:'Repaired', na:'Not inspected' };

  // Item codes like the printed form: first two letters of the section + a number within the section (LG1, LG2 …)
  function codesFor(items){
    const count = {};
    return items.map(it => {
      const letters = String(it.section || 'Item').replace(/[^A-Za-z]/g, '').toUpperCase();
      const prefix = (letters || 'IT').slice(0, 2);
      count[prefix] = (count[prefix] || 0) + 1;
      return prefix + count[prefix];
    });
  }

  function summary(items){
    const s = { total: items.length, pass: 0, attention: 0, defective: 0, repaired: 0, na: 0 };
    items.forEach(it => { s[statusOf(it)]++; });
    return s;
  }

  function banner(s){
    if(s.defective === 0 && s.attention === 0)
      return `<div class="rpt-banner ok">ALL INSPECTED COMPONENTS PASSED OR WERE REPAIRED</div>`;
    if(s.defective > 0)
      return `<div class="rpt-banner bad">${s.defective} DEFECTIVE COMPONENT${s.defective === 1 ? '' : 'S'} NEED${s.defective === 1 ? 'S' : ''} REPAIR</div>`;
    return `<div class="rpt-banner warn">${s.attention} COMPONENT${s.attention === 1 ? '' : 'S'} NEED${s.attention === 1 ? 'S' : ''} ATTENTION</div>`;
  }

  function build(d){
    const items = Array.isArray(d.items) ? d.items : [];
    const s = summary(items);
    const codes = codesFor(items);
    const final = d.status === 'completed' || d.completed_at;
    const vehicle = [d.year, d.make, d.model].filter(Boolean).join(' ') || (d.vehicle || '—');

    // group rows by section, keeping the template order
    const groups = [];
    items.forEach((it, i) => {
      const name = it.section || 'Items';
      let g = groups.find(x => x.name === name);
      if(!g){ g = { name, rows: [] }; groups.push(g); }
      g.rows.push({ it, code: codes[i] });
    });

    const rows = groups.map(g => `
      <tr class="rpt-sec"><td colspan="5">${esc(g.name)}</td></tr>
      ${g.rows.map(({ it, code }) => {
        const st = statusOf(it);
        return `<tr>
          <td class="rpt-id">${esc(code)}</td>
          <td>${esc(it.label)}</td>
          <td>${esc(it.where_on_unit || '—')}</td>
          <td><span class="rpt-pill ${st}">${LABEL[st]}</span></td>
          <td class="rpt-note">${it.notes ? esc(it.notes) : '–'}</td>
        </tr>`;
      }).join('')}`).join('');

    const sig = d.signature && String(d.signature).startsWith('data:image/png;base64,')
      ? `<img class="rpt-sig" src="${esc(d.signature)}" alt="Technician signature">` : `<div class="rpt-sigline"></div>`;

    const logo = d.logo_url ? `<img class="rpt-logo" src="${esc(d.logo_url)}" alt="">` : '';

    return `<div class="rpt">
  <div class="rpt-top">
    <div class="rpt-shop">${logo}<div>
      <div class="rpt-shopname">${esc(d.shop || '')}</div>
      <div class="rpt-sub">${esc(d.address || '')}${d.phone ? ' · ' + esc(d.phone) : ''}${d.email ? ' · ' + esc(d.email) : ''}</div>
    </div></div>
    <div class="rpt-title">
      <div class="rpt-h">${esc((d.template || 'Inspection').toUpperCase())} REPORT</div>
      <div class="rpt-sub">${d.work_order ? 'Work order ' + esc(d.work_order) : ''}</div>
    </div>
  </div>

  <div class="rpt-info">
    <div><span>CUSTOMER</span><b>${esc(d.customer || '—')}</b></div>
    <div><span>WORK ORDER</span><b>${esc(d.work_order || '—')}</b></div>
    <div><span>UNIT</span><b>${esc(d.unit || '—')}</b></div>
    <div><span>VIN</span><b>${esc(d.vin || '—')}</b></div>
    <div><span>VEHICLE</span><b>${esc(vehicle)}</b></div>
    <div><span>INSPECTION DATE</span><b>${esc(fmtDate(d.completed_at || d.started_at))}</b></div>
    <div><span>DOT EXPIRATION</span><b>${esc(fmtDate(d.dot_expiration))}</b></div>
    <div><span>REPORT STATUS</span><b class="rpt-status ${final ? 'final' : 'draft'}">${final ? 'FINAL' : 'DRAFT'}</b></div>
  </div>

  <div class="rpt-tiles">
    <div><span>TOTAL</span><b>${s.total}</b></div>
    <div class="pass"><span>PASSED</span><b>${s.pass}</b></div>
    <div class="attention"><span>ATTENTION</span><b>${s.attention}</b></div>
    <div class="defective"><span>DEFECTIVE</span><b>${s.defective}</b></div>
    <div class="repaired"><span>REPAIRED</span><b>${s.repaired}</b></div>
    <div class="na"><span>NOT INSPECTED</span><b>${s.na}</b></div>
  </div>
  ${banner(s)}

  <table class="rpt-table">
    <thead><tr><th>ID</th><th>COMPONENT</th><th>POSITION</th><th>STATUS</th><th>PROBLEM / NOTES</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="rpt-empty">No items on this checklist.</td></tr>'}</tbody>
  </table>

  ${d.notes ? `<div class="rpt-gennotes"><b>Notes:</b> ${esc(d.notes)}</div>` : ''}

  <div class="rpt-foot">
    <div class="rpt-sigbox">${sig}<div class="rpt-signame">${esc(d.signed_name || '')}</div><div class="rpt-lbl">TECHNICIAN SIGNATURE</div></div>
    <div class="rpt-datebox"><div class="rpt-date">${esc(fmtDate(d.completed_at || d.started_at))}</div><div class="rpt-lbl">INSPECTION DATE</div></div>
  </div>
  <div class="rpt-bottom"><span>UNIT ${esc(d.unit || '—')} | VIN ${esc(d.vin || '—')}</span><span>${d.signed_at ? 'Signed ' + esc(fmtStamp(d.signed_at)) : ''}</span></div>
</div>`;
  }

  const CSS = `
.rpt{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1B2430;background:#fff;max-width:900px;margin:0 auto;padding:18px;font-size:12px;}
.rpt *{box-sizing:border-box;}
.rpt-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #0D5C6E;padding-bottom:10px;margin-bottom:12px;}
.rpt-shop{display:flex;gap:10px;align-items:center;}
.rpt-logo{width:44px;height:44px;object-fit:contain;}
.rpt-shopname{font-size:18px;font-weight:800;}
.rpt-title{text-align:right;}
.rpt-h{font-size:18px;font-weight:800;color:#0D5C6E;letter-spacing:.02em;}
.rpt-sub{color:#566172;font-size:11px;margin-top:2px;}
.rpt-info{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;}
.rpt-info>div{border:1px solid #D7DEE2;border-radius:6px;padding:6px 8px;background:#F8FAFB;min-width:0;}
.rpt-info span,.rpt-tiles span{display:block;font-size:9px;font-weight:700;letter-spacing:.06em;color:#566172;}
.rpt-info b{display:block;font-size:12px;overflow-wrap:anywhere;}
.rpt-status.final{color:#1E7B4A;} .rpt-status.draft{color:#C98A00;}
.rpt-tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:10px;}
.rpt-tiles>div{border:1px solid #D7DEE2;border-radius:6px;padding:6px 8px;text-align:center;}
.rpt-tiles b{font-size:20px;font-weight:800;}
.rpt-tiles .pass b{color:#1E7B4A;} .rpt-tiles .attention b{color:#C98A00;} .rpt-tiles .defective b{color:#C62828;} .rpt-tiles .repaired b{color:#1565C0;} .rpt-tiles .na b{color:#6B7280;}
.rpt-banner{padding:8px 12px;border-radius:6px;font-weight:800;text-align:center;letter-spacing:.02em;margin-bottom:12px;}
.rpt-banner.ok{background:#E3F4EA;color:#1E7B4A;} .rpt-banner.warn{background:#FFF4D6;color:#8A5A00;} .rpt-banner.bad{background:#FDE2DE;color:#B42318;}
.rpt-table{width:100%;border-collapse:collapse;font-size:11px;}
.rpt-table th{background:#0D5C6E;color:#fff;text-align:left;padding:6px 6px;font-size:10px;letter-spacing:.04em;}
.rpt-table td{border-bottom:1px solid #E3E8EB;padding:4px 6px;vertical-align:top;}
.rpt-table tr{page-break-inside:avoid;}
.rpt-sec td{background:#EEF4F6;font-weight:800;color:#0D5C6E;font-size:10px;letter-spacing:.05em;text-transform:uppercase;}
.rpt-id{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;white-space:nowrap;}
.rpt-note{color:#3F4A5A;}
.rpt-pill{display:inline-block;min-width:76px;text-align:center;padding:2px 6px;border-radius:4px;color:#fff;font-weight:700;font-size:10px;}
.rpt-pill.pass{background:#1E7B4A;} .rpt-pill.attention{background:#C98A00;} .rpt-pill.defective{background:#C62828;}
.rpt-pill.repaired{background:#1565C0;} .rpt-pill.na{background:#6B7280;}
.rpt-empty{text-align:center;color:#566172;padding:12px;}
.rpt-gennotes{margin-top:10px;padding:8px 10px;background:#F8FAFB;border-radius:6px;}
.rpt-foot{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:22px;}
.rpt-sigbox{flex:1;max-width:420px;}
.rpt-sig{display:block;height:56px;object-fit:contain;}
.rpt-sigline{height:56px;border-bottom:1px solid #1B2430;}
.rpt-signame{font-weight:700;margin-top:4px;}
.rpt-datebox{text-align:right;}
.rpt-date{font-weight:700;font-size:13px;border-bottom:1px solid #1B2430;padding:0 12px 4px;}
.rpt-lbl{font-size:9px;font-weight:700;letter-spacing:.06em;color:#566172;margin-top:4px;}
.rpt-bottom{display:flex;justify-content:space-between;color:#566172;font-size:9px;border-top:1px solid #D7DEE2;margin-top:14px;padding-top:6px;}
@media (max-width:640px){
  .rpt{padding:10px;} .rpt-top{flex-direction:column;} .rpt-title{text-align:left;}
  .rpt-info{grid-template-columns:repeat(2,1fr);} .rpt-tiles{grid-template-columns:repeat(3,1fr);}
  .rpt-table{font-size:10px;} .rpt-table thead{display:none;}
  .rpt-table tr{display:block;border-bottom:1px solid #E3E8EB;padding:4px 0;}
  .rpt-table td{display:inline-block;border:0;padding:2px 4px;} .rpt-table td:nth-child(2){display:block;font-weight:600;}
  .rpt-note{display:block;} .rpt-foot{flex-direction:column;align-items:stretch;}
}
@page{size:letter;margin:12mm;}
@media print{ .rpt{padding:0;max-width:none;} .rpt-table tr{page-break-inside:avoid;} .rpt-foot{page-break-inside:avoid;} }
`;

  function ensureCss(){
    if(document.getElementById('rptStyles')) return;
    const st = document.createElement('style'); st.id = 'rptStyles'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  window.RelayReport = { build, css: CSS, ensureCss, statusOf, summary };
})();
