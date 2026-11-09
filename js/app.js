// Pocket PDF – Step 3: scan pages, adjust their corners, choose colour or
// black and white for each, and share them as one PDF.

import { warmUp, findPage, straighten, discardPhoto } from './scan/scan.js';
import { openAdjust, getCorners, layout as layoutAdjust } from './screens/adjust.js';
import {
  pages, putPage, selectedIndex, imageFor, allReady, setPageHooks, render as renderPages,
} from './screens/pages.js';
import { buildPdf } from './pdf/build.js';
import { sharePdf } from './share/share.js';

const VERSION = self.POCKET_PDF_VERSION;
const $ = (id) => document.getElementById(id);

$('version').textContent = VERSION;

// ---- Screens ----

const screens = ['home', 'working', 'adjust', 'pages'];
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  window.scrollTo(0, 0);
}

function showMessage(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}

function showPagesNote(text) {
  $('pages-note').textContent = text;
  $('pages-note').hidden = !text;
}

function showWorking(text, firstScanHint) {
  $('working-text').textContent = text;
  $('working-hint').hidden = !firstScanHint;
  show('working');
}

// Back to the Pages screen if there are pages, otherwise Home.
function showStart() {
  if (pages.length) {
    renderPages();
    show('pages');
  } else {
    show('home');
  }
}

function showError(err) {
  console.error(err);
  discardPhoto();
  showStart();
  const text = /memory|allocat/i.test(err.message)
    ? 'The photo was too big for this phone. Please try again.'
    : 'Something went wrong with that photo. Please try again.';
  if (pages.length) showPagesNote(text); else showMessage(text);
}

// ---- Scan → adjust → straighten → Pages ----

// Used when the edges can't be found: a box a little inside the photo.
const DEFAULT_CORNERS = [
  { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
];
const ADJUST_TIP = 'Drag the dots to the corners of the page.';

// Where the photo on the Adjust screen goes when you tap "Looks good":
// its position in the pages (the end for a new page, or the page being
// retaken or edited), and the photo itself.
let target = 0;
let editing = false; // true when the photo came from Edit rather than the camera
let photo = null;
let adjustUrl = null;

function openCamera(index) {
  target = index;
  editing = false;
  showMessage('');
  showPagesNote('');
  warmUp(); // load the edge finder while the camera is open
  $('camera').click();
}

$('scan-btn').addEventListener('click', () => openCamera(pages.length));
$('add-btn').addEventListener('click', () => openCamera(pages.length));
$('retake-page-btn').addEventListener('click', () => openCamera(selectedIndex()));

$('camera').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same photo can be picked again
  if (!file) return;

  showWorking('Finding the page…', true);
  try {
    // Keep our own copy of the photo, so Edit can reopen it later.
    photo = new Blob([await file.arrayBuffer()], { type: file.type });
    const found = await findPage(photo);
    await showAdjust(found.preview, found.found ? found.corners : DEFAULT_CORNERS,
      found.found ? ADJUST_TIP : "Couldn't find the edges of the page. Drag the dots to its corners.",
      !found.found);
  } catch (err) {
    showError(err);
  }
});

// Edit: reopen the selected page's photo with its corners where you left them.
$('edit-btn').addEventListener('click', async () => {
  target = selectedIndex();
  editing = true;
  const page = pages[target];
  showWorking('Opening the photo…', false);
  try {
    photo = page.source;
    const found = await findPage(photo);
    await showAdjust(found.preview, page.corners, ADJUST_TIP, false);
  } catch (err) {
    showError(err);
  }
});

async function showAdjust(previewBlob, corners, note, warning) {
  if (adjustUrl) URL.revokeObjectURL(adjustUrl);
  adjustUrl = URL.createObjectURL(previewBlob);
  setAdjustNote(note, warning);
  show('adjust');
  await openAdjust(adjustUrl, corners);
}

