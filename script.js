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

// ================= helpers =================
function milesBetween(lat1,lon1,lat2,lon2){
  const R=3958.8;
  const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function pinIcon(cls){
  return L.divIcon({ className:'', html:`<div class="relay-pin ${cls}"></div>`, iconSize:[16,16], iconAnchor:[8,8] });
}
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function showCompleteToast(job){
  const el = document.getElementById('completeToast');
  const sub = document.getElementById('completeToastSub');
  let durText = '';
  if(job && job.created_at){
    const mins = Math.round((Date.now() - new Date(job.created_at).getTime()) / 60000);
    durText = mins < 60 ? `${mins} min` : `${(mins/60).toFixed(1)} hrs`;
  }
  sub.textContent = job ? `${job.customer} — ${job.vehicle}` + (durText ? ` · ${durText}` : '') : '';
  el.classList.remove('hidden');
  clearTimeout(showCompleteToast._t);
  showCompleteToast._t = setTimeout(()=> el.classList.add('hidden'), 4500);
}

// ================= data layer =================
async function fetchMyProfile(userId){
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if(error){ console.error('fetchMyProfile', error); return null; }
  return data;
}
async function fetchAllMechanics(){
  const { data, error } = await sb.from('profiles').select('*').eq('role','mechanic');
  if(error){ console.error('fetchAllMechanics', error); return []; }
  return data || [];
}
async function fetchAllProfiles(){
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending:true });
  if(error){ console.error('fetchAllProfiles', error); return []; }
  return data || [];
}
async function fetchCompanies(){
  const { data, error } = await sb.from('profiles').select('company').eq('role','fleet');
  if(error) return [];
  return [...new Set((data||[]).map(d=>d.company).filter(Boolean))];
}
async function fetchJobs(){
  const { data, error } = await sb.from('jobs').select('*').order('created_at', { ascending:true });
  if(error){ console.error('fetchJobs', error); return []; }
  return data || [];
}
async function fetchJobComments(jobId){
  const { data, error } = await sb.from('job_comments').select('*, profiles:author_id(name)').eq('job_id', jobId).order('created_at', { ascending:true });
  if(error){ console.error('fetchJobComments', error); return []; }
  return data || [];
}
async function addJobComment(jobId, body){
  const { error } = await sb.from('job_comments').insert([{ job_id:jobId, author_id:session.id, body }]);
  return !error;
}
function commentsBlockHtml(jobId){
  return `
    <button class="comments-toggle" data-job="${jobId}">💬 Chat</button>
    <div class="comments-box hidden" id="comments-${jobId}">
      <div class="comment-list" id="comment-list-${jobId}"></div>
      <div class="comment-form">
        <input type="text" id="comment-input-${jobId}" placeholder="Message...">
        <button id="comment-send-${jobId}">Send</button>
      </div>
    </div>`;
}
const openCommentThreads = new Set();
async function renderCommentList(jobId){
  const listEl = document.getElementById('comment-list-'+jobId);
  if(!listEl) return;
  const comments = await fetchJobComments(jobId);
  listEl.innerHTML = comments.length === 0 ? '<div class="empty-note">No messages yet.</div>' :
    comments.map(c => {
      const mine = c.author_id === session.id;
      return `<div class="comment-item ${mine?'mine':''}">
        <div class="cbubble">
          <span class="cauthor">${esc(c.profiles ? c.profiles.name : 'Someone')}</span>
          <div class="cbody">${esc(c.body)}</div>
          <span class="ctime">${new Date(c.created_at).toLocaleTimeString()}</span>
        </div>
      </div>`;
    }).join('');
  listEl.scrollTop = listEl.scrollHeight;
}
function preserveOpenInputs(){
  const preserved = {};
  document.querySelectorAll('[id^="comment-input-"]').forEach(inp=>{
    const jobId = inp.id.replace('comment-input-', '');
    preserved[jobId] = {
      value: inp.value,
      hadFocus: document.activeElement === inp,
      selStart: inp.selectionStart,
      selEnd: inp.selectionEnd
    };
  });
  return preserved;
}
function restoreOpenInputs(preserved){
  Object.keys(preserved).forEach(jobId=>{
    const inp = document.getElementById('comment-input-'+jobId);
    const saved = preserved[jobId];
    if(!inp || !saved) return;
    inp.value = saved.value;
    if(saved.hadFocus){
      inp.focus();
      try{ inp.setSelectionRange(saved.selStart, saved.selEnd); }catch(e){}
    }
  });
}
function wireCommentToggles(container){
  container.querySelectorAll('.comments-toggle').forEach(btn=>{
    const jobId = btn.dataset.job;
    btn.onclick = ()=>{
      const box = document.getElementById('comments-'+jobId);
      if(box.classList.contains('hidden')) openThread(jobId); else closeThread(jobId);
    };
    if(openCommentThreads.has(jobId)) openThread(jobId);
  });
}
const commentDrafts = {};
function openThread(jobId){
  const box = document.getElementById('comments-'+jobId);
  if(!box) return;
  box.classList.remove('hidden');
  openCommentThreads.add(jobId);
  renderCommentList(jobId);
  const input = document.getElementById('comment-input-'+jobId);
  const send = document.getElementById('comment-send-'+jobId);
  if(commentDrafts[jobId]) input.value = commentDrafts[jobId];
  input.oninput = ()=>{ commentDrafts[jobId] = input.value; };
  const submit = async ()=>{
    const val = input.value.trim();
    if(!val) return;
    send.disabled = true;
    const ok = await addJobComment(jobId, val);
    send.disabled = false;
    if(ok){ input.value = ''; delete commentDrafts[jobId]; renderCommentList(jobId); }
  };
  send.onclick = submit;
  input.onkeydown = (e)=>{ if(e.key === 'Enter') submit(); };
}
function closeThread(jobId){
  const box = document.getElementById('comments-'+jobId);
  if(box) box.classList.add('hidden');
  openCommentThreads.delete(jobId);
}
setInterval(()=>{
  openCommentThreads.forEach(jobId => renderCommentList(jobId));
}, 5000);

