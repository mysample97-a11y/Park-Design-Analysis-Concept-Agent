// src/utils/ai.jsx - API Router (Claude + Gemini, browser BYOK)
// FIXES vs previous version:
//  1. callGemini now reads the SUCCESS body correctly (old code parsed the error-body variable -> always empty).
//  2. callClaude uses the CORRECT browser CORS header: "anthropic-dangerous-direct-browser-access" (old "dangerously-allow-browser" is ignored by Anthropic -> every call CORS-blocked).
//  3. callAI now reads `content` (what the analyzers actually send) AND `prompt`, and honors `maxTokens`, `useWebSearch`, and `pdfBase64`.

function resolveGeminiModel(modelName) {
  // Respect whatever the user typed in Settings. Only substitute a default
  // when nothing usable was provided. "gemini-flash-latest" tracks Google's
  // current free Flash model without needing a code change on rename.
  const fallback = "gemini-flash-latest";
  if (!modelName || typeof modelName !== "string") return fallback;
  const clean = modelName.trim().replace(/^models\//, "");
  return clean || fallback;
}

export function parseGeminiResponse(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (data.candidates && data.candidates[0]) {
    const parts = data.candidates[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("\n").trim();
  }
  return "";
}

export function parseClaudeResponse(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (data.content && Array.isArray(data.content)) {
    return data.content.filter((b) => b.type === "text").map((b) => b.text || "").join("\n").trim();
  }
  return "";
}

import { readProviderUsage, estimateTokens, recordRequest, recordRequestReason, readRateLimitHeaders, saveLiveLimits, getLimits, requestWindows } from "./tokenMeter";

/**
 * Reports token usage to the caller without changing any return contract.
 * If the provider reported nothing, an estimate is supplied and clearly
 * flagged, so the UI never presents a guess as a measurement.
 */
function emitUsage(onUsage, data, { content, systemInstruction, text, provider }) {
  // NOTE: the request itself is counted inside withRetry(), at the moment the
  // fetch is issued. Counting here as well would double-count every call.
  if (typeof onUsage !== "function") return;
  try {
    const reported = readProviderUsage(data && (data.usage || data.usageMetadata));
    if (reported) {
      onUsage({ ...reported, estimated: false });
    } else {
      onUsage({
        input: estimateTokens(systemInstruction) + estimateTokens(content),
        output: estimateTokens(text),
        estimated: true,
      });
    }
  } catch {
    /* accounting must never break a run */
  }
}


/* ---------------------------------------------------------------------------
 * TRANSIENT-FAILURE RETRY  (F18)
 *
 * 529 is Anthropic signalling server-side overload. It is NOT a rate limit and
 * NOT a quota problem - it means the API is temporarily unable to serve anyone,
 * regardless of your account. Previously this surfaced immediately as "the model
 * is currently experiencing high demand", which reads to a user like their key
 * or their input is at fault when neither is.
 *
 * Almost all of these clear within seconds, so a short backoff absorbs them
 * invisibly. Deliberately NOT retried:
 *   429  a real rate limit - retrying makes it worse and burns request quota,
 *        which on a 15 RPM free tier is the scarce resource
 *   4xx  the request itself is wrong; repeating it cannot help
 *
 * Jitter is applied so that concurrent calls do not resynchronise and arrive
 * together on the retry, which is how a thundering herd forms.
 * ------------------------------------------------------------------------- */
const RETRY_STATUSES = [529, 500, 502, 503, 504];
const MAX_ATTEMPTS = 3;

/*
 * PER-STATUS RETRY POLICY
 *
 * 503 from Gemini means the model has no capacity right now. It is not a
 * momentary blip, and hammering it does not improve the odds - it just spends
 * requests. Each attempt is counted by the provider, so three attempts turn one
 * click into three units of the scarcest resource on a free key, during exactly
 * the outage you are trying to survive.
 *
 * 503/529 therefore get ONE extra attempt after a long wait. 500/502/504 are
 * genuine transients and keep the shorter escalating backoff.
 */
const CAPACITY_STATUSES = [503, 529];

/*
 * REQUEST TIMEOUT AND CANCELLATION
 *
 * fetch() has NO default timeout. If a provider accepts a connection and then
 * never answers, the promise simply never settles - so the UI sits on
 * "Researching..." indefinitely with no error, no failure and no way out. That
 * is worse than an error, because nothing tells the user anything is wrong.
 *
 * Every request now carries:
 *   - a hard timeout, after which it aborts and reports honestly;
 *   - an external AbortSignal, so a Cancel button can stop it on demand.
 *
 * 90s is deliberately generous: a grounded request doing several web searches
 * legitimately takes 30-60s, and cutting off real work would be worse than
 * waiting.
 */
/*
 * TIMEOUTS
 *
 * 90s was too tight and was set from guesswork rather than measurement. Reports
 * of it firing on ordinary runs - with grounding OFF, on more than one tool -
 * say the models routinely need longer than that on a free tier, where requests
 * get the least priority.
 *
 * A timeout exists to distinguish "slow" from "dead", not to cap how long a
 * model may think. Set generously: 4 minutes for ordinary calls, 5 for grounded
 * research, which does search-then-read-then-generate and is always the slowest
 * thing here. If a request is still silent after that, it really is dead.
 */
export const REQUEST_TIMEOUT_MS = 240000;          // 4 minutes, ordinary calls
export const RESEARCH_TIMEOUT_MS = 300000;         // 5 minutes, grounded research

/** Merges our timeout with any caller-supplied cancel signal. */
/** Grounded research is the slowest call shape, so it gets the longer budget. */
function timeoutFor(opts = {}) {
  if (opts && opts.timeoutMs) return opts.timeoutMs;
  return opts && opts.useWebSearch ? RESEARCH_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

function makeSignal(externalSignal, ms = REQUEST_TIMEOUT_MS) {
  const ctrl = new AbortController();

  /*
   * ALREADY-ABORTED SIGNALS MUST THROW, NOT ABORT.
   *
   * If the caller's signal is already aborted, calling ctrl.abort() here fires
   * BEFORE fetch attaches its abort listener - so fetch never rejects and the
   * promise never settles. That is a spinner with no timeout behind it at all,
   * which is worse than the hang this function exists to prevent.
   *
   * Throwing synchronously puts the failure in the caller's catch immediately.
   */
  if (externalSignal && externalSignal.aborted) {
    const e = new Error("cancelled");
    e.name = "AbortError";
    throw e;
  }

  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), ms);
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => ctrl.abort(new Error("cancelled")), { once: true });
  }
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/** Turns an abort into a message that says WHICH kind of stop it was. */
export function abortMessage(err, externalSignal, usedMs) {
  // A user cancel is identified by the caller's signal; anything else that got
  // here is a timeout. Checking the message alone is unreliable because the
  // reason is not preserved consistently across browsers.
  const cancelled = !!(externalSignal && externalSignal.aborted);
  if (cancelled) return "Cancelled. Nothing already generated has been lost - press Continue to resume.";
  return `The request timed out after ${Math.round((usedMs || REQUEST_TIMEOUT_MS) / 1000)}s without a reply. ` +
         "The provider accepted the connection and then stopped responding - this is at their end, " +
         "not your key or your input. Nothing already generated has been lost.";
}
function policyFor(status) {
  /*
   * 503 IS NOT RETRIED AT ALL ANY MORE.
   *
   * Evidence from a real request log: every single 503 was followed by a retry
   * that also returned 503. Twelve logged requests, six of them retries, zero
   * recoveries. On a 20-per-minute free tier that is half the budget spent on
   * attempts that cannot succeed - and the exhausted budget then produces the
   * "usage limit" message on top of the original refusal.
   *
   * A capacity refusal means the model has nothing spare right now. Waiting a
   * minute helps; asking again immediately does not. Failing fast leaves the
   * user their quota and lets them choose when to try again.
   */
  return CAPACITY_STATUSES.includes(status)
    ? { maxAttempts: 1, baseDelay: 0 }
    : { maxAttempts: MAX_ATTEMPTS, baseDelay: 1000 };
}

