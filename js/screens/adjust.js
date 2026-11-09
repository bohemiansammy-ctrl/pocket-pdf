// Adjust screen: the photo with a teal outline and four draggable corner dots.
// Corners are fractions (0 to 1) of the photo's width and height, so they map
// exactly onto the full-size photo whatever size it is shown at here.

const DOT_ROOM = 28; // px kept around the photo so edge dots stay easy to grab
const LOUPE = 128;   // magnifier size in px (matches the CSS)
const ZOOM = 3;      // how much bigger the magnifier shows things than the screen
const LOUPE_GAP = 56; // space between the dot and the magnifier, clear of your finger

const $ = (id) => document.getElementById(id);
const stage = $('adjust-stage');
const wrap = $('adjust-wrap');
const photo = $('adjust-photo');
const outline = $('adjust-outline');
const dots = [...wrap.querySelectorAll('.corner')]; // top-left, top-right, bottom-right, bottom-left
const loupe = $('loupe');
const loupeCanvas = loupe.querySelector('canvas');

let corners = [];

// Shows the photo with the given corners. Resolves once it is laid out.
export function openAdjust(previewUrl, startCorners) {
  corners = startCorners.map((p) => ({ ...p }));
  return new Promise((resolve) => {
    photo.onload = () => {
      layout();
      resolve();
    };
    photo.src = previewUrl;
  });
}

// The corners exactly as placed, in a consistent order for straightening.
// Returns null if the dots cross over and don't make a sensible shape.
export function getCorners() {
  const ordered = orderCorners(corners);
  return isConvex(ordered) ? ordered.map((p) => ({ ...p })) : null;
}

// Fits the photo into the space available, keeping its shape.
export function layout() {
  if (!photo.naturalWidth) return;
  const availW = stage.clientWidth - DOT_ROOM * 2;
  const availH = stage.clientHeight - DOT_ROOM * 2;
  const s = Math.min(availW / photo.naturalWidth, availH / photo.naturalHeight);
  wrap.style.width = Math.floor(photo.naturalWidth * s) + 'px';
  wrap.style.height = Math.floor(photo.naturalHeight * s) + 'px';
  draw();
}

window.addEventListener('resize', layout);

function draw() {
  outline.setAttribute('points', corners.map((p) => `${p.x},${p.y}`).join(' '));
  outline.previousElementSibling.setAttribute('points', outline.getAttribute('points'));
  dots.forEach((dot, i) => {
    dot.style.left = corners[i].x * 100 + '%';
    dot.style.top = corners[i].y * 100 + '%';
  });
}

// ---- Dragging ----
// The dot keeps the same offset from your finger as when you first touched
// it, so it doesn't jump, and it stays exactly where you let go.

dots.forEach((dot, i) => {
  let grab = null;

  dot.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dot.setPointerCapture(e.pointerId);
    const r = wrap.getBoundingClientRect();
    grab = {
      dx: e.clientX - (r.left + corners[i].x * r.width),
      dy: e.clientY - (r.top + corners[i].y * r.height),
    };
    dot.classList.add('dragging');
    showLoupe(i);
  });

  dot.addEventListener('pointermove', (e) => {
    if (!grab) return;
    const r = wrap.getBoundingClientRect();
    corners[i] = {
      x: clamp((e.clientX - grab.dx - r.left) / r.width),
      y: clamp((e.clientY - grab.dy - r.top) / r.height),
    };
    draw();
    drawLoupe(i);
  });

  const stop = () => {
    grab = null;
    dot.classList.remove('dragging');
    loupe.hidden = true;
  };
  dot.addEventListener('pointerup', stop);
  dot.addEventListener('pointercancel', stop);
});

const clamp = (v) => Math.min(1, Math.max(0, v));

// ---- Magnifier ----
// While you drag, a bubble shows the area under your finger, zoomed in, with
// a crosshair on the exact spot the dot will land.

function showLoupe(i) {
  const dpr = window.devicePixelRatio || 1;
  loupeCanvas.width = loupeCanvas.height = Math.round(LOUPE * dpr);
  loupe.hidden = false;
  drawLoupe(i);
}

function drawLoupe(i) {
  const ctx = loupeCanvas.getContext('2d');
  const size = loupeCanvas.width;
  const dpr = size / LOUPE;
  const r = wrap.getBoundingClientRect();
  const nw = photo.naturalWidth;
  const nh = photo.naturalHeight;

  // The patch of photo to show, centred on the dot, in photo pixels.
  const span = LOUPE / (ZOOM * (r.width / nw));
  const sx = corners[i].x * nw - span / 2;
  const sy = corners[i].y * nh - span / 2;
  const k = size / span;

  ctx.fillStyle = getComputedStyle(loupe).backgroundColor;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(photo, sx, sy, span, span, 0, 0, size, size);

  // The outline, so you can see the edge you're lining up.
  ctx.beginPath();
  corners.forEach((p, j) => {
    const x = (p.x * nw - sx) * k;
    const y = (p.y * nh - sy) * k;
    if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 5 * dpr;
  ctx.stroke();
  ctx.strokeStyle = getComputedStyle(loupe).borderTopColor;
  ctx.lineWidth = 2.5 * dpr;
  ctx.stroke();

  // Crosshair on the exact spot.
  const c = size / 2;
  const arm = 14 * dpr;
  ctx.lineCap = 'round';
  for (const [colour, width] of [['rgba(255, 255, 255, 0.9)', 5 * dpr], [ctx.strokeStyle, 2 * dpr]]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(c - arm, c); ctx.lineTo(c - 4 * dpr, c);
    ctx.moveTo(c + 4 * dpr, c); ctx.lineTo(c + arm, c);
    ctx.moveTo(c, c - arm); ctx.lineTo(c, c - 4 * dpr);
    ctx.moveTo(c, c + 4 * dpr); ctx.lineTo(c, c + arm);
    ctx.stroke();
  }

  placeLoupe(r.left + corners[i].x * r.width, r.top + corners[i].y * r.height);
}

// Puts the magnifier above the dot, or beside it if there's no room above,
// always on screen and never under your finger.
function placeLoupe(dotX, dotY) {
  let left = dotX - LOUPE / 2;
  let top = dotY - LOUPE_GAP - LOUPE;
  if (top < 8) {
    top = dotY - LOUPE / 2;
    left = dotX < window.innerWidth / 2 ? dotX + LOUPE_GAP : dotX - LOUPE_GAP - LOUPE;
  }
  left = Math.min(Math.max(8, left), window.innerWidth - LOUPE - 8);
  top = Math.min(Math.max(8, top), window.innerHeight - LOUPE - 8);
  loupe.style.left = left + 'px';
  loupe.style.top = top + 'px';
}

// ---- Shape checks ----

// Puts the corners in the order top-left, top-right, bottom-right, bottom-left
// (going round the shape), without moving them.
function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const round = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // Start from the corner nearest the top-left.
  let start = 0;
  round.forEach((p, k) => {
    if (p.x + p.y < round[start].x + round[start].y) start = k;
  });
  return [...round.slice(start), ...round.slice(0, start)];
}

function isConvex(pts) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}
