// Talks to the background worker that finds and straightens the page.

let worker = null;

function getWorker() {
  if (!worker) worker = new Worker('js/scan/worker.js');
  return worker;
}

// Start loading the edge-finding library early (e.g. while the camera is open).
export function warmUp() {
  getWorker().postMessage('warm-up');
}

// Resolves to { found, jpeg, width, height }.
export function straighten(file) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    w.onmessage = (e) => (e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)));
    w.onerror = (e) => {
      // A crashed worker (often out of memory) can't be reused.
      worker = null;
      reject(new Error(e.message || 'worker failed'));
    };
    w.postMessage({ file });
  });
}
