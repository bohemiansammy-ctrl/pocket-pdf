// Export screen: file name, paper size per page, file size, and the three
// ways out (Save PDF, Share, Print). After saving or sharing it asks whether
// to save the pages to Photos as well (No unless you tap Yes).

import { pages, imageFor, allReady, notifyChanged } from './pages.js';
import { shrinkImage } from '../scan/scan.js';
import { buildPdf } from '../pdf/build.js';
import { savePdf, sharePdf, sharePictures } from '../share/share.js';
import { printPages } from '../share/print.js';
import { finished } from '../store/store.js';

// Each page image is kept under this, so a typical three-page letter comes
// to about 2 MB. Pages already under it are left exactly as they are.
const PAGE_BUDGET = 650 * 1024;

const $ = (id) => document.getElementById(id);
const nameInput = $('file-name');
const nameError = $('name-error');
const paperList = $('paper-list');
const sizeText = $('file-size');
const note = $('export-note');
const actions = [$('save-btn'), $('export-share-btn'), $('print-btn')];

let made = null; // { blob, images } once the PDF for the current choices is ready
let version = 0;

export function openExport() {
  nameError.hidden = true;
  showNote('');
  renderPaperList();
  remake();
}

// Forget the typed name (when the pages are cleared for a new document).
export function resetExport() {
  nameInput.value = '';
  closePhotos();
}

// The typed name, as typed (kept with the unfinished pages).
export function typedName() {
  return nameInput.value;
}
export function setTypedName(text) {
  nameInput.value = text;
}

function showNote(text) {
  note.textContent = text;
  note.hidden = !text;
}

// ---- File name ----

