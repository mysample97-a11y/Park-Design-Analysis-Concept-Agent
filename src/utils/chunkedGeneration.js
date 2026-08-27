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

  /*
   * ADDITIVE, NOT REPLACEMENT — this is the critical part.
   *
   * The first version told the model to answer with a DIFFERENT schema
   * ({"sections": {...}, "completed": [...]}) from the one the tool's own prompt
   * had just specified. Two contracts in one prompt, and the model resolved the
   * conflict by emitting only the control fields:
   *
   *     {"completed":["zone_recommendations", ...],"remaining":[]}
   *
   * No sections, 100 output tokens, an empty report - across every tool. The
   * merge then correctly rejected the false completion claim, so the run looked
   * like it had produced nothing, because it had.
   *
   * So: KEEP the tool's schema exactly as specified, and add two optional
   * top-level keys alongside it. The model returns the object it was already
   * going to return, simply omitting keys it could not finish.
   */
  p += "\nHOW TO RETURN THIS\n";
  p += "Use EXACTLY the JSON shape the instructions above specify - the same keys,\n";
  p += "the same types. Do not wrap it in a 'sections' object and do not invent a\n";
  p += "different structure.\n\n";
  p += "Two changes only:\n";
  p += "  1. OMIT any key you could not finish completely. A missing key is the\n";
  p += "     signal that it still needs generating - never emit a key with a\n";
  p += "     placeholder, an empty string or a truncated value.\n";
  p += "  2. Add these two extra top-level keys so the run can be resumed:\n";
  p += '       "_remaining": ["<keys you did NOT complete>"],\n';
  p += '       "_summary": "<2-3 sentences on what you wrote, so a later call can\n';
  p += '                    continue without repeating it>"\n';
  p += "\nDo not add a '_completed' key. Whether a section is done is determined by\n";
  p += "whether its content is actually present, not by a claim about it.\n";

  p += "\nOPTIONAL - only when live web research returned something material the\n";
  p += "sections above do not cover (a local code requirement, a published\n";
  p += "site-specific constraint), you may also add:\n";
  p += '  "extra_findings": [{ "title": "", "text": "", "items": [] }]\n';
  p += "It must be additive, from a source you actually retrieved, and must not\n";
  p += "duplicate or replace any key above. Omit it entirely if you have nothing\n";
  p += "retrieved to add - a speculative entry is worse than none.\n";

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

  // The reply is the tool's own flat object. `sections` is still accepted for
  // any older saved partial, but the normal shape is now flat.
  const incoming = reply.sections && typeof reply.sections === "object" ? reply.sections : reply;
  const validKeys = new Set(topics.map((t) => t.key));

  /*
   * VALUES MAY BE ANY SHAPE - THIS IS LOAD-BEARING.
   *
   * An earlier version accepted only strings and silently dropped everything
   * else. Most sections in these tools are ARRAYS (zone_recommendations,
   * suggested_species, observations...). So on the FIRST call those arrays were
   * discarded, and on the SECOND call `setInsight({ ...parsed, ...merged })`
   * produced an object missing them entirely. The report renderer then called
   * .map() on undefined and the whole page went blank - which is exactly the
   * crash reported when pressing Generate a second time to continue.
   *
   * Size is therefore measured by CONTENT VOLUME, not string length, so the
   * "never replace something bigger with something smaller" rule still holds
   * for arrays and objects.
   */
  const volume = (v) => {
    if (v == null) return 0;
    if (typeof v === "string") return v.trim().length;
    if (Array.isArray(v)) return v.length ? JSON.stringify(v).length : 0;
    if (typeof v === "object") return Object.keys(v).length ? JSON.stringify(v).length : 0;
    return String(v).length;
  };

  Object.keys(incoming).forEach((k) => {
    if (!validKeys.has(k)) return;                       // ignore invented keys
    const value = typeof incoming[k] === "string" ? incoming[k].trim() : incoming[k];
    const vol = volume(value);
    if (!vol) return;                                    // I3: never store empty
    // I3: a continuation must not degrade content already held.
    if (volume(next.sections[k]) > vol) return;
    next.sections[k] = value;
    if (!next.done.includes(k)) next.done.push(k);
  });

  // Trust our own record of what exists over the model's self-report: a model
  // can claim completion for a section it did not actually return.
  next.done = topics.map((t) => t.key).filter((k) => volume(next.sections[k]) > 0);
  next.remaining = topics.map((t) => t.key).filter((k) => !next.done.includes(k));

  const summary = reply._summary || reply.continuation_summary;
  if (typeof summary === "string" && summary.trim()) {
    next.continuationSummary = summary.trim();
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
  const has = (v) => v != null && (typeof v === "string" ? v.trim().length : (Array.isArray(v) ? v.length : (typeof v === "object" ? Object.keys(v).length : String(v).length)));
  return topics
    .filter((t) => has(state.sections[t.key]))
    .map((t) => ({ key: t.key, label: t.label, text: state.sections[t.key] }));
}

export function isComplete(state, topics) {
  const has = (v) => v != null && (typeof v === "string" ? v.trim().length : (Array.isArray(v) ? v.length : (typeof v === "object" ? Object.keys(v).length : 1)));
  return topics.every((t) => has(state.sections[t.key]));
}

export function progressLabel(state, topics) {
  const total = topics.length;
  const has = (v) => v != null && (typeof v === "string" ? v.trim().length : (Array.isArray(v) ? v.length : (typeof v === "object" ? Object.keys(v).length : 1)));
  const doneCount = topics.filter((t) => has(state.sections[t.key])).length;
  return {
    doneCount, total,
    complete: doneCount === total,
    doneLabels: topics.filter((t) => has(state.sections[t.key])).map((t) => t.label),
    remainingLabels: topics.filter((t) => !has(state.sections[t.key])).map((t) => t.label),
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
    const hasV = (v) => v != null && (typeof v === "string" ? v.trim().length : (Array.isArray(v) ? v.length : (typeof v === "object" ? Object.keys(v).length : 1)));
    const done = topics.map((t) => t.key).filter((k) => hasV(p.sections[k]));
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
