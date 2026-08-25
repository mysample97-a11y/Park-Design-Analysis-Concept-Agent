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

export default { setActiveTool, setActiveEstimate, setActivePartial, clearActiveTool, getActiveTool, subscribeActiveTool };
