// src/utils/session.js
// ---------------------------------------------------------------------------
// SESSION SAVE / LOAD  (F28)
//
// "Is this possible without a server?" - yes, completely.
//
// Saving is a Blob plus an object URL plus a synthetic click on an <a download>.
// The file is written by the BROWSER to wherever the user's download settings
// point; the page never sees the path and never uploads anything. Loading is an
// <input type="file">, which hands the page a File object the user explicitly
// chose. Both directions are local, and neither needs a backend - so this does
// not compromise the no-server architecture that the whole submission rests on.
//
// Why it is needed
// ----------------
// Every tool holds its work in React state, which dies with the tab. A crash, a
// reload, a dropped connection mid-analysis, or simply switching machines loses
// an entire session of paid tokens. localStorage helps but is tied to one
// browser profile and can be cleared without warning. A file the user controls
// is the only durable answer.
//
// WHAT IS DELIBERATELY NOT SAVED
// ------------------------------
// API keys. They are the one thing in the app worth stealing, and a session
// file is likely to be emailed, synced or attached to a submission. Excluding
// them is not an oversight - it is the point. The loader states plainly that
// keys must be re-entered.
// ---------------------------------------------------------------------------

export const SESSION_FORMAT = "alsafa2.session";
export const SESSION_VERSION = 1;

/** Keys that must never be written to a portable file. */
const FORBIDDEN = [/api[_-]?key/i, /secret/i, /token[_-]?value/i, /password/i, /bearer/i];

function stripSecrets(obj, path = "") {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((v, i) => stripSecrets(v, `${path}[${i}]`));
  if (typeof obj !== "object") return obj;
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (FORBIDDEN.some((re) => re.test(k))) return;      // drop the key entirely
    out[k] = stripSecrets(obj[k], path ? `${path}.${k}` : k);
  });
  return out;
}

/**
 * SUPERSEDED - not on the live path.
 *
 * These three (buildSession / saveSessionToFile / loadSessionFromFile) take a
 * state object the caller supplies. The UI uses the APP-LEVEL pair further down
 * (exportAppSession / saveAppSessionToFile / loadAppSessionFromFile), which works
 * at the storage layer and needs no cooperation from each tool.
 *
 * Kept because a per-tool save is the natural next step if tools ever lift their
 * form state into a serialisable shape. Do not wire these expecting whole-app
 * behaviour - they only carry what you hand them.
 *
 * Builds the session object.
 * @param {string} toolCode  e.g. "SOL"
 * @param {object} state     whatever the tool wants to restore
 */
export function buildSession(toolCode, state, meta = {}) {
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    tool: toolCode,
    savedAt: new Date().toISOString(),
    app: "Al Safa 2 Site Analysis Suite",
    meta: stripSecrets(meta),
    state: stripSecrets(state),
  };
}

