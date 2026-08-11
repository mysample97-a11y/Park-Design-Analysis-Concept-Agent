/**
 * Local PDF text extraction — runs entirely in the browser, no AI, no API key.
 *
 * Why this exists: the Combined Document Generator previously read PDFs by sending
 * the file to Claude's native document endpoint. That made the whole tool unusable
 * on the Gemini free tier — the most likely way someone tries this app — and it
 * spent tokens re-typing text the file already contained. pdf.js extracts the text
 * layer directly, so PDF support now works on every provider and with no key at all.
 *
 * Limitation, stated rather than hidden: this reads the EMBEDDED TEXT LAYER. A
 * scanned or image-only PDF has no text layer and will yield nothing. That case is
 * detected and reported so the user knows to use OCR or paste the text, instead of
 * silently receiving an empty section.
 */

let pdfjsPromise = null;
let stdFontUrl = undefined;

/** Load pdf.js on first use so it stays out of the initial bundle. */
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then(async (pdfjs) => {
      // The worker is bundled locally rather than pulled from a CDN, which keeps
      // this working under the app's `default-src 'self'` content security policy.
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      // Standard font data must be bundled too, or PDFs using the base-14 fonts
      // emit "Ensure that the standardFontDataUrl API parameter is provided" and
      // can drop glyphs. Resolved from the local package, not a CDN, so this stays
      // inside the app's default-src 'self' policy.
      stdFontUrl = new URL("pdfjs-dist/standard_fonts/", import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Extract text from a PDF File/Blob.
 * @returns {Promise<{text: string, pages: number, empty: boolean, note: string}>}
 */
export async function extractPdfText(file, onProgress) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false, standardFontDataUrl: stdFontUrl }).promise;

  const parts = [];
  for (let n = 1; n <= doc.numPages; n++) {
    if (typeof onProgress === "function") onProgress(n, doc.numPages);
    const page = await doc.getPage(n);
    const content = await page.getTextContent();

    // Rebuild lines from positioned text items. pdf.js returns fragments with
    // transform matrices, not lines, so items are grouped by their Y position -
    // otherwise every word arrives on its own line and structure is lost.
    const rows = new Map();
    content.items.forEach((it) => {
      if (!it.str || !it.str.trim()) return;
      const y = Math.round(it.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    });
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])                       // top of page downwards
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    if (lines.length) parts.push(lines.join("\n"));
    page.cleanup();
  }

  const text = parts.join("\n\n").trim();
  const pages = doc.numPages;
  doc.destroy();

  if (!text) {
    return {
      text: "", pages, empty: true,
      note:
        `This PDF has ${pages} page${pages === 1 ? "" : "s"} but no embedded text layer, ` +
        "which means it is a scan or an exported image. Text cannot be extracted from it in " +
        "the browser. Run it through OCR first, or paste the text into the box above.",
    };
  }
  return { text, pages, empty: false, note: `Extracted ${text.length.toLocaleString()} characters from ${pages} page${pages === 1 ? "" : "s"}.` };
}
