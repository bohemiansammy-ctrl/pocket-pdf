// Pocket PDF – Step 2: take one photo, adjust the corners, straighten it,
// make a PDF, share it.

import { warmUp, findPage, straighten, discardPhoto } from './scan/scan.js';
import { openAdjust, getCorners, layout as layoutAdjust } from './screens/adjust.js';
import { buildPdf } from './pdf/build.js';
import { sharePdf } from './share/share.js';

const VERSION = self.POCKET_PDF_VERSION;
const $ = (id) => document.getElementById(id);

$('version').textContent = VERSION;

// ---- Screens ----

const screens = ['home', 'working', 'adjust', 'result'];
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  window.scrollTo(0, 0);
}

function showMessage(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}

function showWorking(text, firstScanHint) {
  $('working-text').textContent = text;
  $('working-hint').hidden = !firstScanHint;
  show('working');
}

function showError(err) {
  console.error(err);
  discardPhoto();
  show('home');
  showMessage(/memory|allocat/i.test(err.message)
    ? 'The photo was too big for this phone. Please try again.'
    : 'Something went wrong with that photo. Please try again.');
}

// ---- Scan → adjust → straighten → PDF ----

// Used when the edges can't be found: a box a little inside the photo.
const DEFAULT_CORNERS = [
  { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
];
const ADJUST_TIP = 'Drag the dots to the corners of the page.';

let pdfBlob = null;
let adjustUrl = null;
let previewUrl = null;

function openCamera() {
  showMessage('');
  warmUp(); // load the edge finder while the camera is open
  $('camera').click();
}

$('scan-btn').addEventListener('click', openCamera);

$('camera').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same photo can be picked again
  if (!file) return;

  showWorking('Finding the page…', true);
  try {
    const found = await findPage(file);

    if (adjustUrl) URL.revokeObjectURL(adjustUrl);
    adjustUrl = URL.createObjectURL(found.preview);

    setAdjustNote(found.found ? ADJUST_TIP :
      "Couldn't find the edges of the page. Drag the dots to its corners.", !found.found);
    show('adjust');
    await openAdjust(adjustUrl, found.found ? found.corners : DEFAULT_CORNERS);
  } catch (err) {
    showError(err);
  }
});

function setAdjustNote(text, warning) {
  $('adjust-note').textContent = text;
  $('adjust-note').classList.toggle('warning', warning);
  layoutAdjust(); // the note's height changes the space for the photo
}

$('retake-btn').addEventListener('click', () => {
  discardPhoto();
  show('home');
  openCamera();
});

$('accept-btn').addEventListener('click', async () => {
  const corners = getCorners();
  if (!corners) {
    setAdjustNote("The dots don't make a page shape. Move each one to a corner of the page.", true);
    return;
  }

  showWorking('Straightening your page…', false);
  try {
    const page = await straighten(corners);
    pdfBlob = await buildPdf([page]);

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(page.jpeg);
    $('preview').src = previewUrl;
    $('result-note').hidden = true;
    show('result');
  } catch (err) {
    showError(err);
  }
});

$('share-btn').addEventListener('click', async () => {
  if (!pdfBlob) return;
  try {
    const outcome = await sharePdf(pdfBlob, fileName());
    if (outcome === 'downloaded') {
      $('result-note').textContent = "Sharing isn't available here, so the PDF was saved to Downloads.";
      $('result-note').hidden = false;
    }
  } catch (err) {
    console.error(err);
    $('result-note').textContent = "Couldn't open the share menu. Please try again.";
    $('result-note').hidden = false;
  }
});

// Edit: back to the same photo, with the dots and edges where you left them.
$('edit-btn').addEventListener('click', () => {
  setAdjustNote(ADJUST_TIP, false);
  show('adjust');
  layoutAdjust();
});

// Rescan: forget this photo and take a fresh one.
$('rescan-btn').addEventListener('click', () => {
  pdfBlob = null;
  discardPhoto();
  show('home');
  openCamera();
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
