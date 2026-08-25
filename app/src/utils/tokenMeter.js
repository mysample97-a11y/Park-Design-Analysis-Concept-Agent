// src/utils/tokenMeter.js
// ---------------------------------------------------------------------------
// TOKEN ACCOUNTING AND PRE-FLIGHT ESTIMATION
//
// Why this exists
// ---------------
// During the Al Safa 2 run the Budget Tracker repeatedly died mid-report
// because the account's token budget ran out partway through generation. There
// was no way to see it coming and no way to resume: the only workaround was to
// swap in another free-tier key and start the whole analysis again.
//
// Two things were missing, and this module supplies both:
//   1. VISIBILITY  - how many tokens has this tool consumed so far.
//   2. FORESIGHT   - roughly how many will the next run need.
//
// Everything here is deliberately provider-agnostic and side-effect free apart
// from localStorage. It does no network work of its own.
//
// HONEST LIMITATION - state this in the UI, do not hide it
// --------------------------------------------------------
// Pre-flight numbers are ESTIMATES. Real tokenisation is model-specific (BPE
// for Claude, SentencePiece for Gemini) and cannot be computed in the browser
// without shipping the tokeniser. The heuristic below is calibrated against
// English prose and is typically within about 10-15%. It is a planning aid,
// never a guarantee. Actual usage returned by the provider is always recorded
// in preference to the estimate.
// ---------------------------------------------------------------------------

const STORE_PREFIX = "as2p_tokens_";

/* --------------------------------------------------------------------------
 * ESTIMATION
 * ------------------------------------------------------------------------ */

/**
 * Rough token count for a string.
 * ~4 characters per token for English prose is the widely used approximation.
 * JSON and code are denser (more punctuation, more token boundaries), so a
 * modest surcharge is applied when the text looks structured.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const structural = (s.match(/[{}\[\]":,]/g) || []).length;
  const density = structural / Math.max(s.length, 1) > 0.04 ? 3.2 : 4.0;
  return Math.ceil(s.length / density);
}

/**
 * Pre-flight estimate for a whole analysis run.
 *
 * @param {object} o
 * @param {string} o.systemText  system instruction
 * @param {string} o.userText    assembled user prompt including inputs
 * @param {number} o.maxTokens   the cap requested per call
 * @param {number} o.calls       how many API calls the run makes (default 1)
 * @returns {{input:number, output:number, total:number, calls:number}}
 */
export function estimateRun({ systemText = "", userText = "", maxTokens = 2048, calls = 1 } = {}) {
  const input = estimateTokens(systemText) + estimateTokens(userText);
  // Output rarely reaches the cap. Empirically ~70% is a fair planning figure,
  // and over-estimating here is the safer error: it warns earlier.
  const output = Math.ceil(maxTokens * 0.7);
  return {
    input: input * calls,
    output: output * calls,
    total: (input + output) * calls,
    calls,
  };
}

/* --------------------------------------------------------------------------
 * ACCOUNTING
 * ------------------------------------------------------------------------ */

function readStore(toolCode) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + toolCode);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return p;
  } catch {
    return null;
  }
}

const EMPTY = { input: 0, output: 0, total: 0, calls: 0, lastRun: null, estimated: false };

/** Cumulative usage recorded for a tool. Never throws. */
export function getUsage(toolCode) {
  return readStore(toolCode) || { ...EMPTY };
}

/**
 * Record one API call's usage.
 * `estimated` marks the figure as heuristic rather than provider-reported, so
 * the UI can say which it is showing rather than implying false precision.
 */
export function recordUsage(toolCode, { input = 0, output = 0, estimated = false } = {}) {
  const cur = getUsage(toolCode);
  const next = {
    input: cur.input + (Number(input) || 0),
    output: cur.output + (Number(output) || 0),
    total: cur.total + (Number(input) || 0) + (Number(output) || 0),
    calls: cur.calls + 1,
    lastRun: new Date().toISOString(),
    // Sticky: once any figure in the total is an estimate, the total is.
    estimated: cur.estimated || !!estimated,
  };
  try {
    localStorage.setItem(STORE_PREFIX + toolCode, JSON.stringify(next));
  } catch {
    /* quota or private mode - accounting is not worth failing a run over */
  }
  return next;
}