async function fetchLocation(mechanicId){
  const { data, error } = await sb.from('locations').select('*').eq('mechanic_id', mechanicId).maybeSingle();
  if(error || !data) return null;
  return { lat:data.lat, lng:data.lng, updatedAt:new Date(data.updated_at).getTime(), status:data.status };
}
async function upsertLocation(mechanicId, lat, lng, status){
  const { error } = await sb.from('locations').upsert(
    { mechanic_id:mechanicId, lat, lng, status, updated_at:new Date().toISOString() },
    { onConflict:'mechanic_id' }
  );
  if(error){ console.error('upsertLocation', error); return false; }
  return true;
}
async function updateLocationStatus(mechanicId, status){
  const { error } = await sb.from('locations').update({ status }).eq('mechanic_id', mechanicId);
  return !error;
}

// ================= session =================
let session = null; // { id, name, role, company, orgId }
let watchId = null;
let mechMapObj = null, mechMarker = null;
const mechDestMarkers = {};
let appEntered = false;

// ================= public nav (Home / Sign in / Contact) =================
const homeView = document.getElementById('homeView');
const contactView = document.getElementById('contactView');
const publicAuthView = document.getElementById('authView');
const navHome = document.getElementById('navHome'), navSignin = document.getElementById('navSignin'), navContact = document.getElementById('navContact');

function showPublicView(which){
  [homeView, contactView, publicAuthView].forEach(v=>v.classList.add('hidden'));
  [navHome, navSignin, navContact].forEach(b=>b.classList.remove('active'));
  if(which === 'home'){ homeView.classList.remove('hidden'); navHome.classList.add('active'); }
  if(which === 'contact'){ contactView.classList.remove('hidden'); navContact.classList.add('active'); }
  if(which === 'signin'){ publicAuthView.classList.remove('hidden'); navSignin.classList.add('active'); }
}
navHome.onclick = ()=> showPublicView('home');
navContact.onclick = ()=> showPublicView('contact');
navSignin.onclick = ()=> { showPublicView('signin'); showAuthForm('login'); };
document.getElementById('brandHome').onclick = ()=> showPublicView('home');
document.getElementById('landingLogin').onclick = ()=> { showPublicView('signin'); showAuthForm('login'); };
document.getElementById('landingSignup').onclick = ()=> { showPublicView('signin'); showAuthForm('signup'); };
document.getElementById('landingSignup2').onclick = ()=> { showPublicView('signin'); showAuthForm('signup'); };

// ================= auth ui wiring =================
const tabLogin = document.getElementById('tabLogin'), tabSignup = document.getElementById('tabSignup');
const loginForm = document.getElementById('loginForm'), signupForm = document.getElementById('signupForm');
const completeProfileForm = document.getElementById('completeProfileForm');
const authError = document.getElementById('authError');

function showAuthForm(which){
  [loginForm, signupForm, completeProfileForm].forEach(f=>f.classList.add('hidden'));
  tabLogin.classList.remove('active'); tabSignup.classList.remove('active');
  authError.textContent = '';
  if(which === 'login'){ loginForm.classList.remove('hidden'); tabLogin.classList.add('active'); }
  if(which === 'signup'){ signupForm.classList.remove('hidden'); tabSignup.classList.add('active'); }
  if(which === 'complete'){ completeProfileForm.classList.remove('hidden'); }
}
tabLogin.onclick = ()=> showAuthForm('login');
tabSignup.onclick = ()=> showAuthForm('signup');

function updateRoleFields(prefix){
  const role = document.getElementById(prefix+'Role').value;
  document.getElementById(prefix+'ShopNameField').classList.toggle('hidden', role !== 'shop');
  document.getElementById(prefix+'InviteField').classList.toggle('hidden', role === 'shop');
  document.getElementById(prefix+'CompanyField').classList.toggle('hidden', role !== 'fleet');
}
document.getElementById('suRole').onchange = ()=> updateRoleFields('su');
document.getElementById('cpRole').onchange = ()=> updateRoleFields('cp');
updateRoleFields('su'); updateRoleFields('cp');

// resolves { orgId, error } for a signup based on role + shop name / invite code
async function resolveOrgForSignup(role, shopName, inviteCode){
  if(role === 'shop'){
    if(!shopName) return { error: 'Enter your company / shop name.' };
    const { data, error } = await sb.from('organizations').insert([{ name: shopName }]).select();
    if(error) return { error: 'Could not create your company: ' + error.message };
    return { orgId: data[0].id };
  } else {
    if(!inviteCode) return { error: 'Enter the invite code from your shop owner.' };
    const { data, error } = await sb.from('organizations').select('id').eq('invite_code', inviteCode.trim().toUpperCase()).maybeSingle();
    if(error || !data) return { error: 'Invite code not found — double check it with your shop owner.' };
    return { orgId: data.id };
  }
}

