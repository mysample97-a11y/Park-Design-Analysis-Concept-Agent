import { useState, createContext, useContext } from "react";
import { MapPin, Sun, BarChart3, Wind, Leaf, Settings, Layers, Calculator, FileStack } from "lucide-react";
import SettingsPanel, { useApiKeys } from "./components/SettingsPanel";
import SolarAnalyzer from "./analyzers/SolarAnalyzer";
import SurveyAnalyzer from "./analyzers/SurveyAnalyzer";
import WindAnalyzer from "./analyzers/WindAnalyzer";
import SiteContextAnalyzer from "./analyzers/SiteContextAnalyzer";
import VegetationAnalyzer from "./analyzers/VegetationAnalyzer";
import ConceptGenerator from "./analyzers/ConceptGenerator";
import BudgetTracker from "./analyzers/BudgetTracker";
import CombinedDocumentGenerator from "./analyzers/CombinedDocumentGenerator";

const TABS = [
  { id: "site", label: "Site Context", icon: MapPin },
  { id: "solar", label: "Solar", icon: Sun },
  { id: "survey", label: "Survey", icon: BarChart3 },
  { id: "wind", label: "Wind", icon: Wind },
  { id: "veg", label: "Vegetation", icon: Leaf },
  { id: "concept", label: "Concept Gen", icon: Layers },
  { id: "budget", label: "Budget", icon: Calculator },
  { id: "combined", label: "Combined Doc", icon: FileStack },
];

export const AppContext = createContext(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be inside AppContext.Provider");
  return ctx;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("site");
  const [showSettings, setShowSettings] = useState(false);
  const { keys, models, meta, loaded, saveKey, saveModel, saveMeta, clearAll, getActiveKey, getActiveModel } = useApiKeys();

  const [provider, setProvider] = useState("claude");
  const apiKey = getActiveKey(provider);
  const model = getActiveModel(provider);

  const ctxValue = {
    provider,
    setProvider,
    apiKey,
    model,
    keys,
    models,
    meta,
    saveKey,
    saveModel,
    saveMeta,
    clearAll,
  };

  const hasKey = !!apiKey;

  return (
    <AppContext.Provider value={ctxValue}>
      <div className="min-h-screen bg-brand-cream text-brand-dark font-sans">
        <header className="bg-brand-dark px-6 py-5">
          <div className="max-w-6xl mx-auto flex items-start justify-between gap-4">
            <div>
              <p className="text-xs tracking-[0.2em] uppercase text-brand-gold">
                Al Safa 2 — AI Park Competition
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Site Analysis Suite
              </h1>
              <p className="text-sm mt-1 text-[#C9C6BE]">
                8 integrated tools for landscape architecture site analysis and design.
              </p>
            </div>
            <button
              onClick={() => setShowSettings((s) => !s)}
              className="text-xs font-medium px-3 py-2 rounded-md flex items-center gap-1 shrink-0 bg-white/10 text-white hover:bg-white/20 transition"
            >
              <Settings size={13} /> {showSettings ? "Hide" : "Settings"}
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
            <SettingsPanel
              keys={keys}
              models={models}
              meta={meta}
              saveKey={saveKey}
              saveModel={saveModel}
              saveMeta={saveMeta}
              clearAll={clearAll}
              onClose={() => setShowSettings(false)}
            />
            <div className="mt-4 flex items-center gap-3">
              <span className="text-xs font-semibold text-brand-text uppercase tracking-wide">
                Active Provider:
              </span>
              <div className="flex gap-2">
                {["claude", "gemini"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setProvider(p)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold border-2 transition ${
                      provider === p
                        ? "bg-brand-dark text-white border-brand-dark"
                        : "bg-white text-brand-dark border-[#DDD6C9]"
                    }`}
                  >
                    {p === "claude" ? "Claude" : "Gemini"}
                    {keys[p] ? " ✓" : ""}
                  </button>
                ))}
              </div>
              {!hasKey && (
                <span className="text-xs text-brand-danger font-medium">
                  Add a key in Settings to use AI features.
                </span>
              )}
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
          <div className="flex gap-2 border-b-2 border-brand-border pb-1 overflow-x-auto whitespace-nowrap">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2.5 rounded-t-md text-sm font-semibold flex items-center gap-2 transition border-b-4 ${
                    active
                      ? "bg-white border-brand-gold text-brand-dark"
                      : "bg-transparent border-transparent text-brand-text hover:text-brand-dark"
                  }`}
                >
                  <Icon size={15} /> {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-20">
          {!hasKey && !showSettings && (
            <div className="bg-brand-warm border-2 border-brand-gold rounded-lg p-4 mb-6 flex items-center gap-3">
              <Settings size={18} className="text-brand-warning shrink-0" />
              <p className="text-sm text-brand-text">
                <strong>No API key configured.</strong> Open{" "}
                <button
                  onClick={() => setShowSettings(true)}
                  className="underline text-brand-gold font-semibold"
                >
                  Settings
                </button>{" "}
                and add your {provider === "claude" ? "Claude" : "Gemini"} key to enable AI analysis.
              </p>
            </div>
          )}

          {activeTab === "site" && <SiteContextAnalyzer />}
          {activeTab === "solar" && <SolarAnalyzer />}
          {activeTab === "survey" && <SurveyAnalyzer />}
          {activeTab === "wind" && <WindAnalyzer />}
          {activeTab === "veg" && <VegetationAnalyzer />}
          {activeTab === "concept" && <ConceptGenerator />}
          {activeTab === "budget" && <BudgetTracker />}
          {activeTab === "combined" && <CombinedDocumentGenerator />}
        </main>

        <footer className="border-t border-brand-border bg-white py-4 text-center text-[10px] text-brand-text/50">
          Al Safa 2 Site Analysis Suite • Built for the Dubai AI Park Competition •
          API keys stored locally in your browser only
        </footer>
      </div>
    </AppContext.Provider>
  );
}
