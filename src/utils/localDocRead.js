// src/utils/localDocRead.js
// ---------------------------------------------------------------------------
// LOCAL DOCUMENT READING  (F17, F19, F12)
//
// The principle: an AI call is the LAST resort for reading a document, not the
// first. Three cheaper rungs come before it, and each one that succeeds costs
// nothing in tokens and nothing in requests - which on a 15 RPM free key is the
// scarcer resource.
//
//   RUNG 1  pdf.js text layer      free, instant, already in the app
//   RUNG 2  tesseract.js OCR       free, in-browser WASM, ~2-5s per page
//   RUNG 3  AI vision              costs tokens AND a request - OPT-IN ONLY,
//                                  never automatic, cost shown before consent
//
// This is how conventional web applications handle documents. They do not call
// a language model to read a page of text; they use a text layer or an OCR
// engine. Reaching for the model first is the expensive habit this module
// exists to break.
// ---------------------------------------------------------------------------

/* ==========================================================================
 * F19 - TEXT SUFFICIENCY
 *
 * pdfText.js already reports `empty: true` when extraction yields literally
 * nothing. That check is correct but incomplete: a PDF that yields 30
 * characters across 8 pages passes as "has text" and then feeds near-empty
 * content downstream. That failure is WORSE than the no-text case because it
 * is silent - the tool proceeds confidently on almost nothing.
 * ======================================================================== */

// A page of real prose runs to thousands of characters. A page carrying only
// a header, a page number and a figure caption might yield 80. Below ~120 the
// text layer is almost certainly incidental rather than the document content.
export const MIN_CHARS_PER_PAGE = 120;

export function assessTextSufficiency(text, pages) {
  const chars = (text || "").trim().length;
  const p = Math.max(1, Number(pages) || 1);
  const perPage = Math.round(chars / p);

  if (chars === 0) {
    return {
      level: "none", chars, perPage, pages: p, sufficient: false,
      message: `No embedded text layer across ${p} page${p === 1 ? "" : "s"}. This is a scan or an image-only export.`,
    };
  }
  if (perPage < MIN_CHARS_PER_PAGE) {
    return {
      level: "thin", chars, perPage, pages: p, sufficient: false,
      message:
        `Only ${chars.toLocaleString()} characters across ${p} page${p === 1 ? "" : "s"} ` +
        `(~${perPage} per page). That is far below a normal text document, so this file is ` +
        `probably mostly images with a little incidental text. Reading it as text would give ` +
        `the analysis almost nothing to work with.`,
    };
  }
  return {
    level: "good", chars, perPage, pages: p, sufficient: true,
    message: `Extracted ${chars.toLocaleString()} characters from ${p} page${p === 1 ? "" : "s"}.`,
  };
}

/* ==========================================================================
 * F17 - IMAGE DOWNSCALING BEFORE UPLOAD
 *
 * A phone photo is commonly 4000px+ and several megabytes. Base64 inflates it
 * by a further third. That payload is slow to send, expensive in input tokens,
 * and materially raises the chance of meeting a 529 overload mid-request.
 *
 * Document text stays comfortably legible at 1500px on the long edge, so the
 * resize is close to free in accuracy terms and typically removes 80-90% of
 * the bytes.
 * ======================================================================== */

export const MAX_IMAGE_EDGE = 1500;
export const JPEG_QUALITY = 0.82;

/**
 * Downscales an image File/Blob and returns base64 plus a size report.
 * Returns the original untouched if anything fails - a failed optimisation
 * must never block an upload the user asked for.
 */
export function downscaleImage(file, maxEdge = MAX_IMAGE_EDGE) {
  return new Promise((resolve) => {
    const done = (base64, mediaType, note, before, after) =>
      resolve({ base64, mediaType, note, bytesBefore: before, bytesAfter: after });

    try {
      const url = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        try {
          const { width: w, height: h } = img;
          const longest = Math.max(w, h);
          const scale = longest > maxEdge ? maxEdge / longest : 1;

          if (scale === 1) {
            URL.revokeObjectURL(url);
            const r = new FileReader();
            r.onload = () => done(String(r.result).split(",")[1], file.type || "image/jpeg",
              `Sent at original size (${w}x${h}) - already within ${maxEdge}px.`, file.size, file.size);
            r.onerror = () => done(null, null, "Could not read the image file.", file.size, file.size);
            r.readAsDataURL(file);
            return;
          }

          const cw = Math.round(w * scale);
          const ch = Math.round(h * scale);
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, cw, ch);
          const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          URL.revokeObjectURL(url);

          const base64 = dataUrl.split(",")[1];
          const after = Math.round((base64.length * 3) / 4);
          const saved = file.size > 0 ? Math.round((1 - after / file.size) * 100) : 0;
          done(base64, "image/jpeg",
            `Resized ${w}x${h} to ${cw}x${ch} before sending - ${saved}% smaller, which cuts input tokens and reduces the chance of a provider timeout.`,
            file.size, after);
        } catch {
          URL.revokeObjectURL(url);
          done(null, null, "Could not resize the image; sending as-is.", file.size, file.size);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        done(null, null, "Could not decode the image file.", file.size, file.size);
      };
      img.src = url;
    } catch {
      done(null, null, "Could not process the image file.", file?.size || 0, file?.size || 0);
    }
  });
}

