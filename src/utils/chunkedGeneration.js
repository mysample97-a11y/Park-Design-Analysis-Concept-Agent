// src/utils/chunkedGeneration.js
// ---------------------------------------------------------------------------
// CHUNKED GENERATION WITH CONTINUATION  (F13)
//
// The problem this solves
// -----------------------
// A report asks the model for many sections at once. When the budget runs out
// partway, the reply is cut mid-structure: the JSON no longer parses, the whole
// response is discarded, and the user starts again on a fresh key having gained
// nothing. During the Al Safa 2 run this happened repeatedly on the Budget
// Tracker and cost several complete re-runs.
//
// The approach
// ------------
// Stop asking for "everything". Give the model an explicit LIST OF TOPICS and
// instruct it to produce only as many as it can COMPLETE, then declare which it
// finished and which remain. A short reply covering four whole topics is worth
// far more than a long one truncated mid-sentence.
//
// THE NO-DATA-LOSS INVARIANTS - non-negotiable, and tested
// -------------------------------------------------------
//   I1  INPUT COMPLETENESS. Chunking splits OUTPUT topics only. Every
//       continuation call resends the full input context, so no user input is
//       ever withheld from the model.
//   I2  OUTPUT COMPLETENESS. Every returned section is merged into report
//       state and therefore into every export. A section produced on call 3 is
//       indistinguishable in the final report from one produced on call 1.
//   I3  NO SILENT OVERWRITE. A continuation may not replace an existing
//       section with an empty or shorter one; earlier good content wins.
//   I4  ORDER STABILITY. The final report follows the declared topic order,
//       not the order of generation.
//   I5  RESUMABILITY. Partial state persists, so a reload or an API key swap
//       loses nothing.
// ---------------------------------------------------------------------------

const PARTIAL_PREFIX = "as2p_partial_";

/* ==========================================================================
 * PROMPT CONSTRUCTION
 * ======================================================================== */

/**
 * Builds the topic-aware instruction block.
 * The key instruction is the completeness rule: better to return four whole
 * topics than eight truncated ones.
 */
export function buildChunkedPrompt({ topics, done = [], continuationSummary = "" }) {
  const remaining = topics.filter((t) => !done.includes(t.key));
  const doneList = topics.filter((t) => done.includes(t.key));

  let p = "\n\n--- SECTIONED GENERATION ---\n";
  p += "Produce the sections listed under STILL TO GENERATE below.\n\n";
  p += "COMPLETENESS RULE - THIS OVERRIDES LENGTH:\n";
  p += "Only include a section if you can finish it completely within your output budget.\n";
  p += "It is far better to return FOUR complete sections than EIGHT that stop mid-sentence.\n";
  p += "Never truncate a section to fit more in. If you cannot finish a section, omit it\n";
  p += "entirely and list its key under 'remaining'.\n\n";

  if (doneList.length) {
    p += "ALREADY GENERATED - do not repeat these:\n";
    doneList.forEach((t) => { p += `  - ${t.key}: ${t.label}\n`; });
    p += "\n";
  }
  if (continuationSummary) {
    p += "SUMMARY OF WHAT WAS ALREADY WRITTEN (for continuity of tone and to avoid\n";
    p += "contradicting yourself - do not repeat this content):\n" + continuationSummary + "\n\n";
  }

  p += "STILL TO GENERATE:\n";
  remaining.forEach((t) => { p += `  - ${t.key}: ${t.label}\n`; });

  p += "\nRESPOND WITH ONLY THIS JSON, no markdown fences:\n";
  p += '{\n';
  p += '  "sections": { "<topic key>": "<the full section text>" },\n';
  p += '  "completed": ["<keys you FINISHED>"],\n';
  p += '  "remaining": ["<keys you did NOT attempt>"],\n';
  p += '  "continuation_summary": "<2-3 sentences summarising what you wrote, so a\n';
  p += '     later call can continue coherently without repeating it>"\n';
  p += '}\n';
  p += "\nOPTIONAL - only when live web research returned something material that the\n";
  p += "sections above do not already cover (a local code requirement, a published\n";
  p += "site-specific constraint), you may also return:\n";
  p += '  "extra_findings": [{ "title": "", "text": "", "items": [] }]\n';
  p += "Rules for it: each entry must be additive, not a restatement; it must come from\n";
  p += "a source you actually retrieved and can cite; and it must NOT duplicate or\n";
  p += "replace any section listed above. Omit the field entirely if you have nothing\n";
  p += "retrieved to add - an empty or speculative entry is worse than none.\n";
  p += "\nPut 'completed', 'remaining' and 'continuation_summary' FIRST in the JSON object.\n";
  p += "If output is cut short, those fields must already have been emitted - they are\n";
  p += "what makes resuming possible.\n";
  return p;
}