document.getElementById('signupSubmit').onclick = async (e)=>{
  const btn = e.target; btn.disabled = true;
  const name = document.getElementById('suName').value.trim();
  const email = document.getElementById('suEmail').value.trim();
  const role = document.getElementById('suRole').value;
  const shopName = document.getElementById('suShopName').value.trim();
  const inviteCode = document.getElementById('suInvite').value.trim();
  const company = document.getElementById('suCompany').value.trim();
  const pass = document.getElementById('suPass').value;
  authError.textContent = '';
  if(!name || !email || !pass || (role==='fleet' && !company)){ authError.textContent = 'Fill in all required fields.'; btn.disabled=false; return; }
  if(pass.length < 6){ authError.textContent = 'Password must be at least 6 characters.'; btn.disabled=false; return; }
  if(!sb){ authError.textContent = 'Not connected to the database yet — reload and try again.'; btn.disabled=false; return; }

  const { data: nameCheck } = await sb.from('profiles').select('name').ilike('name', name);
  if(nameCheck && nameCheck.length){ authError.textContent = 'That name is already taken.'; btn.disabled=false; return; }

  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if(error){ authError.textContent = error.message; btn.disabled=false; return; }

  if(data.session && data.user){
    const orgResult = await resolveOrgForSignup(role, shopName, inviteCode);
    if(orgResult.error){ authError.textContent = orgResult.error; btn.disabled=false; return; }
    const { error: profileErr } = await sb.from('profiles').insert([{ id:data.user.id, name, role, company: role==='fleet'?company:null, org_id:orgResult.orgId, active:true }]);
    if(profileErr){ authError.textContent = 'Account created, but profile setup failed: ' + profileErr.message; btn.disabled=false; return; }
    onAuthed(data.session.user.id);
  } else {
    authError.textContent = '';
    alert('Account created! Check your email to confirm it, then log in.');
    showAuthForm('login');
  }
  btn.disabled = false;
};

