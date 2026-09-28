const CACHE = 'fitness-shell-v9';
const SHELL = ['/', '/index.html', '/app.css', '/providers.css', '/app.js', '/store.js', '/domain.js', '/schedule.js', '/meal-contract.js', '/knowledge.js', '/knowledge-tools.js', '/visuals.js', '/model-viewer.js', '/provider-presets.js', '/provider-ui.js', '/chat-stream.js', '/chat-markdown.js', '/chat-attachments.js', '/chat-view.js', '/vendor/marked.esm.js', '/vendor/purify.es.js', '/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(path, {cache:'reload'})))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fitness-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/model/')) return;
  if (SHELL.includes(url.pathname)) event.respondWith(fetch(event.request, {cache:'no-cache'}).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(url.pathname, copy))); }
    return response;
  }).catch(() => caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || Response.error())));
});
