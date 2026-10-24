// ============================================================
// RelayFleet — the shop setup that must be finished before the shop uses Relay.
// Two steps: a shop location with an address and a map pin (the Find shops list needs it),
// and the customer updates the shop sends. The owner or office finishes it. Until then the
// rest of the app is blurred behind this panel and cannot be used.
// ============================================================
const SETUP_EVENTS = [
  ['job_received', 'We received your work order'],
  ['mechanic_assigned', 'A technician is assigned'],
  ['en_route', 'The technician is on the way'],
  ['arrived', 'The technician has arrived'],
  ['estimate_approved', 'The estimate is approved'],
  ['repair_completed', 'The repair is complete'],
  ['payment_received', 'Payment is received'],
  ['review_request', 'Ask for a review afterwards']
];

async function checkShopSetupGate(){
  if(!session || session.role !== 'shop') return;
  const { data, error } = await sb.rpc('shop_setup_status');
  if(error || !data) return;                      // never block the app because the check itself failed
  if(!data.needed){ removeSetupGate(); return; }
  showSetupGate(data);
}

function removeSetupGate(){ const g = document.getElementById('setupGate'); if(g) g.remove(); const b = document.getElementById('setupBar'); if(b) b.remove(); document.body.classList.remove('setup-blocked'); }

function showSetupGate(st){
  removeSetupGate();
  const canFinish = session.staffRole === 'owner' || session.staffRole === 'office';
  const gate = document.createElement('div');
  gate.id = 'setupGate'; gate.className = 'setup-gate'; gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-modal', 'true'); gate.setAttribute('aria-labelledby', 'setupGateTitle');
  if(!canFinish){
    gate.innerHTML = `<div class="setup-card"><h2 id="setupGateTitle">Your shop is not set up yet</h2>
      <p class="meta">Ask your shop owner to finish the setup: the shop location and the customer updates. Relay can be used once this is done.</p>
      <div class="job-actions"><button type="button" class="ghost-btn" id="setupOut">Sign out</button></div></div>`;
  } else {
    gate.innerHTML = `<div class="setup-card">
      <h2 id="setupGateTitle">Finish setting up your shop</h2>
      <p class="meta">Two steps. Relay opens once both are done. Your customers see your shop on the Find shops list only after step 1.</p>
      <div class="setup-step ${st.has_location ? 'is-done' : ''}">
        <div class="setup-step-head"><span class="setup-num">${st.has_location ? '✓' : '1'}</span><b>Your shop location</b></div>
        <p class="meta">Add your address and place its pin on the map, so customers and fleets can find you.</p>
        <div class="job-actions"><button type="button" id="setupGoLoc">${st.has_location ? 'Review location' : 'Add my location'}</button><button type="button" class="ghost-btn" id="setupRecheck">I've added it — check again</button></div>
      </div>
      <div class="setup-step">
        <div class="setup-step-head"><span class="setup-num">2</span><b>Customer updates</b></div>
        <p class="meta">Choose which messages your customers receive by email. You can change this later in Settings.</p>
        <div class="setup-events">${SETUP_EVENTS.map(([k, l]) => `<label class="setup-check"><input type="checkbox" value="${k}" checked> ${relayEsc(l)}</label>`).join('')}</div>
      </div>
      <p class="form-error" id="setupErr"></p>
      <div class="job-actions"><button type="button" id="setupFinish">Finish setup</button><button type="button" class="ghost-btn" id="setupOut">Sign out</button></div>
    </div>`;
  }
  document.body.appendChild(gate);
  document.body.classList.add('setup-blocked');
  const out = gate.querySelector('#setupOut'); if(out) out.onclick = () => sb.auth.signOut();
  const goLoc = gate.querySelector('#setupGoLoc');
  if(goLoc) goLoc.onclick = () => {
    // step 1 happens in Settings → Locations. The panel steps aside to a small bar, so the owner
    // can add the location and come straight back. The rest of the app stays unavailable until setup is done.
    minimizeSetupGate();
    const b = document.querySelector('.dash-tab[data-target="shop-billing"]'); if(b) b.click();
    setTimeout(() => { const t = document.querySelector('[data-settab="locations"]'); if(t) t.click(); }, 60);
  };
  const re = gate.querySelector('#setupRecheck');
  if(re) re.onclick = () => checkShopSetupGate();
  const fin = gate.querySelector('#setupFinish');
  if(fin) fin.onclick = async () => {
    const events = [...gate.querySelectorAll('.setup-events input:checked')].map(i => i.value);
    fin.disabled = true; fin.textContent = 'Checking…';
    const { error } = await sb.rpc('complete_shop_setup', { p_events: events });
    fin.disabled = false; fin.textContent = 'Finish setup';
    if(error){
      const f = friendlyError(error, 'Setup is not finished yet');
      gate.querySelector('#setupErr').textContent = f.message;
      return;
    }
    if(typeof recordsToast === 'function') recordsToast('Setup complete. Welcome to Relay.');
    removeSetupGate();
  };
}

function minimizeSetupGate(){
  const g = document.getElementById('setupGate'); if(g) g.classList.add('is-minimized');
  if(document.getElementById('setupBar')) return;
  const bar = document.createElement('div');
  bar.id = 'setupBar'; bar.className = 'setup-bar'; bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>Finish setting up your shop to use Relay.</span> <button type="button" id="setupBack">Back to setup</button>';
  document.body.appendChild(bar);
  bar.querySelector('#setupBack').onclick = () => { bar.remove(); checkShopSetupGate(); };
}
function showSetupGateAgain(){ checkShopSetupGate(); }
