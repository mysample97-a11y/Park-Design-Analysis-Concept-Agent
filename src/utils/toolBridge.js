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

/*
 * REGISTRY + ACTIVE POINTER  (rev 2)
 *
 * The first version kept ONE slot and every tool wrote into it on mount. With
 * keep-alive every visited tool stays mounted, so the slot ended up holding
 * whichever tool mounted LAST - not the one on screen. Every guarded update from
 * the visible tool was then silently dropped, which is why the estimate showed a
 * stale figure and the Cancel button never appeared.
 *
 * Now: a MAP keyed by tool code, plus an activeCode that App sets on every tab
 * change. Each tool owns its own entry and cannot be clobbered by another.
 */
const tools = new Map();       // code -> { calculate, cancel, resetUsage, estimate, busy }
let activeCode = null;
const listeners = new Set();

const EMPTY = { code: null, calculate: null, cancel: null, resetUsage: null, estimate: null, busy: false, partial: null };

function entry(code) {
  if (!tools.has(code)) {
    tools.set(code, { code, calculate: null, cancel: null, resetUsage: null, estimate: null, busy: false, partial: null });
  }
  return tools.get(code);
}

function notify() {
  const snap = activeCode && tools.has(activeCode) ? { ...tools.get(activeCode) } : { ...EMPTY };
  listeners.forEach((fn) => { try { fn(snap); } catch { /* a bad listener must not break the app */ } });
}

/** App calls this on every tab change. This - not mount order - decides who is visible. */
export function setActiveCode(code) {
  activeCode = code || null;
  notify();
}

export function setActiveTool(code, handlers = {}) {
  const e = entry(code);
  if (typeof handlers.calculate === "function") e.calculate = handlers.calculate;
  if (typeof handlers.cancel === "function") e.cancel = handlers.cancel;
  if (typeof handlers.resetUsage === "function") e.resetUsage = handlers.resetUsage;
  if (handlers.estimate !== undefined) e.estimate = handlers.estimate;
  notify();
}

/** Writes into the tool's OWN entry - no cross-tool clobbering possible. */
export function setActiveEstimate(code, estimate) {
  entry(code).estimate = estimate;
  notify();
}

export function setActiveBusy(code, busy, cancel) {
  const e = entry(code);
  e.busy = !!busy;
  if (typeof cancel === "function") e.cancel = cancel;
  notify();
}

/**
 * Partial-generation progress, so the Usage rail can show "3 of 5 sections" and
 * what is still outstanding. Per-tool, like everything else in this registry.
 */
export function setActivePartial(code, partial) {
  entry(code).partial = partial || null;
  notify();
}

export function clearActiveTool(code) {
  tools.delete(code);
  if (activeCode === code) activeCode = null;
  notify();
}

export function getActiveTool() {
  return activeCode && tools.has(activeCode) ? { ...tools.get(activeCode) } : { ...EMPTY };
}

export function getActiveBusy() {
  const a = getActiveTool();
  return { busy: !!a.busy, cancel: a.cancel || null };
}

export function subscribeActiveTool(fn) {
  listeners.add(fn);
  fn(getActiveTool());
  return () => listeners.delete(fn);
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
