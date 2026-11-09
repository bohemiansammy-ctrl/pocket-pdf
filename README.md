# Pocket PDF

A personal Android web app that turns photos of paper into a scan-style PDF.
Everything runs on the phone. There is no server, no account and no tracking.

## Put it online (GitHub Pages, one time)

1. Sign in at github.com (or create a free account).
2. Click **+** (top right), then **New repository**.
3. Name it `pocket-pdf`, choose **Public**, then click **Create repository**.
4. On the new page, click **uploading an existing file**.
5. Open this folder on your computer, select the files and folders listed
   under "What's in this folder" below (including the `css`, `js` and `icons`
   folders), and drag them onto the page. Never upload the `.claude` folder
   (local testing only, blocked by `.gitignore`), photos or PDFs.
6. Click **Commit changes**.
7. Go to **Settings**, then **Pages** (left menu).
8. Under **Branch**, choose `main` and `/ (root)`, then click **Save**.
9. Wait about a minute and refresh. Your address appears at the top, like
   `https://YOUR-NAME.github.io/pocket-pdf/`.

## Put it on your phone

1. Open the address in **Chrome** on your phone.
2. Tap the **⋮** menu, then **Add to Home screen** (or **Install app**).
3. Open Pocket PDF from your home screen from now on.

The first time, the app downloads about 10 MB, so use Wi-Fi. After that it
works offline, and updates only download the small files that changed.

## Updating the app

1. Every new version has a new number in `version.js`. The number shows at
   the bottom of the home screen.
2. Upload the changed files to GitHub the same way (**Add file**, then
   **Upload files**). Uploading a file with the same name replaces it.
3. GitHub can take up to **10 minutes** to serve the new files.
4. Open the app on your phone. It downloads the new version quietly, then
   shows **"A new version is ready"**. Tap **Update now**.
5. Check that the number at the bottom has changed.

If the banner doesn't appear, close the app fully (swipe it away from
recent apps), wait a minute, and open it again.

## What isn't cleaned up

Pocket PDF deletes its own unfinished work 24 hours after it was last changed,
or straight away with **Clear all**. It cannot reach copies outside the app.
Delete these yourself if you need to:

- PDFs saved to **Downloads**.
- Files you've **shared** (email, Google Drive, WhatsApp and so on).
- Original photos your **camera app** may have kept in the gallery.
- Pages saved to **Photos**.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The page the app lives in |
| `version.js` | The version number (the only place it's set) |
| `sw.js` | Offline support and updates |
| `manifest.webmanifest` | Lets Android install it to the home screen |
| `css/app.css` | Colours, big type, big buttons |
| `js/app.js` | The screens and buttons |
| `js/scan/` | Finds the page in the photo and straightens it |
| `js/screens/adjust.js` | The Adjust screen: the photo with draggable corner dots |
| `js/pdf/build.js` | Makes the PDF |
| `js/share/share.js` | Opens the Android share menu |
| `vendor/` | Two libraries, OpenCV.js 4.9.0 (page finding, about 10 MB) and jsPDF 4.2.1 (PDF making), with their licences |
| `icons/` | The logo and app icons (the only images allowed here) |
| `fonts/` | The Figtree font and its licence |
| `tools/make-icons.js` | Makes the app icons from the logo (run on your computer, not part of the app) |
| `.gitignore` | Stops photos and PDFs being committed |

## Reusing the brand for another Pocket app

- **Logo:** copy `icons/logo.svg`. Keep the tile, and replace only the
  `<g id="symbol">` group with the new app's symbol.
- **Wordmark:** in `index.html`, change only the word inside
  `<span class="wordmark-accent">`.
- **Colours, font and styles:** copy the `fonts/` folder, the font and
  `--brand-*` lines at the top of `css/app.css`, and the "Pocket family brand"
  block at the end of it. The font is Figtree (20 KB, free to use and share,
  licence in `fonts/`).
- **Icons:** copy the `tools/` folder, then run this on your computer
  (it needs Node and Chrome or Edge):

  ```
  node tools/make-icons.js
  ```

  It makes the three home-screen icons in `icons/` from `logo.svg`.
