// surface any uncaught error instead of failing silently
  window.addEventListener('error', function(e){
    const box = document.getElementById('fatalError');
    box.style.display = 'block';
    box.textContent = 'Something broke: ' + (e.message || 'unknown error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '');
  });

  // ================= Supabase connection =================
  const SUPABASE_URL = 'https://okcogufppsubntrchfuf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_Z8qgdFjVetqSOfmZKhxkpQ_XX2tYHDp';
  let sb = null;

  (function checkEnv(){
    const box = document.getElementById('fatalError');
    const problems = [];
    if(typeof window.supabase === 'undefined') problems.push('The Supabase library failed to load — check your internet connection and reload.');
    if(typeof L === 'undefined') problems.push('The map library failed to load — check your internet connection and reload.');
    if(problems.length){ box.style.display = 'block'; box.textContent = problems.join(' '); return; }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  })();

  // ================= distance =================
  function milesBetween(lat1,lon1,lat2,lon2){
    const R=3958.8;
    const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  function pinIcon(cls){
    return L.divIcon({ className:'', html:`<div class="relay-pin ${cls}"></div>`, iconSize:[16,16], iconAnchor:[8,8] });
  }

  // ================= data layer (Supabase) =================
  async function fetchAccounts(){
    const { data, error } = await sb.from('accounts').select('*');
    if(error){ console.error('fetchAccounts', error); return []; }
    return data || [];
  }
  async function fetchJobs(){
    const { data, error } = await sb.from('jobs').select('*').order('created_at', { ascending:true });
    if(error){ console.error('fetchJobs', error); return []; }
    return (data || []).map(j => ({ id:j.id, customer:j.customer, vehicle:j.vehicle, mechanic:j.mechanic, destLat:j.dest_lat, destLng:j.dest_lng, status:j.status }));
  }
  async function fetchLocation(mechanicName){
    const { data, error } = await sb.from('locations').select('*').eq('mechanic_name', mechanicName).maybeSingle();
    if(error || !data) return null;
    return { lat:data.lat, lng:data.lng, updatedAt:new Date(data.updated_at).getTime(), status:data.status };
  }
  async function upsertLocation(mechanicName, lat, lng, status){
    const { error } = await sb.from('locations').upsert(
      { mechanic_name:mechanicName, lat, lng, status, updated_at:new Date().toISOString() },
      { onConflict:'mechanic_name' }
    );
    if(error){ console.error('upsertLocation', error); return false; }
    return true;
  }
  async function updateLocationStatus(mechanicName, status){
    const { error } = await sb.from('locations').update({ status }).eq('mechanic_name', mechanicName);
    return !error;
  }

  // ================= session (device-local, not shared with others) =================
  let session = null;
  let watchId = null;
  let mechMapObj = null, mechMarker = null, mechDestMarker = null;

  function restoreSession(){
    const raw = localStorage.getItem('relay_session');
    if(raw){ session = JSON.parse(raw); enterApp(); }
  }

  // ================= auth ui wiring =================
  const tabLogin = document.getElementById('tabLogin'), tabSignup = document.getElementById('tabSignup');
  const loginForm = document.getElementById('loginForm'), signupForm = document.getElementById('signupForm');
  tabLogin.onclick = ()=>{ tabLogin.classList.add('active'); tabSignup.classList.remove('active'); loginForm.classList.remove('hidden'); signupForm.classList.add('hidden'); document.getElementById('authError').textContent=''; };
  tabSignup.onclick = ()=>{ tabSignup.classList.add('active'); tabLogin.classList.remove('active'); signupForm.classList.remove('hidden'); loginForm.classList.add('hidden'); document.getElementById('authError').textContent=''; };
  document.getElementById('suRole').onchange = (e)=>{
    document.getElementById('suCompanyField').style.display = e.target.value === 'fleet' ? 'block' : 'none';
  };
  document.getElementById('suCompanyField').style.display = 'none';

  document.getElementById('signupSubmit').onclick = async (e)=>{
    const btn = e.target; btn.disabled = true;
    const name = document.getElementById('suName').value.trim();
    const role = document.getElementById('suRole').value;
    const company = document.getElementById('suCompany').value.trim();
    const pass = document.getElementById('suPass').value;
    const err = document.getElementById('authError');
    err.textContent = '';
    if(!name || !pass || (role==='fleet' && !company)){ err.textContent = 'Fill in all required fields.'; btn.disabled=false; return; }
    if(!sb){ err.textContent = 'Not connected to the database yet — reload and try again.'; btn.disabled=false; return; }

    const { data: existing, error: checkErr } = await sb.from('accounts').select('name').ilike('name', name);
    if(checkErr){ err.textContent = 'Database error: ' + checkErr.message; btn.disabled=false; return; }
    if(existing && existing.length){ err.textContent = 'That name is already taken.'; btn.disabled=false; return; }

    const { error } = await sb.from('accounts').insert([{ name, role, company: role==='fleet' ? company : null, passcode: pass }]);
    if(error){ err.textContent = 'Could not create account: ' + error.message; btn.disabled=false; return; }

    session = { name, role, company: role==='fleet' ? company : null };
    localStorage.setItem('relay_session', JSON.stringify(session));
    enterApp();
  };

  document.getElementById('loginSubmit').onclick = async (e)=>{
    const btn = e.target; btn.disabled = true;
    const name = document.getElementById('loginName').value.trim();
    const pass = document.getElementById('loginPass').value;
    const err = document.getElementById('authError');
    err.textContent = '';
    if(!sb){ err.textContent = 'Not connected to the database yet — reload and try again.'; btn.disabled=false; return; }

    const { data, error } = await sb.from('accounts').select('*').ilike('name', name);
    if(error){ err.textContent = 'Database error: ' + error.message; btn.disabled=false; return; }
    if(!data || data.length === 0){ err.textContent = `No account found for "${name}". Check spelling or create an account.`; btn.disabled=false; return; }
    const account = data[0];
    if(account.passcode !== pass){ err.textContent = "That passcode doesn't match this account."; btn.disabled=false; return; }

    session = { name:account.name, role:account.role, company:account.company };
    localStorage.setItem('relay_session', JSON.stringify(session));
    enterApp();
  };

  document.getElementById('logoutBtn').onclick = ()=>{
    if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
    localStorage.removeItem('relay_session');
    location.reload();
  };

  // ================= app entry =================
  function enterApp(){
    document.getElementById('authView').classList.add('hidden');
    document.getElementById('whoBox').classList.remove('hidden');
    document.getElementById('whoName').textContent = session.name;
    document.getElementById('whoRole').textContent = session.role === 'shop' ? 'Shop owner' : session.role === 'fleet' ? 'Fleet manager' : 'Mechanic';

    if(session.role === 'mechanic'){ document.getElementById('mechanicView').classList.remove('hidden'); initMechanicView(); }
    else if(session.role === 'shop'){ document.getElementById('shopView').classList.remove('hidden'); initShopView(); }
    else { document.getElementById('fleetView').classList.remove('hidden'); initFleetView(); }
  }

  // ================= MECHANIC VIEW =================
  function initMechanicView(){
    mechMapObj = L.map('mechMap', { zoomControl:true, attributionControl:false }).setView([42.45, -83.25], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(mechMapObj);

    document.getElementById('mechStatus').onchange = async (e)=>{
      await updateLocationStatus(session.name, e.target.value);
      updateMechAssignedJob();
    };

    const goLiveBtn = document.getElementById('goLiveBtn');
    goLiveBtn.onclick = ()=>{ if(watchId === null) startTracking(); else stopTracking(); };

    function startTracking(){
      if(!navigator.geolocation){ document.getElementById('gpsReadout').textContent = 'Geolocation is not available in this browser.'; return; }
      goLiveBtn.textContent = 'Go offline';
      goLiveBtn.classList.remove('offline-state');
      document.getElementById('liveBadge').className = 'badge live';
      document.getElementById('liveBadge').innerHTML = '<span class="bd"></span>Live';

      let lastWrite = 0;
      watchId = navigator.geolocation.watchPosition(async (pos)=>{
        const { latitude, longitude, accuracy } = pos.coords;
        document.getElementById('gpsReadout').innerHTML =
          `Lat <b>${latitude.toFixed(5)}</b> · Lng <b>${longitude.toFixed(5)}</b> · Accuracy <b>±${Math.round(accuracy)}m</b> · Updated <b>${new Date().toLocaleTimeString()}</b>`;

        if(!mechMarker){
          mechMarker = L.marker([latitude, longitude], { icon: pinIcon('mech') }).addTo(mechMapObj);
          mechMapObj.setView([latitude, longitude], 13);
        } else {
          mechMarker.setLatLng([latitude, longitude]);
        }

        const now = Date.now();
        if(now - lastWrite > 4000){
          lastWrite = now;
          await upsertLocation(session.name, latitude, longitude, document.getElementById('mechStatus').value);
        }
        updateMechAssignedJob();
      }, (err)=>{
        document.getElementById('gpsReadout').textContent = 'Location error: ' + err.message + '. Check that location access is allowed for this page.';
      }, { enableHighAccuracy:true, maximumAge:5000, timeout:15000 });
    }

    function stopTracking(){
      if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
      goLiveBtn.textContent = 'Go live';
      goLiveBtn.classList.add('offline-state');
      document.getElementById('liveBadge').className = 'badge offline';
      document.getElementById('liveBadge').innerHTML = '<span class="bd"></span>Offline';
      document.getElementById('gpsReadout').textContent = 'Location sharing stopped.';
    }

    updateMechAssignedJob();
    setInterval(updateMechAssignedJob, 6000);
  }

  async function updateMechAssignedJob(){
    const jobs = await fetchJobs();
    const myJob = jobs.find(j => j.mechanic === session.name && j.status !== 'complete');
    const box = document.getElementById('mechJobBox');
    if(!myJob){ box.textContent = 'No job assigned right now.'; return; }

    const loc = await fetchLocation(session.name);
    let distText = '—';
    if(loc){
      const mi = milesBetween(loc.lat, loc.lng, myJob.destLat, myJob.destLng);
      distText = mi < 0.1 ? 'Arrived' : mi.toFixed(1) + ' mi away';
      if(mechDestMarker) mechDestMarker.setLatLng([myJob.destLat, myJob.destLng]);
      else mechDestMarker = L.marker([myJob.destLat, myJob.destLng], { icon: pinIcon('dest') }).addTo(mechMapObj);
    }

    box.innerHTML = `
      <div class="assigned-job">
        <div class="row"><span>Customer</span><b>${myJob.customer}</b></div>
        <div class="row"><span>Vehicle</span><b>${myJob.vehicle}</b></div>
        <div class="row"><span>Distance to job</span><b>${distText}</b></div>
        <div class="row"><span>Status</span><b>${myJob.status.replace('_',' ')}</b></div>
      </div>
      <div class="job-actions">
        <button data-s="en_route" class="${myJob.status==='en_route'?'active':''}">Heading there</button>
        <button data-s="on_site" class="${myJob.status==='on_site'?'active':''}">Mark arrived</button>
        <button data-s="complete" class="${myJob.status==='complete'?'active':''}">Mark complete</button>
      </div>`;

    box.querySelectorAll('.job-actions button').forEach(btn=>{
      btn.onclick = async ()=>{
        const { error } = await sb.from('jobs').update({ status: btn.dataset.s }).eq('id', myJob.id);
        if(!error) updateMechAssignedJob();
      };
    });
  }

  // ================= SHOP OWNER VIEW =================
  let shopMap = null, pinMapObj = null, pinMarker = null, chosenPin = null;
  const shopMarkers = {};

  function initShopView(){
    shopMap = L.map('shopOpsMap', { attributionControl:false }).setView([42.45, -83.25], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(shopMap);

    pinMapObj = L.map('pinMap', { attributionControl:false }).setView([42.45, -83.25], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(pinMapObj);
    pinMapObj.on('click', (e)=>{
      chosenPin = e.latlng;
      if(pinMarker) pinMarker.setLatLng(e.latlng); else pinMarker = L.marker(e.latlng, { icon: pinIcon('dest') }).addTo(pinMapObj);
      document.getElementById('pinHint').textContent = `Pin set at ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
    });

    populateMechanicSelect();
    refreshShopData();
    setInterval(refreshShopData, 5000);

    document.getElementById('createJobBtn').onclick = async ()=>{
      const customer = document.getElementById('njCustomer').value.trim();
      const vehicle = document.getElementById('njVehicle').value.trim();
      const mechanic = document.getElementById('njMechanic').value;
      if(!customer || !vehicle || !mechanic || !chosenPin){ alert('Fill in every field and drop a pin for the breakdown location.'); return; }

      const { error } = await sb.from('jobs').insert([{ customer, vehicle, mechanic, dest_lat:chosenPin.lat, dest_lng:chosenPin.lng, status:'assigned' }]);
      if(error){ alert('Could not create job: ' + error.message); return; }

      document.getElementById('njCustomer').value = ''; document.getElementById('njVehicle').value = '';
      if(pinMarker){ pinMapObj.removeLayer(pinMarker); pinMarker = null; } chosenPin = null;
      document.getElementById('pinHint').textContent = 'Click the map to drop a pin at the breakdown location.';
      refreshShopData();
    };
  }

  async function populateMechanicSelect(){
    const accounts = await fetchAccounts();
    const sel = document.getElementById('njMechanic');
    sel.innerHTML = accounts.filter(a=>a.role==='mechanic').map(a=>`<option value="${a.name}">${a.name}</option>`).join('') || '<option value="">No mechanics registered yet</option>';
  }

  async function refreshShopData(){
    const accounts = await fetchAccounts();
    const jobs = await fetchJobs();
    const mechanics = accounts.filter(a=>a.role==='mechanic');

    let liveCount = 0;
    for(const m of mechanics){
      const loc = await fetchLocation(m.name);
      if(!loc) continue;
      const isLive = Date.now() - loc.updatedAt < 30000;
      if(isLive) liveCount++;
      if(shopMarkers[m.name]) shopMarkers[m.name].setLatLng([loc.lat, loc.lng]);
      else shopMarkers[m.name] = L.marker([loc.lat, loc.lng], { icon: pinIcon(isLive?'mech':'offline') }).addTo(shopMap).bindPopup(m.name);
    }
    const countBadge = document.getElementById('shopMechCount');
    countBadge.style.display = 'inline-flex';
    countBadge.innerHTML = `<span class="bd"></span>${liveCount} live`;

    const list = document.getElementById('shopJobList');
    if(jobs.length === 0){ list.innerHTML = '<div class="card">No jobs yet — create one on the right.</div>'; return; }
    let rows = '';
    for(const j of jobs.slice().reverse()){
      const loc = await fetchLocation(j.mechanic);
      let distText = '—';
      if(loc){ const mi = milesBetween(loc.lat, loc.lng, j.destLat, j.destLng); distText = mi < 0.1 ? 'Arrived' : mi.toFixed(1)+' mi'; }
      rows += `<div class="job-row">
        <div class="job-row-top"><b>${j.customer} — ${j.vehicle}</b><span class="badge ${j.status==='on_site'||j.status==='complete'?'arrived':'live'}"><span class="bd"></span>${j.status.replace('_',' ')}</span></div>
        <div class="meta"><span>Mechanic: ${j.mechanic}</span><span>${distText}</span></div>
      </div>`;
    }
    list.innerHTML = rows;
  }

  // ================= FLEET MANAGER VIEW =================
  const fleetMaps = {};
  function initFleetView(){
    document.getElementById('fleetHint').textContent = `Showing live jobs for ${session.company}.`;
    refreshFleetData();
    setInterval(refreshFleetData, 5000);
  }

  async function refreshFleetData(){
    const jobs = await fetchJobs();
    const myJobs = jobs.filter(j => j.customer.toLowerCase() === (session.company||'').toLowerCase());
    const box = document.getElementById('fleetJobs');

    if(myJobs.length === 0){ box.innerHTML = '<div class="card">No active jobs for your company right now.</div>'; return; }

    let html = '';
    for(const j of myJobs){
      html += `<div class="section"><div class="card">
        <div class="job-row-top"><b>${j.vehicle}</b><span class="badge ${j.status==='on_site'||j.status==='complete'?'arrived':'live'}"><span class="bd"></span>${j.status.replace('_',' ')}</span></div>
        <div class="meta" style="margin-top:6px;">Mechanic: ${j.mechanic}</div>
        <div class="ops-map" style="height:280px; margin-top:12px;" id="fleetMap${j.id}"></div>
        <div class="gps-readout" id="fleetDist${j.id}" style="margin-top:10px;"></div>
      </div></div>`;
    }
    box.innerHTML = html;

    for(const j of myJobs){
      const loc = await fetchLocation(j.mechanic);
      if(!fleetMaps[j.id]){
        const m = L.map('fleetMap'+j.id, { attributionControl:false }).setView([j.destLat, j.destLng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(m);
        L.marker([j.destLat, j.destLng], { icon: pinIcon('dest') }).addTo(m);
        fleetMaps[j.id] = { map:m, mechMarker:null };
      }
      const entry = fleetMaps[j.id];
      if(loc){
        if(entry.mechMarker) entry.mechMarker.setLatLng([loc.lat, loc.lng]);
        else entry.mechMarker = L.marker([loc.lat, loc.lng], { icon: pinIcon('mech') }).addTo(entry.map);
        const mi = milesBetween(loc.lat, loc.lng, j.destLat, j.destLng);
        const distEl = document.getElementById('fleetDist'+j.id);
        if(distEl) distEl.innerHTML = mi < 0.1
          ? `<b style="color:var(--done);">Technician has arrived at the location.</b>`
          : `Technician is <b>${mi.toFixed(1)} miles</b> away · last updated <b>${new Date(loc.updatedAt).toLocaleTimeString()}</b>`;
      } else {
        const distEl = document.getElementById('fleetDist'+j.id);
        if(distEl) distEl.textContent = 'Waiting for technician to go live...';
      }
    }
  }

  restoreSession();
