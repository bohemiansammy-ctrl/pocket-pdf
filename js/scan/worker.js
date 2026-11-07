// Background worker: finds the page in a photo and straightens it.
// Runs off the main thread so the screen never freezes.
//
// In:  { file }  (the photo from the camera)
// Out: { ok: true, found, jpeg, width, height }  or  { ok: false, error }

const WORK_MAX = 3000;   // longest side of the working copy of the photo
const DETECT_MAX = 1000; // longest side used for finding the edges
const OUT_MAX_W = 2000;  // brief: pages about 2,000 px wide at most
const OUT_MAX_H = 3000;
const JPEG_QUALITY = 0.8;

let cvReady = null;

function loadCv() {
  if (!cvReady) {
    cvReady = new Promise((resolve, reject) => {
      try {
        importScripts('../../vendor/opencv.js');
      } catch (e) {
        reject(e);
        return;
      }
      // Check every 50 ms until it's ready (give up after 60 s).
      // OpenCV's object has its own .then() that resolves to itself, so it
      // must be wrapped: resolving a promise with it directly loops forever.
      const started = Date.now();
      const check = () => {
        if (self.cv && self.cv.Mat) resolve({ cv: self.cv });
        else if (Date.now() - started > 60000) reject(new Error('edge finder did not start'));
        else setTimeout(check, 50);
      };
      check();
    });
  }
  return cvReady;
}

self.onmessage = async (event) => {
  if (event.data === 'warm-up') {
    loadCv().catch(() => {});
    return;
  }
  try {
    const result = await processPhoto(event.data.file);
    self.postMessage({ ok: true, ...result });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.message || e) });
  }
};

async function processPhoto(file) {
  const { cv } = await loadCv();

  // Decode (honouring the phone's rotation tag) and shrink to the working size.
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
  try {
    const corners = findCorners(cv, src);
    const found = corners !== null;
    const quad = corners || [
      { x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 },
    ];
    const out = warp(cv, src, quad);
    const outCanvas = new OffscreenCanvas(out.cols, out.rows);
    outCanvas.getContext('2d').putImageData(
      new ImageData(new Uint8ClampedArray(out.data), out.cols, out.rows), 0, 0
    );
    const size = { width: out.cols, height: out.rows };
    out.delete();
    const jpeg = await outCanvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    return { found, jpeg, ...size };
  } finally {
    src.delete();
  }
}

// Returns the page's four corners (top-left, top-right, bottom-right,
// bottom-left) in working-image pixels, or null if no page was found.
function findCorners(cv, src) {
  const s = Math.min(1, DETECT_MAX / Math.max(src.cols, src.rows));
  const small = new cv.Mat();
  cv.resize(src, small, new cv.Size(Math.round(src.cols * s), Math.round(src.rows * s)), 0, 0, cv.INTER_AREA);
  const gray = new cv.Mat();
  cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  const area = small.cols * small.rows;
  small.delete();

  // Two ways of separating paper from background; keep the better result.
  // 1) Outlines (works on most backgrounds).
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 50, 150);
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);
  // 2) Brightness split (works well for white paper on a dark surface).
  const bright = new cv.Mat();
  cv.threshold(gray, bright, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.morphologyEx(bright, bright, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
  kernel.delete();
  gray.delete();

  let best = null;
  for (const mask of [edges, bright]) {
    const quad = largestQuad(cv, mask, area);
    if (quad && (!best || quad.area > best.area)) best = quad;
    mask.delete();
  }
  if (!best) return null;
  return orderCorners(best.points.map((p) => ({ x: p.x / s, y: p.y / s })));
}

function largestQuad(cv, mask, imageArea) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  hierarchy.delete();

  const list = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    list.push({ c, area: cv.contourArea(c) });
  }
  list.sort((a, b) => b.area - a.area);

  let best = null;
  for (const { c, area } of list.slice(0, 5)) {
    // Ignore tiny shapes and shapes that are just the photo's own frame.
    if (best || area < imageArea * 0.15 || area > imageArea * 0.98) continue;
    const peri = cv.arcLength(c, true);
    for (const eps of [0.02, 0.03, 0.05]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, eps * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const points = [];
        for (let k = 0; k < 4; k++) {
          points.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
        }
        best = { points, area: cv.contourArea(approx) };
      }
      approx.delete();
      if (best) break;
    }
  }
  for (const { c } of list) c.delete();
  contours.delete();
  return best;
}

function orderCorners(pts) {
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => (a.y - a.x) - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]]; // tl, tr, br, bl
}

function warp(cv, src, [tl, tr, br, bl]) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, OUT_MAX_W / w, OUT_MAX_H / h);
  w = Math.round(w * s);
  h = Math.round(h * s);

  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]);
  const m = cv.getPerspectiveTransform(from, to);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, m, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  from.delete();
  to.delete();
  m.delete();
  return out;
}