// The typed name, cleaned up, or null (with a message) if it's empty.
function fileName() {
  const name = nameInput.value
    .replace(/\s*:\s*/g, ' - ') // "Bills: May" becomes "Bills - May"
    .replace(/[\\/]/g, '-') // a date 10/11/2026 becomes 10-11-2026
    .replace(/[*?"<>|\u0000-\u001f]/g, '') // other characters files can't have
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.pdf$/i, '') // ".pdf" is added automatically
    .trim()
    .slice(0, 100);
  if (!name) {
    nameError.hidden = false;
    nameInput.focus();
    return null;
  }
  nameError.hidden = true;
  return name;
}

nameInput.addEventListener('input', () => {
  nameError.hidden = true;
  notifyChanged();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') nameInput.blur();
});

// ---- Paper size per page ----

function renderPaperList() {
  paperList.replaceChildren(...pages.map((page, i) => {
    const row = document.createElement('div');
    row.className = 'paper-row';

    const thumb = document.createElement('div');
    thumb.className = 'paper-thumb';
    const img = document.createElement('img');
    img.src = imageFor(page).url;
    img.alt = `Page ${i + 1}`;
    const num = document.createElement('span');
    num.className = 'thumb-number';
    num.textContent = i + 1;
    thumb.append(img, num);

    const choice = document.createElement('div');
    choice.className = 'segmented';
    choice.setAttribute('role', 'radiogroup');
    choice.setAttribute('aria-label', `Paper size for page ${i + 1}`);
    for (const [value, label] of [['a4', 'A4'], ['fit', 'Fit to paper']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String((page.paper || 'a4') === value));
      b.addEventListener('click', () => {
        if ((page.paper || 'a4') === value) return;
        page.paper = value;
        notifyChanged();
        renderPaperList();
        remake();
      });
      choice.appendChild(b);
    }

    row.append(thumb, choice);
    return row;
  }));
}

// ---- Making the PDF and showing its size ----

// The page image to put in the PDF, within the size budget. Remembered, so
// it's only worked out again if the page changes.
async function packed(page) {
  const img = imageFor(page);
  if (page.packed && page.packed.from === img.jpeg) return page.packed.img;
  const out = img.jpeg.size <= PAGE_BUDGET ? img : await shrinkImage(img.jpeg, PAGE_BUDGET);
  page.packed = { from: img.jpeg, img: out, trimmed: out !== img };
  return out;
}

async function remake() {
  const v = ++version;
  made = null;
  actions.forEach((b) => { b.disabled = true; });
  sizeText.textContent = 'Working out the file size…';
  try {
    await allReady();
    const images = [];
    for (const page of pages) images.push({ ...(await packed(page)), paper: page.paper || 'a4' });
    const blob = await buildPdf(images);
    if (v !== version) return; // a newer choice is being made
    made = { blob, images };
    const trimmed = pages.filter((p) => p.packed.trimmed).length;
    sizeText.textContent = describeSize(blob.size, trimmed);
    actions.forEach((b) => { b.disabled = false; });
  } catch (err) {
    console.error(err);
    if (v === version) sizeText.textContent = "Couldn't make the PDF. Please go back and try again.";
  }
}

function describeSize(bytes, trimmed) {
  const size = bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const email = bytes <= 10 * 1024 * 1024 ? 'fine for email' : 'may be too big for some email';
  const extra = trimmed ? ` Quality lowered slightly on ${trimmed} page${trimmed > 1 ? 's' : ''} to keep it small.` : '';
  return `File size: ${size}, ${email}.${extra}`;
}

// ---- The three actions ----

$('save-btn').addEventListener('click', () => {
  const name = fileName();
  if (!name || !made) return;
  savePdf(made.blob, `${name}.pdf`);
  done(name, `Saved to Downloads as “${name}.pdf”.`);
});

$('export-share-btn').addEventListener('click', async () => {
  const name = fileName();
  if (!name || !made) return;
  showNote('');
  try {
    const outcome = await sharePdf(made.blob, `${name}.pdf`);
    if (outcome === 'shared') done(name, `Shared “${name}.pdf”.`);
    if (outcome === 'downloaded') {
      done(name, `Sharing isn't available here, so it was saved to Downloads as “${name}.pdf”.`);
    }
  } catch (err) {
    console.error(err);
    showNote("Couldn't open the share menu. Please try again.");
  }
});

$('print-btn').addEventListener('click', async () => {
  const name = fileName();
  if (!name || !made) return;
  showNote('');
  try {
    await printPages(made.images, name);
  } catch (err) {
    console.error(err);
    showNote("Couldn't open printing. Please try again.");
  }
});

// The PDF is saved or shared: the work is finished, so it's no longer kept
// in the phone's storage. Then ask about Photos.
function done(name, text) {
  showNote(text);
  finished();
  askPhotos(name, text);
}

// ---- Save to Photos (asked each time; No unless you tap Yes) ----

const photosAsk = $('photos-ask');
let photosName = '';

function askPhotos(name, text) {
  photosName = name;
  $('photos-done').textContent = text;
  $('photos-note').hidden = true;
  photosAsk.hidden = false;
  $('photos-no').focus();
}

function closePhotos() {
  photosAsk.hidden = true;
}

$('photos-no').addEventListener('click', closePhotos);
// Tapping outside the box counts as No.
photosAsk.addEventListener('click', (e) => {
  if (e.target === photosAsk) closePhotos();
});

// Yes: each page as a JPG (full quality, as seen on the Pages screen) through
// the Android share menu, where Photos is one of the choices.
$('photos-yes').addEventListener('click', async () => {
  const pictures = pages.map((page, i) => ({
    jpeg: imageFor(page).jpeg,
    fileName: pages.length > 1 ? `${photosName} - page ${i + 1}.jpg` : `${photosName}.jpg`,
  }));
  try {
    const outcome = await sharePictures(pictures);
    if (outcome === 'cancelled') return; // the question stays, so you can choose again
    closePhotos();
    showNote(outcome === 'shared'
      ? `${pictures.length > 1 ? `${pictures.length} pictures` : 'The picture'} sent. If you chose Photos, look there.`
      : "This phone can't send pictures from here, so nothing was saved to Photos.");
  } catch (err) {
    console.error(err);
    const msg = $('photos-note');
    msg.textContent = "Couldn't open the share menu. Please try again, or tap No.";
    msg.hidden = false;
  }
});
