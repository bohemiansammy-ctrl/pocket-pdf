// Keeps unfinished pages in the phone's own storage (IndexedDB), so closing
// the app doesn't lose them. Nothing ever leaves the phone.
//
// The work is deleted:
//   - 24 hours after it was last changed (checked whenever the app opens),
//   - straight away with Clear all,
//   - once the PDF is saved or shared (it's finished; the copy on screen
//     stays until you leave the app, and any change keeps it again).
//
// Stores: 'meta'   one record: { changedAt, name, order: [page ids] }
//         'pages'  per page: corners, rotation, look, paper and its images
//         'photos' per page: the original photo (written once; it never changes)

export const KEEP_FOR = 24 * 60 * 60 * 1000; // 24 hours

const DB_NAME = 'pocket-pdf';
const LOW_SPACE = 100 * 1024 * 1024; // warn when less than this is left

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('meta');
        d.createObjectStore('pages');
        d.createObjectStore('photos');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

// Runs fn(stores) in one transaction; resolves when it's safely written.
async function transaction(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(['meta', 'pages', 'photos'], mode);
    const stores = {
      meta: tx.objectStore('meta'),
      pages: tx.objectStore('pages'),
      photos: tx.objectStore('photos'),
    };
    let result;
    Promise.resolve(fn(stores)).then((r) => { result = r; }, (e) => { tx.abort(); reject(e); });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage was interrupted'));
  });
}

const ask = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// ---- When the work was last changed ----

let changedAt = 0; // in memory too, so the clean-up also works if the app stays open

export function lastChanged() {
  return changedAt;
}

export function isExpired(time = changedAt) {
  return time > 0 && Date.now() - time >= KEEP_FOR;
}

// ---- Loading (when the app opens) ----

// Returns { pages, name } for unfinished work, or null if there is none.
// Work older than 24 hours is deleted here instead; `expired` says so.
export async function loadWork() {
  const found = await transaction('readonly', async (s) => {
    const meta = await ask(s.meta.get('meta'));
    if (!meta) return null;
    if (isExpired(meta.changedAt)) return { expired: true };
    const pages = [];
    for (const id of meta.order) {
      const page = await ask(s.pages.get(id));
      const source = await ask(s.photos.get(id));
      if (page && source) pages.push({ ...page, source });
    }
    return { meta, pages };
  });
  if (!found) {
    await clearWork(); // tidy any half-written leftovers
    return null;
  }
  if (found.expired || !found.pages.length) {
    await clearWork();
    return found.expired ? { expired: true } : null;
  }
  changedAt = found.meta.changedAt;
  found.pages.forEach((p) => { written.set(p.id, signature(p)); });
  return { pages: found.pages, name: found.meta.name || '' };
}

// ---- Saving (after every change) ----

// What was last written for each page id, so unchanged pages aren't rewritten.
let written = new Map();

function signature(p) {
  return [p.rotation, p.mode, p.paper, p.colourTurn, p.bwTurn, !!p.bwBase].join('|');
}

// Just the parts of a page worth keeping (the images without their screen URLs).
const plain = (img) => (img ? { jpeg: img.jpeg, width: img.width, height: img.height } : null);
function record(p) {
  return {
    id: p.id,
    corners: p.corners,
    rotation: p.rotation,
    mode: p.mode,
    paper: p.paper,
    colourBase: plain(p.colourBase),
    bwBase: plain(p.bwBase),
    // The turned versions, so reopening is instant. Not stored twice when upright.
    colour: p.colourTurn ? plain(p.colour) : null,
    colourTurn: p.colourTurn,
    bw: p.bw && p.bwTurn ? plain(p.bw) : null,
    bwTurn: p.bw ? p.bwTurn : null,
  };
}

let queue = Promise.resolve();
let timer = null;
let latest = null;
let onProblem = () => {};

// problem(text): called with a plain-words message if saving goes wrong or
// space runs low.
export function setStoreProblem(fn) {
  onProblem = fn;
}

// Called whenever the pages (or the typed name) change. Writes shortly after,
// so several quick changes are saved together.
export function saveSoon(pages, name) {
  changedAt = Date.now();
  latest = { pages: pages.slice(), name };
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}

// Counts as activity (opening the camera, say) without changing the pages,
// so the 24 hours restart.
export function touch(pages, name) {
  if (pages.length) saveSoon(pages, name);
}

function flush() {
  const job = latest;
  latest = null;
  if (!job) return queue;
  queue = queue.then(() => write(job)).catch((err) => {
    console.error(err);
    written = new Map(); // try everything again next time
    onProblem(err && err.name === 'QuotaExceededError'
      ? "The phone's storage is full, so these pages won't be kept if you close the app. Save your PDF soon."
      : "Couldn't keep these pages on the phone. They'll be lost if you close the app, so save your PDF soon.");
  });
  return queue;
}

async function write({ pages, name }) {
  if (!pages.length) {
    await clearWork();
    return;
  }
  askToKeep();
  const ids = new Set(pages.map((p) => p.id));
  await transaction('readwrite', async (s) => {
    const meta = await ask(s.meta.get('meta'));
    for (const old of (meta ? meta.order : [])) {
      if (!ids.has(old)) {
        s.pages.delete(old);
        s.photos.delete(old);
        written.delete(old);
      }
    }
    for (const p of pages) {
      const sig = signature(p);
      if (written.get(p.id) === sig) continue;
      if (!written.has(p.id)) s.photos.put(p.source, p.id);
      s.pages.put(record(p), p.id);
      written.set(p.id, sig);
    }
    s.meta.put({ changedAt, name, order: pages.map((p) => p.id) }, 'meta');
  });
  checkSpace();
}

// ---- Deleting ----

// Deletes everything kept (Clear all, the 24-hour clean-up, or after saving).
export async function clearWork() {
  clearTimeout(timer);
  latest = null;
  written = new Map();
  await queue.catch(() => {});
  queue = transaction('readwrite', (s) => {
    s.meta.clear();
    s.pages.clear();
    s.photos.clear();
  }).catch((err) => console.error(err));
  return queue;
}

// After saving or sharing: the work is finished, so stop keeping it. The
// pages stay on screen; changedAt keeps counting from the last real change.
export function finished() {
  return clearWork();
}

// ---- Storage safety ----

// Asks Chrome not to clear the app's storage when the phone runs low. For an
// app on the home screen it usually says yes without asking you.
let askedToKeep = false;
function askToKeep() {
  if (askedToKeep || !navigator.storage || !navigator.storage.persist) return;
  askedToKeep = true;
  navigator.storage.persist().catch(() => {});
}

let warnedSpace = false;
async function checkSpace() {
  if (warnedSpace || !navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (quota && quota - usage < LOW_SPACE) {
      warnedSpace = true;
      onProblem('The phone is nearly out of space for unfinished pages. Save your PDF soon.');
    }
  } catch (e) { /* not important */ }
}
