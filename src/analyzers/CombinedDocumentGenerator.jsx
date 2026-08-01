import { useState } from "react";
import { Sparkles, AlertTriangle, Info, Layers, Copy, CheckCircle2, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import * as mammoth from "mammoth";
import { callAI } from "../utils/ai";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML, stripRTF, fileToBase64Raw, copyToClipboard } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, generateOverflow, nextDocRef, tableHTML } from "../utils/reportTemplate";

const REG_DEFAULT = `Governing Standards: Dubai Universal Design Code (max ramp gradient 8%/1:12, min ramp width 1.0m, min crossing width 2.0m, max cross-fall 2%, max ramp run 10m, handrails above 0.5m level change); UAE Federal Law No. 29 of 2006 (Rights of People of Determination); Neighborhood Parks Manual (peak capacity 150-400 visitors/10,000sqm by density band, 15% leasable/commercial area target).
Compliance method: every path/ramp/crossing checked programmatically against these standards, tagged Pass/Needs Review/Pending.
Limitation: gradient not verifiable without real site elevation data; terrain assumed flat (Dubai coastal, ~2m ASL) pending DWG confirmation.
Commercial & Service Facilities Map required per Schedule 1(E), tracked as a mandatory deliverable.`;

const PRECEDENT_DEFAULT = `Al Safa Park 1 (direct sister-park precedent, redesigned for the same Dubai Canal reason): post-occupancy evaluation found family-only parking, signed pedestrian walkways, pocket-park green buffers, nighttime pedestrian lighting, strict pedestrian/cyclist separation, and maintained natural landscaping drove visitor satisfaction.
Al Khazan Park (nearby Dubai Municipality redevelopment): fully solar-powered, identity-themed - confirms full solar power is an executed Dubai precedent.
Vancouver Convention Centre West: on-site biomembrane reactor treats 100% of building wastewater, supplies ~80% of greywater needs and irrigates its living roof, ~68% of total water use reclaimed - real source for the elevated pavilion's greywater-fed planting concept, adapted at park scale.
Note: precedents cited for design logic, not scale-equivalent replication.`;

const SECTIONS = [
  { id: "site", label: "1. Site Location & Urban Context", placeholder: "Paste the Site Context tool's adjacency findings + GIS map notes...", default: "" },
  { id: "climate", label: "2. Climatic Analysis", placeholder: "Paste the Solar + Wind tool conclusions...", default: "" },
  { id: "vegetation", label: "3. Vegetation, Terrain & Soil", placeholder: "Paste the Vegetation tool's conclusion...", default: "" },
  { id: "community", label: "4. User & Community Analysis", placeholder: "Paste the Survey Analyzer's conclusion + Parks Manual capacity/audience data...", default: "" },
  { id: "regulatory", label: "5. Regulatory & Accessibility Framework", placeholder: "Paste the regulatory standards and accessibility requirements that govern your project...", default: "", example: REG_DEFAULT },
  { id: "precedent", label: "6. Precedent Study Synthesis", placeholder: "Paste your precedent study findings - comparable projects and what they demonstrate...", default: "", example: PRECEDENT_DEFAULT },
];

