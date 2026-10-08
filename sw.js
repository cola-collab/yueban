const CACHE = 'yueban-v9';
const RELEASE = '2026.10.09.4';
const ASSETS = ['./', './index.html', './style.css', './app.js', './care-data.mjs', './state.mjs', './logic.mjs', './icon.svg', './manifest.webmanifest', './vendor/open-props/sizes.min.css', './vendor/open-props/easings.min.css', './vendor/phosphor/gear-six.svg', './vendor/phosphor/calendar-dots.svg', './vendor/phosphor/hand-heart.svg', './vendor/phosphor/first-aid.svg', './vendor/phosphor/arrow-right.svg', './vendor/phosphor/arrow-left.svg', './vendor/phosphor/drop.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
  event.respondWith(fetch(event.request).then(async response => {
    if (response.ok) (await caches.open(CACHE)).put(event.request, response.clone());
    return response;
  }).catch(() => caches.match(event.request)));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'VERSION') event.source?.postMessage({ type: 'YUEBAN_VERSION', version: RELEASE });
});
