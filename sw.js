/* On thi PWA — service worker.
 * APP SHELL (HTML/CSS/JS/icons): versioned cache-first. Bump APP_VERSION on
 * every code deploy; the page shows "Co phien ban moi [Cap nhat]" and the
 * old shell can never get stuck.
 * CONTENT DATA (data/*.json): NEVER version-locked here. Network-first with
 * cached fallback, keyed WITHOUT the cache-busting query string, so newly
 * deployed catalog/set files are always discovered. The app's own
 * localStorage cache is the primary offline store; this SW fallback only
 * covers edge cases (e.g. no localStorage yet but SW saw the file). */
var APP_VERSION = 'v2.1.0';
var SHELL_CACHE = 'onthi-shell-' + APP_VERSION;
var DATA_CACHE = 'onthi-data-v1';

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/store.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

function isDataRequest(url) {
  return url.origin === self.location.origin && url.pathname.indexOf('/data/') >= 0;
}

// Canonical cache key: same-origin path without query string, so the app's
// ?v=<timestamp> freshness probes still hit/miss the same entry.
function dataKey(request) {
  var url = new URL(request.url);
  return self.location.origin + url.pathname;
}

self.addEventListener('install', function (event) {
  // B5: a failed precache MUST fail the install so the previous working
  // worker/cache is never replaced by a broken one. No automatic
  // skipWaiting here — activation waits for the learner's explicit
  // "Cập nhật" tap (SKIP_WAITING message) at a safe point.
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('onthi-shell-') === 0 && k !== SHELL_CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);

  // Navigations: network first, fall back to cached shell offline.
  // B5: never hot-swap the cached HTML in place — the shell cache stays
  // immutable per APP_VERSION so HTML/JS/CSS from different deploys cannot
  // mix. A newer deploy takes over atomically via worker update + reload.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(function (res) {
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // CONTENT DATA: network-first, cached fallback (never stale-locked).
  if (isDataRequest(url)) {
    event.respondWith(
      fetch(event.request).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(DATA_CACHE).then(function (c) { c.put(dataKey(event.request), copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(dataKey(event.request));
      })
    );
    return;
  }

  // APP SHELL: cache-first. B5: no background mutation of the versioned
  // cache — the shell stays atomic per APP_VERSION until the next worker
  // activates. (Previously a background revalidation could mix files from
  // two deploys in one cache.)
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      if (hit) return hit;
      return fetch(event.request);
    })
  );
});