/** Clears the counter for one tool. */
export function resetUsage(toolCode) {
  try {
    localStorage.removeItem(STORE_PREFIX + toolCode);
  } catch {
    /* ignore */
  }
  return { ...EMPTY };
}

/**
 * Normalises the provider's own usage object into {input, output}.
 * Returns null when the provider reported nothing, so the caller can fall back
 * to an estimate and label it as such.
 */
export function readProviderUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  // Anthropic: { input_tokens, output_tokens }
  if (typeof raw.input_tokens === "number" || typeof raw.output_tokens === "number") {
    return {
      input: Number(raw.input_tokens) || 0,
      output: Number(raw.output_tokens) || 0,
    };
  }
  // Gemini: { promptTokenCount, candidatesTokenCount, totalTokenCount }
  if (typeof raw.promptTokenCount === "number" || typeof raw.candidatesTokenCount === "number") {
    return {
      input: Number(raw.promptTokenCount) || 0,
      output: Number(raw.candidatesTokenCount) || 0,
    };
  }
  return null;
}

/* --------------------------------------------------------------------------
 * PRESENTATION HELPERS
 * ------------------------------------------------------------------------ */

export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return (v / 1000000).toFixed(2) + "M";
  if (v >= 1000) return (v / 1000).toFixed(1) + "k";
  return String(v);
}

/**
 * Advisory only. Free tiers publish rate limits rather than a lifetime budget,
 * and those limits change, so this is a planning reference and is labelled as
 * such in the UI. It is NOT read from the provider.
 */
export const TIER_REFERENCE = {
  claude: { label: "Anthropic", note: "Free tier is rate-limited per minute and per day; paid keys bill per token." },
  gemini: { label: "Google", note: "Free tier is rate-limited per minute and per day; quota resets daily." },
};

/**
 * SUPERSEDED by capacityCheck(), which the rails use.
 *
 * This judged a run on token volume alone. capacityCheck() checks REQUESTS
 * first, which is the dimension that actually throttles this app - a token-only
 * verdict showed comfortable headroom right up to the moment the user was
 * rate-limited. Kept only as the fallback for a caller with no declared limits.
 *
 * Turns an estimate plus recorded usage into a short human verdict.
 * Deliberately qualitative: a precise percentage would imply a precision that
 * neither the estimate nor the tier information supports.
 */
export function runOutlook(estimateTotal, usage) {
  const est = Number(estimateTotal) || 0;
  if (!est) return { level: "unknown", message: "Enter inputs to see an estimate." };
  if (est > 100000) {
    return {
      level: "high",
      message: "Large run. If this is a free-tier key it will likely stop partway. Generate in stages.",
    };
  }
  if (est > 30000) {
    return {
      level: "medium",
      message: "Moderate run. A free-tier key may need more than one continuation.",
    };
  }
  return { level: "low", message: "Should complete in a single pass on most keys." };
}

export default {
  estimateTokens,
  estimateRun,
  getUsage,
  recordUsage,
  resetUsage,
  readProviderUsage,
  formatTokens,
  runOutlook,
  TIER_REFERENCE,
};

/* ===========================================================================
 * REQUEST-WINDOW ACCOUNTING  (F10)
 *
 * Why this was added after the fact
 * --------------------------------
 * The first version of this module counted tokens only. That was the wrong
 * measurement. Gemini's free tier allows 250,000-1,000,000 tokens per minute
 * but only ~20 requests per minute and ~200 per day on the model observed here (the figure is
 * per-model and Google revises it); Anthropic likewise
 * enforces RPM alongside ITPM/OTPM. A run that dies partway is therefore far
 * more likely to have exhausted REQUESTS than tokens - so a token-only meter
 * shows comfortable headroom right up to the moment the user is throttled.
 *
 * Windows are rolling, not calendar-aligned, which matches how providers
 * actually enforce them (token-bucket / rolling window rather than a reset on
 * the minute).
 * ========================================================================= */

