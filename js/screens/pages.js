// Pages screen: the pages in order as thumbnails, a big view of the selected
// page, and its controls (the Colour toggle, Delete).
//
// Each page: {
//   source,   the original photo (kept so Edit can re-crop it)
//   corners,  where its corners were placed on that photo
//   colour,   the straightened page   { jpeg, width, height, url }
//   bw,       black-and-white version, made when first asked for (or null)
//   mode,     'colour' or 'bw'
// }

import { blackAndWhite } from '../scan/scan.js';

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

// Resolves once every black-and-white version that's being made is ready.
export function allReady() {
  return Promise.all(pages.map((p) => p.making));
}

export const withUrl = (img) => ({ ...img, url: URL.createObjectURL(img.jpeg) });

// Adds a page at the end (index = number of pages) or replaces one in place.
export function putPage(index, page) {
  if (index < pages.length) {
    release(pages[index]);
    pages[index] = page;
  } else {
    pages.push(page);
  }
  selected = Math.min(index, pages.length - 1);
  if (page.mode === 'bw') makeBlackAndWhite(page);
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

// ---- Colour / Black and white ----

function makeBlackAndWhite(page) {
  if (page.bw || page.making) return page.making;
  page.making = (async () => {
    try {
      const bw = await blackAndWhite(page.colour.jpeg);
      if (page.gone) return;
      page.bw = withUrl(bw);
    } catch (err) {
      console.error(err);
      page.mode = 'colour';
      showNote("Couldn't make the black and white version. Please try again.");
    } finally {
      page.making = null;
    }
    render();
    hooks.changed();
  })();
  render();
  return page.making;
}

function setMode(mode) {
  const page = pages[selected];
  if (!page || page.mode === mode) return;
  showNote('');
  page.mode = mode;
  if (mode === 'bw') makeBlackAndWhite(page);
  render();
  hooks.changed();
}

function toggleMode() {
  const page = pages[selected];
  if (page && !page.making) setMode(page.mode === 'colour' ? 'bw' : 'colour');
}

modeToggle.addEventListener('click', toggleMode);
$('mode-label').addEventListener('click', toggleMode); // tapping the word works too

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
  modeToggle.setAttribute('aria-checked', String(page.mode === 'colour'));
  modeToggle.disabled = !!page.making;
}
