const CACHE = 'ea-log-shell-v7';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/','/index.html','/manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('ea-log-shell-') && key !== CACHE).map((key) => caches.delete(key)))),
  self.clients.claim(),
  // Older installed pages retain their original CSP response header until a
  // navigation. One safe reload after this worker updates lets the app receive
  // the current Firebase-auth CSP without clearing IndexedDB or user data.
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) =>
    Promise.all(clients.map((client) => client.navigate(client.url).catch(() => undefined))),
  ),
])))
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET' || url.pathname.includes('/__/')) return;
  if (request.mode === 'navigate') {
    // The document carries the CSP. Always bypass the browser's HTTP cache for
    // navigations so a deployed security-policy/auth repair is immediate.
    event.respondWith(fetch(request, { cache: 'reload' }).catch(() => caches.match('/index.html')));
    return;
  }
  // Hashed build assets should always prefer the network. This ensures a
  // released UI fix reaches installed PWA users rather than an old bundle.
  event.respondWith(fetch(request).then((response) => {
    const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); return response;
  }).catch(() => caches.match(request).then((cached) => cached || Response.error())));
});
