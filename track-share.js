// ============================================================
// RelayFleet — sharing a live tracking link with the customer.
// Shop staff open a work order and press "Share live tracking". They can copy the link,
// email it to the customer on the job, or stop sharing it. The customer needs no account.
// ============================================================
const TRACK_BASE = 'https://relayfleet.us/';

async function openTrackingSheet(jobId){
  const body = document.createElement('div');
  body.innerHTML = `<div class="card rec-form"><div class="rec-form-head"><h3>Share live tracking</h3></div>
    <p class="meta">The customer follows the repair on their phone, with no account needed. For a mobile job they also see the technician's position while on the way or on site. The page shows no prices or contact details.</p>
    <p class="form-error" id="trkErr"></p>
    <div class="field"><label for="trkLink">Link</label><input id="trkLink" readonly value="Creating link…"></div>
    <div class="job-actions" style="flex-wrap:wrap;">
      <button type="button" id="trkCopy">Copy link</button>
      <button type="button" class="ghost-btn" id="trkEmail">Email it to the customer</button>
      <button type="button" class="ghost-btn" id="trkStop">Stop sharing</button>
    </div></div>`;
  if(typeof openFormSheet === 'function') openFormSheet('Live tracking', [body]);
  const err = m => { const e = body.querySelector('#trkErr'); if(e) e.textContent = m || ''; };
  const linkEl = body.querySelector('#trkLink');
  const { data, error } = await sb.rpc('shop_tracking_link', { p_job: Number(jobId) });
  if(error){ linkEl.value = ''; err(friendlyError(error, 'Could not create the link').message); return; }
  linkEl.value = TRACK_BASE + data;
  body.querySelector('#trkCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(linkEl.value); if(typeof recordsToast === 'function') recordsToast('Link copied'); }
    catch(_){ linkEl.select(); err('Could not copy automatically. The link is selected: press Ctrl+C or Cmd+C.'); }
  };
  body.querySelector('#trkEmail').onclick = async () => {
    const b = body.querySelector('#trkEmail'); b.disabled = true; err('');
    const { data: sent, error: e2 } = await sb.rpc('share_tracking_by_email', { p_job: Number(jobId), p_base: TRACK_BASE });
    b.disabled = false;
    if(e2){ err(friendlyError(e2, 'Could not send the link').message); return; }
    if(typeof notifyKick === 'function') notifyKick();
    if(typeof recordsToast === 'function') recordsToast('Sent to the customer. It goes out within a minute.');
  };
  body.querySelector('#trkStop').onclick = async () => {
    if(!(await relayConfirm({ message: 'Stop sharing this link? The customer will no longer be able to open it. You can create a new link later.', confirmText: 'Stop sharing', danger: true }))) return;
    const { error: e3 } = await sb.rpc('revoke_tracking_link', { p_job: Number(jobId) });
    if(e3){ err(friendlyError(e3, 'Could not stop sharing').message); return; }
    linkEl.value = 'Sharing stopped. Create a new link to share again.';
    if(typeof recordsToast === 'function') recordsToast('Sharing stopped');
  };
}

// the "Share live tracking" button on a work order, for shop staff
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#woActTrack');
  if(!b || typeof roCurrentJob === 'undefined' || !roCurrentJob) return;
  openTrackingSheet(roCurrentJob.id);
});
