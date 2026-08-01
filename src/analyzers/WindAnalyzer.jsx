import { useState } from "react";
import { Sparkles, Plus, Trash2, Wind, AlertTriangle, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import { callAI } from "../utils/ai";
import { uid, friendlyError, extractJSON } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, generateOverflow, nextDocRef, tableHTML } from "../utils/reportTemplate";
import * as XLSX from "xlsx";

const DEFAULT_SEASONS = [
  { id: "winter", label: "Winter (Dec-Feb)", prevailing: "NW", speedRange: "10-25 km/h", character: "Cooler season. Generally calmer, with occasional rain-bearing systems arriving from the northwest.", dustRisk: "Low" },
  { id: "spring", label: "Spring (Feb-Apr)", prevailing: "NW, variable", speedRange: "15-40 km/h", character: "Strongest and most variable winds of the year. Can raise sand and dust storms.", dustRisk: "High" },
  { id: "summer", label: "Summer (May-Sep)", prevailing: 'NW ("Shamal")', speedRange: "10-30 km/h", character: "Persistent northwesterly Shamal wind, often carrying Gulf moisture. A real passive-cooling opportunity if not blocked.", dustRisk: "Medium" },
  { id: "autumn", label: "Autumn (Oct-Nov)", prevailing: "NW, transitional", speedRange: "10-20 km/h", character: "Milder, transitional period between summer Shamal and winter patterns.", dustRisk: "Low" },
];

const RISK_COLOR = { Low: "#3D7A5C", Medium: "#B8863B", High: "#B84C3D" };

