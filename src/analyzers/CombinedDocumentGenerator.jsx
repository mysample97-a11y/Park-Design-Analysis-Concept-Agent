import { useState } from "react";
import { Sparkles, AlertTriangle, Info, Layers, Copy, CheckCircle2, Upload, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import * as mammoth from "mammoth";
import { callAI } from "../utils/ai";
import { checklistPrompt } from "../utils/methodology";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML, stripRTF, fileToBase64Raw, copyToClipboard } from "../utils/helpers";
import { readExportFile, EXPORT_ACCEPT } from "../utils/readExport";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, tableHTML } from "../utils/reportTemplate";

// EXAMPLE CONTENT ONLY - a worked sample from one project, offered behind a 'Load worked example'
// link so users can see the expected level of detail. Never pre-filled.
const REG_DEFAULT = `[EXAMPLE - replace with your own project's standards] Governing Standards: Dubai Universal Design Code (max ramp gradient 8%/1:12, min ramp width 1.0m, min crossing width 2.0m, max cross-fall 2%, max ramp run 10m, handrails above 0.5m level change); UAE Federal Law No. 29 of 2006 (Rights of People of Determination); Neighborhood Parks Manual (peak capacity 150-400 visitors/10,000sqm by density band, 15% leasable/commercial area target).
Compliance method: every path/ramp/crossing checked programmatically against these standards, tagged Pass/Needs Review/Pending.
Limitation: gradient not verifiable without real site elevation data; terrain assumed flat (Dubai coastal, ~2m ASL) pending DWG confirmation.
Commercial & Service Facilities Map required per Schedule 1(E), tracked as a mandatory deliverable.`;

// EXAMPLE CONTENT ONLY - see note above.
const PRECEDENT_DEFAULT = `[EXAMPLE - replace with your own precedents] Al Safa Park 1 (direct sister-park precedent, redesigned for the same Dubai Canal reason): post-occupancy evaluation found family-only parking, signed pedestrian walkways, pocket-park green buffers, nighttime pedestrian lighting, strict pedestrian/cyclist separation, and maintained natural landscaping drove visitor satisfaction.
Al Khazan Park (nearby Dubai Municipality redevelopment): fully solar-powered, identity-themed - confirms full solar power is an executed Dubai precedent.
Vancouver Convention Centre West: on-site biomembrane reactor treats 100% of building wastewater, supplies ~80% of greywater needs and irrigates its living roof, ~68% of total water use reclaimed - real source for the elevated pavilion's greywater-fed planting concept, adapted at park scale.
Note: precedents cited for design logic, not scale-equivalent replication.`;

