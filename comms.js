// ============================================================
// RelayFleet — Phase 9: customer communication.
// Messages are queued in the database (notification_outbox) by triggers
// and actions; the send-notifications Edge Function delivers them. The
// app nudges it after an action; a Supabase Cron job also runs it every
// minute so nothing waits on someone having the app open.
// ============================================================

const NOTIFY_EVENTS = [
  ['job_received','Job received'], ['mechanic_assigned','Mechanic assigned'], ['en_route','Mechanic on the way'], ['arrived','Mechanic arrived'],
  ['diagnosis_complete','Diagnosis complete'], ['estimate_approved','Estimate approved (confirmation)'], ['repair_started','Repair started'],
  ['repair_completed','Repair completed'], ['payment_received','Payment received (receipt)']
];
const EVENT_LABEL = Object.fromEntries([...NOTIFY_EVENTS, ['review_request','Review request'], ['custom','Message from the shop']]);
const OUT_STATUS = { queued:'Sending…', sending:'Sending…', sent:'Sent', failed:'Failed', skipped:'Not sent' };

// Ask the sender to deliver this shop's queued messages now (debounced).
let notifyTimer = null;
function notifyKick(){
  if(!session || !['shop','mechanic'].includes(session.role)) return;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    try { await sb.functions.invoke('send-notifications', { body: {} }); } catch(e){ console.warn('send-notifications', e); }
  }, 1500);
}

// ---------------- Repair Order: customer updates ----------------
async function loadRoComms(job, opts){
  const box = document.getElementById('roComms2');
  if(!box) return;
  const isShop = opts.isShop;
  const [outRes, revRes] = await Promise.all([
    sb.from('notification_outbox').select('id, event, channel, to_address, subject, body, status, skip_reason, error, created_at, sent_at').eq('job_id', job.id).order('created_at', { ascending:false }).limit(100),
    isShop ? sb.from('review_requests').select('requested_at, opened_at, open_count').eq('job_id', job.id).order('requested_at', { ascending:false }).limit(1) : Promise.resolve({ data:[] })
  ]);
  const rows = outRes.data || [];
  const rev = (revRes.data || [])[0];
  const done = ['complete','invoiced','paid'].includes(job.status);
  if(!isShop && !rows.length){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<h4>Customer updates</h4>
    ${rows.length ? `<div class="comm-list">${rows.map(r => `<div class="comm-row st-${esc(r.status)}">
        <div class="comm-main"><b>${esc(EVENT_LABEL[r.event] || r.event)}</b> <span class="meta">· ${r.channel === 'sms' ? 'Text' : 'Email'}${r.to_address && isShop ? ' to ' + esc(r.to_address) : ''}</span>
          <div class="meta">${esc(r.event === 'custom' ? (r.subject || '') + ' — ' + (r.body || '').slice(0, 120) : (r.body || '').slice(0, 140))}</div></div>
        <div class="comm-side"><span class="comm-status">${esc(OUT_STATUS[r.status] || r.status)}${r.status === 'skipped' && r.skip_reason ? ': ' + esc(r.skip_reason) : ''}${r.status === 'failed' && r.error ? ': ' + esc(r.error) : ''}</span>
          <span class="meta">${fmtDateTime(r.sent_at || r.created_at)}</span></div></div>`).join('')}</div>`
      : '<p class="meta">No updates sent yet. They go out automatically as the job moves along.</p>'}
    ${isShop ? `
      <div class="comm-review">${rev ? `Review requested ${fmtDateTime(rev.requested_at)} · ${rev.opened_at ? `<b class="pos">opened</b> ${fmtDateTime(rev.opened_at)}${rev.open_count > 1 ? ' (' + rev.open_count + '×)' : ''}` : 'not opened yet'}` : ''}
        ${done ? `<button type="button" class="ghost-btn" id="commReview">${rev ? 'Ask again' : 'Ask for a review'}</button>` : '<span class="meta">You can ask for a review once the job is completed.</span>'}</div>
      <details class="comm-compose"><summary>Message the customer</summary>
        <div class="field"><label>Subject</label><input id="commSubject" maxlength="200" placeholder="e.g. Parts update"></div>
        <div class="field"><label>Message</label><textarea id="commBody" rows="3" maxlength="4000" placeholder="Write your message…"></textarea></div>
        <p class="form-error" id="commErr"></p><button type="button" id="commSend">Send email</button></details>` : ''}`;
  const send = document.getElementById('commSend');
  if(send) send.onclick = async () => {
    send.disabled = true;
    const { error } = await sb.rpc('send_customer_message', { p_job: job.id, p_subject: document.getElementById('commSubject').value, p_body: document.getElementById('commBody').value });
    send.disabled = false;
    if(error){ document.getElementById('commErr').textContent = error.message; return; }
    recordsToast('Message queued'); notifyKick(); setTimeout(() => loadRoComms(job, opts), 2500); loadRoComms(job, opts);
  };
  const rb = document.getElementById('commReview');
  if(rb) rb.onclick = async () => {
    if(rev && !confirm('A review was already requested for this job. Send another?')) return;
    const { error } = await sb.rpc('request_review', { p_job: job.id, p_email: null, p_resend: !!rev });
    if(error){ alert(error.message); return; }
    recordsToast('Review request queued'); notifyKick(); loadRoComms(job, opts);
  };
}

// ---------------- Settings (Billing page) ----------------
async function loadNotifySettings(){
  const box = document.getElementById('notifySettings');
  if(!box || !session || session.role !== 'shop') return;
  const { data } = await sb.from('organizations').select('notify_events, auto_review, review_link').eq('id', session.orgId).maybeSingle();
  const on = new Set((data && data.notify_events) || []);
  box.innerHTML = `<div class="section-head" style="margin-top:22px;"><h2>Customer updates</h2></div>
    <div class="card new-job-form" style="max-width:640px;">
      <p class="meta" style="margin-top:0;">Emails sent automatically to the customer on each repair order. Customers can be opted out on their customer page. Estimates and invoices are emailed when you send them, as before.</p>
      <div class="skill-grid">${NOTIFY_EVENTS.map(([k, l]) => `<label class="rec-check"><input type="checkbox" value="${k}" ${on.has(k) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <div class="field" style="margin-top:10px;"><label>Ask for a review automatically</label>
        <select id="nsAutoReview"><option value="off">Off — I'll ask from the repair order</option><option value="on_complete" ${data && data.auto_review === 'on_complete' ? 'selected' : ''}>When a job is completed</option><option value="on_paid" ${data && data.auto_review === 'on_paid' ? 'selected' : ''}>When the invoice is paid</option></select>
        ${data && !data.review_link ? '<p class="meta">Add your review link above for review requests to work.</p>' : ''}</div>
      <p class="meta">Text messages: ready to switch on once a texting provider is connected. Until then, texts are recorded as "not set up".</p>
      <p class="form-error" id="nsErr"></p><button type="button" id="nsSave">Save customer updates</button>
    </div>`;
  document.getElementById('nsSave').onclick = async () => {
    const events = [...box.querySelectorAll('.skill-grid input:checked')].map(i => i.value);
    const { error } = await sb.from('organizations').update({ notify_events: events, auto_review: document.getElementById('nsAutoReview').value }).eq('id', session.orgId);
    if(error){ document.getElementById('nsErr').textContent = error.message; return; }
    recordsToast('Customer updates saved');
  };
}

function initCommsUI(){
  document.querySelectorAll('.dash-tab[data-target="shop-billing"]').forEach(t => t.addEventListener('click', loadNotifySettings));
  loadNotifySettings();
  notifyKick();   // send anything queued while nobody had the app open
}
