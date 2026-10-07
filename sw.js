// RelayFleet service worker — lets Relay install to the home screen and
// open without a signal. Always asks the network first, so an upload to
// GitHub reaches everyone right away; the saved copy is used only when
// there is no connection. Never stores Supabase data or other sites.
const CACHE = 'relay-shell-v9';
const SHELL = ['/', '/index.html', '/style.css', '/script.js', '/ro.js', '/insp.js', '/est.js', '/tech.js', '/fleet.js', '/unit.js',
               '/inv.js', '/analytics.js', '/comms.js', '/roles.js', '/shop.js', '/ops.js', '/dispatch.js', '/r4.js', '/assist.js', '/landing.js', '/scan.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // Supabase, maps, CDNs: untouched
  if (url.pathname.startsWith('/approve') || url.pathname.startsWith('/review')) return;   // customer links: always live
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
  );
});

// ---- Web push (Redesign R4c): show alerts even when Relay is closed ----
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Relay', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Relay', {
    body: d.body || '', tag: d.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});

