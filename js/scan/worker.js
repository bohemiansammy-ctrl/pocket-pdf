// Background worker: finds the page in a photo, straightens it, and makes the
// black-and-white version. Runs off the main thread so the screen never freezes.
//
// In:  { id, type: 'find', file }          Out: { id, ok, found, corners, preview }
//      { id, type: 'straighten', corners } Out: { id, ok, jpeg, width, height }
//      { id, type: 'bw', jpeg }            Out: { id, ok, jpeg, width, height }
//      { id, type: 'rotate', jpeg, degrees } Out: { id, ok, jpeg, width, height }
//      { type: 'discard' }                 (no reply)
// Errors come back as { id, ok: false, error }.

const WORK_MAX = 3000;   // longest side of the working copy of the photo
const DETECT_MAX = 1000; // longest side used for finding the edges
const PREVIEW_MAX = 1600; // longest side of the photo shown on the Adjust screen
const OUT_MAX_W = 2000;  // brief: pages about 2,000 px wide at most
const OUT_MAX_H = 3000;
const JPEG_QUALITY = 0.8;
const INSET = 0.01;      // pull found corners in by 1% so no background shows
const BW_BLACK = 100;    // black and white: this dark (after shadow removal) or darker becomes black
const BW_WHITE = 215;    // ...and this light or lighter becomes white (removes grey haze)

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

// The current photo: { src: cv.Mat, w, h }. Kept from "find" until the next
// photo or a discard, so it is decoded once even if straightened again.
let current = null;

const jobs = {
  find: (msg) => findPage(msg.file),
  straighten: (msg) => straighten(msg.corners),
  bw: (msg) => blackAndWhite(msg.jpeg),
  rotate: (msg) => rotate(msg.jpeg, msg.degrees),
};

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg === 'warm-up') {
    loadCv().catch(() => {});
    return;
  }
  if (msg.type === 'discard') {
    discard();
    return;
  }
  try {
    const result = await jobs[msg.type](msg);
    self.postMessage({ id: msg.id, ok: true, ...result });
  } catch (e) {
    self.postMessage({ id: msg.id, ok: false, error: String(e && e.message || e) });
  }
};

function discard() {
  if (current) current.src.delete();
  current = null;
}

// Decodes the photo, finds the page and makes a preview for the Adjust screen.
// Corners are fractions of the photo's width and height (0 to 1), or null.
async function findPage(file) {
  const { cv } = await loadCv();
  discard();

  // Decode (honouring the phone's rotation tag) and shrink to the working size.
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  current = { src: cv.matFromImageData(ctx.getImageData(0, 0, w, h)), w, h };
  const corners = findCorners(cv, current.src);

  const ps = Math.min(1, PREVIEW_MAX / Math.max(w, h));
  const small = new OffscreenCanvas(Math.round(w * ps), Math.round(h * ps));
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
  const preview = await small.convertToBlob({ type: 'image/jpeg', quality: 0.85 });

  return {
    found: corners !== null,
    corners: corners && corners.map((p) => ({ x: p.x / w, y: p.y / h })),
    preview,
  };
}

// Straightens the current photo using exactly the corners given
// (fractions, in the order top-left, top-right, bottom-right, bottom-left).
async function straighten(corners) {
  const { cv } = await loadCv();
  if (!current) throw new Error('photo no longer available');
  const { src, w, h } = current;

  const out = warp(cv, src, corners.map((p) => ({ x: p.x * w, y: p.y * h })));
  const outCanvas = new OffscreenCanvas(out.cols, out.rows);
  outCanvas.getContext('2d').putImageData(
    new ImageData(new Uint8ClampedArray(out.data), out.cols, out.rows), 0, 0
  );
  const size = { width: out.cols, height: out.rows };
  out.delete();
  const jpeg = await outCanvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return { jpeg, ...size };
}

// Turns a page clockwise by 90, 180 or 270 degrees.
async function rotate(jpeg, degrees) {
  const bmp = await createImageBitmap(jpeg);
  const sideways = degrees % 180 !== 0;
  const w = sideways ? bmp.height : bmp.width;
  const h = sideways ? bmp.width : bmp.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return { jpeg: out, width: w, height: h };
}

// Makes the photocopy look from a straightened page: white paper, dark text,
// shadows and grey cast removed.
//  1. Work out how bright the bare paper is everywhere (blur away the text).
//  2. Divide by that, so shadows and tints cancel out and paper becomes white.
//  3. Push near-white to pure white and darken the text, keeping smooth edges.
async function blackAndWhite(jpeg) {
  const { cv } = await loadCv();
  const bmp = await createImageBitmap(jpeg);
  const w = bmp.width;
  const h = bmp.height;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const src = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  // 1. Paper brightness: shrink, thicken the light areas over the text, smooth.
  const small = new cv.Mat();
  cv.resize(gray, small, new cv.Size(Math.round(w / 4), Math.round(h / 4)), 0, 0, cv.INTER_AREA);
  const k = Math.max(7, Math.round(small.cols / 40)) | 1;
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
  cv.dilate(small, small, kernel);
  kernel.delete();
  cv.medianBlur(small, small, 21);
  const paper = new cv.Mat();
  cv.resize(small, paper, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR);
  small.delete();

  // 2. Divide out the paper brightness.
  const flat = new cv.Mat();
  cv.divide(gray, paper, flat, 255);
  gray.delete();
  paper.delete();

  // 3. Levels: at or below BW_BLACK becomes black, at or above BW_WHITE white.
  const out = ctx.createImageData(w, h);
  const d = flat.data;
  const o = out.data;
  const range = BW_WHITE - BW_BLACK;
  for (let i = 0, j = 0; i < d.length; i++, j += 4) {
    let v = ((d[i] - BW_BLACK) / range) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    o[j] = o[j + 1] = o[j + 2] = v;
    o[j + 3] = 255;
  }
  flat.delete();
  ctx.putImageData(out, 0, 0);

  const result = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return { jpeg: result, width: w, height: h };
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
  // Close (thicken then thin again) to join broken outlines without pushing
  // the border outward onto the background.
  cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
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
  return insetCorners(orderCorners(best.points.map((p) => ({ x: p.x / s, y: p.y / s }))));
}

// Moves each corner towards the page's centre by INSET of the page's size.
function insetCorners(pts) {
  const cx = pts.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = pts.reduce((sum, p) => sum + p.y, 0) / 4;
  const k = 1 - INSET * 2; // 1% of the full width = 2% of the half-width
  return pts.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
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
