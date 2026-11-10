// Printing. Chrome on Android can't print a PDF file directly, so the same
// page images are laid out on paper of the right size (exactly as in the
// PDF) and the Android print dialog opens. That dialog can also save a PDF.

import { pageLayout } from '../pdf/build.js';

const area = document.getElementById('print-area');
const style = document.getElementById('print-style');
let urls = [];

// pages: [{ jpeg, width, height, paper }]; title is used as the print job name.
export async function printPages(pages, title) {
  cleanUp();
  const rules = [];
  const sheets = pages.map((p, i) => {
    const L = pageLayout(p.width, p.height, p.paper);
    // Each page gets its own paper size, so one print can mix A4 and receipts.
    rules.push(`@page p${i} { size: ${L.pageW}mm ${L.pageH}mm; margin: 0; }`);
    const sheet = document.createElement('div');
    sheet.className = 'print-sheet';
    sheet.style.cssText = `page: p${i}; width: ${L.pageW}mm; height: ${L.pageH}mm;`;
    const img = document.createElement('img');
    const url = URL.createObjectURL(p.jpeg);
    urls.push(url);
    img.src = url;
    img.alt = '';
    img.style.cssText = `left: ${L.x}mm; top: ${L.y}mm; width: ${L.w}mm; height: ${L.h}mm;`;
    sheet.appendChild(img);
    return sheet;
  });
  style.textContent = rules.join('\n');
  area.replaceChildren(...sheets);
  await Promise.all([...area.querySelectorAll('img')].map((img) => img.decode()));

  const oldTitle = document.title;
  document.title = title; // suggested name if you choose "Save as PDF"
  const restore = () => {
    document.title = oldTitle;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

function cleanUp() {
  area.replaceChildren();
  style.textContent = '';
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
}