export default function CombinedDocumentGenerator() {
  const { provider, apiKey, meta } = useAppContext();
  const [inputs, setInputs] = useState(() => Object.fromEntries(SECTIONS.map((s) => [s.id, s.default])));
  const [fileLoading, setFileLoading] = useState({});
  const [fileErrors, setFileErrors] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  function updateInput(id, val) { setInputs((prev) => ({ ...prev, [id]: val })); }

  async function handleSectionFile(sectionId, file) {
    if (!file) return;
    setFileLoading((f) => ({ ...f, [sectionId]: true }));
    setFileErrors((f) => ({ ...f, [sectionId]: "" }));
    try {
      const name = file.name.toLowerCase();
      let extracted = "";
      if (name.endsWith(".txt")) {
        extracted = await file.text();
      } else if (name.endsWith(".docx")) {
        const arrayBuffer = await file.arrayBuffer();
        const res = await mammoth.extractRawText({ arrayBuffer });
        extracted = res.value;
      } else if (name.endsWith(".rtf")) {
        extracted = stripRTF(await file.text());
      } else if (name.endsWith(".pdf")) {
        if (provider !== "claude") throw new Error("PDF reading needs the Claude provider (uses AI to read the file). Switch to Claude in Settings, or upload .docx/.txt/.rtf which work on both providers.");
        const base64 = await fileToBase64Raw(file);
        extracted = await callAI({ provider, apiKey, maxTokens: 3000, pdfBase64: base64, content: "Extract the full plain text of this document, preserving structure. Respond with ONLY the extracted text." });
      } else if (name.endsWith(".doc")) {
        throw new Error("Old .doc format isn't supported - save as .docx, or paste the text.");
      } else {
        throw new Error("Unsupported file type - use .txt, .docx, .rtf, or .pdf.");
      }
      updateInput(sectionId, (inputs[sectionId] ? inputs[sectionId] + "\n\n" : "") + (extracted || "").trim());
    } catch (e) {
      setFileErrors((f) => ({ ...f, [sectionId]: e.message || "Could not read this file." }));
    } finally {
      setFileLoading((f) => ({ ...f, [sectionId]: false }));
    }
  }

  async function generateConsolidated() {
    const filled = SECTIONS.filter((s) => inputs[s.id]?.trim()).length;
    if (filled < 3) { setError("Fill in at least 3 sections before consolidating."); return; }
    setLoading(true); setError(""); setResult(null);
    const combined = SECTIONS.map((s) => `## ${s.label}\n${inputs[s.id] || "(not provided)"}`).join("\n\n");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 6000,
        content:
          "You are compiling a Site Analysis and Opportunities Assessment for a park redesign, from six input sections below. Produce: " +
          "(1) 'matrix': array of {theme, constraint, opportunity} - cross-reference findings across ALL sections into themed rows; each constraint AND opportunity must trace to something actually stated below, not invented, " +
          "(2) 'design_implications': array of 4-6 short strings bridging into concept/zoning decisions, each tied to a matrix row, " +
          "(3) 'concept_brief': a single consolidated plain-text brief (400-600 words) summarizing key findings, constraints, opportunities and program requirements from ALL sections, written to be pasted directly into a Concept Generator tool - dense with concrete specifics (numbers, standards, findings), not vague. " +
          "Respond with ONLY valid JSON, no markdown fences: {\"matrix\": [{\"theme\":\"\",\"constraint\":\"\",\"opportunity\":\"\"}], \"design_implications\": [\"\"], \"concept_brief\": \"\"}\n\nSECTIONS:\n" + combined,
      });
      setResult(extractJSON(text));
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyBrief() {
    if (!result?.concept_brief) return;
    copyToClipboard(result.concept_brief).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function buildFullReportText() {
    let lines = ["SITE ANALYSIS AND OPPORTUNITIES ASSESSMENT", "MVP/Prototype compilation", ""];
    SECTIONS.forEach((s) => lines.push(s.label.toUpperCase(), inputs[s.id] || "(not provided)", ""));
    if (result) {
      lines.push("7. CONSOLIDATED CONSTRAINTS & OPPORTUNITIES MATRIX");
      (result.matrix || []).forEach((m) => lines.push(`  [${m.theme}] Constraint: ${m.constraint} | Opportunity: ${m.opportunity}`));
      lines.push("", "8. DESIGN IMPLICATIONS SUMMARY");
      (result.design_implications || []).forEach((d) => lines.push(`  - ${d}`));
      lines.push("", "CONCEPT GENERATOR BRIEF (ready to paste)", result.concept_brief || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  function structuredOpts() {
    return {
      toolCode: "CMB",
      meta,
      inputRecord: SECTIONS.map((s)=>({label:s.label,value:(inputs[s.id]||"(not provided)").slice(0,200)})),
      findings: [{ title: "Analysis output", text: buildFullReportText() }],
      chartNote: result ? "Constraints and opportunities matrix is reproduced in the PDF export." : "No synthesis generated yet.",
      chartsHtml: result
        ? tableHTML(["Theme", "Constraint", "Opportunity"],
            (result.matrix || []).map((m) => [m.theme, m.constraint, m.opportunity]), "Constraints and opportunities matrix")
        : "",
      interpretation: (result?.design_implications || []).join(" "),
      conclusions: (result?.design_implications || []),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (!overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "CMB",
        reportText: buildFullReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Section", "Content"], ...SECTIONS.map((s) => [s.label, inputs[s.id] || ""])]), "Sections 1-6");
    if (result) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Theme", "Constraint", "Opportunity"], ...(result.matrix || []).map((m) => [m.theme, m.constraint, m.opportunity])]), "Constraints-Opportunities");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Design Implication"], ...(result.design_implications || []).map((d) => [d])]), "Design Implications");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Concept Generator Brief"], [result.concept_brief]]), "Concept Brief");
    }
    downloadFile(XLSX.write(wb, { bookType: "xlsx", type: "array" }), "site-analysis-consolidated.xlsx", "application/octet-stream");
  }
  function exportWord() { withOverflow((o) => exportStructuredWord(o)); }
  function exportPDF() {
    withOverflow((o) => exportStructuredPDF(o, () => {
      if (typeof setError === "function") setError("Your browser blocked the new tab needed for PDF export. Allow pop-ups and try again.");
    }));
  }

  return (
    <div className="space-y-6">
      <ToolIntro toolCode="CMB" />

      <div>
        <h2 className="text-xl font-bold text-brand-dark flex items-center gap-2"><Layers size={20} className="text-brand-gold" /> Combined Document Generator</h2>
        <p className="text-sm text-brand-text mt-1">Paste or upload the outputs of your other tools - get a consolidated Constraints & Opportunities Matrix, Design Implications, and a ready-to-paste Concept Generator brief.</p>
      </div>

      <div className="bg-brand-warm border border-brand-border rounded-lg p-4 flex gap-3">
        <AlertTriangle size={18} className="text-brand-danger shrink-0 mt-0.5" />
        <p className="text-sm text-brand-text"><span className="font-semibold">MVP/Prototype tool.</span> All content comes from your inputs. Sections 1-4 need real content from your other tools. Each section accepts .txt, .docx, .rtf (all providers) or .pdf (Claude only).</p>
      </div>

      <div className="card">
        <div className="card-header">Sections 1-6 - Paste or Upload Tool Outputs</div>
        <div className="p-4 space-y-4">
          {SECTIONS.map((s) => (
            <div key={s.id}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-brand-text uppercase tracking-wide">{s.label}</label>
                <span className="flex items-center gap-3">
                {s.example && !inputs[s.id] && (
                  <button onClick={() => updateInput(s.id, s.example)}
                    className="text-[10px] font-medium text-brand-text/70 hover:underline">
                    Load example
                  </button>
                )}
                <label className="text-[10px] font-medium text-brand-gold flex items-center gap-1 cursor-pointer hover:underline">
                  <Upload size={11} /> {fileLoading[s.id] ? "Reading..." : "Upload file"}
                  <input type="file" accept=".txt,.docx,.rtf,.pdf" onChange={(e) => { handleSectionFile(s.id, e.target.files[0]); e.target.value = ""; }} className="sr-only" />
                </label>
                </span>
              </div>
              <textarea value={inputs[s.id]} onChange={(e) => updateInput(s.id, e.target.value)} placeholder={s.placeholder} rows={s.id === "regulatory" || s.id === "precedent" ? 5 : 3} className="textarea" />
              {fileErrors[s.id] && <p className="text-[10px] text-brand-danger mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {friendlyError(fileErrors[s.id])}</p>}
            </div>
          ))}
          <button onClick={generateConsolidated} disabled={loading || !apiKey} className="btn-gold w-full"><Sparkles size={18} /> {loading ? "Consolidating..." : "Generate Consolidated Report"}</button>
          {loading && <p className="text-xs text-brand-text">Cross-referencing all sections - this can take a moment.</p>}
          {error && (<div className="space-y-1"><p className="text-xs text-brand-dark flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(error)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-4">Technical: {error}</p></div>)}
        </div>
      </div>

      {result && (
        <>
          <div className="card p-4 overflow-x-auto">
            <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">7. Consolidated Constraints & Opportunities Matrix</h3>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-brand-text/60 border-b border-brand-border"><th className="py-2 pr-3">Theme</th><th className="py-2 pr-3">Constraint</th><th className="py-2">Opportunity</th></tr></thead>
              <tbody>{(result.matrix || []).map((m, i) => (<tr key={i} className="border-b border-brand-border/50 align-top"><td className="py-2 pr-3 font-semibold">{m.theme}</td><td className="py-2 pr-3 text-brand-danger">{m.constraint}</td><td className="py-2 text-brand-success">{m.opportunity}</td></tr>))}</tbody>
            </table>
          </div>

          <div className="card p-4">
            <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-2">8. Design Implications Summary</h3>
            <div className="space-y-1">{(result.design_implications || []).map((d, i) => (<p key={i} className="text-sm text-brand-dark">- {d}</p>))}</div>
          </div>

          <div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-sm uppercase tracking-wide text-brand-warning">Concept Generator Brief (ready to paste)</h3>
              <button onClick={copyBrief} className="text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1 bg-brand-dark text-white">{copied ? <CheckCircle2 size={13} /> : <Copy size={13} />} {copied ? "Copied!" : "Copy Brief"}</button>
            </div>
            <p className="text-sm text-brand-dark leading-relaxed whitespace-pre-wrap">{result.concept_brief}</p>
          </div>
        </>
      )}

      <div className="card p-4">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Full Report</h3>
        <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
        <p className="text-[10px] text-brand-text/60 mt-2">Exports the full 8-section Site Analysis and Opportunities Assessment.</p>
      </div>
    </div>
  );
}
