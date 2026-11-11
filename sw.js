/* Offline shell. Bump CACHE when you ship a new version of the app files. */
var CACHE = 'fit-v2';
var FILES = ['./', 'index.html', 'style.css', 'plan.js', 'logic.js', 'config.js', 'sync.js', 'app.js',
             'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Serve from cache instantly, refresh the cache in the background.
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(function (hit) {
    var net = fetch(e.request).then(function (r) {
      if (r && r.ok) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return r;
    }).catch(function () { return hit || caches.match('index.html'); });
    return hit || net;
  }));
});
