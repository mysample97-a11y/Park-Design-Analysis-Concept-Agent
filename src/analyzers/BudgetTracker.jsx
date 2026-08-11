import { useState } from "react";
import { Sparkles, AlertTriangle, Calculator, Plus, Trash2, Info } from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { checklistPrompt } from "../utils/methodology";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML, formatNumber, stripRTF } from "../utils/helpers";
// Same accept list as the other consumer tools, so a report exported anywhere in
// this suite can be fed straight in without the user converting it first.
import { readExportFile, EXPORT_ACCEPT } from "../utils/readExport";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, barChartSVG, tableHTML } from "../utils/reportTemplate";

function uid() { return Math.random().toString(36).slice(2, 9); }

// Cascading wrapper percentages. These are typical industry ranges and MUST be checked
// against a published cost index for the project market - they are editable for that reason.
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
  // PDF export uses a new tab; browsers block that silently. This surfaces it -
  // the previous code called a setError() that was never declared in this file, so
  // the typeof guard swallowed the message and the click appeared to do nothing.
  const [pdfError, setPdfError] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [location, setLocation] = useState("");
  const [currency, setCurrency] = useState("");
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

  // ---- Multi-concept comparison ----
  const [conceptTexts, setConceptTexts] = useState(["", "", ""]);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState("");

  async function compareConcepts() {
    const filled = conceptTexts.map((t, i) => ({ i, t })).filter((x) => x.t.trim());
    if (filled.length < 2) { setCompareError("Paste at least two concepts to compare."); return; }
    setComparing(true); setCompareError(""); setComparison(null);
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 3000, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content: "You are a cost consultant comparing park design concepts for affordability. For EACH concept, extract its facilities and areas, apply indicative construction unit rates for the stated location, and build an order-of-cost estimate using the RICS NRM1 cascade (measured works, then preliminaries, overheads and profit, contingency, inflation). " +
          "Then compare them. Return ONLY valid JSON, no markdown fences: {" +
          "\"concepts\":[{\"name\":\"\",\"estimated_capex\":0,\"largest_cost_driver\":\"the single facility contributing most\",\"driver_share_pct\":0,\"within_budget\":true,\"confidence\":\"Verified-Macro|Verified-Adjacent-Scale|Assumption-Flagged\"}]," +
          "\"recommended\":\"name of the most FEASIBLE concept - deliverable within the budget while retaining the most design value, which is not necessarily the cheapest\"," +
          "\"recommendation_reason\":\"3-4 sentences: why this one is deliverable, what it retains that the others lose, and what the runner-up would have offered\"," +
          "\"feasibility_notes\":[{\"concept\":\"\",\"verdict\":\"Deliverable|Deliverable with reductions|Not deliverable within budget\",\"reason\":\"\"}]," +
          "\"cost_reduction_options\":[{\"concept\":\"\",\"facility\":\"\",\"action\":\"reduce, substitute or combine - and the approximate saving\"}]," +
          "\"hybrid_suggestion\":\"if elements of different concepts could be combined for better value, say how - otherwise empty string\"," +
          "\"decision_note\":\"one sentence stating plainly that this is a cost-based recommendation only and the design decision remains with the human designer\"}. " +
          "Mark every rate you could not source against a published benchmark as Assumption-Flagged. Do not present invented figures as verified.\n\n" +
          `LOCATION: ${location || "(not stated)"}\nCURRENCY: ${currency}\nBUDGET CAP: ${budgetCap || "(none stated)"}\n\n` +
          filled.map((x) => `CONCEPT ${x.i + 1}:\n${x.t}`).join("\n\n---\n\n"),
      });
      const parsed = extractJSON(text);
      if (!parsed || !parsed.concepts) throw new Error("The AI did not return a comparison in the expected format. Try again.");
      setComparison(parsed);
    } catch (e) {
      setCompareError(e.message || "Could not compare concepts.");
    } finally { setComparing(false); }
  }

  async function researchRates() {
    const named = facilities.filter((f) => f.name.trim());
    if (!named.length) { setResearchError("Add at least one facility first."); return; }
    if (!location.trim()) { setResearchError("Enter a project location so rates can be researched for the right market."); return; }
    setResearching(true); setResearchError("");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 2500, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
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
      // Shared reader. The old code read only the FIRST sheet of a workbook - but the
      // reports this suite exports carry eleven sheets, so the facility schedule was
      // silently missed. It also could not read PDF at all.
      const res = await readExportFile(file);
      const text = res.text;
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
        content: "You are a cost-planning assistant reviewing a park redesign budget estimate built with a cascading wrapper method (RICS NRM1 style). Using ONLY the data given, provide: (1) 'observations': array of short strings on where the biggest cost drivers are and any figures that look unusually high/low, (2) 'confidence_note': 1-2 sentences on which parts of this estimate rest on Assumption-Flagged rates and should be verified, (3) 'conclusion': 2-3 sentences on overall feasibility/next cost-planning step. Do not invent benchmark prices not present. Respond with ONLY valid JSON, no markdown fences: {\"observations\": [\"\"], \"confidence_note\": \"\", \"conclusion\": \"\"}" + checklistPrompt("BDG") + "\n\nDATA:\n" + JSON.stringify(summary, null, 2),
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
    wrapperRows.forEach((r) => lines.push(`  ${r.label}: ${formatNumber(r.amount)} ${currency}${r.confidence ? ` [${r.confidence}]` : ""}`));
    if (insight) {
      lines.push("", "AI OBSERVATIONS");
      (insight.observations || []).forEach((o) => lines.push(`  - ${o}`));
      lines.push("", "CONFIDENCE NOTE", insight.confidence_note || "", "", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  const [webSources, setWebSources] = useState([]);
  const [groundingNote, setGroundingNote] = useState("");
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "BDG",
      meta,
      inputRecord: [{label:"Facilities entered",value:String(facilities.filter((f)=>f.name.trim()).length)},{label:"Rate assumptions",value:Object.entries(rates).map(([k,r])=>`${k} ${r.pct}% (${r.confidence})`).join("; ")}],
      findings: [
        { title: "Facility schedule", headers: ["Facility", "Area m2", `Rate ${currency}/m2`, "Subtotal", "Rate basis"],
          rows: facilities.filter((f) => f.name.trim()).map((f) => [f.name, f.area, f.rate, formatNumber((Number(f.area)||0)*(Number(f.rate)||0)), f.rateBasis || "user-entered"]) },
        { title: "Cost build-up (RICS NRM1 cascade)", headers: ["Cost line", "Basis", `Amount ${currency}`, "Confidence"],
          rows: wrapperRows.map((r) => [r.label, r.detail, formatNumber(r.amount), r.confidence || ""]) },
        ...(comparison ? [{ title: "Concept cost comparison",
          note: `Recommended: ${comparison.recommended}. ${comparison.recommendation_reason || ""}`,
          headers: ["Concept", `Est. CAPEX ${currency}`, "Largest cost driver", "Feasibility verdict", "Confidence"],
          rows: (comparison.concepts || []).map((c) => {
            const fv = (comparison.feasibility_notes || []).find((f) => f.concept === c.name);
            return [c.name, formatNumber(c.estimated_capex), c.largest_cost_driver, fv ? fv.verdict : (c.within_budget ? "Deliverable" : "Not deliverable within budget"), c.confidence];
          }) },
        { title: "Cost reduction options",
          items: (comparison.cost_reduction_options || []).map((o) => `${o.concept} / ${o.facility}: ${o.action}`)
            .concat(comparison.hybrid_suggestion ? [`Hybrid option: ${comparison.hybrid_suggestion}`] : []) },
        { title: "Decision status",
          text: comparison.decision_note || "This is a cost-based recommendation only. The design decision remains with the designer." }] : []),
      ],
      chartNote: "Cost build-up chart and facility schedule are reproduced in the PDF export.",
      chartsHtml: tableHTML(["Facility", "Area m2", "Rate", "Subtotal"],
          facilities.filter((f) => f.name.trim()).map((f) => [f.name, f.area, f.rate, formatNumber((Number(f.area)||0)*(Number(f.rate)||0))]),
          "Facility schedule")
        + barChartSVG(wrapperRows.map((r) => ({ label: r.label, value: r.amount, display: formatNumber(r.amount), color: r.bold ? "#1C2333" : "#C9A46A" })),
            { title: "Cost build-up" }),
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.observations || []),
      runLimitations: [],
      extraRefs: webSources,
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
  function exportExcel() { withOverflow((o) => exportStructuredExcel(o, XLSX)); }
  function exportWord() { withOverflow((o) => exportStructuredWord(o)); }
  function exportPDF() {
    setPdfError("");
    withOverflow((o) => exportStructuredPDF(o, () => {
      setPdfError("Your browser blocked the new tab needed for PDF export. Allow pop-ups for this site and try again.");
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
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Chicago, USA" className="input text-xs mt-0.5" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Currency</label>
              <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="e.g. AED, USD, EUR, INR" className="input text-xs mt-0.5 font-mono" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Budget cap (optional)</label>
              <input type="number" value={budgetCap} onChange={(e) => setBudgetCap(e.target.value)} placeholder="35000000" className="input text-xs mt-0.5 font-mono" />
            </div>
          </div>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste a concept's facility schedule (the Concept Generator now lists facilities per zone with areas), or a program description..." rows={4} className="textarea" />
          <label className="text-[11px] font-medium text-brand-gold flex items-center gap-1 cursor-pointer hover:underline w-fit">
            <Plus size={12} /> Upload facility list (.xlsx, .csv, .docx, .rtf, .txt)
            <input type="file" accept={EXPORT_ACCEPT} onChange={handleFacilityFile} className="sr-only" />
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

        sourceNote={groundingNote}

        sourceCount={webSources.length}

      />


      <div className="card">
        <div className="card-header">Compare Concepts (optional)</div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-brand-text">
            Paste two or three concepts from the Concept Generator (its report lists facilities and areas per zone).
            Each is costed separately, then compared on value for money - not simply lowest cost.
          </p>
          {conceptTexts.map((t, i) => (
            <textarea key={i} value={t} rows={3} className="textarea"
              placeholder={`Concept ${i + 1} - paste its facility schedule / zone list`}
              onChange={(e) => { const c = [...conceptTexts]; c[i] = e.target.value; setConceptTexts(c); }} />
          ))}
          <button onClick={compareConcepts} disabled={comparing || !apiKey} className="btn-dark w-full">
            <Sparkles size={15} /> {comparing ? "Comparing concepts..." : "Compare Concepts & Recommend Best Value"}
          </button>
          {compareError && <p className="text-xs text-brand-danger">{friendlyError(compareError)}</p>}
          {comparison && (
            <div className="space-y-3">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-brand-text/60 border-b border-brand-border">
                  <th className="py-2 pr-2">Concept</th><th className="py-2 pr-2">Est. CAPEX</th>
                  <th className="py-2 pr-2">Largest cost driver</th><th className="py-2 pr-2">Within budget</th><th className="py-2">Confidence</th>
                </tr></thead>
                <tbody>{(comparison.concepts || []).map((c, i) => (
                  <tr key={i} className="border-b border-brand-border/50">
                    <td className="py-2 pr-2 font-semibold">{c.name}</td>
                    <td className="py-2 pr-2 font-mono">{formatNumber(c.estimated_capex)} {currency}</td>
                    <td className="py-2 pr-2">{c.largest_cost_driver} {c.driver_share_pct ? `(${c.driver_share_pct}%)` : ""}</td>
                    <td className="py-2 pr-2" style={{ color: c.within_budget ? "#3D7A5C" : "#B84C3D" }}>{c.within_budget ? "Yes" : "No"}</td>
                    <td className="py-2" style={{ color: CONFIDENCE_COLOR[c.confidence] || "#5A5445" }}>{c.confidence}</td>
                  </tr>))}
                </tbody>
              </table>
              <div className="rounded-lg border-2 p-3" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}>
                <p className="text-sm text-brand-dark"><span className="font-bold">Best value: {comparison.recommended}</span></p>
                <p className="text-xs text-brand-dark mt-1">{comparison.recommendation_reason}</p>
                {(comparison.feasibility_notes || []).length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {comparison.feasibility_notes.map((f, i) => (
                      <p key={i} className="text-[11px]">
                        <span className="font-semibold">{f.concept}:</span>{" "}
                        <span style={{ color: f.verdict === "Deliverable" ? "#3D7A5C" : f.verdict === "Not deliverable within budget" ? "#B84C3D" : "#B8863B" }}>{f.verdict}</span>
                        {" - "}{f.reason}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-brand-text/70 mt-2 pt-2 border-t border-brand-border">
                  {comparison.decision_note || "This is a cost-based recommendation only. The design decision remains yours - review it against the analysis findings and your own judgement before fixing a concept."}
                </p>
              </div>
              {(comparison.cost_reduction_options || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-brand-text uppercase tracking-wide mb-1">Cost reduction options</p>
                  {comparison.cost_reduction_options.map((o, i) => (
                    <p key={i} className="text-[11px] text-brand-dark">- <span className="font-semibold">{o.concept} / {o.facility}:</span> {o.action}</p>
                  ))}
                </div>
              )}
              {comparison.hybrid_suggestion && (
                <p className="text-[11px] text-brand-success"><span className="font-semibold">Hybrid option:</span> {comparison.hybrid_suggestion}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h3>
        {pdfError && <p className="text-[11px] text-brand-danger mb-2 flex items-center gap-1"><AlertTriangle size={11} /> {pdfError}</p>}
              <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
      </div>
    </div>
  );
}