const REQ_KEY_BASE = "as2p_requests_v1";

/**
 * Rate limits are enforced per PROVIDER ACCOUNT, so the counter must be keyed by
 * provider. The first version used one global bucket, which meant a Gemini call
 * incremented the Anthropic panel as well - the counts were real but attributed
 * to the wrong account, which is worse than not showing them.
 */
function reqKey(provider) {
  const p = String(provider || "claude").toLowerCase().includes("gemini") ? "gemini" : "claude";
  return REQ_KEY_BASE + "_" + p;
}
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

function readReq(provider) {
  try {
    const raw = localStorage.getItem(reqKey(provider));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((t) => typeof t === "number") : [];
  } catch {
    return [];
  }
}

function writeReq(provider, list) {
  try {
    localStorage.setItem(reqKey(provider), JSON.stringify(list));
  } catch {
    /* never fail a run over accounting */
  }
}

/**
 * Records one API request against the rolling windows.
 * Request limits are per KEY, not per tool, so this counter is global across
 * the whole app - unlike token usage, which is reported per tool.
 */
export function recordRequest(provider, now = Date.now()) {
  const list = readReq(provider).filter((t) => now - t < DAY_MS);
  list.push(now);
  writeReq(provider, list);
  return requestWindows(provider, now, list);
}

/** Requests used in the trailing minute and trailing 24 hours. */
export function requestWindows(provider, now = Date.now(), preloaded = null) {
  const list = (preloaded || readReq(provider)).filter((t) => now - t < DAY_MS);
  return {
    lastMinute: list.filter((t) => now - t < MIN_MS).length,
    lastDay: list.length,
    // When the oldest request in the minute window ages out, capacity returns.
    nextMinuteSlotIn: (() => {
      const inMin = list.filter((t) => now - t < MIN_MS).sort((a, b) => a - b);
      if (!inMin.length) return 0;
      return Math.max(0, Math.ceil((MIN_MS - (now - inMin[0])) / 1000));
    })(),
  };
}

export function resetRequests(provider) {
  writeReq(provider, []);
  return { lastMinute: 0, lastDay: 0, nextMinuteSlotIn: 0 };
}

/* ===========================================================================
 * PUBLISHED TIER LIMITS  (F11)
 *
 * Seed values only. Provider limits change - Google cut free-tier quotas in
 * December 2025 and removed Pro models from the free tier in April 2026 - so
 * these are defaults the user can override, never assertions of fact. The UI
 * must state that they are user-declared and may be out of date.
 *
 * Figures below reflect published free-tier limits as researched 17 Aug 2026.
 * ========================================================================= */
export const PUBLISHED_LIMITS = {
  gemini: {
    free: { rpm: 20, rpd: 200, tpm: 250000,
            label: "Gemini free tier (per model)",
            caution: "Limits are PER MODEL and Google changes them without notice - a 429 from " +
                     "this account reported 'generate_content_free_tier_requests, limit: 20'. " +
                     "Check your own quota at ai.dev/rate-limit and edit these fields to match. " +
                     "Free-tier prompts may also be used by Google to improve their products." },
    paid: { rpm: 150, rpd: null, tpm: 1000000, label: "Gemini paid (Tier 1)" },
  },
  claude: {
    free: { rpm: 5, rpd: null, tpm: 20000,
            label: "Anthropic evaluation tier",
            caution: "New organisations start on reduced limits that rise automatically with usage history." },
    paid: { rpm: 50, rpd: null, tpm: 40000, label: "Anthropic Tier 1" },
  },
};

const LIMIT_KEY = "as2p_declared_limits_v1";

