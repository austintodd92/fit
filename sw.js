/* Offline shell. Online: always fetch the newest files (falling back to the saved copy if the
   network is slow or down). Bump CACHE when you ship a new version so old copies are dropped. */
var CACHE = 'fit-v5';
var FILES = ['./', 'index.html', 'style.css', 'plan.js', 'logic.js', 'run-logic.js', 'meals-logic.js', 'config.js', 'sync.js', 'run.js', 'meals.js', 'app.js',
             'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
var SLOW_MS = 3000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // cache: 'reload' skips the browser's own HTTP cache so we never store an outdated file
    return Promise.all(FILES.map(function (f) {
      return fetch(new Request(f, { cache: 'reload' })).then(function (r) { if (r.ok) return c.put(f, r); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  e.respondWith(new Promise(function (resolve) {
    var settled = false;
    function use(res) { if (!settled && res) { settled = true; resolve(res); } }
    function fromCache() { return caches.match(e.request).then(function (hit) { return hit || caches.match('index.html'); }); }

    // Slow network: serve the saved copy now, the fresh copy still lands in the cache.
    var timer = setTimeout(function () { fromCache().then(use); }, SLOW_MS);

    fetch(e.request, { cache: 'no-cache' }).then(function (r) {
      clearTimeout(timer);
      if (r && r.ok) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        use(r);
      } else {
        fromCache().then(function (hit) { use(hit || r); });
      }
    }).catch(function () {
      clearTimeout(timer);
      fromCache().then(function (hit) { if (hit) use(hit); else { settled = true; resolve(Response.error()); } });
    });
  }));
});
