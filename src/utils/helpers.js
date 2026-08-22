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
/**
 * F26 - IMAGE DOWNSCALING BEFORE UPLOAD.
 *
 * Used by every tool that accepts an image, so the saving applies across the
 * whole app rather than one analyzer.
 *
 * A phone photo is commonly 4000px and several megabytes; base64 encoding adds
 * a further third. That payload is slow to send, expensive in input tokens, and
 * materially more likely to meet a provider overload (HTTP 529) mid-request -
 * which is exactly the "model is currently experiencing high demand" failure
 * seen when uploading a GIS map image to Site Context.
 *
 * Map and document text remains legible at 1500px on the long edge, so the
 * resize costs almost nothing in accuracy and typically removes 80-90% of the
 * bytes. Non-images and any failure fall through to the original encoding: a
 * failed optimisation must never block an upload the user asked for.
 */
export async function fileToBase64Raw(file) {
  try {
    if (file && typeof file.type === "string" && file.type.startsWith("image/")) {
      const { downscaleImage } = await import("./localDocRead");
      const r = await downscaleImage(file);
      if (r && r.base64) return r.base64;
    }
  } catch {
    /* fall through */
  }
  const dataUrl = await fileToBase64(file);
  return dataUrl && dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
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
  if (msg.includes("429") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("resource_exhausted") || msg.includes("exhausted")) {
    let out = "Your API key has hit its usage limit. ";
    try {
      if (localStorage.getItem("site_analysis_gemini_grounding") === "1") {
        out += "You have Gemini live web search switched on in Settings - on a free Gemini key that is charged against a very small daily allowance (roughly 20 requests) and is the most likely cause. Turn it off in Settings and try again. ";
      }
    } catch { /* ignore */ }
    out += "Otherwise: free tiers reset after a period, so wait a few minutes and retry, or use a key with remaining quota. Gemini free tier is roughly 10 requests per minute and 1,500 per day.";
    return out;
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("key invalid") || msg.includes("api key error")) return "API key problem - the key was rejected. Check it is correct and still active in Settings.";
  if (msg.includes("overloaded") || msg.includes("503") || msg.includes("529")) return "The AI provider is temporarily overloaded. Wait a moment and retry.";
  if (msg.includes("position") || msg.includes("after array element") || msg.includes("unterminated"))
    return "The AI's answer was cut off before it finished (response length limit). Try again with fewer items, or shorten your input text.";
  if (msg.includes("no json")) return "The AI replied but not in the expected format. This usually resolves on retry. If it repeats, shorten your input.";
  if (msg.includes("json") || msg.includes("unexpected token")) return "The AI's answer could not be read as structured data. Try again - this usually succeeds on retry.";
  if (msg.includes("empty")) return "The AI didn't send back any content that time. Try again.";
  if (msg.includes("cors")) return "The AI provider blocked the browser request. If using Claude, this app needs its browser-access header; if using another provider, it may not support direct browser calls.";
  return typeof err === "string" ? err : err?.message || "Something went wrong. Try again.";
}

/** Robust JSON Extractor (handles markdown fences, objects, arrays) */
/** Closes an unterminated JSON fragment from a truncated response.
 *  Cuts only at COMPLETE element boundaries, so a partially-received value is
 *  discarded rather than silently recovered with a wrong number, and closes
 *  brackets using a stack so nesting order is correct. */
function repairTruncatedJSON(fragment) {
  const t = fragment.trim();

  // Scan once, recording every index that ends a complete element, plus the
  // bracket stack at that point.
  const boundaries = [];
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      boundaries.push({ end: i + 1, stack: [...stack] });
    }
  }
  // Try the latest complete boundary first, then walk backwards.
  for (let k = boundaries.length - 1; k >= 0 && k >= boundaries.length - 40; k--) {
    const { end, stack: open } = boundaries[k];
    const base = t.slice(0, end).replace(/,\s*$/, "");
    const closing = [...open].reverse().map((c) => (c === "{" ? "}" : "]")).join("");
    try {
      const parsed = JSON.parse(base + closing);
      if (Array.isArray(parsed) && parsed.length === 0) continue;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0) continue;
      return parsed;
    } catch { /* walk back further */ }
  }
  return null;
}