/**
 * How many attempts are safe given what is left in the request budget.
 *
 * Retrying is only free when REQUESTS are plentiful. On a Gemini free key the
 * binding limit is requests per minute (the observed 429 reported "limit: 20"),
 * so three attempts per click turns one action into three units of the scarcest
 * resource. That is how a handful of clicks produced twenty logged requests and
 * a quota exhaustion.
 */
function attemptsAllowed(provider) {
  try {
    const lim = getLimits(provider);
    const win = requestWindows(provider);
    if (!lim.rpm) return MAX_ATTEMPTS;
    const headroom = lim.rpm - win.lastMinute;
    if (headroom <= 1) return 1;              // no budget to spend on retries
    if (headroom <= 4) return 2;
    return MAX_ATTEMPTS;
  } catch {
    return MAX_ATTEMPTS;
  }
}

/**
 * Providers say how long to wait. Gemini embeds it in the message
 * ("Please retry in 35.863033314s"); both may send a Retry-After header.
 * Honouring it beats guessing with exponential backoff.
 */
export function retryAfterSeconds(response, bodyText) {
  try {
    const h = response?.headers?.get?.("retry-after");
    if (h && Number.isFinite(Number(h))) return Math.ceil(Number(h));
    const m = String(bodyText || "").match(/retry in ([\d.]+)s/i);
    if (m) return Math.ceil(Number(m[1]));
  } catch { /* ignore */ }
  return null;
}

