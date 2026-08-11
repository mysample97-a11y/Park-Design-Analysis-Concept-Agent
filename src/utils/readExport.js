import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { stripRTF } from "./helpers";
import { extractPdfText } from "./pdfText";

/**
 * Read ANY export this suite produces, back into plain text.
 *
 * The tools are a chain: the analysis tools export a report, and the Combined,
 * Concept and Budget tools consume it. That chain was broken - Combined rejected
 * .xlsx (the primary export format) and Concept had no file upload at all, so the
 * user had to open a file, copy the text out and paste it in by hand.
 *
 * Handles .xlsx / .xls / .csv / .docx / .rtf / .txt / .md / .json / .pdf.
 * Everything is read locally in the browser - no AI, no API key, works on every
 * provider. The only exception is a scanned PDF, which has no text layer to read.
 */
export const EXPORT_ACCEPT = ".txt,.md,.json,.csv,.rtf,.docx,.xlsx,.xls,.pdf";

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
export async function readExportFile(file, onProgress) {
  const name = (file?.name || "").toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));

  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const text = workbookToText(wb);
    if (!text) throw new Error("That spreadsheet appears to be empty.");
    return { text, kind: "spreadsheet", note: `Read ${wb.SheetNames.length} sheet${wb.SheetNames.length === 1 ? "" : "s"} locally - no AI used.` };
  }

  if (ext === ".docx") {
    const buf = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    const text = (value || "").trim();
    if (!text) throw new Error("That Word document contained no readable text.");
    return { text, kind: "docx", note: "Read locally - no AI used." };
  }

  if (ext === ".pdf") {
    const res = await extractPdfText(file, onProgress);
    if (res.empty) throw new Error(res.note);
    return { text: res.text, kind: "pdf", note: res.note + " Read locally - no AI used." };
  }

  if (ext === ".rtf") {
    const raw = await file.text();
    const text = stripRTF(raw).trim();
    if (!text) throw new Error("That RTF file contained no readable text.");
    return { text, kind: "rtf", note: "Read locally - no AI used." };
  }

  if (ext === ".txt" || ext === ".md" || ext === ".json") {
    const text = (await file.text()).trim();
    if (!text) throw new Error("That file is empty.");
    return { text, kind: "text", note: "Read locally - no AI used." };
  }

  throw new Error(
    `${ext || "That file type"} is not supported. Upload a report exported from any tool in this suite ` +
    "(.xlsx, .rtf or .pdf), or a .docx / .txt / .csv file."
  );
}
