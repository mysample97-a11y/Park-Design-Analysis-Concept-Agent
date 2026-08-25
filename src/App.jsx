import { useState, useEffect, createContext, useContext } from "react";
import { getUsage } from "./utils/tokenMeter";
import { subscribeActiveTool, setActiveEstimate } from "./utils/toolBridge";
import { Home, MapPin, Sun, BarChart3, Wind, Leaf, Settings, Layers, Calculator, FileStack } from "lucide-react";
import Landing from "./components/Landing";
import TokenRails from "./components/TokenRails";
import ToolErrorBoundary from "./components/ToolErrorBoundary";
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

/**
 * Tool code per tab, for the usage rail.
 * Strings only - deliberately no component references, so this is safe at module
 * scope even though App.jsx and the analyzers import each other. Anything that
 * touches an analyzer binding must be built inside the component instead.
 */
const TAB_TOOL_CODE = {
  site: "SCX", solar: "SOL", survey: "SUR", wind: "WND",
  veg: "VEG", concept: "CPT", budget: "BDG", combined: "CMB",
};


export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be inside AppContext.Provider");
  return ctx;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("site");
  // Tools that have been opened at least once. Mount-once, keep-alive.
  const [visitedTabs, setVisitedTabs] = useState(() => new Set());
  /*
    MUST stay INSIDE the component.
  
    App.jsx imports every analyzer, and every analyzer imports App.jsx back for
    useAppContext - a circular import. That cycle is harmless as long as nothing
    is evaluated at MODULE scope, because useAppContext only runs at render time.
  
    Declaring this array at module scope broke that: it reads the analyzer
    bindings during module initialisation, and whichever module the bundler
    evaluates first sees the other's bindings still uninitialised. The result was
    "Cannot access 'Re' before initialization" - a TDZ error naming a minified
    variable, which is why it was so hard to place.
  
    Built here, it is evaluated on first render, long after both modules exist.
  */
  const TOOL_PANELS = [
    { id: "site", Component: SiteContextAnalyzer },
    { id: "solar", Component: SolarAnalyzer },
    { id: "survey", Component: SurveyAnalyzer },
    { id: "wind", Component: WindAnalyzer },
    { id: "veg", Component: VegetationAnalyzer },
    { id: "concept", Component: ConceptGenerator },
    { id: "budget", Component: BudgetTracker },
    { id: "combined", Component: CombinedDocumentGenerator },
  ];
  // Live usage for the rail. Polled rather than lifted through context so no
  // tool has to be rewired; the store is localStorage and reads are cheap.
  const [railUsage, setRailUsage] = useState(() => getUsage("SCX"));
  // The visible tool publishes its estimator and reset here. Previously the
  // rails were passed estimate={null} and onReset={null}, so the Calculate
  // and Reset buttons had nothing to call and never rendered at all.
  const [activeTool, setActiveToolState] = useState({ code: null, calculate: null, resetUsage: null, estimate: null });
  useEffect(() => subscribeActiveTool(setActiveToolState), []);
  const [counting, setCounting] = useState(false);
  useEffect(() => {
    const code = TAB_TOOL_CODE[activeTab];
    if (!code) return undefined;
    const read = () => setRailUsage(getUsage(code));
    read();
    const id = setInterval(read, 2000);
    return () => clearInterval(id);
  }, [activeTab]);
  useEffect(() => {
    if (!activeTab) return;
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);
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
      <div className="as2p-tools-theme as2p-shell min-h-screen font-sans">
        <header className="bg-brand-dark px-6 py-5">
          <div className="w-full flex items-start justify-between gap-4">
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
              className="text-xs font-medium px-3 py-2 rounded-md flex items-center gap-1 shrink-0 bg-white/10 text-white hover:bg-white/20 transition"
              title="Back to the landing page"
            >
              <Home size={13} /> Home
            </button>
          </div>
        </header>

        {showSettings && (
          <div className="as2p-wide px-4 sm:px-6 pt-6 pb-10 rounded-lg my-4 shadow-2xl">
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

        <div className="as2p-wide px-4 sm:px-6 pt-6 pb-10 bg-brand-cream rounded-lg my-4 shadow-2xl">
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

        <main className="as2p-wide px-4 sm:px-6 py-6 pb-20">
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

          {/*
            F29 - DO NOT go back to `activeTab === "x" && <Tool />`.

            That form UNMOUNTS the tool on every tab change, and React discards
            all of its state with it. Users lost entire sessions of pasted survey
            data, uploaded files and paid AI output simply by looking at another
            tool - which is the single most expensive bug this app had.

            Instead each tool is mounted ONCE, on first visit, and then kept
            mounted but hidden. `visitedTabs` means an unvisited tool is never
            mounted, so nothing is paid for until it is opened, and the mount
            cost is incurred once rather than on every switch.

            display:none preserves component state, timers and scroll position.
            Do not swap it for conditional rendering to "tidy the DOM".
          */}
          <TokenRails
            provider={provider}
            usage={railUsage}
            estimate={activeTool.estimate}
            partial={activeTool.partial}
            calculating={counting}
            onCalculate={activeTool.calculate ? async () => {
              setCounting(true);
              try { await activeTool.calculate(); } finally { setCounting(false); }
            } : null}
            onClearEstimate={activeTool.code ? () => setActiveEstimate(activeTool.code, null) : null}
            onReset={activeTool.resetUsage ? () => {
              activeTool.resetUsage();
              const code = TAB_TOOL_CODE[activeTab];
              if (code) setRailUsage(getUsage(code));
            } : null}
          >
            {TOOL_PANELS.map(({ id, Component }) =>
              visitedTabs.has(id) ? (
                <div key={id} style={{ display: activeTab === id ? "block" : "none" }}>
                  {/* Confines a render error to the tool that threw. Without this
                      one bad value blanks the whole page and every mounted tool
                      loses its state. */}
                  <ToolErrorBoundary toolName={id}>
                    <Component />
                  </ToolErrorBoundary>
                </div>
              ) : null
            )}
          </TokenRails>
        </main>

        <footer className="border-t border-brand-border bg-white py-4 text-center text-[10px] text-brand-text/50">
          Al Safa 2 Site Analysis Suite • Built for the Dubai AI Park Competition •
          API keys stored locally in your browser only
        </footer>
      </div>
    </AppContext.Provider>
  );
}