export default function WindAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();
  const [location, setLocation] = useState("");
  const [SEASONS, setSeasons] = useState(DEFAULT_SEASONS);
  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState("");
  const [researchError, setResearchError] = useState("");
  const [showRef, setShowRef] = useState(false);

  async function researchLocation() {
    if (!location.trim()) { setResearchError("Enter a project location first."); return; }
    setResearching(true); setResearchError("");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 1400, useWebSearch: provider === "claude",
        content: `For the location "${location}", give the prevailing seasonal wind characteristics. Respond with ONLY a JSON array of 4 season objects, no markdown fences: [{"id":"winter","label":"Winter (months)","prevailing":"compass direction","speedRange":"x-y km/h","character":"one sentence","dustRisk":"Low|Medium|High"}]. Use the four seasons appropriate to that location's climate. Base this on published climate references; do not invent precise wind-rose percentages.`,
      });
      const parsed = extractJSON(text);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("Unexpected format");
      setSeasons(parsed);
      setResearchNote(`Wind reference researched for: ${location}`);
    } catch (e) {
      setResearchError(e.message || "Could not research this location. The default reference remains in use.");
    } finally { setResearching(false); }
  }


  const [zones, setZones] = useState([
    { id: uid(), name: "Public Cinema / Picnic Green Space", wantsCooling: true, hasScreening: false },
    { id: uid(), name: "Yoga & Meditation + Elderly Sit-Out", wantsCooling: true, hasScreening: false },
  ]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");

  function addZone() { setZones([...zones, { id: uid(), name: "", wantsCooling: true, hasScreening: false }]); }
  function updateZone(id, patch) { setZones(zones.map((z) => (z.id === id ? { ...z, ...patch } : z))); }
  function removeZone(id) { setZones(zones.filter((z) => z.id !== id)); }

  function zoneFlag(z) {
    if (z.wantsCooling && !z.hasScreening) return { label: "Good - open to prevailing NW breeze", color: "#3D7A5C" };
    if (z.wantsCooling && z.hasScreening) return { label: "Review - screening may block wanted cooling", color: "#B8863B" };
    if (!z.wantsCooling && !z.hasScreening) return { label: "Consider windbreak for spring dust-storm months", color: "#B84C3D" };
    return { label: "Protected - screening in place", color: "#3D7A5C" };
  }

  async function generateInsight() {
    setInsightLoading(true); setInsight(null); setInsightError("");
    const summary = {
      site: location || meta?.siteDescription || meta?.projectName || "(location not stated)",
      wind_reference: SEASONS,
      note: researchNote || "Prevailing direction and speed range are from general published climate references for the stated location. Not precise wind-rose measurement.",
      zones: zones.filter((z) => z.name.trim()).map((z) => ({ zone: z.name, wants_passive_cooling: z.wantsCooling, has_windbreak_screening: z.hasScreening, assessment: zoneFlag(z).label })),
    };
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 2500,
        content: "You are a landscape architecture assistant giving wind-design guidance for a park design at the stated location, using only the sourced seasonal wind data and zone list below - no invented statistics. For each zone give a one-line recommendation on whether to keep it open to the prevailing breeze or add windbreak screening. Then write a 'conclusion' field: 2-3 sentences naming the single highest-priority zone/action. Be explicit wind data here is qualitative/seasonal, not precise wind-rose measurement. Respond with ONLY valid JSON, no markdown fences: {\"zone_recommendations\": [{\"zone\": \"\", \"recommendation\": \"\"}], \"conclusion\": \"\"}\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });
      setInsight(extractJSON(text));
    } catch (e) {
      setInsightError(e.message || "Something went wrong generating the insight. Try again.");
    } finally {
      setInsightLoading(false);
    }
  }

  function buildReportText() {
    let lines = ["WIND PATTERN REFERENCE & ZONE ASSESSMENT", `Location: ${location || meta?.siteDescription || "(not stated)"}`, "", "SEASONAL WIND REFERENCE"];
    SEASONS.forEach((s) => lines.push(`  ${s.label}: ${s.prevailing}, ${s.speedRange}, dust risk ${s.dustRisk} - ${s.character}`));
    lines.push("", "ZONE ASSESSMENT");
    zones.filter((z) => z.name.trim()).forEach((z) => lines.push(`  ${z.name}: cooling=${z.wantsCooling ? "Yes" : "No"}, screening=${z.hasScreening ? "Yes" : "No"} -> ${zoneFlag(z).label}`));
    if (insight) {
      lines.push("", "AI RECOMMENDATIONS");
      (insight.zone_recommendations || []).forEach((r) => lines.push(`  ${r.zone}: ${r.recommendation}`));
      lines.push("", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  function structuredOpts() {
    return {
      toolCode: "WND",
      meta,
      inputRecord: [{label:"Location",value:(typeof location!=="undefined"&&location)||"(not stated)"}],
      findings: [{ title: "Analysis output", text: buildReportText() }],
      chartNote: "Seasonal wind reference table is reproduced in the PDF export.",
      chartsHtml: tableHTML(["Season", "Prevailing", "Speed", "Dust risk", "Character"],
          SEASONS.map((s) => [s.label, s.prevailing, s.speedRange, s.dustRisk, s.character]), "Seasonal wind reference"),
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.zone_recommendations || []).map((r)=>`${r.zone}: ${r.recommendation}`),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (!overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "WND",
        reportText: buildReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Season", "Prevailing", "Speed Range", "Dust Risk", "Character"], ...SEASONS.map((s) => [s.label, s.prevailing, s.speedRange, s.dustRisk, s.character])]), "Seasonal Reference");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Zone", "Wants Cooling", "Has Screening", "Assessment"], ...zones.filter((z) => z.name.trim()).map((z) => [z.name, z.wantsCooling ? "Yes" : "No", z.hasScreening ? "Yes" : "No", zoneFlag(z).label])]), "Zone Assessment");
    if (insight) {
      const rows = [["Zone", "Recommendation"]];
      (insight.zone_recommendations || []).forEach((r) => rows.push([r.zone, r.recommendation]));
      rows.push([]); rows.push(["Conclusion", insight.conclusion]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "AI Insight");
    }
    const blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "al-safa-2-wind-analysis.xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportWord() { withOverflow((o) => exportStructuredWord(o)); }

  function exportPDF() {
    withOverflow((o) => exportStructuredPDF(o, () => {
      if (typeof setError === "function") setError("Your browser blocked the new tab needed for PDF export. Allow pop-ups and try again.");
    }));
  }

  return (
    <div className="space-y-6">
      <ToolIntro toolCode="WND" />

      <div className="card">
        <div className="card-header">Project Location - Wind Reference</div>
        <div className="p-4 space-y-2">
          <input value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Al Safa 2 Park, Jumeirah, Dubai"
            className="input" />
          <button onClick={researchLocation} disabled={researching || !apiKey} className="btn-gold w-full">
            {researching ? "Researching..." : "Research Wind Data for This Location"}
          </button>
          <p className="text-[10px] text-brand-text/60">
            Optional. Without this, the built-in reference data below is used - which was compiled for a hot-arid
            Gulf climate and may not suit other regions. Researching replaces it with data for your location.
          </p>
          {researchNote && <p className="text-xs text-brand-success">{researchNote}</p>}
          {researchError && <p className="text-xs text-brand-danger">{friendlyError(researchError)}</p>}
        </div>
      </div>
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <span>Zone Wind Exposure Advisor</span>
          <button onClick={addZone} className="btn-gold text-xs px-3 py-1.5"><Plus size={13} /> Add zone</button>
        </div>
        <div className="p-4 space-y-3">
          {zones.map((z) => {
            const flag = zoneFlag(z);
            return (
              <div key={z.id} className="border border-brand-border rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input value={z.name} onChange={(e) => updateZone(z.id, { name: e.target.value })} placeholder="Zone name" className="flex-1 text-sm bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 focus:border-brand-gold outline-none" />
                  <button onClick={() => removeZone(z.id)} className="text-[#B8A98F] hover:text-brand-danger"><Trash2 size={14} /></button>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={z.wantsCooling} onChange={(e) => updateZone(z.id, { wantsCooling: e.target.checked })} /> Wants passive cooling</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={z.hasScreening} onChange={(e) => updateZone(z.id, { hasScreening: e.target.checked })} /> Has windbreak/screening</label>
                </div>
                <p className="text-xs font-medium" style={{ color: flag.color }}>{flag.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-[#FBEAE7] border border-[#F0C8C0] rounded-lg p-4 flex gap-3">
        <AlertTriangle size={18} className="text-brand-danger shrink-0 mt-0.5" />
        <div className="text-sm text-brand-text">
          <p><span className="font-semibold">Lower precision than the Solar tool, by design.</span> Documented seasonal wind character, not a precise monthly wind-rose dataset.</p>
          <p className="mt-2 text-brand-danger font-medium">For reliable AI insight results, keep to around 10-12 zones per analysis run.</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-brand-border overflow-hidden">
        <button onClick={() => setShowRef((v) => !v)} className="w-full px-4 py-3 border-b border-brand-border flex items-center justify-between text-left">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">
            Seasonal Wind Reference {researchNote ? "" : "(built-in default)"}
          </h2>
          <span className="text-xs text-brand-text">{showRef ? "Hide" : "Show"}</span>
        </button>
        {showRef && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-brand-text/60 text-xs uppercase tracking-wide border-b border-brand-border"><th className="px-4 py-2">Season</th><th className="px-4 py-2">Prevailing</th><th className="px-4 py-2">Speed</th><th className="px-4 py-2">Dust Risk</th><th className="px-4 py-2">Character</th></tr></thead>
            <tbody>{SEASONS.map((s) => (<tr key={s.id} className="border-b border-[#F0EBDF] align-top"><td className="px-4 py-2 font-medium">{s.label}</td><td className="px-4 py-2 font-mono">{s.prevailing}</td><td className="px-4 py-2 font-mono">{s.speedRange}</td><td className="px-4 py-2"><span className="px-2 py-0.5 rounded text-xs font-medium" style={{ color: RISK_COLOR[s.dustRisk], background: RISK_COLOR[s.dustRisk] + "20" }}>{s.dustRisk}</span></td><td className="px-4 py-2 text-brand-text text-xs">{s.character}</td></tr>))}</tbody>
          </table>
        </div>
        )}
      </div>

      <div className="card border-2">
        <div className="p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">AI Insight & Recommendation</h2>
            <button onClick={generateInsight} disabled={insightLoading || zones.filter((z) => z.name.trim()).length === 0 || !apiKey} className="btn-dark">
              <Sparkles size={15} /> {insightLoading ? "Analyzing..." : "Generate AI Insight"}
            </button>
          </div>
          {insightLoading && <p className="text-sm text-brand-text/60">Reading zone data and generating wind guidance...</p>}
          {insightError && (<div className="space-y-1"><p className="text-sm text-[#3A362C] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(insightError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {insightError}</p></div>)}
          {insight && (<div className="space-y-1.5">{(insight.zone_recommendations || []).map((r, i) => (<p key={i} className="text-sm text-[#3A362C]"><span className="font-semibold">{r.zone}</span>: {r.recommendation}</p>))}</div>)}
          {!insight && !insightLoading && !insightError && <p className="text-sm text-brand-text/60">Name your zones above, mark cooling/screening intent, then generate wind-design guidance.</p>}
        </div>
      </div>

      {insight?.conclusion && (
        <div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}>
          <h2 className="font-bold text-sm uppercase tracking-wide text-[#8A6A3A] mb-2">Conclusion</h2>
          <p className="text-sm text-[#3A362C] leading-relaxed font-medium">{insight.conclusion}</p>
        </div>
      )}

      <div className="card">
        <div className="p-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h2>
          <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
        </div>
      </div>
    </div>
  );
}
