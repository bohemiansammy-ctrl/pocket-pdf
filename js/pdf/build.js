// Builds the PDF with jsPDF (loaded only when first needed).

const A4 = { w: 210, h: 297 }; // millimetres
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

// pages: [{ jpeg: Blob, width, height }]. Resolves to a PDF Blob.
export async function buildPdf(pages) {
  const JsPdf = await loadJsPdf();
  const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  for (let i = 0; i < pages.length; i++) {
    const { jpeg, width, height } = pages[i];
    if (i > 0) doc.addPage('a4', 'portrait');
    const box = placeOnA4(width, height);
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    doc.addImage(bytes, 'JPEG', box.x, box.y, box.w, box.h);
  }
  return doc.output('blob');
}

function placeOnA4(width, height) {
  const ratio = (height / width) / (A4.h / A4.w);
  if (Math.abs(ratio - 1) <= SNAP) return { x: 0, y: 0, w: A4.w, h: A4.h };
  const s = Math.min(A4.w / width, A4.h / height);
  const w = width * s;
  const h = height * s;
  return { x: (A4.w - w) / 2, y: (A4.h - h) / 2, w, h };
}