document.getElementById('loginSubmit').onclick = async (e)=>{
  const btn = e.target; btn.disabled = true;
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  authError.textContent = '';
  if(!sb){ authError.textContent = 'Not connected to the database yet — reload and try again.'; btn.disabled=false; return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if(error){ authError.textContent = error.message; btn.disabled=false; return; }
  await onAuthed(data.user.id);
  btn.disabled = false;
};

document.getElementById('forgotPassBtn').onclick = async ()=>{
  const email = document.getElementById('loginEmail').value.trim();
  if(!email){ authError.textContent = 'Enter your email above first, then tap "Forgot password?" again.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email);
  authError.textContent = error ? error.message : '';
  if(!error) alert('Password reset email sent — check your inbox (and spam folder).');
};

document.getElementById('completeProfileSubmit').onclick = async (e)=>{
  const btn = e.target; btn.disabled = true;
  const name = document.getElementById('cpName').value.trim();
  const role = document.getElementById('cpRole').value;
  const shopName = document.getElementById('cpShopName').value.trim();
  const inviteCode = document.getElementById('cpInvite').value.trim();
  const company = document.getElementById('cpCompany').value.trim();
  authError.textContent = '';
  if(!name || (role==='fleet' && !company)){ authError.textContent = 'Fill in all required fields.'; btn.disabled=false; return; }

  const orgResult = await resolveOrgForSignup(role, shopName, inviteCode);
  if(orgResult.error){ authError.textContent = orgResult.error; btn.disabled=false; return; }

  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from('profiles').insert([{ id:userData.user.id, name, role, company: role==='fleet'?company:null, org_id:orgResult.orgId, active:true }]);
  if(error){ authError.textContent = error.message; btn.disabled=false; return; }
  await onAuthed(userData.user.id);
  btn.disabled = false;
};

document.getElementById('changePassBtn').onclick = async ()=>{
  const newPass = prompt('Enter a new password (at least 6 characters):');
  if(!newPass) return;
  if(newPass.length < 6){ alert('Password must be at least 6 characters.'); return; }
  const { error } = await sb.auth.updateUser({ password: newPass });
  alert(error ? 'Could not change password: ' + error.message : 'Password updated.');
};

document.getElementById('logoutBtn').onclick = async ()=>{
  if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
  await sb.auth.signOut();
  location.reload();
};

// ================= auth state =================
async function onAuthed(userId){
  const profile = await fetchMyProfile(userId);
  if(!profile){
    showPublicView('signin');
    showAuthForm('complete');
    return;
  }
  session = { id:profile.id, name:profile.name, role:profile.role, company:profile.company, orgId:profile.org_id };
  enterApp();
}

if(sb){
  sb.auth.onAuthStateChange((event, authSession) => {
    if(event === 'SIGNED_IN' && authSession && !appEntered){
      onAuthed(authSession.user.id);
    }
    if(event === 'SIGNED_OUT'){
      appEntered = false;
    }
  });
  sb.auth.getSession().then(({ data }) => {
    if(data.session && !appEntered) onAuthed(data.session.user.id);
  });
}

// ================= dashboard tabs =================
function wireDashTabs(container){
  const tabs = container.querySelectorAll('.dash-tab');
  tabs.forEach(tab=>{
    tab.onclick = ()=>{
      tabs.forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      container.querySelectorAll('.dash-panel').forEach(p=>p.classList.add('hidden'));
      const target = document.getElementById(tab.dataset.target);
      if(target) target.classList.remove('hidden');
    };
  });
}
document.querySelectorAll('.dash-tabs').forEach(wireDashTabs);

// ================= app entry =================
function enterApp(){
  if(appEntered) return;
  appEntered = true;
  document.getElementById('publicNav').classList.add('hidden');
  homeView.classList.add('hidden');
  contactView.classList.add('hidden');
  publicAuthView.classList.add('hidden');
  document.getElementById('whoBox').classList.remove('hidden');
  document.getElementById('whoName').textContent = session.name;
  document.getElementById('whoRole').textContent =
    session.role === 'admin' ? 'Admin' :
    session.role === 'shop' ? 'Shop owner' :
    session.role === 'fleet' ? 'Fleet manager' : 'Mechanic';

  if(session.role === 'mechanic'){ document.getElementById('mechanicView').classList.remove('hidden'); initMechanicView(); }
  else if(session.role === 'shop'){ document.getElementById('shopView').classList.remove('hidden'); initShopView(); }
  else if(session.role === 'admin'){ document.getElementById('adminView').classList.remove('hidden'); initAdminView(); }
  else { document.getElementById('fleetView').classList.remove('hidden'); initFleetView(); }
}

// ================= MECHANIC VIEW =================
function initMechanicView(){
  mechMapObj = L.map('mechMap', { zoomControl:true, attributionControl:false }).setView([42.45, -83.25], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(mechMapObj);

  document.getElementById('mechStatus').onchange = async (e)=>{
    await updateLocationStatus(session.id, e.target.value);
    renderMechJobs();
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
        await upsertLocation(session.id, latitude, longitude, document.getElementById('mechStatus').value);
      }
      renderMechJobs();
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

  renderMechJobs();
  setInterval(renderMechJobs, 6000);
}

async function renderMechJobs(){
  const jobs = await fetchJobs();
  const mine = jobs.filter(j => j.mechanic_id === session.id);
  const active = mine.filter(j => j.status !== 'complete');
  const history = mine.filter(j => j.status === 'complete').slice().reverse().slice(0, 15);

  document.getElementById('mechActiveCount').textContent = active.length ? active.length + ' active' : '';

  const loc = await fetchLocation(session.id);

  const activeBox = document.getElementById('mechJobsBox');
  const _s1 = preserveOpenInputs();
  if(active.length === 0){
    activeBox.innerHTML = '<div class="empty-note">No jobs assigned right now.</div>';
  } else {
    activeBox.innerHTML = active.map(job => {
      let distText = '—';
      if(loc){
        const mi = milesBetween(loc.lat, loc.lng, job.dest_lat, job.dest_lng);
        distText = mi < 0.1 ? 'Arrived' : mi.toFixed(1) + ' mi away';
        if(!mechDestMarkers[job.id]) mechDestMarkers[job.id] = L.marker([job.dest_lat, job.dest_lng], { icon: pinIcon('dest') }).addTo(mechMapObj);
      }
      return `
        <div class="job-card" data-job="${job.id}">
          <div class="job-card-top">
            <div><b>${esc(job.customer)}</b><div class="meta">${esc(job.vehicle)}</div></div>
          </div>
          <div class="row"><span>Distance</span><b>${distText}</b></div>
          <div class="row"><span>Status</span><b>${job.status.replace('_',' ')}</b></div>
          <a class="directions-btn" href="https://www.google.com/maps/dir/?api=1&destination=${job.dest_lat},${job.dest_lng}" target="_blank" rel="noopener">🧭 Get directions</a>
          <div class="job-actions">
            <button data-s="en_route" class="${job.status==='en_route'?'active':''}">Heading there</button>
            <button data-s="on_site" class="${job.status==='on_site'?'active':''}">Mark arrived</button>
            <button data-s="complete" class="${job.status==='complete'?'active':''}">Mark complete</button>
          </div>
          ${commentsBlockHtml(job.id)}
        </div>`;
    }).join('');

    wireCommentToggles(activeBox);
    activeBox.querySelectorAll('.job-card').forEach(card=>{
      const jobId = Number(card.dataset.job);
      const job = active.find(j=>j.id===jobId);
      card.querySelectorAll('.job-actions button').forEach(btn=>{
        btn.onclick = async ()=>{
          const { error } = await sb.from('jobs').update({ status: btn.dataset.s, updated_at: new Date().toISOString() }).eq('id', jobId);
          if(!error){
            if(btn.dataset.s === 'complete') showCompleteToast(job);
            renderMechJobs();
          }
        };
      });
    });
  }
  restoreOpenInputs(_s1);

  const historyBox = document.getElementById('mechHistoryBox');
  const _s2 = preserveOpenInputs();
  historyBox.innerHTML = history.length === 0
    ? '<div class="empty-note">No completed jobs yet.</div>'
    : history.map(job => `
        <div class="job-card">
          <div class="job-card-top"><div><b>${esc(job.customer)}</b><div class="meta">${esc(job.vehicle)}</div></div><span class="badge arrived"><span class="bd"></span>complete</span></div>
          ${commentsBlockHtml(job.id)}
        </div>`).join('');
  wireCommentToggles(historyBox);
  restoreOpenInputs(_s2);
}

// ================= SHOP OWNER VIEW =================
let shopMap = null, pinMapObj = null, pinMarker = null, chosenPin = null;
const shopMarkers = {};

async function loadInviteCode(){
  const box = document.getElementById('inviteCodeBox');
  if(!box || !session.orgId) return;
  const { data, error } = await sb.from('organizations').select('invite_code, name').eq('id', session.orgId).maybeSingle();
  if(error || !data){ box.innerHTML = '<div class="empty-note">Could not load invite code.</div>'; return; }
  box.innerHTML = `<span class="code">${esc(data.invite_code)}</span><button id="copyInviteBtn">Copy</button>`;
  document.getElementById('copyInviteBtn').onclick = ()=>{
    navigator.clipboard.writeText(data.invite_code);
    const b = document.getElementById('copyInviteBtn');
    b.textContent = 'Copied!'; setTimeout(()=>{ b.textContent = 'Copy'; }, 1500);
  };
}

function initShopView(){
  shopMap = L.map('shopOpsMap', { attributionControl:false }).setView([42.45, -83.25], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(shopMap);

  loadInviteCode();

  pinMapObj = L.map('pinMap', { attributionControl:false }).setView([42.45, -83.25], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(pinMapObj);
  pinMapObj.on('click', (e)=>{
    setPin(e.latlng.lat, e.latlng.lng, `Pin set at ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
  });

  function setPin(lat, lng, hintText){
    chosenPin = { lat, lng };
    const latlng = [lat, lng];
    if(pinMarker) pinMarker.setLatLng(latlng); else pinMarker = L.marker(latlng, { icon: pinIcon('dest') }).addTo(pinMapObj);
    pinMapObj.setView(latlng, 15);
    document.getElementById('pinHint').textContent = hintText;
  }

  const addressInput = document.getElementById('addressInput');
  const addressBtn = document.getElementById('addressSearchBtn');

  async function searchAddress(){
    const query = addressInput.value.trim();
    if(!query) return;
    addressBtn.disabled = true;
    addressBtn.textContent = 'Searching…';
    document.getElementById('pinHint').textContent = 'Looking up that address...';
    try{
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const results = await res.json();
      if(!results || results.length === 0){
        document.getElementById('pinHint').textContent = `Couldn't find "${query}" — try adding city and state, or drop the pin manually.`;
      } else {
        const r = results[0];
        setPin(parseFloat(r.lat), parseFloat(r.lon), `Found: ${r.display_name}`);
      }
    }catch(e){
      document.getElementById('pinHint').textContent = 'Address lookup failed — check your connection or drop the pin manually.';
    }
    addressBtn.disabled = false;
    addressBtn.textContent = 'Find';
  }

  addressBtn.onclick = searchAddress;
  addressInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); searchAddress(); } });

  populateMechanicSelect();
  populateCompanyList();
  refreshShopData();
  renderTeamList();
  setInterval(refreshShopData, 5000);
  setInterval(renderTeamList, 15000);

  document.getElementById('createJobBtn').onclick = async ()=>{
    const customer = document.getElementById('njCustomer').value.trim();
    const vehicle = document.getElementById('njVehicle').value.trim();
    const issue = document.getElementById('njIssue').value.trim();
    const mechanicId = document.getElementById('njMechanic').value;
    if(!customer || !vehicle || !mechanicId || !chosenPin){ alert('Fill in every field and set a breakdown location (address or pin).'); return; }

    const { data, error } = await sb.from('jobs').insert([{ customer, vehicle, mechanic_id:mechanicId, dest_lat:chosenPin.lat, dest_lng:chosenPin.lng, status:'assigned', created_by:session.id, org_id:session.orgId }]).select();
    if(error){ alert('Could not create job: ' + error.message); return; }

    if(issue && data && data[0]){
      await addJobComment(data[0].id, issue);
    }

    document.getElementById('njCustomer').value = ''; document.getElementById('njVehicle').value = ''; document.getElementById('njIssue').value = ''; addressInput.value = '';
    if(pinMarker){ pinMapObj.removeLayer(pinMarker); pinMarker = null; } chosenPin = null;
    document.getElementById('pinHint').textContent = 'Type an address and hit Find, or click the map to drop a pin directly.';
    refreshShopData();
    populateCompanyList();
  };
}

async function populateMechanicSelect(){
  const mechanics = (await fetchAllMechanics()).filter(m=>m.active);
  const sel = document.getElementById('njMechanic');
  sel.innerHTML = mechanics.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('') || '<option value="">No active mechanics yet</option>';
}

async function populateCompanyList(){
  const companies = await fetchCompanies();
  document.getElementById('companyList').innerHTML = companies.map(c=>`<option value="${esc(c)}"></option>`).join('');
}

async function renderTeamList(){
  const mechanics = await fetchAllMechanics();
  const box = document.getElementById('teamList');
  if(mechanics.length === 0){ box.innerHTML = '<div class="empty-note">No mechanics have signed up yet.</div>'; return; }
  box.innerHTML = mechanics.map(m => `
    <div class="team-row">
      <div><div class="tname">${esc(m.name)}</div><div class="tstatus">${m.active ? 'Active' : 'Deactivated'}</div></div>
      <button class="toggle-btn ${m.active ? 'on' : 'off'}" data-id="${m.id}" data-active="${m.active}">${m.active ? 'Active' : 'Inactive'}</button>
    </div>`).join('');
  box.querySelectorAll('.toggle-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      const newActive = btn.dataset.active !== 'true';
      const { error } = await sb.from('profiles').update({ active:newActive }).eq('id', btn.dataset.id);
      if(!error){ renderTeamList(); populateMechanicSelect(); }
    };
  });
}