/** Robust JSON extractor. Handles markdown fences, surrounding prose, and truncated
 *  responses. Preserves the OUTERMOST structure so an array is never downgraded to
 *  an object (which would break Array.isArray checks in the tools). */
export function extractJSON(text, fallback = null) {
  if (!text) return fallback;
  if (typeof text === "object") return text;

  try { return JSON.parse(text); } catch (e) { /* continue */ }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    try { return JSON.parse(fence[1].trim()); } catch (err) { text = fence[1]; }
  }

  const fb = text.indexOf("{"), fbr = text.indexOf("[");
  const openers = [fb, fbr].filter((i) => i !== -1);
  if (!openers.length) return fallback;
  const firstOpen = Math.min(...openers);
  const isArray = firstOpen === fbr;
  const closer = isArray ? text.lastIndexOf("]") : text.lastIndexOf("}");

  if (closer > firstOpen) {
    try { return JSON.parse(text.substring(firstOpen, closer + 1)); } catch (err) { /* continue */ }
  }
  const repaired = repairTruncatedJSON(text.slice(firstOpen));
  if (repaired !== null) return repaired;
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
  const esc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}")
    .replace(/[\u0080-\uFFFF]/g, (c) => "\\u" + c.charCodeAt(0) + "?");
  const lines = String(plainText || "").split("\n");
  let out = "";
  let inTable = false;
  for (let raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    // pipe-delimited row -> real RTF table row
    if (trimmed.includes(" | ") && trimmed.split("|").length > 2) {
      const cells = trimmed.split("|").map((c) => c.trim());
      const w = Math.floor(9000 / cells.length);
      let bounds = "";
      for (let i = 1; i <= cells.length; i++) bounds += "\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx" + (w * i);
      out += "\\trowd\\trgaph80" + bounds;
      cells.forEach((c) => { out += "\\intbl\\fs18 " + esc(c) + "\\cell"; });
      out += "\\row\n";
      inTable = true;
      continue;
    }
    if (inTable) { out += "\\pard\\par\n"; inTable = false; }
    if (!trimmed) { out += "\\par\n"; continue; }
    // [n] SECTION HEADING
    if (/^\[\d+\]/.test(trimmed) || /^APPENDIX/.test(trimmed)) {
      out += "\\pard\\sa120\\sb180\\b\\fs24\\cf1 " + esc(trimmed) + "\\b0\\fs22\\cf0\\par\n";
      continue;
    }
    // ALL-CAPS title line
    if (/^[A-Z][A-Z0-9 &,\-\/\.()]{6,}$/.test(trimmed)) {
      out += "\\pard\\sa100\\sb160\\b\\fs26 " + esc(trimmed) + "\\b0\\fs22\\par\n";
      continue;
    }
    // bullet
    if (/^[-*]\s/.test(trimmed)) {
      out += "\\pard\\li600\\fi-200 \\bullet  " + esc(trimmed.replace(/^[-*]\s*/, "")) + "\\par\n";
      continue;
    }
    // Label: value  -> bold the label
    const kv = trimmed.match(/^([A-Za-z][A-Za-z0-9 &\/'\-]{2,38}):\s*(.*)$/);
    if (kv && kv[2]) {
      const indent = raw.match(/^\s*/)[0].length >= 4 ? 600 : 300;
      out += "\\pard\\li" + indent + " \\b " + esc(kv[1]) + ":\\b0  " + esc(kv[2]) + "\\par\n";
      continue;
    }
    const indent = raw.match(/^\s*/)[0].length >= 4 ? 600 : (raw.match(/^\s*/)[0].length >= 2 ? 300 : 0);
    out += "\\pard\\li" + indent + " " + esc(trimmed) + "\\par\n";
  }
  return "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}{\\colortbl;\\red28\\green35\\blue51;}\\f0\\fs22\n" + out + "}";
}

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
  // The async clipboard API REJECTS when the document is not focused, when
  // permission is denied, or in some embedded contexts. The old code returned that
  // rejected promise with no fallback, so the caller's .then() never fired and the
  // button appeared to do nothing. Always fall back to the legacy path.
  const legacy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok ? Promise.resolve() : Promise.reject(new Error("copy blocked"));
    } catch (e) { return Promise.reject(e); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(legacy);
  }
  return legacy();
}