/** User-declared tier and limits. Falls back to published defaults. */
export function getLimits(provider = "claude") {
  const p = String(provider).toLowerCase().includes("gemini") ? "gemini" : "claude";
  let declared = null;
  try {
    const raw = localStorage.getItem(LIMIT_KEY);
    declared = raw ? JSON.parse(raw) : null;
  } catch {
    declared = null;
  }
  const forProvider = declared && declared[p] ? declared[p] : null;
  const tier = (forProvider && forProvider.tier) || "free";
  const base = (PUBLISHED_LIMITS[p] && PUBLISHED_LIMITS[p][tier]) || PUBLISHED_LIMITS[p].free;
  return {
    provider: p,
    tier,
    rpm: forProvider && forProvider.rpm != null ? Number(forProvider.rpm) : base.rpm,
    rpd: forProvider && forProvider.rpd != null ? Number(forProvider.rpd) : base.rpd,
    tpm: forProvider && forProvider.tpm != null ? Number(forProvider.tpm) : base.tpm,
    label: base.label,
    caution: base.caution || "",
    // true when the figures are our published defaults rather than the user's
    isDefault: !forProvider,
  };
}

export function saveLimits(provider, { tier, rpm, rpd, tpm } = {}) {
  const p = String(provider).toLowerCase().includes("gemini") ? "gemini" : "claude";
  let all = {};
  try {
    const raw = localStorage.getItem(LIMIT_KEY);
    all = raw ? JSON.parse(raw) || {} : {};
  } catch {
    all = {};
  }
  all[p] = {
    tier: tier || "free",
    rpm: rpm === "" || rpm == null ? null : Number(rpm),
    rpd: rpd === "" || rpd == null ? null : Number(rpd),
    tpm: tpm === "" || tpm == null ? null : Number(tpm),
  };
  try {
    localStorage.setItem(LIMIT_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  return getLimits(p);
}

/**
 * Combines declared limits with observed usage into a verdict.
 * Requests are checked FIRST because that is the dimension that actually
 * throttles this app's usage pattern.
 */
export function capacityCheck(provider, estimate, now = Date.now()) {
  const lim = getLimits(provider);
  const win = requestWindows(provider, now);
  const est = (estimate && estimate.total) || 0;
  const calls = (estimate && estimate.calls) || 1;

  if (lim.rpd && win.lastDay + calls > lim.rpd) {
    return { level: "high", dimension: "requests/day",
      message: `Daily request limit reached (${win.lastDay} of ${lim.rpd}). This resets on a rolling 24-hour window.` };
  }
  if (lim.rpm && win.lastMinute + calls > lim.rpm) {
    return { level: "high", dimension: "requests/minute",
      message: `Per-minute request limit reached (${win.lastMinute} of ${lim.rpm}). Capacity returns in about ${win.nextMinuteSlotIn}s.` };
  }
  if (lim.tpm && est > lim.tpm) {
    return { level: "high", dimension: "tokens/minute",
      message: `This run is estimated at ~${formatTokens(est)} tokens against a ${formatTokens(lim.tpm)}/min limit. Generate in stages.` };
  }
  if (lim.rpm && win.lastMinute + calls > lim.rpm * 0.7) {
    return { level: "medium", dimension: "requests/minute",
      message: `Approaching the per-minute request limit (${win.lastMinute} of ${lim.rpm}).` };
  }
  if (lim.tpm && est > lim.tpm * 0.6) {
    return { level: "medium", dimension: "tokens/minute",
      message: "Large run against the declared per-minute token limit. A continuation may be needed." };
  }
  return { level: "low", dimension: null, message: "Within declared limits." };
}

/* ===========================================================================
 * EXACT TOKEN COUNTING  (F9)  and  RATE-LIMIT HEADERS  (F8)
 *
 * The heuristic above (chars / 4) is a fallback, not the plan. Both providers
 * expose a free endpoint that returns the EXACT input token count for a given
 * prompt, and Anthropic additionally reports remaining quota on every response
 * as HTTP headers. Where those are available the meter stops estimating and
 * starts measuring.
 *
 * Tier order, most authoritative first:
 *   1  anthropic-ratelimit-* response headers   exact remaining, 0 extra calls
 *   2  count_tokens / countTokens endpoints     exact input, 1 cheap extra call
 *   3  user-declared limits (F11)               ceiling to measure against
 *   4  chars/4 heuristic                        always labelled as estimated
 * ========================================================================= */

/**
 * Reads Anthropic's rate-limit headers off a Response.
 *
 * IMPORTANT CAVEAT: browser JavaScript can only read a non-simple response
 * header if the server lists it in Access-Control-Expose-Headers. Whether
 * Anthropic does so for these headers cannot be determined from documentation,
 * only at runtime. This returns null when the headers are unreadable, and the
 * caller must degrade to a lower tier rather than showing blanks.
 */
export function readRateLimitHeaders(response) {
  if (!response || typeof response.headers?.get !== "function") return null;
  const g = (n) => {
    const v = response.headers.get(n);
    return v == null || v === "" ? null : v;
  };
  const num = (n) => {
    const v = g(n);
    if (v == null) return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const out = {
    inputRemaining: num("anthropic-ratelimit-input-tokens-remaining"),
    inputLimit: num("anthropic-ratelimit-input-tokens-limit"),
    outputRemaining: num("anthropic-ratelimit-output-tokens-remaining"),
    outputLimit: num("anthropic-ratelimit-output-tokens-limit"),
    tokensRemaining: num("anthropic-ratelimit-tokens-remaining"),
    tokensLimit: num("anthropic-ratelimit-tokens-limit"),
    requestsRemaining: num("anthropic-ratelimit-requests-remaining"),
    requestsLimit: num("anthropic-ratelimit-requests-limit"),
    resetsAt: g("anthropic-ratelimit-tokens-reset") || g("anthropic-ratelimit-requests-reset"),
    retryAfter: num("retry-after"),
  };
  const any = Object.keys(out).some((k) => out[k] !== null);
  return any ? out : null;   // null => CORS did not expose them
}

const LIVE_KEY = "as2p_live_limits_v1";

/** Persists the last observed live quota so the meter survives a reload. */
export function saveLiveLimits(provider, headers) {
  if (!headers) return null;
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify({
      provider, at: Date.now(), ...headers,
    }));
  } catch { /* ignore */ }
  return headers;
}

/** Last observed live quota, if recent enough to still be meaningful. */
export function getLiveLimits(maxAgeMs = 10 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    if (Date.now() - (p.at || 0) > maxAgeMs) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Exact input token count from the provider. Free on both.
 * Returns null on any failure so the caller falls back to the heuristic - this
 * must never block or fail a run, it is a planning aid.
 *
 * NOTE: this costs one REQUEST against RPM/RPD even though it costs no tokens.
 * On a 15 RPM free key that is not free in the dimension that actually binds,
 * so callers should only use it when the user asks for a precise figure, not
 * on every keystroke.
 */
export async function countTokensExact({ provider, apiKey, model, systemText, userText }) {
  const isClaude = String(provider).toLowerCase().includes("claude") ||
                   String(provider).toLowerCase().includes("anthropic");
  try {
    if (isClaude) {
      const r = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": (apiKey || "").trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: model || "claude-sonnet-4-6",
          system: systemText || undefined,
          messages: [{ role: "user", content: String(userText || "") }],
        }),
      });
      if (!r.ok) return null;
      const d = await r.json().catch(() => null);
      const n = d && (d.input_tokens ?? d.inputTokens);
      return Number.isFinite(n) ? { input: n, exact: true } : null;
    }
    const m = model || "gemini-2.5-flash";
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:countTokens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": (apiKey || "").trim() },
        body: JSON.stringify({
          contents: [{ parts: [{ text: String(systemText || "") + "\n" + String(userText || "") }] }],
        }),
      });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const n = d && d.totalTokens;
    return Number.isFinite(n) ? { input: n, exact: true } : null;
  } catch {
    return null;
  }
}