function backoffDelay(attempt) {
  const base = 1000 * Math.pow(2, attempt);      // 1s, 2s, 4s
  return Math.round(base + Math.random() * 400); // jitter
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));



/**
 * Wraps a fetch-returning thunk with backoff on transient server failures.
 * The thunk must return the Response; it is re-invoked from scratch each
 * attempt so no body stream is reused.
 */
export async function withRetry(makeRequest, onAttempt, provider) {
  let last = null;
  const budgetCap = attemptsAllowed(provider);
  let maxAttempts = budgetCap;
  let baseDelay = 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Every attempt is a real HTTP request and the provider counts it against
    // the rate limit whether it succeeds or not. Count it here, before we know
    // the outcome, or the meter under-reports precisely when it matters.
    try {
      recordRequest(provider);
      // Record WHY, so the rail can explain a jump of two or three per click
      // instead of leaving it looking like a miscount.
      recordRequestReason(provider, attempt === 0 ? "first attempt" : `retry after HTTP ${last && last.status}`);
    } catch { /* accounting must not break a run */ }
    const response = await makeRequest();
    if (response.ok || !RETRY_STATUSES.includes(response.status)) return response;
    last = response;
    // Narrow the policy once we know WHY it failed. Capacity refusals get one
    // slow retry; the request budget still caps it.
    const pol = policyFor(response.status);
    maxAttempts = Math.min(budgetCap, pol.maxAttempts);
    baseDelay = pol.baseDelay;
    if (attempt < maxAttempts - 1) {
      // Honour the provider's own figure when it gives one - Gemini embeds it in
      // the message ("Please retry in 35.86s") and both providers may send a
      // Retry-After header. Guessing when we have been told is strictly worse.
      // Read the body as TEXT from a clone, so the caller's json() still works.
      let advised = null;
      try {
        const peek = await response.clone().text();
        advised = retryAfterSeconds(response, peek);
      } catch { advised = retryAfterSeconds(response, ""); }
      const wait = advised != null
        ? Math.min(advised * 1000, 60000)          // cap: never stall a UI past a minute
        : Math.round(baseDelay * Math.pow(2, attempt) + Math.random() * 400);
      if (typeof onAttempt === "function") {
        onAttempt({ attempt: attempt + 1, of: maxAttempts, status: response.status, waitMs: wait });
      }
      await sleep(wait);
    }
  }
  return last;
}

