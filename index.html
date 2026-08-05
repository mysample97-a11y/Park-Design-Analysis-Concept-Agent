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

// ---------- Gemini ----------
export async function callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, onSources }) {
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
  parts.push({ text: typeof content === "string" ? content : JSON.stringify(content) });

  const payload = { contents: [{ role: "user", parts }] };
  if (maxTokens) payload.generationConfig = { maxOutputTokens: maxTokens };
  if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  // Grounding with Google Search - gives Gemini live web access, so research-driven
  // tools work on a Gemini key rather than being Claude-only.
  if (useWebSearch) payload.tools = [{ google_search: {} }];

  async function send(body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cleanKey },
      body: JSON.stringify(body),
    });
    return { r, data: await r.json().catch(() => ({})) };
  }

  let { r: response, data } = await send(payload);

  // Not every model or key supports grounding. Fall back rather than failing the whole run.
  if (!response.ok && useWebSearch) {
    const msg = (data?.error?.message || "").toLowerCase();
    if (msg.includes("tool") || msg.includes("google_search") || msg.includes("not supported") || response.status === 400) {
      const { tools, ...noTools } = payload;
      ({ r: response, data } = await send(noTools));
      if (response.ok && typeof onSources === "function") {
        onSources({ grounded: false, note: "This model or key does not support Google Search grounding, so the answer comes from the model's training knowledge rather than live sources.", sources: [] });
      }
    }
  }

  if (!response.ok) {
    const errMsg = data?.error?.message || `Gemini API Error (${response.status})`;
    if (response.status === 400 && errMsg.toLowerCase().includes("key")) {
      throw new Error("API key invalid. Please verify your Google AI Studio key in Settings.");
    }
    throw new Error(errMsg);
  }

  // Surface the real sources Google actually used, so reports can cite them.
  if (useWebSearch && typeof onSources === "function") {
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
  return text;
}

// ---------- Claude ----------
export async function callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64, onSources }) {
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
  blocks.push({ type: "text", text: typeof content === "string" ? content : JSON.stringify(content) });

  const payload = {
    model: model || "claude-sonnet-4-6",
    max_tokens: maxTokens || 2048,
    messages: [{ role: "user", content: blocks }],
  };
  if (systemInstruction) payload.system = systemInstruction;
  if (useWebSearch) payload.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cleanKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Claude API Error (${response.status})`);
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

  if (provider.includes("claude") || provider.includes("anthropic")) {
    return await callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64, onSources });
  }
  return await callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, onSources });
}

export default callAI;
