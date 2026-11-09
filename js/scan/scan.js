// Talks to the background worker that finds and straightens the page.

let worker = null;

function getWorker() {
  if (!worker) worker = new Worker('js/scan/worker.js');
  return worker;
}

function ask(message) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    w.onmessage = (e) => (e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)));
    w.onerror = (e) => {
      // A crashed worker (often out of memory) can't be reused.
      worker = null;
      reject(new Error(e.message || 'worker failed'));
    };
    w.postMessage(message);
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

// Forgets the current photo (e.g. after Retake).
export function discardPhoto() {
  if (worker) worker.postMessage({ type: 'discard' });
}