/* ==========================================================================
 * F12 - BROWSER OCR
 *
 * tesseract.js is a WASM build of the Tesseract engine. It runs entirely in
 * the browser: no key, no request, no tokens, and no backend - so it preserves
 * the architecture rather than compromising it.
 *
 * Loaded dynamically so the ~2MB WASM payload is only fetched by users who
 * actually upload a scan. It must never be part of the initial bundle.
 *
 * HONEST LIMITATION, and it must be shown in the UI: Tesseract is weaker than
 * a vision model on skewed pages, handwriting, low contrast and complex table
 * structure. Where its confidence is poor the user should be offered the AI
 * path with its cost stated - offered, not defaulted to.
 * ======================================================================== */

let tesseractPromise = null;

async function loadTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = import("tesseract.js").catch((e) => {
      tesseractPromise = null;
      throw new Error(
        "The in-browser OCR engine could not be loaded. Check your connection, " +
        "or use the AI reading option instead. Original error: " + (e?.message || e));
    });
  }
  return tesseractPromise;
}

/**
 * OCRs already-rendered page images locally.
 * @param {string[]} pageImages  data URLs or object URLs, one per page
 * @param {(p:{page:number,of:number,progress:number})=>void} onProgress
 */
export async function ocrPagesLocally(pageImages, onProgress) {
  const T = await loadTesseract();
  const createWorker = T.createWorker || (T.default && T.default.createWorker);
  if (typeof createWorker !== "function") throw new Error("OCR engine exposed no worker factory.");

  const worker = await createWorker("eng");
  const pages = [];
  let confidenceSum = 0;

  try {
    for (let i = 0; i < pageImages.length; i++) {
      if (typeof onProgress === "function") {
        onProgress({ page: i + 1, of: pageImages.length, progress: i / pageImages.length });
      }
      const { data } = await worker.recognize(pageImages[i]);
      pages.push((data && data.text ? data.text : "").trim());
      confidenceSum += (data && typeof data.confidence === "number") ? data.confidence : 0;
    }
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
  }

  const text = pages.join("\n\n").trim();
  const confidence = pageImages.length ? Math.round(confidenceSum / pageImages.length) : 0;

  return {
    text,
    pages: pageImages.length,
    confidence,
    // Tesseract's own confidence, surfaced honestly rather than hidden. Below
    // about 70 the transcription is usually too unreliable to analyse.
    reliable: confidence >= 70 && text.length > 0,
    note:
      `Read locally in your browser using OCR - no API call, no tokens used. ` +
      `Average confidence ${confidence}%.` +
      (confidence < 70
        ? " That is low: the scan may be skewed, low-contrast or handwritten. Check the text before relying on it, or use the AI reading option."
        : ""),
  };
}

/**
 * Decides which rung to use, and what to tell the user.
 * Never triggers the AI path itself - it returns a RECOMMENDATION, and the
 * component asks for consent before spending anything.
 */
export function chooseReadingStrategy(extraction) {
  const s = assessTextSufficiency(extraction?.text, extraction?.pages);
  if (s.sufficient) {
    return { strategy: "text-layer", cost: "free", assessment: s,
      message: s.message + " No AI call needed." };
  }
  return {
    strategy: "ocr-local",
    cost: "free",
    assessment: s,
    message: s.message +
      " It can be read with in-browser OCR at no cost in tokens or requests. " +
      "If that transcription comes out poor, reading the pages with AI vision is the fallback - " +
      "that one does cost tokens and will be estimated before you confirm.",
  };
}

export default {
  assessTextSufficiency,
  downscaleImage,
  ocrPagesLocally,
  chooseReadingStrategy,
  MIN_CHARS_PER_PAGE,
  MAX_IMAGE_EDGE,
};