/** Human-readable explanation for a transient status. */
/** Prefixes a provider error so it can never be mistaken for the other one. */
export function attributeError(provider, message, model) {
  const name = String(provider).toLowerCase().includes("gemini") ? "Google Gemini" : "Anthropic Claude";
  const tag = model ? `${name} (${model})` : name;
  const text = String(message || "").trim() || "returned an error with no message.";
  return `${tag}: ${text}`;
}

export function transientMessage(status) {
  if (status === 503 || status === 529) {
    return `The model has no spare capacity right now (HTTP ${status}). This is at the provider's ` +
           "end - it is not your key and not your remaining allowance, and NOT something a " +
           "continuation can fix: " +
           "the model refused before generating anything.\n\n" +
           "What actually helps:\n" +
           "1. Switch to a PINNED model in Settings. An alias such as 'gemini-flash-latest' can " +
           "resolve to preview capacity, and a SUPERSEDED id gets whatever capacity is left " +
           "over - both are common 503 sources. 'gemini-3.6-flash' is the current free-tier " +
           "workhorse; 'gemini-3.5-flash' was replaced by it in July 2026.\n" +
           "2. Wait a minute or two. Retrying immediately spends a request without improving the odds - " +
           "every attempt counts against your per-minute limit.\n" +
           "3. Try a Claude key if you have one; the two providers do not share capacity.";
  }
  if (status >= 500) {
    return `The AI provider returned a server error (HTTP ${status}) and did not recover after retries. ` +
           "This is not caused by your key or your input.";
  }
  return "";
}

