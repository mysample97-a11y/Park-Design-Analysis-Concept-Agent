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

// Sensible current defaults (editable in Settings if the provider renames them)
const DEFAULT_MODELS = {
  claude: "claude-sonnet-4-6",
  gemini: "gemini-flash-latest",
};

export function useApiKeys() {
  const [keys, setKeys] = useState({ claude: "", gemini: "" });
  const [models, setModels] = useState({ ...DEFAULT_MODELS });
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

  const clearAll = () => {
    setKeys({ claude: "", gemini: "" });
    setModels({ ...DEFAULT_MODELS });
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
      Object.values(MODEL_KEYS).forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  };

  const getActiveKey = (provider) => keys[provider] || "";
  const getActiveModel = (provider) => models[provider] || DEFAULT_MODELS[provider];

  return { keys, models, loaded, saveKey, saveModel, clearAll, getActiveKey, getActiveModel };
}

export default function SettingsPanel({ keys, models, saveKey, saveModel, clearAll, onClose }) {
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
            providers aren't compatible with how this app runs, so only these two are offered. Both have
            free-tier options that work here.
          </p>
        </div>

        {/* Claude Key */}
        <div className="space-y-1.5">
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

        {/* Gemini Key */}
        <div className="space-y-1.5">
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
