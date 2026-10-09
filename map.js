// ============================================================
// RelayFleet — shops on the map (R10).
// Fleet portal "Find shops": every approved shop location in the US, each
// marked with the shop's logo (or initials). Admin: the same map of every
// shop on Relay. Pins are exact lat/lng, the same spot as Google/Apple Maps.
// ============================================================
let shopDirCache = null;
async function loadShopDirectory(force){
  if(shopDirCache && !force) return shopDirCache;
  const { data, error } = await sb.rpc('shop_directory');
  if(error) throw error;
  shopDirCache = Array.isArray(data) ? data : [];
  return shopDirCache;
}
function shopInitials(name){ return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'; }
function shopLogoUrl(e){ return e.logo_path && typeof billingLogoPublicUrl === 'function' ? billingLogoPublicUrl(e.logo_path) : ''; }
function shopMarkerIcon(e){
  const logo = shopLogoUrl(e);
  return L.divIcon({ className:'shop-pin-wrap' + (e.shown === false ? ' is-hidden' : ''), iconSize:[44, 52], iconAnchor:[22, 50], popupAnchor:[0, -46],
    html:`<div class="shop-pin">${logo ? `<img src="${esc(logo)}" alt="">` : `<span>${esc(shopInitials(e.company))}</span>`}</div><div class="shop-pin-tip"></div>` });
}
function shopDirections(e){
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return ios ? `https://maps.apple.com/?daddr=${e.lat},${e.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}`;
}
function shopCardHtml(e, opts){
  return `<div class="shop-pop">
    <div class="shop-pop-head">${shopLogoUrl(e) ? `<img src="${esc(shopLogoUrl(e))}" alt="">` : `<span class="shop-pop-init">${esc(shopInitials(e.company))}</span>`}
      <div><b>${esc(e.company || '')}</b><div class="meta">${esc(e.location || '')}${e.shown === false ? ' · hidden from fleets' : ''}${e.km != null ? ' · ' + Math.round(e.km * 0.621371) + ' mi away' : ''}</div></div></div>
    ${e.address ? `<div class="shop-pop-line">${esc(e.address)}</div>` : ''}
    <div class="shop-pop-actions">
      ${e.phone ? `<a class="ghost-btn" href="tel:${esc(String(e.phone).replace(/[^\d+]/g, ''))}">Call</a>` : ''}
      ${e.email ? `<a class="ghost-btn" href="mailto:${esc(e.email)}">Email</a>` : ''}
      <a class="ghost-btn" href="${shopDirections(e)}" target="_blank" rel="noopener">Directions</a>
      ${opts && opts.request ? `<a class="ghost-btn primary" href="/?request=${encodeURIComponent(e.org_id)}" target="_blank" rel="noopener">Request service</a>` : ''}
    </div>${e.phone || e.email ? `<div class="meta shop-pop-contact">${esc([e.phone, e.email].filter(Boolean).join(' · '))}</div>` : ''}</div>`;
}
function drawShopMap(elId, entries, opts){
  const el = document.getElementById(elId);
  if(!el || !window.L) return null;
  if(el._relayMap){ el._relayMap.remove(); el._relayMap = null; }
  const map = L.map(el, { scrollWheelZoom: !('ontouchstart' in window) }).setView([39.5, -98.35], 4);   // the whole US
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'© OpenStreetMap' }).addTo(map);
  const pts = [];
  entries.forEach(e => { if(e.lat == null) return; const m = L.marker([e.lat, e.lng], { icon: shopMarkerIcon(e), title: (e.company || '') + ' — ' + (e.location || '') }).addTo(map); m.bindPopup(shopCardHtml(e, opts), { maxWidth: 300 }); pts.push([e.lat, e.lng]); e._marker = m; });
  if(pts.length === 1) map.setView(pts[0], 12); else if(pts.length > 1) map.fitBounds(pts, { padding:[40, 40], maxZoom: 12 });
  el._relayMap = map; setTimeout(() => map.invalidateSize(), 80);
  return map;
}
const kmBetween = (a, b, c, d) => { const R = 6371, r = x => x * Math.PI / 180; const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

// ---------- fleet portal: Find shops ----------
async function renderFleetShopMap(){
  const box = document.getElementById('fp-shops'); if(!box) return;
  box.innerHTML = `<div class="section-head"><h2>Find shops</h2><span class="meta">Truck and trailer repair shops on Relay across the US</span></div>
    <div class="rec-toolbar"><input type="search" id="fsSearch" placeholder="Search by shop, city or state" aria-label="Search shops"><button type="button" class="ghost-btn" id="fsNear">Near me</button></div>
    <div class="shop-map" id="fleetShopMap"></div><div id="fsList" class="fs-list"><p class="meta">Loading shops…</p></div>`;
  let entries;
  try { entries = (await loadShopDirectory(true)).map(e => ({ ...e })); }
  catch(e){ document.getElementById('fsList').innerHTML = `<p class="form-error">${esc(e.message || String(e))}</p>`; return; }
  const map = drawShopMap('fleetShopMap', entries, { request:true });
  const list = (rows) => { document.getElementById('fsList').innerHTML = rows.length ? rows.map(e => `<div class="fs-row" data-id="${e.id}">${shopCardHtml(e, { request:true })}</div>`).join('') : '<p class="meta">No shops match.</p>'; 
    document.querySelectorAll('#fsList .fs-row .shop-pop-head').forEach(h => h.onclick = () => { const e = entries.find(x => x.id === Number(h.closest('.fs-row').dataset.id)); if(e && e._marker && map){ map.setView([e.lat, e.lng], 14); e._marker.openPopup(); document.getElementById('fleetShopMap').scrollIntoView({ behavior:'smooth', block:'center' }); } }); };
  list(entries);
  document.getElementById('fsSearch').oninput = (ev) => { const q = ev.target.value.trim().toLowerCase(); list(entries.filter(e => !q || [e.company, e.location, e.address].join(' ').toLowerCase().includes(q))); };
  document.getElementById('fsNear').onclick = () => {
    if(!navigator.geolocation){ return; }
    const b = document.getElementById('fsNear'); b.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition((p) => {
      b.textContent = 'Near me';
      entries.forEach(e => { e.km = kmBetween(p.coords.latitude, p.coords.longitude, e.lat, e.lng); });
      entries.sort((a, c) => a.km - c.km); list(entries);
      if(map && entries[0]) map.fitBounds([[p.coords.latitude, p.coords.longitude], ...entries.slice(0, 3).map(e => [e.lat, e.lng])], { padding:[40, 40], maxZoom: 12 });
    }, () => { b.textContent = 'Near me'; }, { timeout: 10000 });
  };
}
// ---------- admin: every shop on Relay ----------
async function renderAdminShopMap(){
  const box = document.getElementById('adminShopMapBox'); if(!box) return;
  let entries;
  try { entries = await loadShopDirectory(true); } catch(e){ box.innerHTML = `<p class="form-error">${esc(e.message || String(e))}</p>`; return; }
  const shops = new Set(entries.map(e => e.org_id)).size;
  box.querySelector('.meta').textContent = `${shops} shop${shops === 1 ? '' : 's'} · ${entries.length} location${entries.length === 1 ? '' : 's'} with a pin`;
  drawShopMap('adminShopMap', entries, { request:false });
}
function initShopMaps(){
  const ft = document.querySelector('#fleetView .fleet-tab[data-ftab="shops"]');
  if(ft) ft.addEventListener('click', () => setTimeout(renderFleetShopMap, 0));
  const ov = document.getElementById('admin-overview');
  if(ov && !document.getElementById('adminShopMapBox')){
    ov.insertAdjacentHTML('beforeend', '<div class="section" id="adminShopMapBox"><div class="section-head"><h2>Shops on Relay</h2><span class="meta">Loading…</span></div><div class="shop-map" id="adminShopMap"></div></div>');
  }
}
document.addEventListener('DOMContentLoaded', initShopMaps);
if(document.readyState !== 'loading') initShopMaps();
