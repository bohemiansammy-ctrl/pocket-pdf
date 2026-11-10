// Sending the PDF out: save it to the phone, or open the Android share menu.
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