function jobEditRowHtml(job, mechanics){
  return `
    <div class="edit-grid">
      <input type="text" class="ej-customer" value="${esc(job.customer)}" placeholder="Customer">
      <input type="text" class="ej-vehicle" value="${esc(job.vehicle)}" placeholder="Vehicle">
      <select class="ej-mechanic">${mechanics.map(m=>`<option value="${m.id}" ${m.id===job.mechanic_id?'selected':''}>${esc(m.name)}</option>`).join('')}</select>
    </div>
    <div class="job-actions">
      <button class="ej-save">Save</button>
      <button class="ej-cancel">Cancel</button>
    </div>`;
}

function renderAnalytics(jobs, mechanics, mechName){
  const completed = jobs.filter(j => j.status === 'complete');
  const barsBox = document.getElementById('analyticsBars');
  const statsBox = document.getElementById('analyticsStats');
  if(!barsBox || !statsBox) return;

  if(completed.length === 0){
    barsBox.innerHTML = '<div class="empty-note">No completed jobs yet.</div>';
    statsBox.innerHTML = `<div class="stat-box"><b>0</b><span>Total completed</span></div>`;
    return;
  }

  const counts = {};
  completed.forEach(j => { counts[j.mechanic_id] = (counts[j.mechanic_id]||0) + 1; });
  const maxCount = Math.max(...Object.values(counts));
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  barsBox.innerHTML = sorted.map(([id,count]) => `
    <div class="bar-row">
      <div class="bar-label">${esc(mechName(id))}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(count/maxCount*100).toFixed(0)}%"></div></div>
      <div class="bar-count">${count}</div>
    </div>`).join('');

  const durations = completed
    .filter(j => j.created_at && j.updated_at)
    .map(j => (new Date(j.updated_at) - new Date(j.created_at)) / 60000);
  const avgMin = durations.length ? Math.round(durations.reduce((a,b)=>a+b,0) / durations.length) : 0;
  const avgText = avgMin < 60 ? `${avgMin} min` : `${(avgMin/60).toFixed(1)} hrs`;
  const busiest = sorted[0] ? mechName(sorted[0][0]) : '—';

  statsBox.innerHTML = `
    <div class="stat-box"><b>${completed.length}</b><span>Total completed</span></div>
    <div class="stat-box"><b>${avgText}</b><span>Avg. time to complete</span></div>
    <div class="stat-box"><b>${esc(busiest)}</b><span>Busiest mechanic</span></div>`;
}

