// src/utils/ai.jsx - API Router (Claude + Gemini, browser BYOK)

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
export async function callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData }) {
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

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": cleanKey },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errMsg = data?.error?.message || `Gemini API Error (${response.status})`;
    if (response.status === 400 && errMsg.toLowerCase().includes("key")) {
      throw new Error("API key invalid. Please verify your Google AI Studio key in Settings.");
    }
    throw new Error(errMsg);
  }
  const text = parseGeminiResponse(data);
  if (!text) throw new Error("Gemini returned an empty response. Try again.");
  return text;
}

// ---------- Claude ----------
export async function callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64 }) {
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
  const text = parseClaudeResponse(data);
  if (!text) throw new Error("The AI returned no analyzable text (it may have only performed search steps). Try again.");
  return text;
}

// ---------- Universal wrapper ----------
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

  if (provider.includes("claude") || provider.includes("anthropic")) {
    return await callClaude({ apiKey, content, systemInstruction, model, maxTokens, imageData, useWebSearch, pdfBase64 });
  }
  return await callGemini({ apiKey, content, systemInstruction, model, maxTokens, imageData });
}

export default callAI;
