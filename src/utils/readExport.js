import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { stripRTF } from "./helpers";
import { extractPdfText, rasterizePdf } from "./pdfText";
import { parseSuiteReport, digestForConsumer, describeParsed } from "./suiteReport";

/**
 * Read ANY export this suite produces, back into plain text.
 *
 * The tools are a chain: the analysis tools export a report, and the Combined,
 * Concept and Budget tools consume it. That chain was broken - Combined rejected
 * .xlsx (the primary export format) and Concept had no file upload at all, so the
 * user had to open a file, copy the text out and paste it in by hand.
 *
 * Handles .xlsx / .xls / .csv / .docx / .rtf / .txt / .md / .json / .pdf - including
 * scanned PDFs, which are rendered to images and read by the model when the caller
 * supplies an onRasterize handler.
 * Everything is read locally in the browser - no AI, no API key, works on every
 * provider. The only exception is a scanned PDF, which has no text layer to read.
 */
export const EXPORT_ACCEPT = ".txt,.md,.json,.csv,.rtf,.docx,.doc,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp";

/** Flatten a workbook to readable text, keeping sheet names as headings. */
function workbookToText(wb) {
  const out = [];
  wb.SheetNames.forEach((name) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return;
    // Structured reports are exported one report section per sheet, so the sheet
    // name carries real meaning - keep it as a heading rather than discarding it.
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
    if (!rows.length) return;
    out.push(`## ${name}`);
    rows.forEach((r) => {
      const line = r.map((c) => String(c == null ? "" : c).trim()).filter(Boolean).join("  |  ");
      if (line) out.push(line);
    });
    out.push("");
  });
  return out.join("\n").trim();
}

