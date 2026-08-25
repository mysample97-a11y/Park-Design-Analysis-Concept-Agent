// src/utils/toolBridge.js
// ---------------------------------------------------------------------------
// ACTIVE-TOOL BRIDGE
//
// The rails live in App.jsx; the estimator lives inside each tool, because only
// the tool knows what its own inputs are. App passed `estimate={null}` and
// `onCalculate` undefined, so the rail had nothing to call and its buttons
// simply never appeared - which is why the estimate button looked missing.
//
// This is a deliberately tiny publish/subscribe singleton rather than another
// React context. Adding a provider would mean touching all eight tools and the
// shell; a tool registers itself in one useEffect and nothing else changes.
//
// Only ONE tool is active at a time (the others are hidden but still mounted
// for keep-alive), so a single slot is the correct shape - a map would let a
// hidden tool's estimator answer for the visible one.
// ---------------------------------------------------------------------------

let active = { code: null, calculate: null, resetUsage: null, estimate: null, partial: null };
const listeners = new Set();

function notify() {
  listeners.forEach((fn) => {
    try { fn(active); } catch { /* a bad listener must not break the app */ }
  });
}

/**
 * Called by a tool when it becomes the visible one.
 * @param {string} code        tool code, e.g. "WND"
 * @param {object} handlers    { calculate, resetUsage }
 */
export function setActiveTool(code, handlers = {}) {
  active = {
    code,
    calculate: typeof handlers.calculate === "function" ? handlers.calculate : null,
    resetUsage: typeof handlers.resetUsage === "function" ? handlers.resetUsage : null,
    estimate: handlers.estimate || null,
    partial: handlers.partial || null,
  };
  notify();
}

/** Publishes a freshly computed estimate without re-registering the handlers. */
export function setActiveEstimate(code, estimate) {
  if (active.code !== code) return;      // a hidden tool must not overwrite
  active = { ...active, estimate };
  notify();
}

/** Publishes generation progress so the rail can show an incomplete report. */
export function setActivePartial(code, partial) {
  if (active.code !== code) return;
  active = { ...active, partial };
  notify();
}

export function clearActiveTool(code) {
  if (active.code !== code) return;
  active = { code: null, calculate: null, resetUsage: null, estimate: null, partial: null };
  notify();
}

export function getActiveTool() {
  return active;
}

export function subscribeActiveTool(fn) {
  listeners.add(fn);
  fn(active);
  return () => listeners.delete(fn);
}

export default { setActiveTool, setActiveEstimate, setActiveBusy, setActivePartial, clearActiveTool, getActiveTool, subscribeActiveTool };

/* ===========================================================================
 * BUSY STATE AND CANCELLATION
 *
 * Reported problem: "Researching..." sat there for minutes with no error and no
 * way out. Two separate faults behind that:
 *
 *   1. NO TIMEOUT. fetch() waits indefinitely by default. If a provider accepts
 *      the connection and then stalls, the promise never settles, no catch runs,
 *      and the spinner spins forever. Silence is indistinguishable from work.
 *   2. NO WAY TO STOP. Even knowing it was stuck, the only exit was reloading
 *      the page, which loses everything not yet persisted.
 *
 * The tool publishes its busy state and an abort function here; the rails render
 * a Stop button while it is set. Cancelling aborts the in-flight request, so the
 * connection is actually closed rather than merely ignored.
 * ========================================================================= */

/**
 * @param {string} code   tool code
 * @param {boolean} busy  is a request in flight
 * @param {Function} [cancel] aborts it
 */
export function setActiveBusy(code, busy, cancel) {
  if (active.code !== code) return;          // a hidden tool must not speak for the visible one
  active = {
    ...active,
    busy: !!busy,
    cancel: typeof cancel === "function" ? cancel : (busy ? active.cancel : null),
  };
  notify();
}

export function getActiveBusy() {
  return { busy: !!active.busy, cancel: active.cancel || null };
}

/* ===========================================================================
 * TOOL STATE SNAPSHOT — session save/load
 *
 * Why the saved file restored nothing: the exporter only copied localStorage
 * keys. Everything a user types - location, description, zones, pasted survey
 * text, facility tables - lives in React state, which is not in localStorage and
 * is gone the moment the tab closes. The file was real, and almost empty.
 *
 * Each tool now registers a snapshot/restore pair. The tool owns the shape,
 * because only it knows which of its state is user input and which is derived.
 *
 * API keys are NEVER included: session files get emailed and synced, and a key
 * in one is the one thing genuinely worth stealing.
 * ========================================================================= */

const snapshots = new Map();   // code -> { snapshot(), restore(state) }

export function registerToolState(code, handlers = {}) {
  if (typeof handlers.snapshot !== "function") return;
  snapshots.set(code, {
    snapshot: handlers.snapshot,
    restore: typeof handlers.restore === "function" ? handlers.restore : null,
  });
}

export function unregisterToolState(code) {
  snapshots.delete(code);
}

/** Every mounted tool's state. Tools not yet opened are simply absent. */
export function snapshotAllTools() {
  const out = {};
  snapshots.forEach((h, code) => {
    try {
      const v = h.snapshot();
      if (v && typeof v === "object") out[code] = v;
    } catch { /* one bad tool must not lose the rest of the session */ }
  });
  return out;
}

/**
 * Restores what it can and reports what it could not.
 * A tool that has never been opened is not mounted, so it has no restore
 * function - its state is kept in the pending map and applied when it mounts.
 */
const pending = new Map();

export function restoreAllTools(byCode) {
  const applied = [], deferred = [];
  Object.keys(byCode || {}).forEach((code) => {
    const h = snapshots.get(code);
    if (h && h.restore) {
      try { h.restore(byCode[code]); applied.push(code); return; }
      catch { /* fall through to deferral */ }
    }
    pending.set(code, byCode[code]);
    deferred.push(code);
  });
  return { applied, deferred };
}

/** Called by a tool as it mounts, to collect state restored before it existed. */
export function takePendingState(code) {
  if (!pending.has(code)) return null;
  const v = pending.get(code);
  pending.delete(code);
  return v;
}