async function refreshShopData(){
  const mechanics = await fetchAllMechanics();
  const jobs = await fetchJobs();

  let liveCount = 0;
  for(const m of mechanics){
    const loc = await fetchLocation(m.id);
    if(!loc) continue;
    const isLive = Date.now() - loc.updatedAt < 30000;
    if(isLive) liveCount++;
    if(shopMarkers[m.id]) shopMarkers[m.id].setLatLng([loc.lat, loc.lng]);
    else shopMarkers[m.id] = L.marker([loc.lat, loc.lng], { icon: pinIcon(isLive?'mech':'offline') }).addTo(shopMap).bindPopup(esc(m.name));
  }
  const countBadge = document.getElementById('shopMechCount');
  countBadge.style.display = 'inline-flex';
  countBadge.innerHTML = `<span class="bd"></span>${liveCount} live`;

  const mechName = id => (mechanics.find(m=>m.id===id) || {}).name || 'Unassigned';

  const active = jobs.filter(j=>j.status!=='complete');
  const history = jobs.filter(j=>j.status==='complete').slice().reverse().slice(0,20);

  const today = new Date(); today.setHours(0,0,0,0);
  const completedToday = jobs.filter(j => j.status==='complete' && j.updated_at && new Date(j.updated_at) >= today).length;
  document.getElementById('shopStats').innerHTML = `
    <div class="stat-box"><b>${active.length}</b><span>Active jobs</span></div>
    <div class="stat-box"><b>${liveCount}</b><span>Mechanics live now</span></div>
    <div class="stat-box"><b>${mechanics.filter(m=>m.active).length}</b><span>Active mechanics</span></div>
    <div class="stat-box"><b>${completedToday}</b><span>Completed today</span></div>`;

  renderAnalytics(jobs, mechanics, mechName);

  const list = document.getElementById('shopJobList');
  const _s1 = preserveOpenInputs();
  if(active.length === 0){ list.innerHTML = '<div class="empty-note">No active jobs — create one on the right.</div>'; }
  else {
    list.innerHTML = active.slice().reverse().map(j => `
      <div class="job-card" data-job="${j.id}">
        <div class="job-card-top">
          <div><b>${esc(j.customer)} — ${esc(j.vehicle)}</b><div class="meta">Mechanic: ${esc(mechName(j.mechanic_id))}</div></div>
          <span class="badge ${j.status==='on_site'?'arrived':'live'}"><span class="bd"></span>${j.status.replace('_',' ')}</span>
        </div>
        <div class="job-actions">
          <button class="j-edit">Edit</button>
          <button class="j-delete danger">Delete</button>
        </div>
        <div class="j-editbox"></div>
        ${commentsBlockHtml(j.id)}
      </div>`).join('');

    wireCommentToggles(list);
    list.querySelectorAll('.job-card').forEach(card=>{
      const jobId = Number(card.dataset.job);
      const job = jobs.find(j=>j.id===jobId);
      card.querySelector('.j-delete').onclick = async ()=>{
        if(!confirm('Delete this job? This cannot be undone.')) return;
        const { error } = await sb.from('jobs').delete().eq('id', jobId);
        if(!error) refreshShopData();
      };
      card.querySelector('.j-edit').onclick = ()=>{
        const box = card.querySelector('.j-editbox');
        box.innerHTML = jobEditRowHtml(job, mechanics);
        box.querySelector('.ej-cancel').onclick = ()=>{ box.innerHTML = ''; };
        box.querySelector('.ej-save').onclick = async ()=>{
          const customer = box.querySelector('.ej-customer').value.trim();
          const vehicle = box.querySelector('.ej-vehicle').value.trim();
          const mechanic_id = box.querySelector('.ej-mechanic').value;
          if(!customer || !vehicle || !mechanic_id) return;
          const { error } = await sb.from('jobs').update({ customer, vehicle, mechanic_id, updated_at:new Date().toISOString() }).eq('id', jobId);
          if(!error) refreshShopData();
        };
      };
    });
  }
  restoreOpenInputs(_s1);

  const histBox = document.getElementById('shopHistoryList');
  const _s2 = preserveOpenInputs();
  histBox.innerHTML = history.length === 0
    ? '<div class="empty-note">No completed jobs yet.</div>'
    : history.map(j => `
      <div class="job-card">
        <div class="job-card-top"><div><b>${esc(j.customer)} — ${esc(j.vehicle)}</b><div class="meta">Mechanic: ${esc(mechName(j.mechanic_id))}</div></div><span class="badge arrived"><span class="bd"></span>complete</span></div>
        ${commentsBlockHtml(j.id)}
      </div>`).join('');
  wireCommentToggles(histBox);
  restoreOpenInputs(_s2);
}

