const CACHE = 'fairway-vatos-v63';
const PRECACHE = [
  './manifest.json',
  './icon.png',
  './app_icon.png'
];

// Network-first for HTML/CSS/JS so updates deploy immediately
const NETWORK_FIRST = ['/', '/index.html', '/styles.css', '/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isNetworkFirst = NETWORK_FIRST.some(p => url.pathname.endsWith(p) || url.pathname === '/Fairway-Vatos/' || url.pathname === '/Fairway-Vatos/index.html');

  if (isNetworkFirst) {
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
