// Service worker: keeps a copy of the app on the phone so it works offline,
// and fetches new versions in the background.
//
// Chrome re-checks version.js on every update check, so changing the number
// there is enough to trigger an update.

importScripts('version.js');

const CACHE = 'pocket-pdf-' + self.POCKET_PDF_VERSION;

const APP_FILES = [
  './',
  'index.html',
  'version.js',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/scan/scan.js',
  'js/scan/worker.js',
  'js/pdf/build.js',
  'js/share/share.js',
  'js/screens/adjust.js',
  'js/screens/pages.js',
  'js/screens/export.js',
  'js/share/print.js',
  'js/store/store.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/logo.svg',
  'fonts/figtree.woff2',
];

// The libraries are big (OpenCV is about 10 MB) and rarely change, so they
// live in their own copy that survives app updates. Change this name only
// when a library file changes.
const VENDOR_CACHE = 'pocket-pdf-vendor-opencv4.9.0-jspdf4.2.1';
const VENDOR_FILES = [
  'vendor/opencv.js',
  'vendor/jspdf.umd.min.js',
];

const fresh = (url) => new Request(url, { cache: 'reload' });

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own short-term cache, so we always
  // store the freshly published files.
  event.waitUntil(Promise.all([
    caches.open(CACHE).then((cache) => cache.addAll(APP_FILES.map(fresh))),
    caches.open(VENDOR_CACHE).then(async (cache) => {
      const missing = [];
      for (const url of VENDOR_FILES) {
        if (!(await cache.match(url))) missing.push(fresh(url));
      }
      return cache.addAll(missing);
    }),
  ]));
  // No skipWaiting here: the new version waits until you tap "Update now",
  // so it never swaps in the middle of a scan.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('pocket-pdf-') && k !== CACHE && k !== VENDOR_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---- Privacy lock ----
// Every request the app makes passes through here. Anything for another
// address is refused, so nothing can leave the phone. Files served from the
// phone's copy also carry the lock, which covers the background worker (the
// lock written in index.html only covers the page itself).

const PAGE_LOCK = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; " +
  "connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'";
// The edge finder (OpenCV) needs to build some of its code as it starts.
// That code is still locked in: it can't contact anywhere either. (data: is
// OpenCV's engine, built into its own file; it isn't a network address.)
const WORKER_LOCK = "default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; " +
  "connect-src 'self' data:; img-src 'self' blob: data:";

function locked(response, url) {
  if (!response || response.type === 'opaque') return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy',
    new URL(url).pathname.endsWith('/js/scan/worker.js') ? WORKER_LOCK : PAGE_LOCK);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fromCache(req, options) {
  return (await caches.match(req, { cacheName: CACHE, ...options })) ||
    (await caches.match(req, { cacheName: VENDOR_CACHE, ...options }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Another address: refused.
  if (new URL(req.url).origin !== self.location.origin) {
    event.respondWith(Response.error());
    return;
  }
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(fromCache('index.html')
      .then((hit) => hit || fetch(req))
      .then((res) => locked(res, req.url)));
    return;
  }

  event.respondWith(fromCache(req, { ignoreSearch: true })
    .then((hit) => hit || fetch(req))
    .then((res) => locked(res, req.url)));
});
