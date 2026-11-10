// Pages screen: the pages in order as thumbnails, a big view of the selected
// page, and its controls (Rotate, the Colour toggle, Delete).
//
// Each page: {
//   source,      the original photo (kept so Edit can re-crop it)
//   corners,     where its corners were placed on that photo
//   colourBase,  the straightened page, upright as photographed { jpeg, width, height }
//   bwBase,      its black-and-white version, made when first needed (or null)
//   rotation,    0, 90, 180 or 270 degrees clockwise
//   colour, bw,  the versions shown and used in the PDF, turned by `rotation`
//                { jpeg, width, height, url }
//   mode,        'colour' or 'bw'
//   paper,       'a4' or 'fit' (Fit to paper), chosen on the Export screen
// }
// Turned versions are always made from the bases, so rotating many times
// never blurs the page.

import { blackAndWhite, rotateImage } from '../scan/scan.js';

const $ = (id) => document.getElementById(id);
const thumbs = $('thumbs');
const preview = $('preview');
const busy = $('preview-busy');
const note = $('pages-note');
const modeToggle = $('mode-toggle'); // on = colour, off = black and white
const deleteBtn = $('delete-btn');

export const pages = [];
let selected = 0;
let hooks = { changed() {}, emptied() {} };

// changed(): the pages or their looks changed (so the PDF needs remaking).
// emptied(): the last page was deleted.
export function setPageHooks(h) {
  hooks = h;
}

export function selectedIndex() {
  return selected;
}

// The image a page uses in the PDF: its black-and-white version when chosen.
export function imageFor(page) {
  return page.mode === 'bw' && page.bw ? page.bw : page.colour;
}

// Resolves once every page's rotation and black-and-white work is done.
export function allReady() {
  return Promise.all(pages.map((p) => p.making));
}

export const withUrl = (img) => ({ ...img, url: URL.createObjectURL(img.jpeg) });

// Adds a page at the end (index = number of pages) or replaces one in place.
// `straight` is the newly straightened image; `mode` and `paper` carry over
// when a page is edited or retaken, and `rotation` when it is edited.
export function putPage(index, { source, corners, straight, rotation = 0, mode = 'colour', paper = 'a4' }) {
  const page = {
    source,
    corners,
    colourBase: straight,
    bwBase: null,
    rotation,
    colour: withUrl(straight),
    colourTurn: 0,
    bw: null,
    bwTurn: null,
    mode,
    paper,
  };
  if (index < pages.length) {
    release(pages[index]);
    pages[index] = page;
  } else {
    pages.push(page);
  }
  selected = Math.min(index, pages.length - 1);
  if (page.rotation || page.mode === 'bw') updateLooks(page, page.rotation ? 'Turning the page…' : 'Making black and white…');
  render();
  hooks.changed();
}

function release(page) {
  URL.revokeObjectURL(page.colour.url);
  if (page.bw) URL.revokeObjectURL(page.bw.url);
  page.gone = true;
}

function showNote(text) {
  note.textContent = text;
  note.hidden = !text;
}

// ---- Rotation and black and white ----
// Work for a page runs one job at a time, in order, so quick taps always
// end up right.

function updateLooks(page, busyText) {
  page.busyText = busyText;
  const job = (page.making || Promise.resolve()).then(() => bringUpToDate(page));
  page.making = job;
  job.then(() => {
    if (page.making !== job) return; // more work queued behind this
    page.making = null;
    if (page.gone) return;
    render();
    hooks.changed();
  });
  render();
}

async function bringUpToDate(page) {
  try {
    if (page.colourTurn !== page.rotation) {
      const turn = page.rotation;
      const img = turn ? await rotateImage(page.colourBase.jpeg, turn) : page.colourBase;
      if (page.gone) return;
      swap(page, 'colour', img);
      page.colourTurn = turn;
    }
    if (page.mode === 'bw') {
      if (!page.bwBase) {
        page.bwBase = await blackAndWhite(page.colourBase.jpeg);
        if (page.gone) return;
      }
      if (page.bwTurn !== page.rotation) {
        const turn = page.rotation;
        const img = turn ? await rotateImage(page.bwBase.jpeg, turn) : page.bwBase;
        if (page.gone) return;
        swap(page, 'bw', img);
        page.bwTurn = turn;
      }
    }
  } catch (err) {
    console.error(err);
    if (page.mode === 'bw' && !page.bwBase) {
      page.mode = 'colour';
      showNote("Couldn't make the black and white version. Please try again.");
    } else {
      showNote("Couldn't turn the page. Please try again.");
    }
  }
}

function swap(page, key, img) {
  if (page[key]) URL.revokeObjectURL(page[key].url);
  page[key] = withUrl(img);
}

function setMode(mode) {
  const page = pages[selected];
  if (!page || page.mode === mode) return;
  showNote('');
  page.mode = mode;
  if (mode === 'bw') updateLooks(page, 'Making black and white…');
  render();
  hooks.changed();
}

function toggleMode() {
  const page = pages[selected];
  if (page && !page.making) setMode(page.mode === 'colour' ? 'bw' : 'colour');
}

modeToggle.addEventListener('click', toggleMode);
$('mode-label').addEventListener('click', toggleMode); // tapping the word works too

// Rotate: each tap turns the selected page a quarter turn clockwise.
$('rotate-btn').addEventListener('click', () => {
  const page = pages[selected];
  if (!page) return;
  showNote('');
  page.rotation = (page.rotation + 90) % 360;
  updateLooks(page, 'Turning the page…');
});

// ---- Delete (tap twice, so one stray tap can't lose a page) ----

let confirmTimer = null;

function resetDelete() {
  clearTimeout(confirmTimer);
  deleteBtn.classList.remove('confirming');
  deleteBtn.textContent = 'Delete';
}

deleteBtn.addEventListener('click', () => {
  if (!deleteBtn.classList.contains('confirming')) {
    deleteBtn.classList.add('confirming');
    deleteBtn.textContent = 'Tap again';
    confirmTimer = setTimeout(resetDelete, 3000);
    return;
  }
  resetDelete();
  release(pages[selected]);
  pages.splice(selected, 1);
  selected = Math.min(selected, pages.length - 1);
  if (!pages.length) {
    hooks.emptied();
    return;
  }
  render();
  hooks.changed();
});

// ---- Drawing the screen ----

export function render() {
  resetDelete();
  const page = pages[selected];
  if (!page) return;

  thumbs.replaceChildren(...pages.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb';
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-label', `Page ${i + 1}`);
    b.setAttribute('aria-current', String(i === selected));
    const img = document.createElement('img');
    img.alt = '';
    img.src = imageFor(p).url;
    const num = document.createElement('span');
    num.className = 'thumb-number';
    num.textContent = i + 1;
    b.append(img, num);
    b.addEventListener('click', () => {
      selected = i;
      showNote('');
      render();
    });
    return b;
  }));
  thumbs.children[selected].scrollIntoView({ block: 'nearest', inline: 'nearest' });

  preview.src = imageFor(page).url;
  preview.alt = `Page ${selected + 1}`;
  busy.hidden = !page.making;
  busy.textContent = page.busyText || '';
  modeToggle.setAttribute('aria-checked', String(page.mode === 'colour'));
  modeToggle.disabled = !!page.making;
}
