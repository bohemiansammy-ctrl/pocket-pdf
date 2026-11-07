// Pocket PDF – Step 0: home screen, version number, update banner.

const VERSION = self.POCKET_PDF_VERSION;

document.getElementById('version').textContent = VERSION;

const message = document.getElementById('message');
function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

document.getElementById('scan-btn').addEventListener('click', () => {
  showMessage('Scanning arrives in the next step.');
});

// ---- Offline support and updates ----
// A new version downloads quietly in the background. When it is ready, a
// banner appears; tapping "Update now" switches to it and reloads the page.

const banner = document.getElementById('update-banner');

function showUpdateBanner(worker) {
  banner.hidden = false;
  document.getElementById('update-btn').onclick = () => {
    worker.postMessage('SKIP_WAITING');
  };
}

if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
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