/**
 * @returns {Promise<{text:string, note:string, kind:string}>}
 * @throws  {Error} with a message written for the user, not a stack trace
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("Could not read that image."));
    r.readAsDataURL(file);
  });
}

export async function readExportFile(file, onProgress, onRasterize) {
  const name = (file?.name || "").toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));

  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const text = workbookToText(wb);
    if (!text) throw new Error("That spreadsheet appears to be empty.");
    return finalise({ text, kind: "spreadsheet", note: `Read ${wb.SheetNames.length} sheet${wb.SheetNames.length === 1 ? "" : "s"} locally - no AI used.` });
  }

  if (ext === ".docx") {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    const text = (value || "").trim();
    if (!text) throw new Error("That Word document contained no readable text.");
    return finalise({ text, kind: "docx", note: "Read locally - no AI used." });
  }

  if (ext === ".pdf") {
    const res = await extractPdfText(file, onProgress);

    /* ------------------------------------------------------------------
     * READING LADDER (F12) - cheapest rung that works, AI last.
     *
     *   1. pdf.js text layer      free, instant
     *   2. SUFFICIENCY check      a PDF yielding 30 characters across 8 pages
     *                             passes `!empty` but tells the analysis almost
     *                             nothing. That silent near-miss is worse than
     *                             no text at all, so it is caught here.
     *   3. tesseract.js OCR       free, in-browser, no key, NO TOKENS and NO
     *                             REQUEST - so it does not touch the rate limit
     *                             that actually constrains this app
     *   4. AI vision              costs tokens AND a request; only reached when
     *                             the free rungs fail or OCR confidence is poor
     * ---------------------------------------------------------------- */
    const { assessTextSufficiency } = await import("./localDocRead");
    const suff = assessTextSufficiency(res.text, res.pages);

    if (!res.empty && suff.sufficient) {
      return finalise({ text: res.text, kind: "pdf", note: res.note + " Read locally - no AI used." });
    }

    // Rung 3: free browser OCR before spending anything.
    try {
      const { ocrPagesLocally } = await import("./localDocRead");
      const { blocks, pagesRendered, pagesTotal } = await rasterizePdf(file, 6, onProgress);
      const dataUrls = (blocks || [])
        .map((b) => (b?.source?.data ? `data:${b.source.media_type || "image/png"};base64,${b.source.data}` : null))
        .filter(Boolean);
      if (dataUrls.length) {
        const ocr = await ocrPagesLocally(dataUrls, (p) => {
          if (typeof onProgress === "function") {
            onProgress(`Reading page ${p.page} of ${p.of} with in-browser OCR (free, no API call)...`);
          }
        });
        if (ocr.reliable) {
          return finalise({
            text: ocr.text, kind: "pdf-ocr-local",
            note: `${suff.level === "thin" ? "The text layer was too sparse to use, so " : "No text layer, so "}` +
              `${pagesRendered} of ${pagesTotal} page${pagesTotal === 1 ? "" : "s"} were read by OCR in your browser. ` +
              ocr.note + " No API call, no tokens and no request used. Check the result against the original.",
          });
        }
        // Poor confidence: fall through to AI vision, saying why.
        if (typeof onProgress === "function") {
          onProgress(`In-browser OCR confidence was only ${ocr.confidence}% - falling back to AI vision.`);
        }
      }
    } catch (e) {
      if (typeof onProgress === "function") {
        onProgress("In-browser OCR unavailable (" + (e?.message || "unknown") + ") - falling back to AI vision.");
      }
    }

    // Rung 4: AI vision. Costs tokens and a request, so it is genuinely last.
    if (typeof onRasterize === "function") {
      const { blocks, pagesRendered, pagesTotal } = await rasterizePdf(file, 6, onProgress);
      const text = await onRasterize(blocks, { pagesRendered, pagesTotal });
      if (text && text.trim()) {
        return finalise({
          text: text.trim(), kind: "pdf-ocr",
          note: `Free in-browser OCR could not read this reliably, so ${pagesRendered} of ${pagesTotal} page${pagesTotal === 1 ? "" : "s"} were read as images by the AI - this used tokens and a request. Check the result against the original.`,
        });
      }
    }
    throw new Error(res.note);
  }

  if (ext === ".rtf") {
    const raw = await file.text();
    const text = stripRTF(raw).trim();
    if (!text) throw new Error("That RTF file contained no readable text.");
    return finalise({ text, kind: "rtf", note: "Read locally - no AI used." });
  }

  if (ext === ".txt" || ext === ".md" || ext === ".json") {
    const text = (await file.text()).trim();
    if (!text) throw new Error("That file is empty.");
    return finalise({ text, kind: "text", note: "Read locally - no AI used." });
  }

  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
    // Screenshots and exported chart images. There is no text to extract, so these
    // go straight to the model as an image block - same path as a scanned PDF.
    if (typeof onRasterize !== "function") {
      throw new Error("Reading an image needs an API key. Add one in Settings and re-upload, or upload the .xlsx / .rtf export instead.");
    }
    const b64 = await fileToBase64(file);
    const media = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    const text = await onRasterize([{ type: "image", source: { type: "base64", media_type: media, data: b64 } }],
      { pagesRendered: 1, pagesTotal: 1 });
    if (!text || !text.trim()) throw new Error("Nothing readable was found in that image.");
    return finalise({ text: text.trim(), kind: "image", note: "Image read by the AI. Check the result against the original." });
  }

  // Anything else: try reading it as text before refusing. A file with an unusual
  // extension is often still plain text, and refusing outright is unhelpful.
  try {
    const guess = (await file.text()).trim();
    if (guess && /[\x20-\x7E]/.test(guess.slice(0, 200))) {
      return finalise({ text: guess, kind: "text", note: `Read ${ext || "the file"} as plain text.` });
    }
  } catch { /* fall through to the error below */ }

  throw new Error(
    `${ext || "That file type"} could not be read. Upload a report exported from any tool in this suite ` +
    "(.xlsx, .rtf or .pdf), or a .docx / .txt / .csv / image file."
  );
}

/**
 * Every read path funnels through here, so a caller always gets the same shape:
 * raw text, the parsed report structure when it is one of ours, and a digest with
 * the boilerplate stripped out.
 */
function finalise(res) {
  const parsed = parseSuiteReport(res.text);
  return {
    ...res,
    parsed,
    digest: digestForConsumer(parsed),
    note: `${res.note} ${describeParsed(parsed)}`.trim(),
  };
}
