// src/utils/helpers.js - Helper & Utility Functions

/** Converts a File object to Base64 data URL string */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(""); return; }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}

/** Returns just the base64 payload (no data: prefix) - needed for PDF document blocks */
export function fileToBase64Raw(file) {
  return fileToBase64(file).then((dataUrl) => (dataUrl && dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl));
}

/** Unique ID Generator */
export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
}
export const generateUid = uid;
export const getUid = uid;

/** User-Friendly Error Formatter */
export function friendlyError(err) {
  const msg = (typeof err === "string" ? err : err?.message || "").toLowerCase();
  if (!msg) return "An unknown error occurred. Please try again.";
  if (msg.includes("no api key") || msg.includes("key is missing")) return "Add an API key in Settings before using AI features.";
  if (msg.includes("failed to fetch") || msg.includes("networkerror")) return "Network error - check your internet connection, or the AI provider may be temporarily unreachable.";
  if (msg.includes("401") || msg.includes("403") || msg.includes("key invalid") || msg.includes("api key error")) return "API key problem - check your key is correct and has quota remaining in Settings.";
  if (msg.includes("json") || msg.includes("unexpected token") || msg.includes("no json")) return "The AI's answer got cut off or wasn't in the expected format. Try again - it often works on retry, or reduce the amount of input.";
  if (msg.includes("empty")) return "The AI didn't send back any content that time. Try again.";
  if (msg.includes("cors")) return "The AI provider blocked the browser request. If using Claude, this app needs its browser-access header; if using another provider, it may not support direct browser calls.";
  return typeof err === "string" ? err : err?.message || "Something went wrong. Try again.";
}

/** Robust JSON Extractor (handles markdown fences, objects, arrays) */
export function extractJSON(text, fallback = null) {
  if (!text) return fallback;
  if (typeof text === "object") return text;
  try { return JSON.parse(text); } catch (e) {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) { try { return JSON.parse(fence[1].trim()); } catch (err) {} }
  const fb = text.indexOf("{"), lb = text.lastIndexOf("}");
  const fbr = text.indexOf("["), lbr = text.lastIndexOf("]");
  // Prefer whichever structure appears first
  if (fbr !== -1 && (fb === -1 || fbr < fb) && lbr > fbr) { try { return JSON.parse(text.substring(fbr, lbr + 1)); } catch (err) {} }
  if (fb !== -1 && lb > fb) { try { return JSON.parse(text.substring(fb, lb + 1)); } catch (err) {} }
  if (fbr !== -1 && lbr > fbr) { try { return JSON.parse(text.substring(fbr, lbr + 1)); } catch (err) {} }
  return fallback;
}
export const safeJSONParse = extractJSON;
export const parseJSON = extractJSON;
export const parseJson = extractJSON;

/** Strips RTF control codes to plain text - used to read our own .rtf exports back in */
export function stripRTF(rtfText) {
  if (!rtfText) return "";
  let text = rtfText.replace(/\\par[d]?/g, "\n");
  text = text.replace(/\{\\fonttbl[^}]*\}/g, "");
  text = text.replace(/\{\\colortbl[^}]*\}/g, "");
  text = text.replace(/\{\\\*[^}]*\}/g, "");
  text = text.replace(/\\[a-zA-Z]+-?\d* ?/g, "");
  text = text.replace(/[{}]/g, "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Number & Date Formatting */
export function formatNumber(val, decimals = 2) {
  if (val === undefined || val === null || isNaN(val)) return "N/A";
  return Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
export function formatPercent(val) {
  if (val === undefined || val === null || isNaN(val)) return "0%";
  return `${Number(val).toFixed(1)}%`;
}
export function formatDate(dateStr) {
  if (!dateStr) return new Date().toLocaleDateString();
  return new Date(dateStr).toLocaleDateString();
}

/** Download & Export Helpers */
export function downloadFile(content, filename, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** RTF (Word-openable) builder from plain text */
export function buildRTF(plainText) {
  const body = (plainText || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\par ");
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22 ${body}}`;
}

/** Opens a print-to-PDF window with given HTML */
export function printHTML(html, onBlocked) {
  const win = window.open("", "_blank");
  if (!win) { if (onBlocked) onBlocked(); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 400);
}

export function exportToJSON(data, filename = "analysis-report.json") {
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  downloadFile(content, filename, "application/json");
}

export function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand("copy"); document.body.removeChild(ta);
  return Promise.resolve();
}