// ---------- Gemini ----------
export async function callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, onSources, onUsage, onRetry, abortSignal, timeoutMs }) {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey) throw new Error("Gemini API key is missing. Please enter your API key in Settings.");

  const activeModel = resolveGeminiModel(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent`;

  const parts = [];
  if (imageData) {
    let base64String = imageData, mimeType = "image/jpeg";
    if (imageData.includes("data:")) {
      const split = imageData.split(",");
      mimeType = split[0].match(/:(.*?);/)?.[1] || "image/jpeg";
      base64String = split[1] || imageData;
    }
    parts.push({ inlineData: { mimeType, data: base64String } });
  }
  // As in callClaude: `content` may be an array of Anthropic-style content blocks
  // (how the analyzers send uploaded images). Gemini uses a different shape, so
  // translate rather than stringify - stringifying sends base64 as text and the
  // model sees no image.
  if (Array.isArray(content)) {
    content.forEach((b) => {
      if (!b || typeof b !== "object") return;
      if (b.type === "image" && b.source?.data) {
        parts.push({ inlineData: { mimeType: b.source.media_type || "image/png", data: b.source.data } });
      } else if (b.type === "text" && b.text) {
        parts.push({ text: b.text });
      }
    });
  } else {
    parts.push({ text: typeof content === "string" ? content : JSON.stringify(content) });
  }

  const payload = { contents: [{ role: "user", parts }] };
  if (maxTokens) payload.generationConfig = { maxOutputTokens: maxTokens };
  if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  // Grounding with Google Search - gives Gemini live web access, so research-driven
  // tools work on a Gemini key rather than being Claude-only.
  // Google Search grounding is effectively a paid-tier feature. On the free tier a grounded
  // request is charged against generate_content_free_tier_requests (about 20/day, 5 RPM)
  // rather than the search-grounding quota - so enabling it by default makes a fresh key
  // fail almost immediately. It is therefore OPT-IN via Settings.
  const groundingOn = useWebSearch && (() => {
    try { return localStorage.getItem("site_analysis_gemini_grounding") === "1"; }
    catch { return false; }
  })();
  if (groundingOn) payload.tools = [{ google_search: {} }];

  // A Response body can only be read ONCE. send() therefore performs the fetch
  // AND parses, returning both; withRetry must operate on the raw fetch so that
  // each attempt gets a fresh, unread body. Reading json() after a retried
  // response would throw "body stream already read".
  async function sendRaw(body) {
    const { signal, done } = makeSignal(abortSignal, timeoutMs || timeoutFor({ useWebSearch }));
    try {
      return await fetch(url, {
        signal,
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cleanKey },
        body: JSON.stringify(body),
      });
    } finally { done(); }
  }

  async function send(body) {
    const r = await withRetry(() => sendRaw(body), onRetry, "gemini");
    return { r, data: await r.json().catch(() => ({})) };
  }

  let { r: response, data } = await send(payload);

  // Not every model or key supports grounding. Fall back rather than failing the whole run.
  if (!response.ok && groundingOn) {
    const msg = (data?.error?.message || "").toLowerCase();
    const quotaish = response.status === 429 || msg.includes("quota") || msg.includes("exhausted") || msg.includes("rate");
    if (quotaish || msg.includes("tool") || msg.includes("google_search") || msg.includes("not supported") || response.status === 400) {
      const { tools, ...noTools } = payload;
      ({ r: response, data } = await send(noTools));
      if (response.ok && typeof onSources === "function") {
        onSources({ grounded: false, sources: [],
          note: quotaish
            ? "Google Search grounding was refused by your quota, so this ran without it. On the Gemini free tier a grounded request is charged against a very small daily allowance - the answer therefore comes from the model's training knowledge, not live sources."
            : "This model or key does not support Google Search grounding, so the answer comes from the model's training knowledge rather than live sources." });
      }
    }
  }

  if (!response.ok) {
    const transientG = transientMessage(response.status);
    if (transientG) throw new Error(attributeError("gemini", transientG, model));
    const errMsg = attributeError("gemini",
      data?.error?.message || `API error (HTTP ${response.status})`, model);
    if (response.status === 400 && errMsg.toLowerCase().includes("key")) {
      throw new Error("API key invalid. Please verify your Google AI Studio key in Settings.");
    }
    throw new Error(errMsg);
  }

  // Surface the real sources Google actually used, so reports can cite them.
  if (groundingOn && typeof onSources === "function") {
    const gm = data?.candidates?.[0]?.groundingMetadata;
    if (gm) {
      const sources = (gm.groundingChunks || [])
        .map((c) => ({ t: c?.web?.title || "", u: c?.web?.uri || "", o: "via Google Search" }))
        .filter((x) => x.u);
      onSources({ grounded: sources.length > 0, queries: gm.webSearchQueries || [], sources });
    }
  }

  const text = parseGeminiResponse(data);
  if (!text) throw new Error("Gemini returned an empty response. Try again.");
  emitUsage(onUsage, data, { content, systemInstruction, text, provider: "gemini" });
  return text;
}

// ---------- Claude ----------
export async function callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64, onSources, onUsage, onRetry, abortSignal, timeoutMs }) {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey) throw new Error("Claude API key is missing. Please enter your API key in Settings.");

  const url = "https://api.anthropic.com/v1/messages";
  const blocks = [];

  if (pdfBase64) {
    blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } });
  }
  if (imageData) {
    let base64String = imageData, mimeType = "image/jpeg";
    if (imageData.includes("data:")) {
      const split = imageData.split(",");
      mimeType = split[0].match(/:(.*?);/)?.[1] || "image/jpeg";
      base64String = split[1] || imageData;
    }
    blocks.push({ type: "image", source: { type: "base64", media_type: mimeType, data: base64String } });
  }
  // Callers may pass `content` either as a plain string, or as a ready-made array
  // of Anthropic content blocks (this is how the analyzers send uploaded images).
  // Stringifying that array would send the base64 payload as TEXT - the model
  // would receive no image at all, burn the token budget, and return nothing
  // useful. Pass an array straight through instead.
  if (Array.isArray(content)) {
    content.forEach((b) => { if (b && typeof b === "object") blocks.push(b); });
  } else {
    blocks.push({ type: "text", text: typeof content === "string" ? content : JSON.stringify(content) });
  }

  const payload = {
    model: model || "claude-sonnet-4-6",
    max_tokens: maxTokens || 2048,
    messages: [{ role: "user", content: blocks }],
  };
  if (systemInstruction) payload.system = systemInstruction;
  if (useWebSearch) payload.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const response = await withRetry(async () => {
    const { signal, done } = makeSignal(abortSignal, timeoutMs || timeoutFor({ useWebSearch }));
    try {
      return await fetch(url, {
        signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cleanKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(payload),
      });
    } finally { done(); }
  }, onRetry, "claude");

  // F8: read live quota off the response headers before touching the body.
  // Returns null when CORS has not exposed them, in which case the meter
  // silently falls back to declared limits rather than showing blanks.
  try { saveLiveLimits("claude", readRateLimitHeaders(response)); } catch { /* non-fatal */ }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const transient = transientMessage(response.status);
    if (transient) throw new Error(attributeError("claude", transient, model));
    throw new Error(attributeError("claude",
      data?.error?.message || `API error (HTTP ${response.status})`, model));
  }
  if (useWebSearch && typeof onSources === "function") {
    const sources = [];
    (data.content || []).forEach((b) => {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        b.content.forEach((r) => { if (r?.url) sources.push({ t: r.title || "", u: r.url, o: "via web search" }); });
      }
    });
    onSources({ grounded: sources.length > 0, sources });
  }
  const text = parseClaudeResponse(data);
  if (!text) throw new Error("The AI returned no analyzable text (it may have only performed search steps). Try again.");
  emitUsage(onUsage, data, { content, systemInstruction, text, provider: "claude" });
  return text;
}

// ---------- Universal wrapper ----------
// Accepts a single options object. Reads BOTH `content` and `prompt` so it works
// with every analyzer regardless of which field name they used.
// Reads the user-chosen model from localStorage as a fallback, so every tool
// honors the Settings model field even without passing `model` explicitly.
function storedModel(provider) {
  try {
    if (provider.includes("claude") || provider.includes("anthropic")) {
      return localStorage.getItem("site_analysis_claude_model") || "";
    }
    return localStorage.getItem("site_analysis_gemini_model") || "";
  } catch {
    return "";
  }
}

export async function callAI(opts = {}) {
  // Wrap the whole call so an abort surfaces as a clear message rather than the
  // browser's bare "The operation was aborted" - which tells the user nothing.
  try {
    return await callAIInner(opts);
  } catch (e) {
    // Must also match "timeout" and "cancelled": makeSignal aborts with those
    // reasons, and some browsers surface the REASON rather than an AbortError.
    // Without them the user saw a bare "timeout" with no explanation - which is
    // exactly the unhelpful message reported.
    const m = String((e && e.message) || "");
    if (e && (e.name === "AbortError" || /abort|timeout|cancell?ed/i.test(m))) {
      throw new Error(abortMessage(e, opts.abortSignal, timeoutFor(opts)));
    }
    throw e;
  }
}

async function callAIInner(opts = {}) {
  const provider = String(opts.provider || opts.apiProvider || "gemini").toLowerCase();
  const apiKey = opts.apiKey || opts.key || "";
  const content = opts.content || opts.prompt || opts.userPrompt || "";
  const systemInstruction = opts.systemInstruction || opts.systemPrompt || opts.system || "";
  const model = opts.model || storedModel(provider) || "";
  const maxTokens = opts.maxTokens || opts.max_tokens || 2048;
  const imageData = opts.imageData || opts.image || opts.fileData || null;
  const useWebSearch = opts.useWebSearch || false;
  const pdfBase64 = opts.pdfBase64 || null;
  const onSources = opts.onSources || null;
  const onUsage = opts.onUsage || null;
  const onRetry = opts.onRetry || null;
  const signal = opts.signal || null;
  const timeoutMs = timeoutFor(opts);
  const abortSignal = opts.abortSignal || null;

  if (provider.includes("claude") || provider.includes("anthropic")) {
    return await callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64, onSources, onUsage, onRetry, abortSignal });
  }
  return await callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, onSources, onUsage, onRetry, abortSignal });
}

export default callAI;
