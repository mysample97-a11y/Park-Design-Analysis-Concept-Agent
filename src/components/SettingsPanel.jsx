import { useState, useEffect } from "react";
import { Settings, KeyRound, Trash2, AlertTriangle, Eye, EyeOff, CheckCircle2, Info } from "lucide-react";

const STORAGE_KEYS = {
  claude: "site_analysis_claude_key",
  gemini: "site_analysis_gemini_key",
};

const MODEL_KEYS = {
  claude: "site_analysis_claude_model",
  gemini: "site_analysis_gemini_model",
};

const META_KEY = "site_analysis_project_meta";
const GROUND_KEY = "site_analysis_gemini_grounding";

const DEFAULT_META = {
  projectName: "",
  projectCode: "PRJ",
  siteDescription: "",
  author: "",
  status: "DRAFT",
};

// Sensible current defaults (editable in Settings if the provider renames them)
const DEFAULT_MODELS = {
  claude: "claude-sonnet-4-6",
  gemini: "gemini-flash-latest",
};

export function useApiKeys() {
  const [keys, setKeys] = useState({ claude: "", gemini: "" });
  const [models, setModels] = useState({ ...DEFAULT_MODELS });
  const [meta, setMeta] = useState({ ...DEFAULT_META });
  const [grounding, setGroundingState] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setKeys({
        claude: localStorage.getItem(STORAGE_KEYS.claude) || "",
        gemini: localStorage.getItem(STORAGE_KEYS.gemini) || "",
      });
      setModels({
        claude: localStorage.getItem(MODEL_KEYS.claude) || DEFAULT_MODELS.claude,
        gemini: localStorage.getItem(MODEL_KEYS.gemini) || DEFAULT_MODELS.gemini,
      });
      setGroundingState(localStorage.getItem(GROUND_KEY) === "1");
      const rawMeta = localStorage.getItem(META_KEY);
      if (rawMeta) setMeta({ ...DEFAULT_META, ...JSON.parse(rawMeta) });
    } catch {
      // localStorage blocked (private mode, etc.)
    }
    setLoaded(true);
  }, []);

  const saveKey = (provider, value) => {
    setKeys((prev) => ({ ...prev, [provider]: value }));
    try {
      if (value) localStorage.setItem(STORAGE_KEYS[provider], value);
      else localStorage.removeItem(STORAGE_KEYS[provider]);
    } catch {
      // ignore
    }
  };

  const saveModel = (provider, value) => {
    const v = value || DEFAULT_MODELS[provider];
    setModels((prev) => ({ ...prev, [provider]: v }));
    try {
      localStorage.setItem(MODEL_KEYS[provider], v);
    } catch {
      // ignore
    }
  };


  const saveGrounding = (on) => {
    setGroundingState(on);
    try { if (on) localStorage.setItem(GROUND_KEY, "1"); else localStorage.removeItem(GROUND_KEY); } catch { /* ignore */ }
  };

  const saveMeta = (patch) => {
    setMeta((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(META_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const clearAll = () => {
    setKeys({ claude: "", gemini: "" });
    setModels({ ...DEFAULT_MODELS });
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
      Object.values(MODEL_KEYS).forEach((k) => localStorage.removeItem(k));
      localStorage.removeItem(GROUND_KEY);
    } catch {
      // ignore
    }
  };

  const getActiveKey = (provider) => keys[provider] || "";
  const getActiveModel = (provider) => models[provider] || DEFAULT_MODELS[provider];

  return { keys, models, meta, grounding, loaded, saveKey, saveModel, saveMeta, saveGrounding, clearAll, getActiveKey, getActiveModel };
}

import { getLimits, saveLimits, PUBLISHED_LIMITS, requestWindows, resetRequests } from "../utils/tokenMeter";

/**
 * API TIER AND LIMITS  (F11)
 *
 * The token meter needs a ceiling to measure against. Anthropic returns exact
 * remaining quota in response headers, but Gemini does not, and neither exposes
 * a lifetime budget - so where the provider will not tell us, the user does.
 *
 * The published figures below are SEEDS, not assertions. Provider limits move:
 * Google cut free-tier quotas in December 2025 and removed the Pro models from
 * the free tier in April 2026. Every field stays editable and the panel says
 * plainly that the values are user-declared.
 */
function TierLimits({ provider }) {
  const [lim, setLim] = useState(() => getLimits(provider));
  const [win, setWin] = useState(() => requestWindows(provider));
  // Uncommitted keystrokes. Absent key => show the saved value.
  const [draft, setDraft] = useState({});

  useEffect(() => { setLim(getLimits(provider)); setWin(requestWindows(provider)); setDraft({}); }, [provider]);
  useEffect(() => {
    const id = setInterval(() => setWin(requestWindows(provider)), 5000);
    return () => clearInterval(id);
  }, []);

  const p = String(provider).toLowerCase().includes("gemini") ? "gemini" : "claude";
  const published = PUBLISHED_LIMITS[p];

  const apply = (patch) => setLim(saveLimits(p, { ...lim, ...patch }));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {["free", "paid"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => apply({ tier: t, rpm: null, rpd: null, tpm: null })}
            className={`px-3 py-1.5 rounded border text-xs ${
              lim.tier === t
                ? "bg-brand-dark text-white border-brand-dark"
                : "border-brand-border text-brand-text"
            }`}
          >
            {t === "free" ? "Free tier" : "Paid tier"}
          </button>
        ))}
        <span className="text-[11px] text-brand-muted self-center">{lim.label}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          ["rpm", "Requests / min"],
          ["rpd", "Requests / day"],
          ["tpm", "Tokens / min"],
        ].map(([k, label]) => (
          <label
            key={k}
            className="text-[11px] text-brand-muted border border-brand-border rounded-md p-2 bg-white block"
          >
            <span className="block mb-1 font-medium text-brand-text">{label}</span>
            <input
              type="number"
              min="0"
              // Controlled by a LOCAL draft string, not by saved state. Binding
              // straight to saved state made the field impossible to clear: an
              // empty box saved as null, getLimits() substituted the published
              // default, and the digit reappeared before the next keystroke.
              value={draft[k] ?? (lim[k] == null ? "" : String(lim[k]))}
              placeholder={published[lim.tier][k] == null ? "no limit" : String(published[lim.tier][k])}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              onBlur={() => {
                const raw = draft[k];
                if (raw === undefined) return;
                apply({ [k]: raw === "" ? null : raw });
                setDraft((d) => { const n = { ...d }; delete n[k]; return n; });
              }}
              className="input-field w-full border border-brand-border rounded px-2 py-1"
            />
          </label>
        ))}
      </div>

      <p className="text-[11px] text-brand-muted">
        Requests used: <strong>{win.lastMinute}</strong> in the last minute,{" "}
        <strong>{win.lastDay}</strong> in the last 24 hours.{" "}
        <button type="button" onClick={() => setWin(resetRequests(provider))}
          className="underline">reset</button>
      </p>

      <p className="text-[11px] text-brand-muted">
        {lim.isDefault
          ? "Showing published defaults for this tier. These are seeds only - provider limits change, so edit them to match what your account actually shows."
          : "Using your declared limits."}
        {lim.caution ? " " + lim.caution : ""}
      </p>
    </div>
  );
}

