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
      // Standard font data. The previous value used a BARE package specifier inside
      // new URL(), which Vite does not resolve - it produced a 404 path at runtime.
      // The fonts are copied into /public/pdf-fonts instead, so this resolves against
      // the deployed site and stays inside the default-src 'self' policy.
      stdFontUrl = new URL("pdf-fonts/", document.baseURI).href;
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
  // Keep the loading task: destroy() lives on the TASK, not the document proxy.
  // Calling doc.destroy() threw "i.destroy is not a function" in the minified build,
  // after extraction had already succeeded - so the text was pulled and then binned.
  const loadingTask = pdfjs.getDocument({ data: buf, isEvalSupported: false, standardFontDataUrl: stdFontUrl });
  const doc = await loadingTask.promise;

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
  // Defensive: cleanup must never take down a successful extraction.
  try { doc.cleanup?.(); await loadingTask.destroy?.(); } catch { /* extraction already succeeded */ }

  if (!text) {
    return {
      text: "", pages, empty: true,
      note:
        `This PDF has ${pages} page${pages === 1 ? "" : "s"} but no embedded text layer - it is a ` +
        "scan or an image export, so there is no text in the file to read. " +
        "Fastest fix: upload the .xlsx export instead - it carries every report section and " +
        "needs no AI. Alternatively add an API key in Settings and re-upload this PDF; the " +
        "pages will then be read as images.",
    };
  }
  return { text, pages, empty: false, note: `Extracted ${text.length.toLocaleString()} characters from ${pages} page${pages === 1 ? "" : "s"}.` };
}

/**
 * Rasterise PDF pages to PNG data for the AI vision path.
 *
 * Used ONLY when extractPdfText finds no embedded text layer - i.e. the PDF is a
 * scan or an image export. Telling the user to "run OCR first" is not a real
 * answer when the whole point of the tool chain is that a report exported from one
 * tool feeds straight into the next.
 *
 * Returns Anthropic-style content blocks, which the AI router already translates
 * for Gemini - so this works on BOTH providers, not just Claude.
 *
 * @param {File|Blob} file
 * @param {number} maxPages  cap so a long scan cannot blow the token budget
 */
export async function rasterizePdf(file, maxPages = 6, onProgress) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buf, isEvalSupported: false, standardFontDataUrl: stdFontUrl });
  const doc = await loadingTask.promise;
  const total = Math.min(doc.numPages, maxPages);
  const blocks = [];

  for (let n = 1; n <= total; n++) {
    if (typeof onProgress === "function") onProgress(n, total);
    const page = await doc.getPage(n);
    // 2x scale: enough for the model to read body text without producing an
    // image so large it dominates the request.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(viewport.width, 1600);
    canvas.height = Math.round(viewport.height * (canvas.width / viewport.width));
    const ctx = canvas.getContext("2d");
    const scaled = page.getViewport({ scale: 2 * (canvas.width / viewport.width) });
    await page.render({ canvasContext: ctx, viewport: scaled }).promise;
    const dataUrl = canvas.toDataURL("image/png");
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: dataUrl.split(",")[1] },
    });
    page.cleanup();
  }
  const pages = doc.numPages;
  try { doc.cleanup?.(); await loadingTask.destroy?.(); } catch { /* rasterise already succeeded */ }
  return { blocks, pagesRendered: total, pagesTotal: pages };
}
