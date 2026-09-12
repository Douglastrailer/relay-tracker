// surface any uncaught error instead of failing silently
async function logErrorToServer(message, stack){
  try{
    if(!sb || typeof session === 'undefined' || !session) return;
    await sb.from('error_logs').insert([{
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 4000) : null,
      page_url: window.location.href,
      user_id: session.id,
      user_role: session.role
    }]);
  } catch(e){ /* never let error logging itself cause more errors */ }
}

window.addEventListener('error', function(e){
  const box = document.getElementById('fatalError');
  box.style.display = 'block';
  box.textContent = 'Something broke: ' + (e.message || 'unknown error') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '');
  logErrorToServer(e.message, e.error && e.error.stack);
});

// Unhandled promise rejections are extremely common in an app this
// full of async/await Supabase calls, and were previously invisible
// entirely — a failed request could just silently do nothing.
window.addEventListener('unhandledrejection', function(e){
  const reasonMsg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
  const box = document.getElementById('fatalError');
  box.style.display = 'block';
  box.textContent = 'Something broke: ' + reasonMsg;
  logErrorToServer(reasonMsg, e.reason && e.reason.stack);
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
async function fetchOrgMembers(){
  const { data: mechanics, error: mechErr } = await sb.from('profiles').select('*').eq('role','mechanic').eq('org_id', session.orgId);
  if(mechErr) console.error('fetchOrgMembers (mechanics)', mechErr);

  // Fleet managers are linked via fleet_shop_links now, not just profiles.org_id,
  // since one fleet manager can belong to multiple shops.
  const { data: fleetLinks, error: fleetErr } = await sb.from('fleet_shop_links').select('profiles:fleet_id(*)').eq('org_id', session.orgId);
  if(fleetErr) console.error('fetchOrgMembers (fleet)', fleetErr);
  const fleetMembers = (fleetLinks || []).map(l => l.profiles).filter(Boolean);

  return [...(mechanics || []), ...fleetMembers];
}
async function fetchAllProfiles(){
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending:true });
  if(error){ console.error('fetchAllProfiles', error); return []; }
  return data || [];
}
async function fetchAllOrganizations(){
  const { data, error } = await sb.from('organizations').select('id, name, status, created_at');
  if(error){ console.error('fetchAllOrganizations', error); return []; }
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
// Active jobs are naturally small (a handful of open jobs at once) so no
// limit is needed here. Completed history is the one that grows unbounded
// over years of use — this fetches only the N most recent AT THE DATABASE
// LEVEL, instead of the old approach of downloading every job a company has
// ever had and slicing it down in the browser.
async function fetchActiveJobs(){
  const { data, error } = await sb.from('jobs').select('*').neq('status','complete').order('created_at', { ascending:true });
  if(error){ console.error('fetchActiveJobs', error); return []; }
  return data || [];
}
async function fetchCompletedJobs(limit){
  const { data, error } = await sb.from('jobs').select('*').eq('status','complete').order('updated_at', { ascending:false }).limit(limit);
  if(error){ console.error('fetchCompletedJobs', error); return []; }
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
// Keeps an open chat's actual input box alive across a page rebuild,
// instead of destroying it and copying the text back in. Copying text
// back in (the old approach) still resets focus and the on-screen
// keyboard on mobile, which is what was still causing jumpiness —
// this way the exact same DOM element survives, so nothing about it
// ever actually resets: cursor position, focus, even autocomplete state.
function preserveOpenChatNodes(container){
  const preserved = {};
  container.querySelectorAll('.comments-box:not(.hidden)').forEach(box=>{
    const jobId = box.id.replace('comments-', '');
    preserved[jobId] = box;
    box.remove();
  });
  return preserved;
}
function restoreOpenChatNodes(container, preserved){
  Object.keys(preserved).forEach(jobId=>{
    const placeholder = container.querySelector('#comments-'+jobId);
    if(placeholder && preserved[jobId]) placeholder.replaceWith(preserved[jobId]);
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

// ================= job attachments (photos/files) =================
const openAttachmentThreads = new Set();
function attachmentsBlockHtml(jobId){
  return `
    <button class="comments-toggle" data-attach-job="${jobId}">📎 Files</button>
    <div class="comments-box hidden" id="attachments-${jobId}">
      <div class="attach-list" id="attach-list-${jobId}"></div>
      <label class="attach-upload-btn">
        + Add a photo or file
        <input type="file" id="attach-input-${jobId}" accept="image/*,.pdf,.doc,.docx" style="display:none;">
      </label>
    </div>`;
}
async function fetchAttachments(jobId){
  const { data, error } = await sb.from('job_attachments').select('*, profiles:uploader_id(name)').eq('job_id', jobId).order('created_at', { ascending:true });
  if(error){ console.error('fetchAttachments', error); return []; }
  return data || [];
}
async function renderAttachmentList(jobId){
  const listEl = document.getElementById('attach-list-'+jobId);
  if(!listEl) return;
  const files = await fetchAttachments(jobId);
  if(files.length === 0){ listEl.innerHTML = '<div class="empty-note">No files yet.</div>'; return; }
  const items = await Promise.all(files.map(async f=>{
    const { data: signed } = await sb.storage.from('job-attachments').createSignedUrl(f.file_path, 3600);
    const url = signed ? signed.signedUrl : '#';
    const isImage = (f.file_type || '').startsWith('image/');
    return `
      <div class="attach-item">
        ${isImage
          ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" class="attach-thumb" alt="${esc(f.file_name)}"></a>`
          : `<a href="${url}" target="_blank" rel="noopener" class="attach-file-link">📄 ${esc(f.file_name)}</a>`}
        <div class="attach-meta">${esc(f.profiles ? f.profiles.name : 'Someone')} · ${new Date(f.created_at).toLocaleDateString()}</div>
      </div>`;
  }));
  listEl.innerHTML = items.join('');
}
function openAttachmentThread(jobId){
  const box = document.getElementById('attachments-'+jobId);
  if(!box) return;
  box.classList.remove('hidden');
  openAttachmentThreads.add(jobId);
  renderAttachmentList(jobId);
  const input = document.getElementById('attach-input-'+jobId);
  input.onchange = async ()=>{
    const file = input.files[0];
    if(!file) return;
    if(file.size > 10*1024*1024){ alert('That file is too big — 10MB max.'); input.value=''; return; }
    const path = `${jobId}/${Date.now()}-${file.name}`;
    const { error: upErr } = await sb.storage.from('job-attachments').upload(path, file);
    if(upErr){ alert('Upload failed: ' + upErr.message); input.value=''; return; }
    const { error: metaErr } = await sb.from('job_attachments').insert([{ job_id:jobId, uploader_id:session.id, file_path:path, file_name:file.name, file_type:file.type }]);
    if(metaErr) console.error('job_attachments insert failed', metaErr);
    input.value = '';
    renderAttachmentList(jobId);
  };
}
function closeAttachmentThread(jobId){
  const box = document.getElementById('attachments-'+jobId);
  if(box) box.classList.add('hidden');
  openAttachmentThreads.delete(jobId);
}
function wireAttachmentToggles(container){
  container.querySelectorAll('[data-attach-job]').forEach(btn=>{
    const jobId = btn.dataset.attachJob;
    btn.onclick = ()=>{
      const box = document.getElementById('attachments-'+jobId);
      if(box.classList.contains('hidden')) openAttachmentThread(jobId); else closeAttachmentThread(jobId);
    };
    if(openAttachmentThreads.has(jobId)) openAttachmentThread(jobId);
  });
}

setInterval(()=>{
  openCommentThreads.forEach(jobId => renderCommentList(jobId));
}, 5000);

async function fetchLocation(mechanicId){
  const { data, error } = await sb.from('locations').select('*').eq('mechanic_id', mechanicId).maybeSingle();
  if(error || !data) return null;
  return { lat:data.lat, lng:data.lng, updatedAt:new Date(data.updated_at).getTime(), status:data.status };
}
// Fetches locations for MANY mechanics in a single request instead of
// one request per mechanic — critical once you have more than a
// handful of mechanics, since the old per-mechanic loop meant every
// dashboard refresh did N sequential network round-trips.
async function fetchLocationsFor(mechanicIds){
  const map = {};
  if(!mechanicIds || mechanicIds.length === 0) return map;
  const { data, error } = await sb.from('locations').select('*').in('mechanic_id', mechanicIds);
  if(error){ console.error('fetchLocationsFor', error); return map; }
  (data || []).forEach(row=>{
    map[row.mechanic_id] = { lat:row.lat, lng:row.lng, updatedAt:new Date(row.updated_at).getTime(), status:row.status };
  });
  return map;
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
let mechActiveJobsCache = []; // last-rendered active jobs, used by the GPS ticker to update distance without a full page rebuild
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
document.getElementById('brandHome').onclick = ()=>{ if(!appEntered) showPublicView('home'); };
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
function generateInviteCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  // crypto.getRandomValues is cryptographically secure — Math.random() is not,
  // and invite codes are a security-sensitive token, not just a display string.
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, b => chars[b % chars.length]).join('');
}
async function rotateInviteCode(orgId){
  await sb.from('organizations').update({ invite_code: generateInviteCode() }).eq('id', orgId);
}

async function resolveOrgForSignup(role, shopName, inviteCode){
  if(role === 'shop'){
    if(!shopName) return { error: 'Enter your company / shop name.' };
    const { data, error } = await sb.from('organizations').insert([{ name: shopName }]).select();
    if(error) return { error: 'Could not create your company: ' + error.message };
    return { orgId: data[0].id, joinedViaInvite: false };
  } else {
    if(!inviteCode) return { error: 'Enter the invite code from your shop owner.' };
    const { data, error } = await sb.from('organizations').select('id').eq('invite_code', inviteCode.trim().toUpperCase()).maybeSingle();
    if(error || !data) return { error: 'Invite code not found or already used — ask your shop owner for a fresh one.' };
    return { orgId: data.id, joinedViaInvite: true };
  }
}

document.getElementById('signupSubmit').onclick = async (e)=>{
  const btn = e.target; btn.disabled = true;
  const name = document.getElementById('suName').value.trim();
  const email = document.getElementById('suEmail').value.trim();
  const phone = document.getElementById('suPhone').value.trim();
  const role = document.getElementById('suRole').value;
  const shopName = document.getElementById('suShopName').value.trim();
  const inviteCode = document.getElementById('suInvite').value.trim();
  const company = document.getElementById('suCompany').value.trim();
  const pass = document.getElementById('suPass').value;
  authError.textContent = '';
  if(!name || !email || !phone || !pass || (role==='fleet' && !company)){ authError.textContent = 'Fill in all required fields.'; btn.disabled=false; return; }
  if(pass.length < 6){ authError.textContent = 'Password must be at least 6 characters.'; btn.disabled=false; return; }
  if(!sb){ authError.textContent = 'Not connected to the database yet — reload and try again.'; btn.disabled=false; return; }

  const { data: nameCheck } = await sb.from('profiles').select('name').ilike('name', name);
  if(nameCheck && nameCheck.length){ authError.textContent = 'That name is already taken.'; btn.disabled=false; return; }

  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if(error){ authError.textContent = error.message; btn.disabled=false; return; }

  if(data.session && data.user){
    const orgResult = await resolveOrgForSignup(role, shopName, inviteCode);
    if(orgResult.error){ authError.textContent = orgResult.error; btn.disabled=false; return; }
    const { error: profileErr } = await sb.from('profiles').insert([{ id:data.user.id, name, role, company: role==='fleet'?company:null, org_id:orgResult.orgId, active:true, email, phone }]);
    if(profileErr){ authError.textContent = 'Account created, but profile setup failed: ' + profileErr.message; btn.disabled=false; return; }
    if(role === 'fleet'){
      const { error: linkErr } = await sb.from('fleet_shop_links').insert([{ fleet_id:data.user.id, org_id:orgResult.orgId }]);
      if(linkErr) console.error('fleet_shop_links insert failed on signup', linkErr); // recoverable via "Join another shop" in their dashboard
    }
    if(orgResult.joinedViaInvite) rotateInviteCode(orgResult.orgId);
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
  const phone = document.getElementById('cpPhone').value.trim();
  const role = document.getElementById('cpRole').value;
  const shopName = document.getElementById('cpShopName').value.trim();
  const inviteCode = document.getElementById('cpInvite').value.trim();
  const company = document.getElementById('cpCompany').value.trim();
  authError.textContent = '';
  if(!name || !phone || (role==='fleet' && !company)){ authError.textContent = 'Fill in all required fields.'; btn.disabled=false; return; }

  const orgResult = await resolveOrgForSignup(role, shopName, inviteCode);
  if(orgResult.error){ authError.textContent = orgResult.error; btn.disabled=false; return; }

  const { data: userData, error: getUserErr } = await sb.auth.getUser();
  if(getUserErr || !userData || !userData.user){ authError.textContent = 'Something went wrong confirming your session — please refresh and try again.'; btn.disabled=false; return; }
  const { error } = await sb.from('profiles').insert([{ id:userData.user.id, name, role, company: role==='fleet'?company:null, org_id:orgResult.orgId, active:true, email:userData.user.email, phone }]);
  if(error){ authError.textContent = error.message; btn.disabled=false; return; }
  if(role === 'fleet'){
    const { error: linkErr } = await sb.from('fleet_shop_links').insert([{ fleet_id:userData.user.id, org_id:orgResult.orgId }]);
    if(linkErr) console.error('fleet_shop_links insert failed on signup', linkErr); // recoverable via "Join another shop" in their dashboard
  }
  if(orgResult.joinedViaInvite) rotateInviteCode(orgResult.orgId);
  await onAuthed(userData.user.id);
  btn.disabled = false;
};

// ================= more menu (change password / log out) =================
const moreMenuBtn = document.getElementById('moreMenuBtn');
const moreMenu = document.getElementById('moreMenu');
moreMenuBtn.onclick = (e)=>{
  e.stopPropagation();
  moreMenu.classList.toggle('hidden');
};
document.addEventListener('click', (e)=>{
  if(!moreMenu.classList.contains('hidden') && !moreMenu.contains(e.target) && e.target !== moreMenuBtn){
    moreMenu.classList.add('hidden');
  }
});

const contactModalOverlay = document.getElementById('contactModalOverlay');
document.getElementById('contactUsBtn').onclick = ()=>{
  moreMenu.classList.add('hidden');
  contactModalOverlay.classList.remove('hidden');
};
document.getElementById('contactModalClose').onclick = ()=> contactModalOverlay.classList.add('hidden');
contactModalOverlay.onclick = (e)=>{ if(e.target === contactModalOverlay) contactModalOverlay.classList.add('hidden'); };

document.getElementById('editCompanyBtn').onclick = async ()=>{
  moreMenu.classList.add('hidden');
  const newName = prompt('Enter your new company / shop name:', session.orgName || '');
  if(!newName || !newName.trim()) return;
  const { error } = await sb.from('organizations').update({ name: newName.trim() }).eq('id', session.orgId);
  if(error){ alert('Could not update company name: ' + error.message); return; }
  session.orgName = newName.trim();
  document.getElementById('whoOrg').textContent = '· ' + session.orgName;
  alert('Company name updated.');
};

document.getElementById('changePassBtn').onclick = async ()=>{
  moreMenu.classList.add('hidden');
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
  let orgName = null, orgStatus = 'approved';
  if(profile.org_id){
    const { data: orgData } = await sb.from('organizations').select('name, status').eq('id', profile.org_id).maybeSingle();
    orgName = orgData ? orgData.name : null;
    orgStatus = orgData ? orgData.status : 'approved';
  }
  session = { id:profile.id, name:profile.name, role:profile.role, company:profile.company, orgId:profile.org_id, orgName, orgStatus };

  if(profile.active === false){
    showInactiveScreen();
    return;
  }
  if(session.role === 'shop' && orgStatus !== 'approved'){
    showPendingScreen(orgStatus);
    return;
  }
  enterApp();
}

function showInactiveScreen(){
  document.getElementById('publicNav').classList.add('hidden');
  homeView.classList.add('hidden');
  contactView.classList.add('hidden');
  publicAuthView.classList.add('hidden');
  document.getElementById('whoBox').classList.remove('hidden');
  document.getElementById('whoName').textContent = session.name;
  document.getElementById('whoRole').textContent = 'Inactive';
  document.getElementById('whoOrg').textContent = '';
  document.getElementById('editCompanyBtn').classList.add('hidden');
  document.getElementById('accountInactiveView').classList.remove('hidden');
}

function showPendingScreen(status){
  document.getElementById('publicNav').classList.add('hidden');
  homeView.classList.add('hidden');
  contactView.classList.add('hidden');
  publicAuthView.classList.add('hidden');
  document.getElementById('whoBox').classList.remove('hidden');
  document.getElementById('whoName').textContent = session.name;
  document.getElementById('whoRole').textContent = 'Shop owner';
  document.getElementById('whoOrg').textContent = session.orgName ? '· ' + session.orgName : '';
  document.getElementById('editCompanyBtn').classList.add('hidden');

  const view = document.getElementById('pendingApprovalView');
  view.classList.remove('hidden');
  if(status === 'rejected'){
    document.getElementById('pendingIcon').textContent = '⚠️';
    document.getElementById('pendingTitle').textContent = "We couldn't approve this request";
    document.getElementById('pendingBody').textContent = "Your company's request to join Relay wasn't approved. If you think this is a mistake, reach out to us at hello@relayfleet.us.";
    document.getElementById('pendingCheckBtn').classList.add('hidden');
  } else {
    document.getElementById('pendingIcon').textContent = '⏳';
    document.getElementById('pendingTitle').textContent = 'Your request is under review';
    document.getElementById('pendingBody').textContent = "Thanks for signing up for Relay. We're reviewing your company's request and will be in touch shortly.";
    document.getElementById('pendingCheckBtn').classList.remove('hidden');
  }
}

document.getElementById('pendingCheckBtn').onclick = async ()=>{
  const btn = document.getElementById('pendingCheckBtn');
  btn.disabled = true;
  btn.textContent = 'Checking...';
  const { data: orgData } = await sb.from('organizations').select('status').eq('id', session.orgId).maybeSingle();
  const status = orgData ? orgData.status : 'pending';
  if(status === 'approved'){
    document.getElementById('pendingApprovalView').classList.add('hidden');
    enterApp();
  } else {
    session.orgStatus = status;
    showPendingScreen(status);
    btn.disabled = false;
    btn.textContent = 'Check again';
  }
};

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
  const panelParent = container.parentElement; // the view div that holds both the tab bar and the panels
  tabs.forEach(tab=>{
    tab.onclick = ()=>{
      tabs.forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      panelParent.querySelectorAll(':scope > .dash-panel').forEach(p=>p.classList.add('hidden'));
      const target = document.getElementById(tab.dataset.target);
      if(target) target.classList.remove('hidden');
      // Leaflet maps initialized while their tab was hidden render blank —
      // they never learn their real size until told to recalculate, which
      // can only happen once the tab is actually visible in the DOM.
      setTimeout(()=>{
        [shopMap, pinMapObj, adminOpsMap].forEach(m=>{ if(m && m.invalidateSize) m.invalidateSize(); });
      }, 50);
    };
  });
}
document.querySelectorAll('.dash-tabs').forEach(wireDashTabs);

// ================= app entry =================
// ================= realtime sync =================
// Instead of every dashboard constantly asking "anything new?" every
// few seconds, Supabase pushes changes the instant they happen.
let realtimeChannel = null;
function refreshCurrentView(){
  if(!appEntered) return;
  if(session.role === 'mechanic') renderMechJobs();
  else if(session.role === 'shop') refreshShopData();
  else if(session.role === 'admin') refreshAdminData();
  else if(session.role === 'fleet') refreshFleetData();
}
// Location pings happen constantly (every few seconds per live mechanic) —
// far too often to justify rebuilding the whole page, since that was wiping
// out anything being typed in an open chat box. Instead we just nudge the
// map marker directly, straight from the realtime payload, touching nothing
// else on the page at all.
function handleLocationPing(payload){
  if(!appEntered) return;
  const row = payload.new;
  if(!row || !row.mechanic_id) return;
  if(session.role === 'shop' && shopMarkers[row.mechanic_id]){
    shopMarkers[row.mechanic_id].setLatLng([row.lat, row.lng]);
  } else if(session.role === 'admin' && adminMarkers[row.mechanic_id]){
    adminMarkers[row.mechanic_id].setLatLng([row.lat, row.lng]);
  } else if(session.role === 'fleet'){
    const jobIds = fleetJobsByMechanic[row.mechanic_id] || [];
    jobIds.forEach(jobId=>{
      const entry = fleetMaps[jobId];
      if(!entry) return;
      if(entry.mechMarker) entry.mechMarker.setLatLng([row.lat, row.lng]);
      else entry.mechMarker = L.marker([row.lat, row.lng], { icon: pinIcon('mech') }).addTo(entry.map);
    });
  }
  // Mechanic's own marker is already handled locally by their own GPS callback.
}
function setupRealtimeSync(){
  if(realtimeChannel || !sb) return;
  realtimeChannel = sb.channel('relay-live-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, refreshCurrentView)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, handleLocationPing)
    .subscribe();
}

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
  document.getElementById('whoOrg').textContent = session.orgName ? '· ' + session.orgName : '';
  document.getElementById('editCompanyBtn').classList.toggle('hidden', session.role !== 'shop');

  if(session.role === 'mechanic'){ document.getElementById('mechanicView').classList.remove('hidden'); initMechanicView(); }
  else if(session.role === 'shop'){ document.getElementById('shopView').classList.remove('hidden'); initShopView(); }
  else if(session.role === 'admin'){ document.getElementById('adminView').classList.remove('hidden'); initAdminView(); }
  else { document.getElementById('fleetView').classList.remove('hidden'); initFleetView(); }

  setupRealtimeSync();

  // Watch for admin deactivating this account WHILE they're using the app —
  // kicks them out immediately instead of waiting for their next reload.
  setInterval(async ()=>{
    const { data } = await sb.from('profiles').select('active').eq('id', session.id).maybeSingle();
    if(data && data.active === false){
      if(watchId !== null){ navigator.geolocation.clearWatch(watchId); watchId = null; }
      document.getElementById('mechanicView').classList.add('hidden');
      document.getElementById('shopView').classList.add('hidden');
      document.getElementById('adminView').classList.add('hidden');
      document.getElementById('fleetView').classList.add('hidden');
      showInactiveScreen();
    }
  }, 15000);
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
      // Update just the distance numbers directly instead of rebuilding the
      // whole page — this used to call renderMechJobs() on every single GPS
      // tick (often every 1-3 seconds), which was wiping out anything being
      // typed in an open chat box. Distances still update live; nothing else
      // needs to change just because the GPS pinged.
      mechActiveJobsCache.forEach(job=>{
        const el = document.getElementById('mech-dist-'+job.id);
        if(!el) return;
        const mi = milesBetween(latitude, longitude, job.dest_lat, job.dest_lng);
        el.textContent = mi < 0.1 ? 'Arrived' : mi.toFixed(1) + ' mi away';
      });
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
  setInterval(renderMechJobs, 60000); // fallback only - Realtime handles instant updates
}

async function renderMechJobs(){
  const active = (await fetchActiveJobs()).filter(j => j.mechanic_id === session.id);
  const history = (await fetchCompletedJobs(15)).filter(j => j.mechanic_id === session.id);
  mechActiveJobsCache = active; // used by the GPS ticker to update distance without a full rebuild

  document.getElementById('mechActiveCount').textContent = active.length ? active.length + ' active' : '';

  const loc = await fetchLocation(session.id);

  const activeBox = document.getElementById('mechJobsBox');
  const _s1 = preserveOpenChatNodes(activeBox);
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
          <div class="row"><span>Distance</span><b id="mech-dist-${job.id}">${distText}</b></div>
          <div class="row"><span>Status</span><b>${job.status.replace('_',' ')}</b></div>
          <a class="directions-btn" href="https://www.google.com/maps/dir/?api=1&destination=${job.dest_lat},${job.dest_lng}" target="_blank" rel="noopener">🧭 Get directions</a>
          <div class="job-actions">
            <button data-s="en_route" class="${job.status==='en_route'?'active':''}">Heading there</button>
            <button data-s="on_site" class="${job.status==='on_site'?'active':''}">Mark arrived</button>
            <button data-s="complete" class="${job.status==='complete'?'active':''}">Mark complete</button>
          </div>
          ${commentsBlockHtml(job.id)}
          ${attachmentsBlockHtml(job.id)}
        </div>`;
    }).join('');

    wireCommentToggles(activeBox);
    wireAttachmentToggles(activeBox);
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
  restoreOpenChatNodes(activeBox, _s1);

  const historyBox = document.getElementById('mechHistoryBox');
  const _s2 = preserveOpenChatNodes(historyBox);
  historyBox.innerHTML = history.length === 0
    ? '<div class="empty-note">No completed jobs yet.</div>'
    : history.map(job => `
        <div class="job-card">
          <div class="job-card-top"><div><b>${esc(job.customer)}</b><div class="meta">${esc(job.vehicle)}</div></div><span class="badge arrived"><span class="bd"></span>complete</span></div>
          ${commentsBlockHtml(job.id)}
          ${attachmentsBlockHtml(job.id)}
        </div>`).join('');
  wireCommentToggles(historyBox);
  wireAttachmentToggles(historyBox);
  restoreOpenChatNodes(historyBox, _s2);
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

document.getElementById('regenerateInviteBtn').onclick = async ()=>{
  if(!session || !session.orgId) return;
  if(!confirm('This will make the current invite code stop working immediately. Continue?')) return;
  await rotateInviteCode(session.orgId);
  loadInviteCode();
};

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
  setInterval(refreshShopData, 60000); // fallback only - Realtime handles instant updates
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
  const members = await fetchOrgMembers();
  const mechanics = members.filter(m=>m.role==='mechanic');
  const fleets = members.filter(m=>m.role==='fleet');
  const box = document.getElementById('teamList');

  function rowHtml(m){
    const sub = m.role === 'fleet'
      ? `Fleet manager · ${esc(m.company || 'no company set')}`
      : 'Mechanic';
    return `
    <div class="team-row">
      <div><div class="tname">${esc(m.name)}</div><div class="tstatus">${sub} — ${m.active ? 'Active' : 'Deactivated'}</div></div>
      <button class="toggle-btn ${m.active ? 'on' : 'off'}" data-id="${m.id}" data-active="${m.active}">${m.active ? 'Active' : 'Inactive'}</button>
    </div>`;
  }

  box.innerHTML = `
    <div class="team-subhead">Mechanics</div>
    ${mechanics.length ? mechanics.map(rowHtml).join('') : '<div class="empty-note">No mechanics have signed up yet.</div>'}
    <div class="team-subhead">Fleet managers</div>
    ${fleets.length ? fleets.map(rowHtml).join('') : '<div class="empty-note">No fleet managers have signed up yet.</div>'}
  `;

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
  const active = await fetchActiveJobs();
  const locByMechanic = await fetchLocationsFor(mechanics.map(m=>m.id));

  let liveCount = 0;
  for(const m of mechanics){
    const loc = locByMechanic[m.id];
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

  const history = await fetchCompletedJobs(20);

  const today = new Date(); today.setHours(0,0,0,0);
  // Note: "completed today" is computed from the most recent 20 completed jobs,
  // not the full history — on an extremely busy day (20+ completions) this
  // could slightly undercount. Acceptable tradeoff for not downloading a
  // company's entire job history just to show one stat number.
  const completedToday = history.filter(j => j.updated_at && new Date(j.updated_at) >= today).length;
  document.getElementById('shopStats').innerHTML = `
    <div class="stat-box"><b>${active.length}</b><span>Active jobs</span></div>
    <div class="stat-box"><b>${liveCount}</b><span>Mechanics live now</span></div>
    <div class="stat-box"><b>${mechanics.filter(m=>m.active).length}</b><span>Active mechanics</span></div>
    <div class="stat-box"><b>${completedToday}</b><span>Completed today</span></div>`;

  // Analytics currently run against active + the most recent 20 completed
  // jobs, not a company's full history — a proper fix is a dedicated
  // database aggregation query (flagged in the production audit as a
  // follow-up, not done in this pass).
  renderAnalytics(active.concat(history), mechanics, mechName);

  const list = document.getElementById('shopJobList');
  const _s1 = preserveOpenChatNodes(list);
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
        ${attachmentsBlockHtml(j.id)}
      </div>`).join('');

    wireCommentToggles(list);
    wireAttachmentToggles(list);
    list.querySelectorAll('.job-card').forEach(card=>{
      const jobId = Number(card.dataset.job);
      const job = active.find(j=>j.id===jobId);
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
  restoreOpenChatNodes(list, _s1);

  const histBox = document.getElementById('shopHistoryList');
  const _s2 = preserveOpenChatNodes(histBox);
  histBox.innerHTML = history.length === 0
    ? '<div class="empty-note">No completed jobs yet.</div>'
    : history.map(j => `
      <div class="job-card">
        <div class="job-card-top"><div><b>${esc(j.customer)} — ${esc(j.vehicle)}</b><div class="meta">Mechanic: ${esc(mechName(j.mechanic_id))}</div></div><span class="badge arrived"><span class="bd"></span>complete</span></div>
        ${commentsBlockHtml(j.id)}
        ${attachmentsBlockHtml(j.id)}
      </div>`).join('');
  wireCommentToggles(histBox);
  wireAttachmentToggles(histBox);
  restoreOpenChatNodes(histBox, _s2);
}

// ================= FLEET MANAGER VIEW =================
const fleetMaps = {};
let fleetJobsByMechanic = {}; // mechanic_id -> [job.id, ...], used for realtime marker targeting
function initFleetView(){
  document.getElementById('fleetHint').textContent = `Showing units for ${session.company}, across every shop you've joined.`;
  loadFleetShops();
  refreshFleetData();
  setInterval(refreshFleetData, 60000); // fallback only - Realtime handles instant updates
}

async function loadFleetShops(){
  const listBox = document.getElementById('fleetShopList');
  const { data, error } = await sb.from('fleet_shop_links').select('org_id, organizations(name)').eq('fleet_id', session.id);
  if(error || !data || data.length === 0){ listBox.innerHTML = '<div class="empty-note">You haven\'t joined any shops yet.</div>'; return; }
  listBox.innerHTML = data.map(l => `<span class="shop-chip">🏢 ${esc(l.organizations ? l.organizations.name : 'Unknown shop')}</span>`).join('');
}

document.getElementById('fleetAddShopBtn').onclick = async ()=>{
  const errBox = document.getElementById('fleetAddShopError');
  const codeInput = document.getElementById('fleetAddShopCode');
  const code = codeInput.value.trim().toUpperCase();
  errBox.textContent = '';
  if(!code){ errBox.textContent = 'Enter an invite code.'; return; }

  const { data: org, error: orgErr } = await sb.from('organizations').select('id').eq('invite_code', code).maybeSingle();
  if(orgErr || !org){ errBox.textContent = 'Invite code not found — double check it with that shop.'; return; }

  const { error: linkErr } = await sb.from('fleet_shop_links').insert([{ fleet_id: session.id, org_id: org.id }]);
  if(linkErr){
    errBox.textContent = linkErr.code === '23505' ? 'You\'ve already joined that shop.' : 'Could not join: ' + linkErr.message;
    return;
  }
  await rotateInviteCode(org.id);
  codeInput.value = '';
  loadFleetShops();
  refreshFleetData();
};

async function refreshFleetData(){
  // RLS already restricts this to only jobs from shops you've joined, matching your company name
  const active = await fetchActiveJobs();
  const history = await fetchCompletedJobs(15);
  const locByMechanic = await fetchLocationsFor(active.map(j=>j.mechanic_id));
  const orgs = await fetchAllOrganizations();
  const orgName = id => (orgs.find(o=>o.id===id) || {}).name || '—';

  fleetJobsByMechanic = {};
  active.forEach(j => {
    if(!fleetJobsByMechanic[j.mechanic_id]) fleetJobsByMechanic[j.mechanic_id] = [];
    fleetJobsByMechanic[j.mechanic_id].push(j.id);
  });

  const box = document.getElementById('fleetJobs');
  const _s1 = preserveOpenChatNodes(box);
  if(active.length === 0){ box.innerHTML = '<div class="card empty-note">No active jobs for your company right now.</div>'; }
  else {
    let html = '';
    for(const j of active){
      html += `<div class="card" style="margin-bottom:14px;">
        <div class="job-card-top"><div><b>${esc(j.vehicle)}</b><div class="meta">Shop: ${esc(orgName(j.org_id))}</div></div><span class="badge ${j.status==='on_site'?'arrived':'live'}"><span class="bd"></span>${j.status.replace('_',' ')}</span></div>
        <div class="ops-map" style="height:280px; margin-top:12px;" id="fleetMap${j.id}"></div>
        <div class="gps-readout" id="fleetDist${j.id}" style="margin-top:10px;"></div>
        ${commentsBlockHtml(j.id)}
        ${attachmentsBlockHtml(j.id)}
      </div>`;
    }
    box.innerHTML = html;
    wireCommentToggles(box);
    wireAttachmentToggles(box);
    restoreOpenChatNodes(box, _s1);

    for(const j of active){
      const loc = locByMechanic[j.mechanic_id];
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
  const _s2 = preserveOpenChatNodes(histBox);
  histBox.innerHTML = history.length === 0
    ? '<div class="card empty-note">No completed jobs yet.</div>'
    : history.map(j => `<div class="job-card"><div class="job-card-top"><b>${esc(j.vehicle)}</b><span class="badge arrived"><span class="bd"></span>complete</span></div>${commentsBlockHtml(j.id)}${attachmentsBlockHtml(j.id)}</div>`).join('');
  wireCommentToggles(histBox);
  wireAttachmentToggles(histBox);
  restoreOpenChatNodes(histBox, _s2);
}

// ================= ADMIN VIEW =================
let adminOpsMap = null;
const adminMarkers = {};

function initAdminView(){
  adminOpsMap = L.map('adminOpsMap', { attributionControl:false }).setView([42.45, -83.25], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(adminOpsMap);

  refreshAdminData();
  setInterval(refreshAdminData, 60000); // fallback only - Realtime handles instant updates
}

async function refreshAdminData(){
  const profiles = await fetchAllProfiles();
  const orgs = await fetchAllOrganizations();
  const mechanics = profiles.filter(p=>p.role==='mechanic');
  const orgName = id => (orgs.find(o=>o.id===id) || {}).name || '—';
  const locByMechanic = await fetchLocationsFor(mechanics.map(m=>m.id));

  // Fleet managers can belong to multiple shops now — build the full list
  // per fleet manager instead of just showing their first/primary one.
  const { data: allFleetLinks } = await sb.from('fleet_shop_links').select('fleet_id, org_id');
  const fleetShopsById = {};
  (allFleetLinks || []).forEach(l=>{
    if(!fleetShopsById[l.fleet_id]) fleetShopsById[l.fleet_id] = [];
    fleetShopsById[l.fleet_id].push(orgName(l.org_id));
  });

  // stats
  let liveCount = 0;
  for(const m of mechanics){
    const loc = locByMechanic[m.id];
    if(loc && Date.now() - loc.updatedAt < 30000) liveCount++;
  }
  const activeJobs = await fetchActiveJobs();
  // Exact counts via a head-only query — gets the real total without
  // downloading every row, which matters once job history is in the
  // thousands. This is what Phase 15 of the audit asks for: efficient
  // aggregation instead of scanning the whole table into the browser.
  const { count: completeCount } = await sb.from('jobs').select('*', { count:'exact', head:true }).eq('status','complete');
  document.getElementById('adminStats').innerHTML = `
    <div class="stat-box"><b>${profiles.length}</b><span>Total accounts</span></div>
    <div class="stat-box"><b>${liveCount}</b><span>Mechanics live now</span></div>
    <div class="stat-box"><b>${activeJobs.length}</b><span>Active jobs</span></div>
    <div class="stat-box"><b>${completeCount || 0}</b><span>Completed jobs</span></div>`;

  // live map
  for(const m of mechanics){
    const loc = locByMechanic[m.id];
    if(!loc) continue;
    const isLive = Date.now() - loc.updatedAt < 30000;
    if(adminMarkers[m.id]) adminMarkers[m.id].setLatLng([loc.lat, loc.lng]);
    else adminMarkers[m.id] = L.marker([loc.lat, loc.lng], { icon: pinIcon(isLive?'mech':'offline') }).addTo(adminOpsMap).bindPopup(esc(m.name));
  }

  // accounts — only show members of approved companies (pending/rejected show under Requests instead)
  const approvedOrgIds = new Set(orgs.filter(o=>o.status==='approved').map(o=>o.id));
  const visibleProfiles = profiles.filter(p => p.role === 'admin' || approvedOrgIds.has(p.org_id));
  const accBox = document.getElementById('adminAccounts');

  function accountRowHtml(p, companyLine){
    return `
    <div class="account-row" data-id="${p.id}">
      <div class="aname">${esc(p.name)}<div class="meta" style="font-family:var(--font-mono); font-size:0.72rem; color:var(--ink-faint); margin-top:2px;">${companyLine}</div></div>
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
    </div>`;
  }

  function renderAccountsForRole(role){
    const filtered = visibleProfiles.filter(p=>p.role===role);
    const companyLine = p =>
      role === 'shop' ? 'Company: ' + esc(orgName(p.org_id)) :
      role === 'mechanic' ? 'Works for: ' + esc(orgName(p.org_id)) :
      role === 'fleet' ? 'Customer of: ' + esc((fleetShopsById[p.id]||[]).join(', ') || orgName(p.org_id)) + ' · Company: ' + esc(p.company||'—') :
      'Platform admin';
    accBox.innerHTML = filtered.length
      ? filtered.map(p=>accountRowHtml(p, companyLine(p))).join('')
      : '<div class="empty-note">None yet.</div>';
    accBox.querySelectorAll('.account-row').forEach(row=>{
      const id = row.dataset.id;
      row.querySelector('.toggle-btn').onclick = async (e)=>{
        const btn = e.target;
        const newActive = btn.dataset.active !== 'true';
        const { error } = await sb.from('profiles').update({ active:newActive }).eq('id', id);
        if(!error) refreshAdminData();
      };
      row.querySelector('.acc-save').onclick = async ()=>{
        const newRole = row.querySelector('.arole-select').value;
        const company = row.querySelector('.acompany-input').value.trim();
        const { error } = await sb.from('profiles').update({ role:newRole, company: newRole==='fleet' ? company : null }).eq('id', id);
        if(error) alert('Could not update: ' + error.message); else refreshAdminData();
      };
    });
  }

  const roleFilter = document.getElementById('accountsRoleFilter');
  renderAccountsForRole(roleFilter.value);
  roleFilter.onchange = ()=> renderAccountsForRole(roleFilter.value);


  // pending company requests
  const pendingOrgs = orgs.filter(o => o.status === 'pending');
  const reqBadge = document.getElementById('requestsBadge');
  if(pendingOrgs.length > 0){ reqBadge.textContent = pendingOrgs.length; reqBadge.classList.remove('hidden'); }
  else { reqBadge.classList.add('hidden'); }

  const reqBox = document.getElementById('adminRequests');
  if(pendingOrgs.length === 0){
    reqBox.innerHTML = '<div class="empty-note">No pending requests right now.</div>';
  } else {
    reqBox.innerHTML = pendingOrgs.map(org => {
      const owner = profiles.find(p => p.org_id === org.id && p.role === 'shop');
      return `
      <div class="request-card" data-org="${org.id}">
        <div class="rq-top">
          <div>
            <div class="rq-shop">${esc(org.name)}</div>
            <div class="rq-meta">
              Owner: ${esc(owner ? owner.name : 'Unknown')}<br>
              Email: ${esc(owner && owner.email ? owner.email : '—')}<br>
              Phone: ${esc(owner && owner.phone ? owner.phone : '—')}<br>
              Requested: ${new Date(org.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
        <div class="rq-actions">
          <button class="rq-approve">Approve</button>
          <button class="rq-reject">Reject</button>
        </div>
      </div>`;
    }).join('');

    reqBox.querySelectorAll('.request-card').forEach(card=>{
      const orgId = card.dataset.org;
      card.querySelector('.rq-approve').onclick = async ()=>{
        const { error } = await sb.from('organizations').update({ status:'approved' }).eq('id', orgId);
        if(error) alert('Could not approve: ' + error.message); else refreshAdminData();
      };
      card.querySelector('.rq-reject').onclick = async ()=>{
        if(!confirm('Reject this company\'s request? They will see a rejection message when they log in.')) return;
        const { error } = await sb.from('organizations').update({ status:'rejected' }).eq('id', orgId);
        if(error) alert('Could not reject: ' + error.message); else refreshAdminData();
      };
    });
  }

  // jobs
  const mechName = id => (profiles.find(p=>p.id===id) || {}).name || 'Unassigned';
  const active = activeJobs; // already fetched above for the stats
  const history = await fetchCompletedJobs(30);

  const list = document.getElementById('adminJobList');
  const _s1 = preserveOpenChatNodes(list);
  list.innerHTML = active.length === 0 ? '<div class="empty-note">No active jobs.</div>' : active.slice().reverse().map(j => `
    <div class="job-card" data-job="${j.id}">
      <div class="job-card-top">
        <div><b>${esc(j.customer)} — ${esc(j.vehicle)}</b><div class="meta">Mechanic: ${esc(mechName(j.mechanic_id))} · Company: ${esc(orgName(j.org_id))}</div></div>
        <span class="badge ${j.status==='on_site'?'arrived':'live'}"><span class="bd"></span>${j.status.replace('_',' ')}</span>
      </div>
      <div class="job-actions">
        <button class="j-delete danger">Delete</button>
      </div>
      ${commentsBlockHtml(j.id)}
      ${attachmentsBlockHtml(j.id)}
    </div>`).join('');
  wireCommentToggles(list);
  wireAttachmentToggles(list);
  restoreOpenChatNodes(list, _s1);
  list.querySelectorAll('.j-delete').forEach(btn=>{
    btn.onclick = async ()=>{
      const jobId = Number(btn.closest('.job-card').dataset.job);
      if(!confirm('Delete this job?')) return;
      const { error } = await sb.from('jobs').delete().eq('id', jobId);
      if(!error) refreshAdminData();
    };
  });

  const adminHistBox = document.getElementById('adminHistoryList');
  const _s2 = preserveOpenChatNodes(adminHistBox);
  adminHistBox.innerHTML = history.length === 0
    ? '<div class="empty-note">No completed jobs yet.</div>'
    : history.map(j => `<div class="job-card"><div class="job-card-top"><div><b>${esc(j.customer)} — ${esc(j.vehicle)}</b><div class="meta">Mechanic: ${esc(mechName(j.mechanic_id))} · Company: ${esc(orgName(j.org_id))}</div></div><span class="badge arrived"><span class="bd"></span>complete</span></div>${commentsBlockHtml(j.id)}${attachmentsBlockHtml(j.id)}</div>`).join('');
  wireCommentToggles(adminHistBox);
  wireAttachmentToggles(adminHistBox);
  restoreOpenChatNodes(adminHistBox, _s2);

  // error log
  const { data: errors } = await sb.from('error_logs').select('*').order('created_at', { ascending:false }).limit(50);
  const errBadge = document.getElementById('errorsBadge');
  const recentErrors = (errors || []).filter(e => Date.now() - new Date(e.created_at).getTime() < 24*60*60*1000);
  if(recentErrors.length > 0){ errBadge.textContent = recentErrors.length; errBadge.classList.remove('hidden'); }
  else { errBadge.classList.add('hidden'); }

  const errBox = document.getElementById('adminErrors');
  errBox.innerHTML = (!errors || errors.length === 0) ? '<div class="empty-note">No errors logged. That\'s a good sign.</div>' :
    errors.map(er => `
      <div class="error-card">
        <div class="err-msg">${esc(er.message || 'Unknown error')}</div>
        <div class="err-meta">${new Date(er.created_at).toLocaleString()} · Role: ${esc(er.user_role||'—')} · Page: ${esc((er.page_url||'').split('/').pop() || '—')}</div>
        ${er.stack ? `<details><summary>Stack trace</summary><pre>${esc(er.stack)}</pre></details>` : ''}
      </div>`).join('');
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
