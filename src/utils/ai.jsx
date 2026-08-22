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

import { readProviderUsage, estimateTokens, recordRequest, readRateLimitHeaders, saveLiveLimits } from "./tokenMeter";

/**
 * Reports token usage to the caller without changing any return contract.
 * If the provider reported nothing, an estimate is supplied and clearly
 * flagged, so the UI never presents a guess as a measurement.
 */
function emitUsage(onUsage, data, { content, systemInstruction, text, provider }) {
  // Request counting is GLOBAL and unconditional - rate limits are enforced per
  // key, not per tool, and they apply whether or not a tool passes onUsage.
  try { recordRequest(provider); } catch { /* accounting must never break a run */ }
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
export async function withRetry(makeRequest, onAttempt) {
  let last = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await makeRequest();
    if (response.ok || !RETRY_STATUSES.includes(response.status)) return response;
    last = response;
    if (attempt < MAX_ATTEMPTS - 1) {
      const wait = backoffDelay(attempt);
      if (typeof onAttempt === "function") {
        onAttempt({ attempt: attempt + 1, of: MAX_ATTEMPTS, status: response.status, waitMs: wait });
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
  if (status === 529) {
    return "The AI provider is temporarily overloaded (HTTP 529). This is a problem at their end, " +
           "not with your API key, your quota or your input. It was retried automatically and still " +
           "did not clear - waiting a minute and trying again usually works.";
  }
  if (status >= 500) {
    return `The AI provider returned a server error (HTTP ${status}) and did not recover after retries. ` +
           "This is not caused by your key or your input.";
  }
  return "";
}

// ---------- Gemini ----------
export async function callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, onSources, onUsage, onRetry }) {
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
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cleanKey },
      body: JSON.stringify(body),
    });
  }

  async function send(body) {
    const r = await withRetry(() => sendRaw(body), onRetry);
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
export async function callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64, onSources, onUsage, onRetry }) {
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

  const response = await withRetry(() => fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cleanKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(payload),
  }), onRetry);

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

  if (provider.includes("claude") || provider.includes("anthropic")) {
    return await callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64, onSources, onUsage, onRetry });
  }
  return await callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, onSources, onUsage, onRetry });
}

export default callAI;
