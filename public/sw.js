const CACHE = 'ea-log-shell-v4';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/','/index.html','/manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('ea-log-shell-') && key !== CACHE).map((key) => caches.delete(key)))), self.clients.claim()])));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET' || url.pathname.includes('/__/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }
  // Hashed build assets should always prefer the network. This ensures a
  // released UI fix reaches installed PWA users rather than an old bundle.
  event.respondWith(fetch(request).then((response) => {
    const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); return response;
  }).catch(() => caches.match(request).then((cached) => cached || Response.error())));
});
