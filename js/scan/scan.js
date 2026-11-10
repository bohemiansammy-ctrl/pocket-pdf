// Talks to the background worker that finds, straightens and cleans up pages.

let worker = null;
let nextId = 1;
const waiting = new Map(); // request id -> { resolve, reject }

function getWorker() {
  if (!worker) {
    worker = new Worker('js/scan/worker.js');
    worker.onmessage = (e) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.ok) job.resolve(e.data);
      else job.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      // A crashed worker (often out of memory) can't be reused.
      worker = null;
      for (const job of waiting.values()) job.reject(new Error(e.message || 'worker failed'));
      waiting.clear();
    };
  }
  return worker;
}

function ask(message) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...message });
  });
}

// Start loading the edge-finding library early (e.g. while the camera is open).
export function warmUp() {
  getWorker().postMessage('warm-up');
}

// Resolves to { found, corners, preview }. Corners are fractions (0 to 1)
// of the photo's width and height, or null if no page was found.
export function findPage(file) {
  return ask({ type: 'find', file });
}

// Straightens the photo from the last findPage() using exactly these corners
// (top-left, top-right, bottom-right, bottom-left). Resolves to { jpeg, width, height }.
export function straighten(corners) {
  return ask({ type: 'straighten', corners });
}

// Makes the black-and-white (photocopy) version of a straightened page.
// Resolves to { jpeg, width, height }.
export function blackAndWhite(jpeg) {
  return ask({ type: 'bw', jpeg });
}

// Turns a page clockwise by 90, 180 or 270 degrees. Resolves to { jpeg, width, height }.
export function rotateImage(jpeg, degrees) {
  return ask({ type: 'rotate', jpeg, degrees });
}

// Makes a page image fit within maxBytes (quality first, then size).
// Resolves to { jpeg, width, height }.
export function shrinkImage(jpeg, maxBytes) {
  return ask({ type: 'shrink', jpeg, maxBytes });
}

// Forgets the current photo (e.g. after Retake).
export function discardPhoto() {
  if (worker) worker.postMessage({ type: 'discard' });
}
