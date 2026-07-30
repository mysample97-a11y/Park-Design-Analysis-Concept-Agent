import { useState } from "react";
import { Sparkles, AlertTriangle, Calculator, Plus, Trash2, Info } from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { useAppContext } from "../App";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML, formatNumber } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";

function uid() { return Math.random().toString(36).slice(2, 9); }

// Cascading wrapper rates with confidence bands (Turner & Townsend UAEMI-style defaults, editable)
const DEFAULT_RATES = {
  preliminaries: { pct: 13, base: "Construction Subtotal", confidence: "Verified-Macro" },
  ohp: { pct: 11, base: "Subtotal + Preliminaries", confidence: "Verified-Macro" },
  contingency: { pct: 10, base: "Subtotal + Prelim + OH&P", confidence: "Assumption-Flagged" },
  inflation: { pct: 4, base: "Running total", confidence: "Verified-Macro" },
  opex: { pct: 5, base: "Total CAPEX (annual)", confidence: "Assumption-Flagged" },
};

const CONFIDENCE_COLOR = {
  "Verified-Macro": "#3D7A5C",
  "Verified-Adjacent-Scale": "#B8863B",
  "Assumption-Flagged": "#B84C3D",
};

export default function BudgetTracker() {
  const { provider, apiKey } = useAppContext();
  const [facilities, setFacilities] = useState([
    { id: uid(), name: "", area: "", rate: "" },
  ]);
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [pasteText, setPasteText] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");

  function addFacility() { setFacilities([...facilities, { id: uid(), name: "", area: "", rate: "" }]); }
  function updateFacility(id, patch) { setFacilities(facilities.map((f) => (f.id === id ? { ...f, ...patch } : f))); }
  function removeFacility(id) { setFacilities(facilities.filter((f) => f.id !== id)); }
  function updateRate(key, patch) { setRates({ ...rates, [key]: { ...rates[key], ...patch } }); }

  async function autoDetect() {
    if (!pasteText.trim()) { setDetectError("Paste a facility/program description first."); return; }
    setDetecting(true); setDetectError("");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 1500,
        content: "Extract a list of built facilities/zones from this park program description. For each, output {name, area (number in square meters, estimate if not stated but mark estimated), category}. Respond with ONLY a valid JSON array, no markdown fences.\n\nDESCRIPTION:\n" + pasteText,
      });
      const parsed = extractJSON(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a list of facilities.");
      setFacilities(parsed.map((f) => ({ id: uid(), name: f.name || "", area: f.area || "", rate: "", category: f.category || "" })));
    } catch (e) {
      setDetectError(e.message || "Could not detect facilities. Try again or enter them manually.");
    } finally {
      setDetecting(false);
    }
  }

  // Cascading calculation
  const constructionSubtotal = facilities.reduce((sum, f) => sum + (Number(f.area) || 0) * (Number(f.rate) || 0), 0);
  const prelimAmount = constructionSubtotal * (rates.preliminaries.pct / 100);
  const afterPrelim = constructionSubtotal + prelimAmount;
  const ohpAmount = afterPrelim * (rates.ohp.pct / 100);
  const afterOhp = afterPrelim + ohpAmount;
  const contingencyAmount = afterOhp * (rates.contingency.pct / 100);
  const afterContingency = afterOhp + contingencyAmount;
  const inflationAmount = afterContingency * (rates.inflation.pct / 100);
  const totalCapex = afterContingency + inflationAmount;
  const annualOpex = totalCapex * (rates.opex.pct / 100);

  const wrapperRows = [
    { label: "Construction Subtotal", detail: "Sum of (area x rate) for all facilities", amount: constructionSubtotal, confidence: null },
    { label: `Preliminaries (${rates.preliminaries.pct}%)`, detail: `Applied to ${rates.preliminaries.base}`, amount: prelimAmount, confidence: rates.preliminaries.confidence },
    { label: `Overheads & Profit (${rates.ohp.pct}%)`, detail: `Applied to ${rates.ohp.base}`, amount: ohpAmount, confidence: rates.ohp.confidence },
    { label: `Contingency (${rates.contingency.pct}%)`, detail: `Applied to ${rates.contingency.base}`, amount: contingencyAmount, confidence: rates.contingency.confidence },
    { label: `Inflation (${rates.inflation.pct}%)`, detail: `Applied to ${rates.inflation.base}`, amount: inflationAmount, confidence: rates.inflation.confidence },
    { label: "TOTAL CAPEX", detail: "Full estimated capital cost", amount: totalCapex, confidence: null, bold: true },
    { label: `Annual OPEX (${rates.opex.pct}%)`, detail: `Applied to ${rates.opex.base}`, amount: annualOpex, confidence: rates.opex.confidence },
  ];

  async function generateInsight() {
    setInsightLoading(true); setInsight(null); setInsightError("");
    const summary = {
      facilities: facilities.filter((f) => f.name.trim()).map((f) => ({ name: f.name, area_m2: f.area, rate_per_m2: f.rate, subtotal: (Number(f.area) || 0) * (Number(f.rate) || 0) })),
      construction_subtotal: constructionSubtotal,
      total_capex: totalCapex,
      annual_opex: annualOpex,
      rate_assumptions: rates,
    };
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 1200,
        content: "You are a cost-planning assistant reviewing a park redesign budget estimate built with a cascading wrapper method (RICS NRM1 style). Using ONLY the data given, provide: (1) 'observations': array of short strings on where the biggest cost drivers are and any figures that look unusually high/low, (2) 'confidence_note': 1-2 sentences on which parts of this estimate rest on Assumption-Flagged rates and should be verified, (3) 'conclusion': 2-3 sentences on overall feasibility/next cost-planning step. Do not invent benchmark prices not present. Respond with ONLY valid JSON, no markdown fences: {\"observations\": [\"\"], \"confidence_note\": \"\", \"conclusion\": \"\"}\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });
      setInsight(extractJSON(text));
    } catch (e) {
      setInsightError(e.message || "Something went wrong generating the insight. Try again.");
    } finally {
      setInsightLoading(false);
    }
  }

  function buildReportText() {
    let lines = ["BUDGET TRACKER - COST ESTIMATE (MVP/PROTOTYPE)", "Method: cascading wrapper (RICS NRM1 style). Rates carry confidence bands - verify Assumption-Flagged items.", "", "FACILITIES"];
    facilities.filter((f) => f.name.trim()).forEach((f) => lines.push(`  ${f.name}: ${f.area} m2 x ${f.rate} = ${formatNumber((Number(f.area) || 0) * (Number(f.rate) || 0))} AED`));
    lines.push("", "COST BUILD-UP");
    wrapperRows.forEach((r) => lines.push(`  ${r.label}: ${formatNumber(r.amount)} AED${r.confidence ? ` [${r.confidence}]` : ""}`));
    if (insight) {
      lines.push("", "AI OBSERVATIONS");
      (insight.observations || []).forEach((o) => lines.push(`  - ${o}`));
      lines.push("", "CONFIDENCE NOTE", insight.confidence_note || "", "", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Facility", "Area m2", "Rate AED/m2", "Subtotal AED"], ...facilities.filter((f) => f.name.trim()).map((f) => [f.name, Number(f.area) || 0, Number(f.rate) || 0, (Number(f.area) || 0) * (Number(f.rate) || 0)])]), "Facilities");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cost Line", "Detail", "Amount AED", "Confidence"], ...wrapperRows.map((r) => [r.label, r.detail, Math.round(r.amount), r.confidence || ""])]), "Cost Build-Up");
    if (insight) {
      const rows = [["Observations"]];
      (insight.observations || []).forEach((o) => rows.push([o]));
      rows.push([], ["Confidence Note", insight.confidence_note], ["Conclusion", insight.conclusion]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "AI Insight");
    }
    downloadFile(XLSX.write(wb, { bookType: "xlsx", type: "array" }), "budget-estimate.xlsx", "application/octet-stream");
  }
  function exportWord() { downloadFile(buildRTF(buildReportText()), "budget-estimate.rtf", "application/rtf"); }
  function exportPDF() {
    const barsHtml = wrapperRows.map((r) => { const max = Math.max(1, totalCapex); return `<div style="display:flex;align-items:center;margin-bottom:4px;"><div style="width:180px;font-size:11px;text-align:right;padding-right:8px;${r.bold ? "font-weight:bold;" : ""}">${r.label}</div><div style="background:${r.bold ? "#1C2333" : "#C9A46A"};height:14px;width:${Math.max(3, (r.amount / max) * 240)}px;border-radius:2px;margin-right:6px;"></div><div style="font-size:11px;">${formatNumber(r.amount)}</div></div>`; }).join("");
    const html = `<html><head><title>Budget Estimate</title><style>body{font-family:Arial;padding:30px;color:#1C2333;}h1{color:#1C2333;}h2{color:#5A5445;border-bottom:1px solid #E8E2D5;}table{border-collapse:collapse;width:100%;font-size:11px;}td,th{border:1px solid #ddd;padding:4px;}.note{background:#FBEAE7;border:1px solid #F0C8C0;padding:10px;border-radius:6px;font-size:12px;margin-bottom:20px;}.conclusion{background:#FBF1E1;border:1px solid #E8D5B0;padding:14px;border-radius:6px;margin-top:16px;}</style></head><body>
    <h1>Budget Estimate - MVP/Prototype</h1>
    <div class="note"><b>Note:</b> Cascading wrapper cost estimate (RICS NRM1 style). Rates carry confidence bands; Assumption-Flagged items must be verified against real benchmark data before use.</div>
    <h2>Facilities</h2><table><tr><th>Facility</th><th>Area m2</th><th>Rate AED/m2</th><th>Subtotal AED</th></tr>${facilities.filter((f) => f.name.trim()).map((f) => `<tr><td>${f.name}</td><td>${f.area}</td><td>${f.rate}</td><td>${formatNumber((Number(f.area) || 0) * (Number(f.rate) || 0))}</td></tr>`).join("")}</table>
    <h2>Cost Build-Up</h2>${barsHtml}
    ${insight ? `<h2>AI Observations</h2><ul>${(insight.observations || []).map((o) => `<li>${o}</li>`).join("")}</ul><p><b>Confidence:</b> ${insight.confidence_note || ""}</p>` : ""}
    ${insight?.conclusion ? `<div class="conclusion"><b>Conclusion:</b> ${insight.conclusion}</div>` : ""}
    </body></html>`;
    printHTML(html, () => setInsightError("Your browser blocked the new tab needed for PDF export. Allow pop-ups and try again."));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-brand-dark flex items-center gap-2"><Calculator size={20} className="text-brand-gold" /> Budget Tracker</h2>
        <p className="text-sm text-brand-text mt-1">Estimate capital and operating cost with a cascading wrapper method - every rate carries an honest confidence band.</p>
      </div>

      <div className="bg-brand-warm border border-brand-border rounded-lg p-4 flex gap-3">
        <Info size={18} className="text-brand-warning shrink-0 mt-0.5" />
        <p className="text-sm text-brand-text"><span className="font-semibold">Rates are editable defaults, not verified for your site.</span> Confidence bands (Verified-Macro / Verified-Adjacent-Scale / Assumption-Flagged) show how much to trust each - always verify Assumption-Flagged items against real benchmark data before relying on the total.</p>
      </div>

      <div className="card">
        <div className="card-header">Auto-Detect Facilities (optional)</div>
        <div className="p-4 space-y-3">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste a program/facility description and let AI extract the facility list with areas..." rows={4} className="textarea" />
          <button onClick={autoDetect} disabled={detecting || !apiKey} className="btn-gold w-full"><Sparkles size={16} /> {detecting ? "Detecting..." : "Auto-Detect Facilities"}</button>
          {detectError && (<div className="space-y-1"><p className="text-xs text-brand-dark flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(detectError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-4">Technical: {detectError}</p></div>)}
        </div>
      </div>

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <span>Facilities</span>
          <button onClick={addFacility} className="btn-gold text-xs px-3 py-1.5"><Plus size={13} /> Add</button>
        </div>
        <div className="p-4 space-y-2">
          <div className="flex gap-2 text-[10px] uppercase tracking-wide text-brand-text/60 px-1"><span className="flex-1">Facility</span><span className="w-24">Area m2</span><span className="w-28">Rate AED/m2</span><span className="w-28 text-right">Subtotal</span><span className="w-6" /></div>
          {facilities.map((f) => (
            <div key={f.id} className="flex gap-2 items-center text-sm">
              <input value={f.name} onChange={(e) => updateFacility(f.id, { name: e.target.value })} placeholder="Name" className="flex-1 bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 focus:border-brand-gold outline-none" />
              <input type="number" value={f.area} onChange={(e) => updateFacility(f.id, { area: e.target.value })} placeholder="m2" className="w-24 bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 font-mono focus:border-brand-gold outline-none" />
              <input type="number" value={f.rate} onChange={(e) => updateFacility(f.id, { rate: e.target.value })} placeholder="AED/m2" className="w-28 bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 font-mono focus:border-brand-gold outline-none" />
              <span className="w-28 text-right font-mono text-xs">{formatNumber((Number(f.area) || 0) * (Number(f.rate) || 0))}</span>
              <button onClick={() => removeFacility(f.id)} className="text-brand-text/40 hover:text-brand-danger w-6"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">Cost Build-Up (cascading wrapper) & Rate Assumptions</div>
        <div className="p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-2">
            {Object.entries(rates).map(([key, r]) => (
              <div key={key} className="flex items-center gap-2 text-xs border border-brand-border rounded px-2 py-1.5">
                <span className="flex-1 capitalize">{key}</span>
                <input type="number" value={r.pct} onChange={(e) => updateRate(key, { pct: Number(e.target.value) })} className="w-14 bg-[#F7F5F1] border border-brand-border rounded px-1.5 py-1 font-mono" />
                <span>%</span>
                <select value={r.confidence} onChange={(e) => updateRate(key, { confidence: e.target.value })} className="text-[10px] bg-[#F7F5F1] border border-brand-border rounded px-1 py-1" style={{ color: CONFIDENCE_COLOR[r.confidence] }}>
                  <option value="Verified-Macro">Verified-Macro</option>
                  <option value="Verified-Adjacent-Scale">Verified-Adjacent-Scale</option>
                  <option value="Assumption-Flagged">Assumption-Flagged</option>
                </select>
              </div>
            ))}
          </div>
          <table className="w-full text-sm mt-2">
            <tbody>
              {wrapperRows.map((r, i) => (
                <tr key={i} className={`border-b border-brand-border/40 ${r.bold ? "font-bold" : ""}`}>
                  <td className="py-2">{r.label}<span className="block text-[10px] text-brand-text/50 font-normal">{r.detail}</span></td>
                  <td className="py-2 text-right font-mono">{formatNumber(r.amount)} AED</td>
                  <td className="py-2 pl-3 text-right">{r.confidence && <span className="text-[10px] font-medium" style={{ color: CONFIDENCE_COLOR[r.confidence] }}>{r.confidence}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text">AI Insight & Recommendation</h3>
          <button onClick={generateInsight} disabled={insightLoading || !apiKey} className="btn-dark"><Sparkles size={15} /> {insightLoading ? "Analyzing..." : "Generate AI Insight"}</button>
        </div>
        {insightLoading && <p className="text-sm text-brand-text">Reviewing cost build-up...</p>}
        {insightError && (<div className="space-y-1"><p className="text-sm text-brand-dark flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(insightError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {insightError}</p></div>)}
        {insight && (
          <div className="space-y-2 text-sm text-brand-dark">
            <div className="space-y-1">{(insight.observations || []).map((o, i) => (<p key={i}>- {o}</p>))}</div>
            {insight.confidence_note && <p className="text-xs text-brand-warning"><span className="font-semibold">Confidence:</span> {insight.confidence_note}</p>}
          </div>
        )}
        {!insight && !insightLoading && !insightError && <p className="text-sm text-brand-text">Add facilities and rates above, then generate a cost-planning read.</p>}
      </div>

      {insight?.conclusion && (
        <div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}>
          <h3 className="font-bold text-sm uppercase tracking-wide text-brand-warning mb-2">Conclusion</h3>
          <p className="text-sm text-brand-dark leading-relaxed font-medium">{insight.conclusion}</p>
        </div>
      )}

      <div className="card p-4">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h3>
        <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
      </div>
    </div>
  );
}