const SECTIONS = [
  { id: "site", label: "1. Site Location & Urban Context", placeholder: "Paste the Site Context tool's adjacency findings + GIS map notes...", default: "" },
  { id: "solar", label: "2a. Solar Exposure Analysis", placeholder: "Paste the Solar Exposure tool's report or conclusion...", default: "" },
  { id: "wind", label: "2b. Wind Exposure Analysis", placeholder: "Paste the Wind Exposure tool's report or conclusion...", default: "" },
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
  const [pdfNotes, setPdfNotes] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  function updateInput(id, val) { setInputs((prev) => ({ ...prev, [id]: val })); }


  // Supplied to readExportFile: called only when a PDF has no text layer. The pages
  // arrive already rendered as image blocks; both providers accept them.
  async function readScannedPages(blocks, info) {
    if (!apiKey) throw new Error(
      "This PDF is a scan with no embedded text layer. To read it as images, add an API key " +
      "in Settings and re-upload. Or upload the .xlsx or .rtf export instead - those carry the " +
      "same content, read instantly, and need no key at all.");
    return await callAI({
      // NOTE: no `model` here. This context exposes { provider, apiKey, meta } only -
      // passing `model` threw "model is not defined" the moment a file was uploaded.
      provider, apiKey, maxTokens: 3000,
      content: [
        ...blocks,
        { type: "text", text: `These are ${info.pagesRendered} page image(s) from a scanned document. Transcribe ALL text you can read, preserving headings, tables and reading order. Respond with ONLY the transcribed text - no commentary.` },
      ],
    });
  }

  async function handleSectionFile(sectionId, file) {
    if (!file) return;
    setFileLoading((f) => ({ ...f, [sectionId]: true }));
    setFileErrors((f) => ({ ...f, [sectionId]: "" }));
    try {
      // Single path for every format. The .txt/.docx/.rtf branches used to bypass the
      // shared reader, so those uploads skipped the suite-report parser and arrived as
      // an undifferentiated blob - the exact thing the digest exists to prevent.
      const res = await readExportFile(file,
        (p, total) => setFileErrors((fe) => ({ ...fe, [sectionId]: `Reading page ${p} of ${total}...` })),
        readScannedPages);
      setFileErrors((fe) => ({ ...fe, [sectionId]: "" }));
      let extracted = res.digest || res.text;
      setPdfNotes((n) => ({ ...n, [sectionId]: res.note }));
      updateInput(sectionId, (inputs[sectionId] ? inputs[sectionId] + "\n\n" : "") + (extracted || "").trim());
    } catch (e) {
      setFileErrors((f) => ({ ...f, [sectionId]: e.message || "Could not read this file." }));
    } finally {
      setFileLoading((f) => ({ ...f, [sectionId]: false }));
    }
  }

  const [projectLocation, setProjectLocation] = useState("");
  const [gapCheck, setGapCheck] = useState(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapError, setGapError] = useState("");

  // Deliberately SEPARATE from the synthesis. The matrix must reflect only what the user
  // supplied - otherwise a reader cannot tell their analysis from the model's general
  // knowledge. This checks for gaps and reports them in their own section.
  async function runGapCheck() {
    const filled = SECTIONS.filter((sec) => inputs[sec.id]?.trim());
    if (filled.length < 2) { setGapError("Fill in at least two sections before running a gap check."); return; }
    setGapLoading(true); setGapError("");
    try {
      const combined = filled.map((sec) => `## ${sec.label}\n${inputs[sec.id]}`).join("\n\n");
      const text = await callAI({
        provider, apiKey, maxTokens: 2000, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content:
          "You are reviewing a site analysis for COMPLETENESS. Do not rewrite or improve it. " +
          (projectLocation ? `The project is at: ${projectLocation}. Research what a competent analysis at THIS location would be expected to address. ` : "") +
          "Do TWO things. " +
          "FIRST, research and report real comparable projects at or near this location - actual public spaces, what they provide, and the specific lesson each offers this project. Name them and say where they are. Only include projects you can actually attribute; mark anything uncertain. " +
          "SECOND, identify: (a) standard analysis topics that appear missing or thin, " +
          "(b) location-specific factors that matter here and are not addressed, " +
          "(c) any claim in the supplied text that looks questionable against what you can verify, " +
          "(d) standards or regulations that govern at this location and are not cited. " +
          "Be specific and restrained - only raise something if it genuinely matters. If the analysis is adequately complete, say so. " +
          "Respond with ONLY valid JSON, no markdown fences: {" +
          "\"local_examples\":[{\"project\":\"\",\"where\":\"\",\"what_it_does\":\"\",\"lesson_for_this_project\":\"\",\"verified\":true}]," +
          "\"missing_topics\":[{\"topic\":\"\",\"why_it_matters_here\":\"\"}]," +
          "\"location_specific_gaps\":[{\"factor\":\"\",\"why\":\"\"}]," +
          "\"questionable_claims\":[{\"claim\":\"\",\"concern\":\"\"}]," +
          "\"uncited_standards\":[{\"standard\":\"\",\"relevance\":\"\"}]," +
          "\"overall\":\"one honest sentence on how complete this analysis is\"}\n\nSUPPLIED ANALYSIS:\n" + combined,
      });
      const parsed = extractJSON(text);
      if (!parsed) throw new Error("The gap check came back in an unexpected format. Try again.");
      setGapCheck(parsed);
    } catch (e) {
      setGapError(e.message || "Could not run the gap check.");
    } finally { setGapLoading(false); }
  }

  async function generateConsolidated() {
    const filled = SECTIONS.filter((s) => inputs[s.id]?.trim()).length;
    if (filled < 3) { setError("Fill in at least 3 sections before consolidating."); return; }
    setLoading(true); setError(""); setResult(null);
    const combined = SECTIONS.map((s) => `## ${s.label}\n${inputs[s.id] || "(not provided)"}`).join("\n\n") +
      (gapCheck
        ? "\n\n## Location research and identified gaps (from the completeness check)\n" +
          (gapCheck.local_examples || []).map((e) => `- Comparable project: ${e.project}${e.where ? ` (${e.where})` : ""} - ${e.lesson_for_this_project}`).join("\n") +
          "\n" + (gapCheck.missing_topics || []).map((g) => `- Gap: ${g.topic} - ${g.why_it_matters_here}`).join("\n") +
          "\n" + (gapCheck.location_specific_gaps || []).map((g) => `- Local factor not addressed: ${g.factor} - ${g.why}`).join("\n") +
          "\n" + (gapCheck.uncited_standards || []).map((g) => `- Standard that governs here: ${g.standard} - ${g.relevance}`).join("\n")
        : "");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 6000,
        content:
          "You are compiling a Site Analysis and Opportunities Assessment for a park redesign, from six input sections below. Produce: " +
          "(1) 'matrix': array of {theme, constraint, opportunity} - cross-reference findings across ALL sections into themed rows; each constraint AND opportunity must trace to something actually stated below, not invented, " +
          "(2) 'design_implications': array of 4-6 short strings bridging into concept/zoning decisions, each tied to a matrix row, " +
          "(3) 'concept_brief': a single consolidated plain-text brief (500-800 words) written to be pasted directly into a Concept Generator. It must carry forward: the key findings, constraints and opportunities from every section; the programme requirements; ANY comparable projects and their lessons from the location research; and ANY identified gaps or ungoverned standards, stated as open items the concept must account for. Dense with concrete specifics - numbers, standards, named findings - not vague summary language. " +
          "Respond with ONLY valid JSON, no markdown fences: {\"matrix\": [{\"theme\":\"\",\"constraint\":\"\",\"opportunity\":\"\"}], \"design_implications\": [\"\"], \"concept_brief\": \"\"}" + checklistPrompt("CMB") + "\n\nSECTIONS:\n" + combined,
      });
      // extractJSON returns NULL on an unrecoverable reply - it does not throw.
      // Passing that null into state leaves the section silently empty.
      const parsedResult = extractJSON(text);
      if (!parsedResult) throw new Error("The reply could not be read as structured data, even after recovery. "
        + "This is usually a truncated response - shorten the input or run it again.");
      setResult(parsedResult);
    } catch (e) {
      setError(e.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyBrief() {
    if (!result?.concept_brief) return;
    copyToClipboard(result.concept_brief)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
      .catch(() => setCopyError("Your browser blocked the copy. Select the brief text above and copy it manually, or download the report."));
  }

  function buildFullReportText() {
    let lines = ["SITE ANALYSIS AND OPPORTUNITIES ASSESSMENT", "MVP/Prototype compilation", ""];
    SECTIONS.forEach((sec) => lines.push(sec.label.toUpperCase(), inputs[sec.id] || "(not provided)", ""));
    if (result) {
      lines.push("7. CONSOLIDATED CONSTRAINTS & OPPORTUNITIES MATRIX", "");
      (result.matrix || []).forEach((m) => {
        lines.push(`THEME: ${m.theme}`);
        lines.push(`  Constraint: ${m.constraint}`);
        lines.push(`  Opportunity: ${m.opportunity}`);
        lines.push("");
      });
      lines.push("8. DESIGN IMPLICATIONS SUMMARY", "");
      (result.design_implications || []).forEach((d) => lines.push(`  - ${d}`));
      lines.push("", "9. CONCEPT GENERATOR BRIEF (ready to paste)", "", result.concept_brief || "");
    }
    return lines.join("\n");
  }

  function buildFindings() {
    const out = [];
    SECTIONS.forEach((sec) => {
      if (inputs[sec.id]) out.push({ title: sec.label, text: inputs[sec.id] });
    });
    if (gapCheck) {
      const items = [
        ...(gapCheck.local_examples || []).map((e) => `COMPARABLE PROJECT: ${e.project}${e.where ? ` (${e.where})` : ""} - ${e.what_it_does}. Lesson: ${e.lesson_for_this_project}${e.verified === false ? " [UNVERIFIED]" : ""}`),
        ...(gapCheck.missing_topics || []).map((g) => `MISSING: ${g.topic} - ${g.why_it_matters_here}`),
        ...(gapCheck.location_specific_gaps || []).map((g) => `LOCAL FACTOR: ${g.factor} - ${g.why}`),
        ...(gapCheck.questionable_claims || []).map((g) => `CHECK: ${g.claim} - ${g.concern}`),
        ...(gapCheck.uncited_standards || []).map((g) => `UNCITED STANDARD: ${g.standard} - ${g.relevance}`),
      ];
      out.push({
        title: "Location Research & Completeness Check",
        note: "Comparable projects researched for this location, plus a review of what this analysis does NOT cover. Deliberately separate from the synthesis below - the matrix reflects only the supplied analysis. Requires human judgement before acting on.",
        text: gapCheck.overall || "",
        items,
      });
    }
    if (result) {
      out.push({
        title: "Consolidated Constraints & Opportunities Matrix",
        note: "Cross-referenced across every supplied section. Each row traces to a stated finding.",
        headers: ["Theme", "Constraint", "Opportunity"],
        rows: (result.matrix || []).map((m) => [m.theme, m.constraint, m.opportunity]),
      });
      out.push({
        title: "Design Implications",
        items: result.design_implications || [],
      });
      out.push({
        title: "Concept Generator Brief",
        note: "Formatted for direct paste into the Concept Generator.",
        text: result.concept_brief || "",
      });
    }
    return out;
  }

  // --- Structured 11-section report export ---
  const [overflowText, setOverflowText] = useState("");
  const [webSources, setWebSources] = useState([]);
  const [groundingNote, setGroundingNote] = useState("");
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "CMB",
      meta,
      inputRecord: SECTIONS.map((sec) => ({
        label: sec.label,
        value: inputs[sec.id] ? `${String(inputs[sec.id]).length} characters supplied` : "(not provided)",
      })),
      findings: buildFindings(),
      chartNote: result ? "Constraints and opportunities matrix is reproduced in the PDF export." : "No synthesis generated yet.",
      chartsHtml: result
        ? tableHTML(["Theme", "Constraint", "Opportunity"],
            (result.matrix || []).map((m) => [m.theme, m.constraint, m.opportunity]), "Constraints and opportunities matrix")
        : "",
      interpretation: result
        ? `The consolidated analysis identifies ${(result.matrix || []).length} cross-cutting themes across the supplied sections. ` +
          (result.design_implications || []).join(" ")
        : "",
      conclusions: result ? (result.design_implications || []) : [],
      runLimitations: SECTIONS.filter((sec) => !inputs[sec.id]).map((sec) => `Section not supplied: ${sec.label} - its findings are absent from this synthesis.`),
      extraRefs: webSources,
      overflow: overflowText,
    };
  }

  async function withOverflow(run) {
    if (includeOverflow && !overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "CMB", reportText: buildFullReportText() });
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
      <ToolIntro toolCode="CMB" />

      <div className="bg-brand-warm border border-brand-border rounded-lg p-4 flex gap-3">
        <AlertTriangle size={18} className="text-brand-danger shrink-0 mt-0.5" />
        <p className="text-sm text-brand-text"><span className="font-semibold">MVP/Prototype tool.</span> All content comes from your inputs. Sections 1-4 need real content from your other tools. Each section accepts any report this suite exports - .xlsx, .rtf, .pdf - plus .docx, .txt, .csv and .md. All read locally in your browser: all providers, no API key needed. Scanned PDFs with no text layer are read as page images when an API key is set. [build: v19-payload-trim]</p>
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
                    Load worked example
                  </button>
                )}
                <label className="text-[10px] font-medium text-brand-gold flex items-center gap-1 cursor-pointer hover:underline">
                  <Upload size={11} /> {fileLoading[s.id] ? "Reading..." : "Upload file"}
                  <input type="file" accept={EXPORT_ACCEPT} onChange={(e) => { handleSectionFile(s.id, e.target.files[0]); e.target.value = ""; }} className="sr-only" />
                </label>
                </span>
              </div>
              <textarea value={inputs[s.id]} onChange={(e) => updateInput(s.id, e.target.value)} placeholder={s.placeholder} rows={s.id === "regulatory" || s.id === "precedent" ? 5 : 3} className="textarea" />
              {fileErrors[s.id] && <p className="text-[10px] text-brand-danger mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {friendlyError(fileErrors[s.id])}</p>}
              {pdfNotes[s.id] && !fileErrors[s.id] && (
                <p className="text-[10px] text-brand-success mt-1 flex items-center gap-1">
                  <FileText size={10} /> {pdfNotes[s.id]}
                </p>
              )}
            </div>
          ))}
          <div className="border border-brand-border rounded-lg p-3 space-y-2">
            <label className="text-xs font-semibold text-brand-text uppercase tracking-wide">Completeness check (optional, recommended)</label>
            <p className="text-[10px] text-brand-text/60">
              Reviews what you have supplied against what a competent analysis at this location would cover, and
              flags gaps. <strong>Kept separate from the synthesis below</strong> - the constraints matrix reflects
              only your own analysis, so a reader can always tell your findings from the model's commentary.
            </p>
            <input value={projectLocation} onChange={(e) => setProjectLocation(e.target.value)}
              placeholder="Project location (e.g. Riverside Park, Chicago, USA)" className="input" />
            <button onClick={runGapCheck} disabled={gapLoading || !apiKey} className="btn-dark w-full">
              <Sparkles size={15} /> {gapLoading ? "Checking completeness..." : "Check for Gaps in This Analysis"}
            </button>
            {gapError && <p className="text-[11px] text-brand-danger">{friendlyError(gapError)}</p>}
            {gapCheck && (
              <div className="text-[11px] space-y-1.5 mt-1">
                <p className="text-brand-dark font-semibold">{gapCheck.overall}</p>
                {(gapCheck.local_examples || []).map((ex, i) => (
                  <p key={"e" + i} className="text-brand-success">
                    Example: <span className="font-semibold">{ex.project}</span>{ex.where ? ` (${ex.where})` : ""} - {ex.lesson_for_this_project}
                    {ex.verified === false && <span className="text-brand-warning"> [unverified]</span>}
                  </p>
                ))}
                {(gapCheck.missing_topics || []).map((g, i) => (
                  <p key={"m" + i} className="text-brand-warning">Missing: <span className="font-semibold">{g.topic}</span> - {g.why_it_matters_here}</p>
                ))}
                {(gapCheck.location_specific_gaps || []).map((g, i) => (
                  <p key={"l" + i} className="text-brand-warning">Local factor: <span className="font-semibold">{g.factor}</span> - {g.why}</p>
                ))}
                {(gapCheck.questionable_claims || []).map((g, i) => (
                  <p key={"q" + i} className="text-brand-danger">Check: <span className="font-semibold">{g.claim}</span> - {g.concern}</p>
                ))}
                {(gapCheck.uncited_standards || []).map((g, i) => (
                  <p key={"s" + i} className="text-brand-text">Uncited standard: <span className="font-semibold">{g.standard}</span> - {g.relevance}</p>
                ))}
              </div>
            )}
          </div>

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
              {copyError && <p className="text-[10px] text-brand-danger mt-1">{copyError}</p>}
            </div>
            <p className="text-sm text-brand-dark leading-relaxed whitespace-pre-wrap">{result.concept_brief}</p>
          </div>
        </>
      )}

      <ReportPreview

        reportText={buildStructuredReport({ ...structuredOpts(), docRef: "preview" })}

        chartsHtml={structuredOpts().chartsHtml}

        includeOverflow={includeOverflow}

        setIncludeOverflow={setIncludeOverflow}

        sourceNote={groundingNote}

        sourceCount={webSources.length}

      />


      <div className="card p-4">
        <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Full Report</h3>
        <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
        <p className="text-[10px] text-brand-text/60 mt-2">Exports the full 8-section Site Analysis and Opportunities Assessment.</p>
      </div>
    </div>
  );
}
