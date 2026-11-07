// Pocket PDF – Step 1: take one photo, straighten it, make a PDF, share it.

import { warmUp, straighten } from './scan/scan.js';
import { buildPdf } from './pdf/build.js';
import { sharePdf } from './share/share.js';

const VERSION = self.POCKET_PDF_VERSION;
const $ = (id) => document.getElementById(id);

$('version').textContent = VERSION;

// ---- Screens ----

const screens = ['home', 'working', 'result'];
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  window.scrollTo(0, 0);
}

function showMessage(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}

// ---- Scan → straighten → PDF ----

let pdfBlob = null;
let previewUrl = null;

$('scan-btn').addEventListener('click', () => {
  showMessage('');
  warmUp(); // load the edge finder while the camera is open
  $('camera').click();
});

$('camera').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same photo can be picked again
  if (!file) return;

  show('working');
  try {
    const page = await straighten(file);
    pdfBlob = await buildPdf([page]);

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(page.jpeg);
    $('preview').src = previewUrl;

    const note = $('result-note');
    note.hidden = page.found;
    note.textContent = page.found ? '' :
      "Couldn't find the edges of the page, so the whole photo is used. " +
      'Try again with the page on a darker surface.';
    show('result');
  } catch (err) {
    console.error(err);
    show('home');
    showMessage(/memory|allocat/i.test(err.message)
      ? 'The photo was too big for this phone. Please try again.'
      : 'Something went wrong while straightening the page. Please try again.');
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

$('again-btn').addEventListener('click', () => {
  pdfBlob = null;
  show('home');
  $('scan-btn').click();
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
  $('update-btn').onclick = () => {
    updateTapped = true;
    worker.postMessage('SKIP_WAITING');
  };
}

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
