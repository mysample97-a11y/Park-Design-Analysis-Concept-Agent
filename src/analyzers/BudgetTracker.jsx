import { useState } from "react";
import { Sparkles, AlertTriangle, Calculator, Plus, Trash2, Info } from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML, formatNumber, stripRTF } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, generateOverflow, nextDocRef, buildStructuredReport, barChartSVG, tableHTML } from "../utils/reportTemplate";

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
  const { provider, apiKey, meta } = useAppContext();
  const [facilities, setFacilities] = useState([
    { id: uid(), name: "", area: "", rate: "" },
  ]);
  const [rates, setRates] = useState(DEFAULT_RATES);
  const [pasteText, setPasteText] = useState("");
  const [location, setLocation] = useState("");
  const [currency, setCurrency] = useState("AED");
  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState("");
  const [researchError, setResearchError] = useState("");
  const [budgetCap, setBudgetCap] = useState("");
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
        provider, apiKey, maxTokens: 2500,
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

  async function researchRates() {
    const named = facilities.filter((f) => f.name.trim());
    if (!named.length) { setResearchError("Add at least one facility first."); return; }
    if (!location.trim()) { setResearchError("Enter a project location so rates can be researched for the right market."); return; }
    setResearching(true); setResearchError("");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 2500, useWebSearch: provider === "claude",
        content: "You are a cost consultant. For each facility below, give an indicative construction unit rate per square metre for the stated location and currency, based on published construction cost benchmarks you can actually cite (e.g. international construction cost indices, published market reports). " +
          "For each facility return: {name, rate_per_m2 (number), basis (the published source or benchmark type you based it on), confidence ('Verified-Macro' if from a published national/city index, 'Verified-Adjacent-Scale' if from a comparable project type, 'Assumption-Flagged' if you are inferring without a specific published benchmark)}. " +
          "Do NOT invent a precise figure and present it as verified - if you have no benchmark, give your best estimate and mark it Assumption-Flagged. " +
          `Respond with ONLY a valid JSON array, no markdown fences.\n\nLOCATION: ${location}\nCURRENCY: ${currency}\nFACILITIES:\n` +
          named.map((f) => `- ${f.name}${f.area ? ` (${f.area} m2)` : ""}`).join("\n"),
      });
      const parsed = extractJSON(text);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("The AI did not return rates in the expected format. Try again, or enter rates manually.");
      setFacilities((prev) => prev.map((f) => {
        const hit = parsed.find((r) => (r.name || "").toLowerCase().trim() === f.name.toLowerCase().trim());
        return hit ? { ...f, rate: String(hit.rate_per_m2 ?? f.rate), rateBasis: hit.basis || "", rateConfidence: hit.confidence || "Assumption-Flagged" } : f;
      }));
      setResearchNote(`Rates researched for ${location} in ${currency}. Every rate carries a confidence band - verify Assumption-Flagged items before relying on the total.`);
    } catch (e) {
      setResearchError(e.message || "Could not research rates.");
    } finally { setResearching(false); }
  }

  async function handleFacilityFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setDetectError("");
    try {
      const name = (file.name || "").toLowerCase();
      let text = "";
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      } else if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      } else if (name.endsWith(".rtf")) {
        text = stripRTF(await file.text());
      } else if (name.endsWith(".txt") || name.endsWith(".csv")) {
        text = await file.text();
      } else {
        throw new Error("Unsupported file. Use .xlsx, .csv, .docx, .rtf or .txt - or paste the text instead.");
      }
      setPasteText((prev) => (prev ? prev + "\n\n" : "") + text);
    } catch (err) {
      setDetectError(err.message || "Could not read this file.");
    } finally { e.target.value = ""; }
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
        provider, apiKey, maxTokens: 2500,
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
    facilities.filter((f) => f.name.trim()).forEach((f) => lines.push(`  ${f.name}: ${f.area} m2 x ${f.rate} = ${formatNumber((Number(f.area) || 0) * (Number(f.rate) || 0))} ${currency}`));
    lines.push("", "COST BUILD-UP");
    wrapperRows.forEach((r) => lines.push(`  ${r.label}: ${formatNumber(r.amount)} AED${r.confidence ? ` [${r.confidence}]` : ""}`));
    if (insight) {
      lines.push("", "AI OBSERVATIONS");
      (insight.observations || []).forEach((o) => lines.push(`  - ${o}`));
      lines.push("", "CONFIDENCE NOTE", insight.confidence_note || "", "", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "BDG",
      meta,
      inputRecord: [{label:"Facilities entered",value:String(facilities.filter((f)=>f.name.trim()).length)},{label:"Rate assumptions",value:Object.entries(rates).map(([k,r])=>`${k} ${r.pct}% (${r.confidence})`).join("; ")}],
      findings: [{ title: "Analysis output", text: buildReportText() }],
      chartNote: "Cost build-up chart and facility schedule are reproduced in the PDF export.",
      chartsHtml: tableHTML(["Facility", "Area m2", "Rate", "Subtotal"],
          facilities.filter((f) => f.name.trim()).map((f) => [f.name, f.area, f.rate, formatNumber((Number(f.area)||0)*(Number(f.rate)||0))]),
          "Facility schedule")
        + barChartSVG(wrapperRows.map((r) => ({ label: r.label, value: r.amount, display: formatNumber(r.amount), color: r.bold ? "#1C2333" : "#C9A46A" })),
            { title: "Cost build-up" }),
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.observations || []),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (includeOverflow && !overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "BDG",
        reportText: buildReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Facility", "Area m2", "Rate /m2", "Subtotal AED"], ...facilities.filter((f) => f.name.trim()).map((f) => [f.name, Number(f.area) || 0, Number(f.rate) || 0, (Number(f.area) || 0) * (Number(f.rate) || 0)])]), "Facilities");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Cost Line", "Detail", "Amount AED", "Confidence"], ...wrapperRows.map((r) => [r.label, r.detail, Math.round(r.amount), r.confidence || ""])]), "Cost Build-Up");
    if (insight) {
      const rows = [["Observations"]];
      (insight.observations || []).forEach((o) => rows.push([o]));
      rows.push([], ["Confidence Note", insight.confidence_note], ["Conclusion", insight.conclusion]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "AI Insight");
    }
    downloadFile(XLSX.write(wb, { bookType: "xlsx", type: "array" }), "budget-estimate.xlsx", "application/octet-stream");
  }
  function exportWord() { withOverflow((o) => exportStructuredWord(o)); }
  function exportPDF() {
    withOverflow((o) => exportStructuredPDF(o, () => {
      if (typeof setError === "function") setError("Your browser blocked the new tab needed for PDF export. Allow pop-ups and try again.");
    }));
  }

  return (
    <div className="space-y-6">
      <ToolIntro toolCode="BDG" />

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
          <div className="grid sm:grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Project location</label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Dubai, UAE" className="input text-xs mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Currency</label>
              <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="AED" className="input text-xs mt-0.5 font-mono" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Budget cap (optional)</label>
              <input type="number" value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} placeholder="35000000" className="input text-xs mt-0.5 font-mono" />
            </div>
          </div>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste a concept's facility schedule (the Concept Generator now lists facilities per zone with areas), or a program description..." rows={4} className="textarea" />
          <label className="text-[11px] font-medium text-brand-gold flex items-center gap-1 cursor-pointer hover:underline w-fit">
            <Plus size={12} /> Upload facility list (.xlsx, .csv, .docx, .rtf, .txt)
            <input type="file" accept=".xlsx,.xls,.csv,.docx,.rtf,.txt" onChange={handleFacilityFile} className="sr-only" />
          </label>
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
          <div className="flex gap-2 text-[10px] uppercase tracking-wide text-brand-text/60 px-1"><span className="flex-1">Facility</span><span className="w-24">Area m2</span><span className="w-28">Rate /m2</span><span className="w-28 text-right">Subtotal</span><span className="w-6" /></div>
          {facilities.map((f) => (
            <div key={f.id} className="flex gap-2 items-center text-sm">
              <input value={f.name} onChange={(e) => updateFacility(f.id, { name: e.target.value })} placeholder="Name" className="flex-1 bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 focus:border-brand-gold outline-none" />
              <input type="number" value={f.area} onChange={(e) => updateFacility(f.id, { area: e.target.value })} placeholder="m2" className="w-24 bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 font-mono focus:border-brand-gold outline-none" />
              <input type="number" value={f.rate} onChange={(e) => updateFacility(f.id, { rate: e.target.value })} placeholder="/m2" className="w-28 bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 font-mono focus:border-brand-gold outline-none" />
              <span className="w-28 text-right font-mono text-xs">{formatNumber((Number(f.area) || 0) * (Number(f.rate) || 0))}</span>
              <button onClick={() => removeFacility(f.id)} className="text-brand-text/40 hover:text-brand-danger w-6"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">Unit Rates</div>
        <div className="p-4 space-y-2">
          <p className="text-[11px] text-brand-text">
            Rates drive every figure below. Without them the estimate is zero. Research them from published
            construction cost benchmarks for your location, then review each one - or type them directly in the table above.
          </p>
          <button onClick={researchRates} disabled={researching || !apiKey} className="btn-gold w-full">
            <Sparkles size={16} /> {researching ? "Researching rates..." : "Research Unit Rates for This Location"}
          </button>
          {researchNote && <p className="text-[11px] text-brand-success">{researchNote}</p>}
          {researchError && <p className="text-[11px] text-brand-danger">{friendlyError(researchError)}</p>}
          {facilities.some((f) => f.rateBasis) && (
            <div className="mt-2 space-y-1">
              {facilities.filter((f) => f.rateBasis).map((f) => (
                <p key={f.id} className="text-[10px] text-brand-text">
                  <span className="font-semibold">{f.name}:</span> {f.rate} {currency}/m2 -
                  <span style={{ color: CONFIDENCE_COLOR[f.rateConfidence] || "#5A5445" }}> {f.rateConfidence}</span> - {f.rateBasis}
                </p>
              ))}
            </div>
          )}
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
                  <td className="py-2 text-right font-mono">{formatNumber(r.amount)} {currency}</td>
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

      <ReportPreview

        reportText={buildStructuredReport({ ...structuredOpts(), docRef: "preview" })}

        chartsHtml={structuredOpts().chartsHtml}

        includeOverflow={includeOverflow}

        setIncludeOverflow={setIncludeOverflow}

      />


      <div className="card p-4">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h3>
        <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
      </div>
    </div>
  );
}
