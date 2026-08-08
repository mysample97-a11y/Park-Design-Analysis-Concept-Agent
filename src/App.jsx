import { useState, useEffect, createContext, useContext } from "react";
import { Home, MapPin, Sun, BarChart3, Wind, Leaf, Settings, Layers, Calculator, FileStack } from "lucide-react";
import Landing from "./components/Landing";
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
  const [settingsFocus, setSettingsFocus] = useState("settings");
  const [view, setView] = useState("landing");   // "landing" | "app"
  const [dirty, setDirty] = useState(false);      // true once the user has done work worth losing

  // Entering the workspace pushes a history entry so the browser Back button returns
  // to the landing page rather than leaving the site. If work has been done, warn first.
  function openTool(tabId) {
    setActiveTab(tabId);
    setView("app");
    try { window.history.pushState({ view: "app" }, ""); } catch { /* ignore */ }
    window.scrollTo(0, 0);
  }

  useEffect(() => {
    function onPop() {
      if (view !== "app") return;
      if (dirty) {
        const leave = window.confirm(
          "Return to the landing page?\n\nAnything you have entered or generated in the workspace will be lost. " +
          "Export any report you want to keep before leaving."
        );
        if (!leave) {
          try { window.history.pushState({ view: "app" }, ""); } catch { /* ignore */ }
          return;
        }
      }
      setView("landing");
      window.scrollTo(0, 0);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [view, dirty]);

  // Guard a full page reload / tab close while there is unsaved work
  useEffect(() => {
    function beforeUnload(e) {
      if (view === "app" && dirty) { e.preventDefault(); e.returnValue = ""; }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [view, dirty]);

  const { keys, models, meta, grounding, loaded, saveKey, saveModel, saveMeta, saveGrounding, clearAll, getActiveKey, getActiveModel } = useApiKeys();

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
    grounding,
    saveKey,
    saveModel,
    saveMeta,
    saveGrounding,
    clearAll,
    markDirty: () => setDirty(true),
  };

  const hasKey = !!apiKey;

  // Landing page first. The workspace mounts only when an instrument is chosen,
  // so the landing animation never runs alongside it.
  if (view === "landing") {
    return (
      <AppContext.Provider value={ctxValue}>
        <Landing onOpen={openTool} onNav={(target) => {
          setView("app");
          setShowSettings(true);
          setSettingsFocus(target);        // "settings" | "help" | "project"
          try { window.history.pushState({ view: "app" }, ""); } catch { /* ignore */ }
          window.scrollTo(0, 0);
        }} />
        {showSettings && (
          <SettingsPanel
            keys={keys}
            models={models}
            meta={meta}
            grounding={grounding}
            saveKey={saveKey}
            saveModel={saveModel}
            saveMeta={saveMeta}
            saveGrounding={saveGrounding}
            clearAll={clearAll}
            focus={settingsFocus}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AppContext.Provider>
    );
  }

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
            <button
              onClick={() => {
                if (!dirty || window.confirm("Return to the landing page?\n\nAnything you have entered or generated here will be lost. Export any report you want to keep first.")) {
                  setView("landing"); window.scrollTo(0, 0);
                }
              }}
              className="text-xs font-medium border border-brand-border px-3 py-1.5 rounded-md flex items-center gap-1 hover:border-brand-gold"
              title="Back to the landing page"
            >
              <Home size={13} /> Home
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
            <SettingsPanel
              keys={keys}
              models={models}
              meta={meta}
              grounding={grounding}
              saveKey={saveKey}
              saveModel={saveModel}
              saveMeta={saveMeta}
              saveGrounding={saveGrounding}
              clearAll={clearAll}
              focus={settingsFocus}
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
