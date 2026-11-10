// Sending things out: save the PDF to the phone, or open the Android share
// menu (for the PDF, or for the pages as pictures).
// Both must be called straight from a button tap (Android requires this).

// Saves the PDF to the phone's Downloads folder.
export function savePdf(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Opens the Android share menu. Falls back to saving if sharing isn't available.
// Resolves to 'shared', 'cancelled' or 'downloaded'.
export async function sharePdf(blob, fileName) {
  const file = new File([blob], fileName, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      throw e;
    }
  }

  savePdf(blob, fileName);
  return 'downloaded';
}

// Sends the pages as JPG pictures through the Android share menu (choose
// Photos there). pictures: [{ jpeg, fileName }].
// Resolves to 'shared', 'cancelled' or 'unavailable'.
export async function sharePictures(pictures) {
  const files = pictures.map((p) => new File([p.jpeg], p.fileName, { type: 'image/jpeg' }));
  if (!navigator.canShare || !navigator.canShare({ files })) return 'unavailable';
  try {
    await navigator.share({ files });
    return 'shared';
  } catch (e) {
    if (e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}