function setAdjustNote(text, warning) {
  $('adjust-note').textContent = text;
  $('adjust-note').classList.toggle('warning', warning);
  layoutAdjust(); // the note's height changes the space for the photo
}

// Retake on the Adjust screen: throw this photo away and take another for
// the same position.
$('retake-btn').addEventListener('click', () => {
  discardPhoto();
  photo = null;
  showStart();
  openCamera(target);
});

$('accept-btn').addEventListener('click', async () => {
  const corners = getCorners();
  if (!corners) {
    setAdjustNote("The dots don't make a page shape. Move each one to a corner of the page.", true);
    return;
  }

  showWorking('Straightening your page…', false);
  try {
    const straight = await straighten(corners);
    discardPhoto(); // the page is made; free the memory
    const replacing = pages[target];
    putPage(target, {
      source: photo,
      corners,
      straight,
      // Edit keeps the page's turn; a retake starts upright.
      rotation: editing && replacing ? replacing.rotation : 0,
      mode: replacing ? replacing.mode : 'colour',
    });
    photo = null;
    showPagesNote('');
    show('pages');
  } catch (err) {
    showError(err);
  }
});

// ---- The PDF ----
// Remade in the background whenever the pages change, so Share is quick.

let pdfVersion = 0;
let pdfMade = { version: -1, blob: null };

async function makePdf() {
  const version = pdfVersion;
  await allReady();
  const blob = await buildPdf(pages.map(imageFor));
  if (version === pdfVersion) pdfMade = { version, blob };
  return version === pdfVersion;
}

async function latestPdf() {
  while (pdfMade.version !== pdfVersion) await makePdf();
  return pdfMade.blob;
}

setPageHooks({
  changed() {
    pdfVersion++;
    makePdf().catch((err) => console.error(err));
  },
  emptied() {
    pdfVersion++;
    pdfMade = { version: -1, blob: null };
    show('home');
  },
});

$('share-btn').addEventListener('click', async () => {
  if (!pages.length) return;
  showPagesNote('');
  try {
    const outcome = await sharePdf(await latestPdf(), fileName());
    if (outcome === 'downloaded') {
      showPagesNote("Sharing isn't available here, so the PDF was saved to Downloads.");
    }
  } catch (err) {
    console.error(err);
    showPagesNote("Couldn't open the share menu. Please try again.");
  }
});

// Temporary name until Step 4 adds the file name box.
function fileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `Pocket PDF ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}.pdf`;
}


// ---- Offline support and updates ----
// A new version downloads quietly in the background. When it is ready, a
// banner appears; tapping "Update now" switches to it and reloads the page.

const banner = $('update-banner');
let updateTapped = false;

function showUpdateBanner(worker) {
  banner.hidden = false;
  reserveBannerSpace();
  $('update-btn').onclick = () => {
    updateTapped = true;
    worker.postMessage('SKIP_WAITING');
  };
}

// Leaves room at the bottom of every screen for the banner, so it never
// covers the version number or the buttons.
function reserveBannerSpace() {
  const space = banner.hidden ? 0 : banner.offsetHeight + 16;
  document.documentElement.style.setProperty('--banner-space', space + 'px');
  layoutAdjust();
}
window.addEventListener('resize', reserveBannerSpace);

if ('serviceWorker' in navigator) {
  // Reload only when you tapped "Update now". The very first install also
  // fires this event, and reloading then could wipe a scan in progress.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateTapped) return;
    updateTapped = false;
    location.reload();
  });

  // updateViaCache 'none': always fetch sw.js and version.js fresh when
  // checking for updates, rather than trusting GitHub's 10-minute cache.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    // A newer version already finished downloading on an earlier visit.
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdateBanner(reg.waiting);
    }

    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        // Only offer an update if an older version is already running;
        // on the very first visit there is nothing to replace.
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(incoming);
        }
      });
    });

    // Check for a new version whenever the app is opened or brought back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {
    showMessage('Offline mode could not be set up. The app still works while you have signal.');
  });
}