/** Triggers a download. Returns the filename used. */
export function saveSessionToFile(toolCode, state, meta = {}) {
  const session = buildSession(toolCode, state, meta);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const name = `alsafa2-${toolCode}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return name;
}

/**
 * Parses a chosen file back into state.
 * Validates hard, because a user may pick any file at all - including one of
 * this app's own REPORT exports, which is a different shape entirely.
 */
export async function loadSessionFromFile(file, expectedTool = null) {
  if (!file) throw new Error("No file chosen.");
  let text;
  try {
    text = await file.text();
  } catch {
    throw new Error("That file could not be read.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "That is not a session file. Session files are JSON produced by the " +
      "'Save session' button. A report export (.pdf, .rtf, .xlsx) cannot be loaded back."
    );
  }

  if (!parsed || parsed.format !== SESSION_FORMAT) {
    throw new Error(
      "That JSON file is not an Al Safa 2 session file - it is missing the format marker."
    );
  }
  if (parsed.version > SESSION_VERSION) {
    throw new Error(
      `That session was saved by a newer version of this app (v${parsed.version}). ` +
      `This build understands up to v${SESSION_VERSION}.`
    );
  }
  if (expectedTool && parsed.tool && parsed.tool !== expectedTool) {
    throw new Error(
      `That session belongs to the ${parsed.tool} tool, not ${expectedTool}. ` +
      `Open the ${parsed.tool} tool and load it there.`
    );
  }
  if (!parsed.state || typeof parsed.state !== "object") {
    throw new Error("That session file has no saved state in it.");
  }

  return {
    tool: parsed.tool,
    savedAt: parsed.savedAt,
    state: parsed.state,
    meta: parsed.meta || {},
    note:
      `Loaded a ${parsed.tool} session saved ${parsed.savedAt ? new Date(parsed.savedAt).toLocaleString() : "at an unknown time"}. ` +
      `API keys are never stored in a session file - re-enter yours in Settings if it is not already set.`,
  };
}

export default { buildSession, saveSessionToFile, loadSessionFromFile, SESSION_FORMAT, SESSION_VERSION };

/* ===========================================================================
 * WHOLE-APP SESSION  (F38 UI support)
 *
 * The per-tool helpers above take a state object the caller supplies. This pair
 * works at the storage layer instead: it exports every key this app owns, which
 * is what a user actually means by "save my session".
 *
 * WHAT IT CAPTURES
 *   - partial insights per tool (as2p_partial_*)  - the expensive AI output
 *   - token and request counters                  - so spend history survives
 *   - declared tier limits
 *
 * WHAT IT DOES NOT CAPTURE, AND THIS MUST BE SAID IN THE UI
 *   Form inputs that live only in React state (typed descriptions, uploaded
 *   files, zone tables) are NOT in localStorage and cannot be exported this
 *   way. Saving protects the AI output you paid for, not everything on screen.
 *   Claiming otherwise would be worse than the limitation itself.
 * ========================================================================= */

const OWNED_PREFIXES = ["as2p_"];

// Imported lazily inside the functions to avoid a circular import at module load.


export function exportAppSession(toolState = {}) {
  const data = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !OWNED_PREFIXES.some((p) => k.startsWith(p))) continue;
      if (FORBIDDEN.some((re) => re.test(k))) continue;   // never export a key
      data[k] = localStorage.getItem(k);
    }
  } catch { /* private mode */ }
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    tool: "ALL",
    savedAt: new Date().toISOString(),
    app: "Al Safa 2 Site Analysis Suite",
    storage: data,
    // The part that was missing: everything typed into the tools. Without this
    // the file held only counters and partial AI output, so loading it appeared
    // to do nothing at all.
    toolState: stripSecrets(toolState),
  };
}

export function saveAppSessionToFile(toolState = {}) {
  const session = exportAppSession(toolState);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const name = `alsafa2-session-${stamp}.json`;
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    name,
    keys: Object.keys(session.storage).length,
    tools: Object.keys(session.toolState || {}).length,
  };
}

export async function loadAppSessionFromFile(file) {
  if (!file) throw new Error("No file chosen.");
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That is not a session file. Session files are the JSON produced by 'Save session'.");
  }
  if (!parsed || parsed.format !== SESSION_FORMAT) {
    throw new Error("That JSON is not an Al Safa 2 session file - the format marker is missing.");
  }
  if (parsed.version > SESSION_VERSION) {
    throw new Error(`That session was saved by a newer build (v${parsed.version}); this one understands up to v${SESSION_VERSION}.`);
  }
  const store = parsed.storage;
  if (!store || typeof store !== "object") throw new Error("That session file contains no saved data.");

  let restored = 0;
  Object.keys(store).forEach((k) => {
    if (!OWNED_PREFIXES.some((p) => k.startsWith(p))) return;   // never write foreign keys
    if (FORBIDDEN.some((re) => re.test(k))) return;
    try { localStorage.setItem(k, store[k]); restored++; } catch { /* ignore */ }
  });

  return {
    restored,
    toolState: parsed.toolState || {},
    savedAt: parsed.savedAt,
    note:
      `Restored ${restored} saved item${restored === 1 ? "" : "s"} from ` +
      `${parsed.savedAt ? new Date(parsed.savedAt).toLocaleString() : "an earlier session"}. ` +
      "Reload the page to see them. API keys are never stored in a session file, " +
      "and form inputs you typed are not included - what is restored is the AI " +
      "output already generated and your usage counters.",
  };
}
