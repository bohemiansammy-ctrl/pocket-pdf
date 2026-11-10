// Builds the PDF with jsPDF (loaded only when first needed), and works out
// where each page image sits on its paper (also used for printing).

const A4 = { short: 210, long: 297 }; // millimetres
const SNAP = 0.08; // within 8% of A4's shape: fill the page; otherwise add white margins

let jsPdfReady = null;

function loadJsPdf() {
  if (!jsPdfReady) {
    jsPdfReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/jspdf.umd.min.js';
      s.onload = () => resolve(window.jspdf.jsPDF);
      s.onerror = () => reject(new Error('Could not load the PDF maker'));
      document.head.appendChild(s);
    });
  }
  return jsPdfReady;
}

// Where a page image goes, in millimetres: { pageW, pageH, x, y, w, h }.
//  'a4':  A4, turned to match the page (landscape A4 for a wide page).
//         Close to A4's shape: fills the paper. Otherwise: white margins.
//  'fit': paper the exact shape of the scanned item (e.g. a receipt), as big
//         as fits on A4. The image fills it.
export function pageLayout(width, height, paper) {
  const wide = width > height;
  const pageW = wide ? A4.long : A4.short;
  const pageH = wide ? A4.short : A4.long;
  const fit = Math.min(pageW / width, pageH / height);

  if (paper === 'fit') {
    const w = width * fit;
    const h = height * fit;
    return { pageW: w, pageH: h, x: 0, y: 0, w, h };
  }
  const ratio = (height / width) / (pageH / pageW);
  if (Math.abs(ratio - 1) <= SNAP) return { pageW, pageH, x: 0, y: 0, w: pageW, h: pageH };
  const w = width * fit;
  const h = height * fit;
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

// pages: [{ jpeg: Blob, width, height, paper }]. Resolves to a PDF Blob.
export async function buildPdf(pages) {
  const JsPdf = await loadJsPdf();
  let doc = null;

  for (const { jpeg, width, height, paper } of pages) {
    const L = pageLayout(width, height, paper);
    const size = [L.pageW, L.pageH];
    const orientation = L.pageW > L.pageH ? 'landscape' : 'portrait';
    if (!doc) doc = new JsPdf({ unit: 'mm', format: size, orientation });
    else doc.addPage(size, orientation);
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    doc.addImage(bytes, 'JPEG', L.x, L.y, L.w, L.h);
  }
  return doc.output('blob');
}