// ================= FLEET MANAGER VIEW =================
const fleetMaps = {};
function initFleetView(){
  document.getElementById('fleetHint').textContent = `Showing jobs for ${session.company}.`;
  refreshFleetData();
  setInterval(refreshFleetData, 5000);
}

async function refreshFleetData(){
  // RLS already restricts this to only this fleet manager's company jobs
  const jobs = await fetchJobs();
  const active = jobs.filter(j=>j.status!=='complete');
  const history = jobs.filter(j=>j.status==='complete').slice().reverse().slice(0,15);

  const box = document.getElementById('fleetJobs');
  const _s1 = preserveOpenInputs();
  if(active.length === 0){ box.innerHTML = '<div class="card empty-note">No active jobs for your company right now.</div>'; }
  else {
    let html = '';
    for(const j of active){
      html += `<div class="card" style="margin-bottom:14px;">
        <div class="job-card-top"><b>${esc(j.vehicle)}</b><span class="badge ${j.status==='on_site'?'arrived':'live'}"><span class="bd"></span>${j.status.replace('_',' ')}</span></div>
        <div class="ops-map" style="height:280px; margin-top:12px;" id="fleetMap${j.id}"></div>
        <div class="gps-readout" id="fleetDist${j.id}" style="margin-top:10px;"></div>
        ${commentsBlockHtml(j.id)}
      </div>`;
    }
    box.innerHTML = html;
    wireCommentToggles(box);
    restoreOpenInputs(_s1);

    for(const j of active){
      const loc = await fetchLocation(j.mechanic_id);
      if(!fleetMaps[j.id]){
        const m = L.map('fleetMap'+j.id, { attributionControl:false }).setView([j.dest_lat, j.dest_lng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(m);
        L.marker([j.dest_lat, j.dest_lng], { icon: pinIcon('dest') }).addTo(m);
        fleetMaps[j.id] = { map:m, mechMarker:null };
      }
      const entry = fleetMaps[j.id];
      if(loc){
        if(entry.mechMarker) entry.mechMarker.setLatLng([loc.lat, loc.lng]);
        else entry.mechMarker = L.marker([loc.lat, loc.lng], { icon: pinIcon('mech') }).addTo(entry.map);
        const mi = milesBetween(loc.lat, loc.lng, j.dest_lat, j.dest_lng);
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

  const histBox = document.getElementById('fleetHistory');
  const _s2 = preserveOpenInputs();
  histBox.innerHTML = history.length === 0
    ? '<div class="card empty-note">No completed jobs yet.</div>'
    : history.map(j => `<div class="job-card"><div class="job-card-top"><b>${esc(j.vehicle)}</b><span class="badge arrived"><span class="bd"></span>complete</span></div>${commentsBlockHtml(j.id)}</div>`).join('');
  wireCommentToggles(histBox);
  restoreOpenInputs(_s2);
}

// ================= ADMIN VIEW =================
let adminOpsMap = null;
const adminMarkers = {};

function initAdminView(){
  adminOpsMap = L.map('adminOpsMap', { attributionControl:false }).setView([42.45, -83.25], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(adminOpsMap);

  refreshAdminData();
  setInterval(refreshAdminData, 6000);
}

async function refreshAdminData(){
  const profiles = await fetchAllProfiles();
  const jobs = await fetchJobs();
  const mechanics = profiles.filter(p=>p.role==='mechanic');

  // stats
  let liveCount = 0;
  for(const m of mechanics){
    const loc = await fetchLocation(m.id);
    if(loc && Date.now() - loc.updatedAt < 30000) liveCount++;
  }
  const activeJobs = jobs.filter(j=>j.status!=='complete');
  const completeJobs = jobs.filter(j=>j.status==='complete');
  document.getElementById('adminStats').innerHTML = `
    <div class="stat-box"><b>${profiles.length}</b><span>Total accounts</span></div>
    <div class="stat-box"><b>${liveCount}</b><span>Mechanics live now</span></div>
    <div class="stat-box"><b>${activeJobs.length}</b><span>Active jobs</span></div>
    <div class="stat-box"><b>${completeJobs.length}</b><span>Completed jobs</span></div>`;

  // live map
  for(const m of mechanics){
    const loc = await fetchLocation(m.id);
    if(!loc) continue;
    const isLive = Date.now() - loc.updatedAt < 30000;
    if(adminMarkers[m.id]) adminMarkers[m.id].setLatLng([loc.lat, loc.lng]);
    else adminMarkers[m.id] = L.marker([loc.lat, loc.lng], { icon: pinIcon(isLive?'mech':'offline') }).addTo(adminOpsMap).bindPopup(esc(m.name));
  }

  // accounts
  const accBox = document.getElementById('adminAccounts');
  accBox.innerHTML = profiles.map(p => `
    <div class="account-row" data-id="${p.id}">
      <div class="aname">${esc(p.name)}</div>
      <select class="arole-select">
        <option value="mechanic" ${p.role==='mechanic'?'selected':''}>Mechanic</option>
        <option value="shop" ${p.role==='shop'?'selected':''}>Shop owner</option>
        <option value="fleet" ${p.role==='fleet'?'selected':''}>Fleet manager</option>
        <option value="admin" ${p.role==='admin'?'selected':''}>Admin</option>
      </select>
      <input type="text" class="acompany-input" placeholder="Company (fleet only)" value="${esc(p.company||'')}">
      <div style="display:flex; gap:8px;">
        <button class="toggle-btn ${p.active?'on':'off'}" data-active="${p.active}">${p.active?'Active':'Inactive'}</button>
        <button class="j-edit acc-save">Save</button>
      </div>
    </div>`).join('');

  accBox.querySelectorAll('.account-row').forEach(row=>{
    const id = row.dataset.id;
    row.querySelector('.toggle-btn').onclick = async (e)=>{
      const btn = e.target;
      const newActive = btn.dataset.active !== 'true';
      const { error } = await sb.from('profiles').update({ active:newActive }).eq('id', id);
      if(!error) refreshAdminData();
    };
    row.querySelector('.acc-save').onclick = async ()=>{
      const role = row.querySelector('.arole-select').value;
      const company = row.querySelector('.acompany-input').value.trim();
      const { error } = await sb.from('profiles').update({ role, company: role==='fleet' ? company : null }).eq('id', id);
      if(error) alert('Could not update: ' + error.message); else refreshAdminData();
    };
  });

  // jobs
  const mechName = id => (profiles.find(p=>p.id===id) || {}).name || 'Unassigned';
  const active = jobs.filter(j=>j.status!=='complete');
  const history = jobs.filter(j=>j.status==='complete').slice().reverse().slice(0,30);

  const list = document.getElementById('adminJobList');
  const _s1 = preserveOpenInputs();
  list.innerHTML = active.length === 0 ? '<div class="empty-note">No active jobs.</div>' : active.slice().reverse().map(j => `
    <div class="job-card" data-job="${j.id}">
      <div class="job-card-top">
        <div><b>${esc(j.customer)} — ${esc(j.vehicle)}</b><div class="meta">Mechanic: ${esc(mechName(j.mechanic_id))}</div></div>
        <span class="badge ${j.status==='on_site'?'arrived':'live'}"><span class="bd"></span>${j.status.replace('_',' ')}</span>
      </div>
      <div class="job-actions">
        <button class="j-delete danger">Delete</button>
      </div>
      ${commentsBlockHtml(j.id)}
    </div>`).join('');
  wireCommentToggles(list);
  restoreOpenInputs(_s1);
  list.querySelectorAll('.j-delete').forEach(btn=>{
    btn.onclick = async ()=>{
      const jobId = Number(btn.closest('.job-card').dataset.job);
      if(!confirm('Delete this job?')) return;
      const { error } = await sb.from('jobs').delete().eq('id', jobId);
      if(!error) refreshAdminData();
    };
  });

  const adminHistBox = document.getElementById('adminHistoryList');
  const _s2 = preserveOpenInputs();
  adminHistBox.innerHTML = history.length === 0
    ? '<div class="empty-note">No completed jobs yet.</div>'
    : history.map(j => `<div class="job-card"><div class="job-card-top"><div><b>${esc(j.customer)} — ${esc(j.vehicle)}</b><div class="meta">Mechanic: ${esc(mechName(j.mechanic_id))}</div></div><span class="badge arrived"><span class="bd"></span>complete</span></div>${commentsBlockHtml(j.id)}</div>`).join('');
  wireCommentToggles(adminHistBox);
  restoreOpenInputs(_s2);
}

// ================= theme toggle =================
(function initTheme(){
  const root = document.documentElement;
  const saved = localStorage.getItem('relay_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  if(theme === 'dark') root.setAttribute('data-theme', 'dark');

  const btn = document.getElementById('themeToggle');
  const knob = btn.querySelector('.knob');
  knob.textContent = theme === 'dark' ? '🌙' : '☀️';

  btn.onclick = ()=>{
    const isDark = root.getAttribute('data-theme') === 'dark';
    if(isDark){ root.removeAttribute('data-theme'); knob.textContent = '☀️'; localStorage.setItem('relay_theme','light'); }
    else{ root.setAttribute('data-theme','dark'); knob.textContent = '🌙'; localStorage.setItem('relay_theme','dark'); }
  };
})();
