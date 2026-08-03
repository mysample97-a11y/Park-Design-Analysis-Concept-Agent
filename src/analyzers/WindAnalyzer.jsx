import { useState } from "react";
import { Sparkles, Plus, Trash2, Wind, AlertTriangle, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { callAI } from "../utils/ai";
import { uid, friendlyError, extractJSON } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, tableHTML, windRoseSVG } from "../utils/reportTemplate";
import * as XLSX from "xlsx";


const RISK_COLOR = { Low: "#3D7A5C", Medium: "#B8863B", High: "#B84C3D" };

export default function WindAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();
  const [location, setLocation] = useState("");
  const [SEASONS, setSeasons] = useState([]);
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
      if (!Array.isArray(parsed) || !parsed.length) {
        throw new Error("The AI did not return seasonal wind data in the expected list format for this location. The built-in reference remains in use - you can still run the analysis, but treat the wind data as generic rather than location-specific.");
      }
      const cleaned = parsed.filter((x) => x && (x.label || x.id)).map((x, i) => ({
        id: x.id || `s${i}`, label: x.label || x.id || `Season ${i + 1}`,
        prevailing: x.prevailing || "not stated", speedRange: x.speedRange || x.speed || "not stated",
        character: x.character || "", dustRisk: x.dustRisk || "Unknown",
      }));
      setSeasons(cleaned);
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

  // City of Ottawa Wind Analysis Terms of Reference - pedestrian comfort thresholds (km/h)
  const COMFORT = [
    { key: "sitting", label: "Sitting", max: 10 },
    { key: "standing", label: "Standing", max: 14 },
    { key: "strolling", label: "Strolling", max: 17 },
    { key: "walking", label: "Walking", max: 20 },
  ];
  const SAFETY_LIMIT = 90;

  function parseSpeed(range) {
    const nums = String(range || "").match(/\d+/g);
    if (!nums || !nums.length) return null;
    return Math.max(...nums.map(Number));
  }

  function comfortRows() {
    return SEASONS.map((sn) => {
      const top = parseSpeed(sn.speedRange);
      const cells = COMFORT.map((c) => (top == null ? "?" : top <= c.max ? "OK" : "EXCEEDS"));
      const safety = top == null ? "?" : top >= SAFETY_LIMIT ? "HAZARD" : "OK";
      return [sn.label, sn.speedRange, ...cells, safety];
    });
  }

  function comfortSummary() {
    const problems = [];
    SEASONS.forEach((sn) => {
      const top = parseSpeed(sn.speedRange);
      if (top == null) return;
      const failed = COMFORT.filter((c) => top > c.max).map((c) => c.label.toLowerCase());
      if (failed.length) problems.push(`${sn.label}: peak ${top} km/h exceeds the comfort threshold for ${failed.join(", ")}`);
      if (top >= SAFETY_LIMIT) problems.push(`${sn.label}: peak ${top} km/h reaches the wind safety hazard threshold - mitigation required`);
    });
    return problems.length ? problems : ["Peak seasonal speeds fall within the comfort thresholds for all assessed activities."];
  }

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
      comfort_assessment: comfortSummary(),
      zones: zones.filter((z) => z.name.trim()).map((z) => ({ zone: z.name, wants_passive_cooling: z.wantsCooling, has_windbreak_screening: z.hasScreening, assessment: zoneFlag(z).label })),
    };
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 2500,
        content: "You are a wind consultant advising on pedestrian-level wind comfort for a park design. Use ONLY the seasonal wind data, comfort-threshold assessment and zone list below - no invented statistics. The comfort thresholds are from the City of Ottawa Wind Analysis Terms of Reference (sitting 10 km/h, standing 14, strolling 17, walking 20, hazard 90). Where a season exceeds a threshold, say which activities become uncomfortable and in which season. For each zone give a one-line recommendation on whether to keep it open to the prevailing breeze or add windbreak screening. Then write a 'conclusion' field: 2-3 sentences naming the single highest-priority zone/action. Be explicit wind data here is qualitative/seasonal, not precise wind-rose measurement. Respond with ONLY valid JSON, no markdown fences: {\"zone_recommendations\": [{\"zone\": \"\", \"recommendation\": \"\"}], \"conclusion\": \"\"}\n\nDATA:\n" + JSON.stringify(summary, null, 2),
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
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "WND",
      meta,
      inputRecord: [{label:"Location",value:(typeof location!=="undefined"&&location)||"(not stated)"}],
      findings: [
        { title: "Seasonal wind reference", note: researchNote || "Built-in reference data - research the location to replace it.",
          headers: ["Season", "Prevailing", "Speed", "Dust risk", "Character"],
          rows: SEASONS.map((sn) => [sn.label, sn.prevailing, sn.speedRange, sn.dustRisk, sn.character]) },
        { title: "Pedestrian wind comfort assessment", note: "Assessed against City of Ottawa Wind Analysis Terms of Reference criteria.",
          headers: ["Season", "Speed", "Sitting <=10", "Standing <=14", "Strolling <=17", "Walking <=20", "Safety >=90"],
          rows: comfortRows() },
        { title: "Comfort criteria applied", items: [
          "Sitting (seating areas, patios): max 10 km/h",
          "Standing (entrances, waiting): max 14 km/h",
          "Strolling (plazas, parks): max 17 km/h",
          "Walking (paths, cycle routes): max 20 km/h",
          "Uncomfortable for most activities: 20 km/h and above - mitigation recommended",
          "Safety hazard: 90 km/h and above - mitigation required",
        ] },
        { title: "Site design mitigation options", items: [
          "Coniferous tree planting at exposed corners",
          "Landscape berms across the prevailing vector",
          "Permeable fences, trellises and privacy screens - filter rather than block",
          "Large rocks and tall obstacles in the pedestrian realm",
          "Staggered planting belts to slow and clean air without sealing the site",
        ] },
        { title: "Zone assessment", headers: ["Zone", "Wants cooling", "Has screening", "Assessment"],
          rows: zones.filter((z) => z.name.trim()).map((z) => [z.name, z.wantsCooling ? "Yes" : "No", z.hasScreening ? "Yes" : "No", zoneFlag(z).label]) },
      ],
      chartNote: "Wind rose, pedestrian comfort assessment and seasonal reference table are reproduced in the PDF export.",
      chartsHtml: (SEASONS.length ? `<div style="margin:12px 0;">${windRoseSVG(SEASONS, "Seasonal wind rose")}</div>` : "") +
        tableHTML(["Season", "Speed", "Sitting <=10", "Standing <=14", "Strolling <=17", "Walking <=20", "Safety >=90"],
          comfortRows(), "Pedestrian wind comfort assessment (City of Ottawa criteria)") +
        tableHTML(["Season", "Prevailing", "Speed", "Dust risk", "Character"],
          SEASONS.map((s) => [s.label, s.prevailing, s.speedRange, s.dustRisk, s.character]), "Seasonal wind reference"),
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.zone_recommendations || []).map((r)=>`${r.zone}: ${r.recommendation}`),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (includeOverflow && !overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "WND",
        reportText: buildReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() { withOverflow((o) => exportStructuredExcel(o, XLSX)); }

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
            placeholder="e.g. Riverside Park, Chicago, USA"
            className="input" />
          <button onClick={researchLocation} disabled={researching || !apiKey} className="btn-gold w-full">
            {researching ? "Researching wind data..." : "Research Wind Data for This Location"}
          </button>
          <p className="text-[10px] text-brand-text/60">
            Required. Wind characteristics are entirely location-specific, so the tool researches them for your site rather than assuming a region. Nothing is analysed until this is done.
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
            Seasonal Wind Reference {SEASONS.length ? "" : "(not yet researched)"}
          </h2>
          <span className="text-xs text-brand-text">{showRef ? "Hide" : "Show"}</span>
        </button>
        {showRef && !SEASONS.length && (
          <div className="p-4"><p className="text-xs text-brand-text">No wind data yet. Enter a project location above and research it - the tool does not assume a climate region.</p></div>
        )}
        {showRef && SEASONS.length > 0 && (
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
