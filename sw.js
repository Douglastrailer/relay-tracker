// RelayFleet service worker — lets Relay install to the home screen and
// open without a signal. Always asks the network first, so an upload to
// GitHub reaches everyone right away; the saved copy is used only when
// there is no connection. Never stores Supabase data or other sites.
const CACHE = 'relay-shell-v1';
const SHELL = ['/', '/index.html', '/style.css', '/script.js', '/ro.js', '/insp.js', '/est.js', '/tech.js', '/fleet.js', '/unit.js',
               '/inv.js', '/analytics.js', '/comms.js', '/roles.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

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
