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
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's own short-term cache, so we always
  // store the freshly published files.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))
    )
  );
  // No skipWaiting here: the new version waits until you tap "Update now",
  // so it never swaps in the middle of a scan.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('pocket-pdf-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html', { cacheName: CACHE }).then((hit) => hit || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