/* ==========================================================================
 * MERGING  -  where the invariants are enforced
 * ======================================================================== */

export function emptyState(topics) {
  return {
    sections: {},
    done: [],
    remaining: topics.map((t) => t.key),
    continuationSummary: "",
    calls: 0,
  };
}

/**
 * Merges one model reply into accumulated state.
 * Enforces I2, I3 and I4.
 */
export function mergeChunk(state, reply, topics) {
  const next = {
    sections: { ...state.sections },
    done: [...state.done],
    remaining: [...state.remaining],
    continuationSummary: state.continuationSummary,
    calls: state.calls + 1,
  };
  if (!reply || typeof reply !== "object") return next;

  const incoming = reply.sections && typeof reply.sections === "object" ? reply.sections : {};
  const validKeys = new Set(topics.map((t) => t.key));

  Object.keys(incoming).forEach((k) => {
    if (!validKeys.has(k)) return;                       // ignore invented keys
    const text = typeof incoming[k] === "string" ? incoming[k].trim() : "";
    if (!text) return;                                   // I3: never store empty
    const existing = (next.sections[k] || "").trim();
    // I3: a continuation must not degrade content already held.
    if (existing && text.length < existing.length) return;
    next.sections[k] = text;
    if (!next.done.includes(k)) next.done.push(k);
  });

  // Trust our own record of what exists over the model's self-report: a model
  // can claim completion for a section it did not actually return.
  next.done = topics.map((t) => t.key).filter((k) => (next.sections[k] || "").trim().length > 0);
  next.remaining = topics.map((t) => t.key).filter((k) => !next.done.includes(k));

  if (typeof reply.continuation_summary === "string" && reply.continuation_summary.trim()) {
    next.continuationSummary = reply.continuation_summary.trim();
  }
  return next;
}

/**
 * I4: assemble in declared topic order, never generation order.
 *
 * NOT on the live path in this app, and that is fine: every tool reads the
 * merged sections BY KEY (insight.conclusion, insight.zone_recommendations),
 * never by iterating the object - so display order cannot depend on the order
 * the model happened to produce them in. I4 holds by construction.
 *
 * Kept for any consumer that DOES need to iterate sections in a fixed order,
 * such as rendering an arbitrary topic list without knowing the keys ahead of
 * time. If a tool ever starts iterating, use this rather than Object.keys().
 */
export function assembleSections(state, topics) {
  return topics
    .filter((t) => (state.sections[t.key] || "").trim())
    .map((t) => ({ key: t.key, label: t.label, text: state.sections[t.key].trim() }));
}

export function isComplete(state, topics) {
  return topics.every((t) => (state.sections[t.key] || "").trim().length > 0);
}

export function progressLabel(state, topics) {
  const total = topics.length;
  const doneCount = topics.filter((t) => (state.sections[t.key] || "").trim()).length;
  return {
    doneCount, total,
    complete: doneCount === total,
    doneLabels: topics.filter((t) => (state.sections[t.key] || "").trim()).map((t) => t.label),
    remainingLabels: topics.filter((t) => !(state.sections[t.key] || "").trim()).map((t) => t.label),
    text: doneCount === total
      ? `All ${total} sections generated.`
      : `${doneCount} of ${total} sections generated.`,
  };
}

/* ==========================================================================
 * PERSISTENCE  -  I5
 * ======================================================================== */

export function savePartial(toolCode, state) {
  try {
    localStorage.setItem(PARTIAL_PREFIX + toolCode, JSON.stringify({ ...state, at: Date.now() }));
  } catch { /* never fail a run over persistence */ }
  return state;
}

export function loadPartial(toolCode, topics) {
  try {
    const raw = localStorage.getItem(PARTIAL_PREFIX + toolCode);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object" || !p.sections) return null;
    // Re-derive done/remaining from actual content rather than trusting the
    // stored lists, which may predate a change to the topic set.
    const done = topics.map((t) => t.key).filter((k) => (p.sections[k] || "").trim());
    return {
      sections: p.sections,
      done,
      remaining: topics.map((t) => t.key).filter((k) => !done.includes(k)),
      continuationSummary: typeof p.continuationSummary === "string" ? p.continuationSummary : "",
      calls: Number(p.calls) || 0,
    };
  } catch {
    return null;
  }
}

export function clearPartial(toolCode) {
  try { localStorage.removeItem(PARTIAL_PREFIX + toolCode); } catch { /* ignore */ }
}

export default {
  buildChunkedPrompt, emptyState, mergeChunk, assembleSections,
  isComplete, progressLabel, savePartial, loadPartial, clearPartial,
};
