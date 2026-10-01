const CACHE = 'fitness-shell-v29';
const SHELL = ['/', '/index.html', '/app.css', '/providers.css', '/app.js', '/store.js', '/domain.js', '/model-capabilities.js', '/schedule.js', '/busy-rules.js', '/holidays.js', '/achievements.js', '/plan-library.js', '/assets/weekly-achievement.svg', '/meal-advice-prompt.js', '/meal-contract.js', '/knowledge.js', '/knowledge-tools.js', '/visuals.js', '/model-viewer.js', '/provider-presets.js', '/provider-ui.js', '/exercise-covers.js', '/chat-stream.js', '/chat-markdown.js', '/chat-attachments.js', '/chat-view.js', '/vendor/marked.esm.js', '/vendor/purify.es.js', '/icon.svg', '/manifest.webmanifest'];
SHELL.push('/energy.css', '/landing.css', '/landing.js');
SHELL.push('/vendor/gsap.min.js', '/vendor/ScrollTrigger.min.js', '/assets/fonts/cabinet-grotesk-400.woff2', '/assets/fonts/cabinet-grotesk-700.woff2');
SHELL.push('/landing-scene.js', '/vendor/three.module.js', '/vendor/three.core.js');
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(path, {cache:'reload'})))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fitness-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/model/')) return;
  if (SHELL.includes(url.pathname)) event.respondWith(fetch(event.request, {cache:'no-cache'}).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(url.pathname, copy))); }
    return response;
  }).catch(() => caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || Response.error())));
  // 动作封面按需缓存：先给缓存命中，再后台更新，避免 25 张图每次都走网络。
  if (url.pathname.startsWith('/assets/exercises/')) event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname).then(hit => {
    const fresh = fetch(event.request).then(response => { if (response.ok) cache.put(url.pathname, response.clone()); return response; }).catch(() => hit || Response.error());
    return hit || fresh;
  })));
});
