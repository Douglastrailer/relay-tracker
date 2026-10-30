// ============================================================
// RelayFleet — the work order side panel (Order · Customer · Vehicle).
// Key facts stay in view while working on the order, so nobody leaves it to look something up.
// Beside the work order on wide screens; above it, as tabs, on a phone. Shop staff only.
// ============================================================
let woSideTab = 'order';

function woAgo(ts){ return ts ? relayDur((Date.now() - new Date(ts).getTime()) / 60000) : ''; }
function woCap(s){ s = String(s || '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
function woMoney(n){ return '$' + Number(n || 0).toLocaleString(relayLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function woRow(label, value){ return value === '' || value == null ? '' : `<div class="ws-row"><span>${esc(label)}</span><b>${value}</b></div>`; }

async function renderWoSide(job){
  const side = document.getElementById('woSide'); if(!side || !job) return;
  side.innerHTML = '<div class="ws-loading">' + skelRows(5) + '</div>';
  const closed = ['complete', 'invoiced', 'paid', 'cancelled'];
  const [cust, unit, hist, docs, tech, unitJobs, custOpen] = await Promise.all([
    job.customer_id ? sb.from('customers').select('id, company_name, contact_name, phone, email, billing_email, payment_terms, tax_exempt, notes').eq('id', job.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    job.unit_id ? sb.from('units').select('id, unit_number, unit_type, year, make, model, vin, plate, engine, odometer').eq('id', job.unit_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('job_status_history').select('to_status, changed_at').eq('job_id', job.id).order('changed_at', { ascending: false }).limit(1),
    sb.from('invoices').select('doc_number, kind, status, total, created_at').eq('job_id', job.id).order('created_at', { ascending: false }),
    job.mechanic_id ? sb.from('profiles').select('name').eq('id', job.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
    job.unit_id ? sb.from('jobs').select('id, ro_number, complaint, status, created_at').eq('unit_id', job.unit_id).neq('id', job.id).order('created_at', { ascending: false }).limit(4) : Promise.resolve({ data: [] }),
    job.customer_id ? sb.from('jobs').select('id, status').eq('customer_id', job.customer_id) : Promise.resolve({ data: [] })
  ]);
  if(document.getElementById('woSide') !== side) return;   // another work order was opened meanwhile
  const c = cust.data, u = unit.data, last = (hist.data || [])[0];
  const stageSince = last && last.to_status === job.status ? last.changed_at : (last ? last.changed_at : job.created_at);
  const docList = docs.data || [];
  const inv = docList.find(d => d.kind === 'invoice'), est = docList.find(d => d.kind === 'estimate');
  const loc = typeof window !== 'undefined' && window.relayAllLocations ? window.relayAllLocations.find(l => l.id === job.location_id) : null;
  const openCount = (custOpen.data || []).filter(j => !closed.includes(j.status)).length;
  const tabs = [['order', 'Order'], ['customer', 'Customer'], ['vehicle', 'Vehicle']];
  const panes = {
    order: `
      ${woRow('Status', typeof jobStatusBadge === 'function' ? jobStatusBadge(job.status) : esc(job.status))}
      ${closed.includes(job.status) ? '' : woRow('In this stage', esc(woAgo(stageSince)))}
      ${woRow('Opened', esc(new Date(job.created_at).toLocaleDateString(relayLocale(), { month: 'short', day: 'numeric', year: 'numeric' })) + ' · ' + esc(relayFmt('{t} ago', { t: woAgo(job.created_at) })))}
      ${woRow('Service', job.job_type === 'mobile' ? 'Roadside / mobile' : 'In the shop')}
      ${job.priority && job.priority !== 'normal' ? woRow('Priority', esc(job.priority.charAt(0).toUpperCase() + job.priority.slice(1))) : ''}
      ${woRow('Technician', esc((tech.data && tech.data.name) || 'Unassigned'))}
      ${loc && (window.relayAllLocations || []).length > 1 ? woRow('Location', esc(loc.display_name || loc.name)) : ''}
      ${est ? woRow('Estimate', esc(est.doc_number || '') + ' · ' + esc(relayFmt(woCap(est.status))) + ' · ' + woMoney(est.total)) : ''}
      ${inv ? woRow('Invoice', esc(inv.doc_number || '') + ' · ' + esc(relayFmt(woCap(inv.status))) + ' · ' + woMoney(inv.total)) : ''}
      ${job.complaint ? `<div class="ws-note"><span>Reason for visit</span><p>${esc(job.complaint)}</p></div>` : ''}`,
    customer: c ? `
      <div class="ws-title">${esc(c.company_name)}</div>
      ${woRow('Contact', esc(c.contact_name || ''))}
      ${c.phone ? woRow('Phone', `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`) : ''}
      ${(c.billing_email || c.email) ? woRow('Email', `<a href="mailto:${esc(c.billing_email || c.email)}">${esc(c.billing_email || c.email)}</a>`) : ''}
      ${woRow('Payment terms', esc(String(c.payment_terms || 'due_on_receipt').replace(/_/g, ' ')))}
      ${c.tax_exempt ? woRow('Tax', 'Exempt') : ''}
      ${woRow('Open work orders', String(openCount))}
      ${c.notes ? `<div class="ws-note"><span>Notes</span><p>${esc(c.notes)}</p></div>` : ''}
      ${typeof openCustomerProfile === 'function' ? `<button type="button" class="ghost-btn ws-open" data-ws-cust="${c.id}">Open customer</button>` : ''}`
      : `<p class="meta">No customer is linked to this work order.</p>`,
    vehicle: u ? `
      <div class="ws-title">${esc(u.unit_number || 'Unit')}${u.unit_type ? ` <span class="meta">${esc(u.unit_type)}</span>` : ''}</div>
      ${woRow('Year / make / model', esc([u.year, u.make, u.model].filter(Boolean).join(' ')))}
      ${u.vin ? woRow('VIN', `<span class="mono">${esc(u.vin)}</span>`) : ''}
      ${woRow('Plate', esc(u.plate || ''))}
      ${woRow('Engine', esc(u.engine || ''))}
      ${(job.odometer || u.odometer) ? woRow('Odometer', esc(Number(job.odometer || u.odometer).toLocaleString()) + ' mi') : ''}
      <div class="ws-sub">Earlier repairs</div>
      ${(unitJobs.data || []).length ? (unitJobs.data || []).map(r => `<div class="ws-hist"><b>${esc(r.ro_number || '#' + r.id)}</b> <span class="meta">${esc(new Date(r.created_at).toLocaleDateString(relayLocale(), { month: 'short', day: 'numeric', year: 'numeric' }))}</span><div>${esc((r.complaint || '').slice(0, 70))}</div></div>`).join('') : '<p class="meta">No earlier repairs on this unit.</p>'}
      ${typeof openUnitHistory === 'function' ? `<button type="button" class="ghost-btn ws-open" data-ws-unit="${u.id}">Full history</button>` : ''}`
      : `<p class="meta">No unit is linked to this work order.</p>`
  };
  if(!panes[woSideTab]) woSideTab = 'order';
  side.innerHTML = `<div class="ws-tabs" role="tablist" aria-label="Work order details">${tabs.map(([k, l]) => `<button type="button" role="tab" id="wsTab-${k}" aria-controls="wsPane" aria-selected="${k === woSideTab}" class="ws-tab${k === woSideTab ? ' is-on' : ''}" data-ws="${k}">${l}</button>`).join('')}</div>
    <div class="ws-pane" id="wsPane" role="tabpanel" aria-labelledby="wsTab-${woSideTab}">${panes[woSideTab]}</div>`;
  side.querySelectorAll('[data-ws]').forEach(b => b.onclick = () => { woSideTab = b.dataset.ws; renderWoSide(job); });
  const oc = side.querySelector('[data-ws-cust]'); if(oc) oc.onclick = () => openCustomerProfile(Number(oc.dataset.wsCust));
  const ou = side.querySelector('[data-ws-unit]'); if(ou) ou.onclick = () => openUnitHistory(Number(ou.dataset.wsUnit));
}