export default function SettingsPanel({ keys, models, meta, grounding, saveKey, saveModel, saveMeta, saveGrounding, clearAll, onClose, focus }) {
  // The landing page can open this panel straight to a section.
  useEffect(() => {
    if (!focus) return;
    const id = focus === "help" ? "sp-help" : focus === "project" ? "sp-project" : "sp-keys";
    const el = document.getElementById(id);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [focus]);

  const [showClaude, setShowClaude] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [cleared, setCleared] = useState(false);

  const handleClear = () => {
    if (window.confirm("Permanently erase all stored API keys from this browser?")) {
      clearAll();
      setCleared(true);
      setTimeout(() => setCleared(false), 3000);
    }
  };

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span className="flex items-center gap-2">
          <Settings size={16} /> AI Provider Settings
        </span>
        {onClose && (
          <button onClick={onClose} className="text-xs text-brand-text hover:text-brand-dark">
            Close
          </button>
        )}
      </div>
      <div className="p-4 space-y-4">
        {/* 1 — HELP: how the tool can be run */}
        <div id="sp-help" className="border border-brand-border rounded-lg p-4 space-y-2 scroll-mt-4">
          <p className="text-xs font-semibold text-brand-text uppercase tracking-wide">How you can run this tool</p>
          <p className="text-[10px] text-brand-text/70">
            Four approaches were built and tested. Each is a real option - pick the one that matches your budget
            and how much the research needs to be traceable.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-left text-brand-text/60 border-b border-brand-border">
                  <th className="py-1.5 pr-2">Route</th><th className="py-1.5 pr-2">Cost</th>
                  <th className="py-1.5 pr-2">Live sources</th><th className="py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="text-brand-dark">
                <tr className="border-b border-brand-border/50">
                  <td className="py-1.5 pr-2"><strong>Gemini free key</strong><span className="block text-brand-text/60">Reference-backed, no live search</span></td>
                  <td className="py-1.5 pr-2">Free</td>
                  <td className="py-1.5 pr-2 text-brand-warning">No</td>
                  <td className="py-1.5 text-brand-success">Available</td>
                </tr>
                <tr className="border-b border-brand-border/50">
                  <td className="py-1.5 pr-2"><strong>Claude API key</strong><span className="block text-brand-text/60">Web search included</span></td>
                  <td className="py-1.5 pr-2">Paid credit</td>
                  <td className="py-1.5 pr-2 text-brand-success">Yes</td>
                  <td className="py-1.5 text-brand-success">Available</td>
                </tr>
                <tr className="border-b border-brand-border/50">
                  <td className="py-1.5 pr-2"><strong>Gemini + grounding</strong><span className="block text-brand-text/60">Google Search grounding</span></td>
                  <td className="py-1.5 pr-2">Paid tier</td>
                  <td className="py-1.5 pr-2 text-brand-success">Yes</td>
                  <td className="py-1.5 text-brand-success">Available</td>
                </tr>
                <tr className="border-b border-brand-border/50">
                  <td className="py-1.5 pr-2"><strong>Claude artifact</strong><span className="block text-brand-text/60">Single tool, inside Claude</span></td>
                  <td className="py-1.5 pr-2">Free</td>
                  <td className="py-1.5 pr-2 text-brand-success">Yes</td>
                  <td className="py-1.5 text-brand-text/70">Demo only - not shareable as a URL</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-2"><strong>Retrieval API (Tavily)</strong><span className="block text-brand-text/60">Dedicated search service</span></td>
                  <td className="py-1.5 pr-2">Free tier</td>
                  <td className="py-1.5 pr-2 text-brand-success">Yes</td>
                  <td className="py-1.5 text-brand-danger">Blocked - needs a server</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-brand-text/70">
            <strong>Trying it out?</strong> A free Gemini key is enough. The analysis, computation and reports all
            work - research draws on the model's knowledge and the built-in reference standards rather than live
            pages, and the report says so.
          </p>
          <p className="text-[10px] text-brand-text/60">
            Tavily was built and tested but is blocked by browser security (CORS) - it needs a server-side proxy,
            which is a documented next step rather than a failure. This app deliberately has no backend, so your
            key never leaves your browser and nothing is stored anywhere.
          </p>
        </div>

        </div>

        {/* 3 — NOTES & LIMITATIONS */}
        <div id="sp-notes" className="border border-brand-border rounded-lg p-4 space-y-2 scroll-mt-4">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={!!grounding} onChange={(e) => saveGrounding(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="text-xs font-semibold text-brand-text uppercase tracking-wide block">
                Gemini: live web search (Google Search grounding)
              </span>
              <span className="text-[10px] text-brand-text/70 block mt-1">
                Lets the research tools read live sources instead of relying on the model's training knowledge,
                and puts the real source links in each report.
              </span>
            </span>
          </label>
          <p className="text-[10px] text-brand-danger">
            <strong>Off by default, deliberately.</strong> On Gemini's free tier a grounded request is charged against
            a very small daily allowance (roughly 20 requests) rather than the search quota - so turning this on
            will usually exhaust a free key within a few analyses. Enable it only on a paid Gemini key, or use a
            Claude key, where web search works without this restriction.
          </p>
          <p className="text-[10px] text-brand-text/60">
            If a grounded call is refused, the tool automatically retries without grounding rather than failing -
            the report then says it used training knowledge rather than live sources.
          </p>
        </div>

        {/* 4 — PROJECT DETAILS */}
        <div id="sp-project" className="border border-brand-border rounded-lg p-4 space-y-2 scroll-mt-4">
          <p className="text-xs font-semibold text-brand-text uppercase tracking-wide">Project Details</p>
          <p className="text-[10px] text-brand-text/60">
            Used in the title block and document reference of every report this app exports.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-[10px] text-brand-text">
              Project name
              <input type="text" value={meta?.projectName || ""} placeholder="e.g. Riverside Park Redesign"
                onChange={(e) => saveMeta({ projectName: e.target.value })} className="input text-xs mt-0.5" />
            </label>
            <label className="text-[10px] text-brand-text">
              Project code (report prefix)
              <input type="text" value={meta?.projectCode || ""} placeholder="ALS2"
                onChange={(e) => saveMeta({ projectCode: e.target.value.toUpperCase().replace(/\s/g, "") })}
                className="input text-xs mt-0.5 font-mono" />
            </label>
            <label className="text-[10px] text-brand-text">
              Site description
              <input type="text" value={meta?.siteDescription || ""} placeholder="e.g. Chicago, USA - 15,000 sqm"
                onChange={(e) => saveMeta({ siteDescription: e.target.value })} className="input text-xs mt-0.5" />
            </label>
            <label className="text-[10px] text-brand-text">
              Author
              <input type="text" value={meta?.author || ""} placeholder="Your name"
                onChange={(e) => saveMeta({ author: e.target.value })} className="input text-xs mt-0.5" />
            </label>
          </div>
          <label className="text-[10px] text-brand-text block">
            Status
            <select value={meta?.status || "DRAFT"} onChange={(e) => saveMeta({ status: e.target.value })}
              className="input text-xs mt-0.5">
              <option value="DRAFT">DRAFT</option>
              <option value="ISSUED">ISSUED</option>
            </select>
          </label>
        </div>

        {/* Security Warning */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-3">
          <AlertTriangle size={18} className="text-brand-danger shrink-0 mt-0.5" />
          <div className="text-xs text-red-800 space-y-1">
            <p className="font-semibold">Security Notice - Read This</p>
            <p>
              This is a static website (GitHub Pages). There is no backend server. Your API key
              is stored <strong>only in your browser</strong> using localStorage.
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>Never share your screen with the key visible.</li>
              <li>Use a <strong>restricted API key</strong> with spending limits.</li>
              <li>Clear keys when done using the button below.</li>
              <li>Anyone with physical access to your unlocked browser can see this key.</li>
            </ul>
          </div>
        </div>

        {/* Provider availability disclaimer */}
        <div className="bg-brand-warm border border-brand-border rounded-lg p-3 flex gap-3">
          <Info size={16} className="text-brand-warning shrink-0 mt-0.5" />
          <p className="text-xs text-brand-text">
            This app currently supports <strong>Claude</strong> and <strong>Gemini</strong>. Other AI
            providers aren't compatible with how this app runs, so only these two are offered. Both have free-tier options that work here, and both can research the web live - Claude via its search tool, Gemini via Google Search grounding.
          </p>
        </div>

        {/* Claude Key */}
        <div id="sp-keys" className="scroll-mt-4 space-y-4">
        {/* Framed to match every other settings block. Previously bare, so the key
           input sat flush against the card edge with no container of its own. */}
        <div className="border border-brand-border rounded-lg p-4 space-y-1.5">
          <label className="text-xs font-semibold text-brand-text uppercase tracking-wide flex items-center gap-1">
            <KeyRound size={12} /> Claude API Key
          </label>
          <div className="relative">
            <input
              type={showClaude ? "text" : "password"}
              value={keys.claude}
              onChange={(e) => saveKey("claude", e.target.value)}
              placeholder="sk-ant-api03-..."
              className="input pr-10 font-mono text-xs"
            />
            <button
              onClick={() => setShowClaude((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-text hover:text-brand-dark"
            >
              {showClaude ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-[10px] text-brand-text/60">
            Get yours at{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-brand-gold"
            >
              console.anthropic.com
            </a>
            . Claude Sonnet 4 is recommended (good balance of capability and free-tier limits).
          </p>
          <div className="mt-2">
            <label className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Claude model name</label>
            <input
              type="text"
              value={models?.claude || ""}
              onChange={(e) => saveModel("claude", e.target.value)}
              placeholder="claude-sonnet-4-6"
              className="input font-mono text-xs mt-1"
            />
            <p className="text-[10px] text-brand-text/60 mt-1">Edit this if Anthropic renames the model. Leave as-is unless you get a "model not found" error.</p>
          </div>
        </div>

        {/* API tier and limits now live in the BUDGET rail beside the tools.
            They were maintained in two places, which meant two sources for one
            number, and the rail is where they are actually consulted. */}


        {/* Gemini Key */}
        <div className="border border-brand-border rounded-lg p-4 space-y-1.5">
          <label className="text-xs font-semibold text-brand-text uppercase tracking-wide flex items-center gap-1">
            <KeyRound size={12} /> Gemini API Key
          </label>
          <div className="relative">
            <input
              type={showGemini ? "text" : "password"}
              value={keys.gemini}
              onChange={(e) => saveKey("gemini", e.target.value)}
              placeholder="AIza..."
              className="input pr-10 font-mono text-xs"
            />
            <button
              onClick={() => setShowGemini((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-brand-text hover:text-brand-dark"
            >
              {showGemini ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-[10px] text-brand-text/60">
            Get yours at{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-brand-gold"
            >
              Google AI Studio
            </a>
            . Use a current free-tier Flash model name below.
          </p>
          <div className="mt-2">
            <label className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Gemini model name</label>
            <input
              type="text"
              value={models?.gemini || ""}
              onChange={(e) => saveModel("gemini", e.target.value)}
              placeholder="gemini-flash-latest"
              className="input font-mono text-xs mt-1"
            />
            <p className="text-[10px] text-brand-text/60 mt-1">Google renames free models often. If you get a "model no longer available" error, check the current free model name at aistudio.google.com and type it here. "gemini-flash-latest" usually points to the current Flash model.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-2 border-t border-brand-border flex items-center justify-between">
          <button
            onClick={handleClear}
            className="text-xs font-medium text-brand-danger flex items-center gap-1.5 hover:underline"
          >
            <Trash2 size={13} /> Clear All Stored Keys
          </button>
          {cleared && (
            <span className="text-xs text-brand-success flex items-center gap-1">
              <CheckCircle2 size={12} /> Cleared
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
