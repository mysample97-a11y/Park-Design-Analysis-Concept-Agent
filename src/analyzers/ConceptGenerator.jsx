import { useState } from "react";
import { Sparkles, AlertTriangle, Layers, Upload} from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { checklistPrompt } from "../utils/methodology";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML } from "../utils/helpers";
import { readExportFile, EXPORT_ACCEPT } from "../utils/readExport";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, bubbleDiagramSVG, tableHTML } from "../utils/reportTemplate";

const POSITIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "Center"];
const GRID_ORDER = ["NW", "N", "NE", "W", "Center", "E", "SW", "S", "SE"];
const SCORE_CRITERIA = [
  { id: "innovation", label: "Innovation & Creativity" },
  { id: "human_centered", label: "Human-Centered & Sustainability" },
  { id: "design_ux", label: "Design Quality & UX" },
  { id: "feasibility", label: "Feasibility & Implementation" },
];
const COLORS = ["#1C2333", "#C9A46A", "#3D7A5C", "#B8863B", "#8A6A3A"];

function overallScore(concept) {
  const vals = SCORE_CRITERIA.map((c) => Number(concept.scores?.[c.id]) || 0);
  return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "0.0";
}

function BubbleDiagram({ zones }) {
  const maxArea = Math.max(1, ...zones.map((z) => Number(z.area_pct) || 5));
  const byPos = {};
  GRID_ORDER.forEach((p) => (byPos[p] = []));
  zones.forEach((z) => { const pos = POSITIONS.includes(z.position) ? z.position : "Center"; byPos[pos].push(z); });
  return (
    <div className="grid grid-cols-3 gap-1.5" style={{ minHeight: 260 }}>
      {GRID_ORDER.map((pos) => (
        <div key={pos} className="border border-dashed border-brand-border rounded-md p-2 flex flex-wrap items-center justify-center gap-1.5" style={{ minHeight: 80 }}>
          {byPos[pos].length === 0 && <span className="text-[9px] text-brand-border">{pos}</span>}
          {byPos[pos].map((z, i) => {
            const size = Math.max(36, Math.min(90, ((Number(z.area_pct) || 5) / maxArea) * 90));
            return (
              <div key={i} title={z.rationale} className="rounded-full flex items-center justify-center text-center text-white shrink-0" style={{ width: size, height: size, background: COLORS[i % COLORS.length], fontSize: Math.max(8, size / 9), padding: 4 }}>
                {z.name}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function ConceptGenerator() {
  const { provider, apiKey, meta } = useAppContext();
  const [brief, setBrief] = useState("");
  // File ingestion. This tool previously accepted pasted text ONLY, so a user had to
  // open an exported report, select all, copy and paste it in by hand - for every run.
  const [briefFileNote, setBriefFileNote] = useState("");
  const [briefFileError, setBriefFileError] = useState("");

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

  async function handleBriefFile(file) {
    if (!file) return;
    setBriefFileError(""); setBriefFileNote("Reading file...");
    try {
      const res = await readExportFile(file, (p, total) => setBriefFileNote(`Reading page ${p} of ${total}...`), readScannedPages);
      // Append rather than overwrite, so several tool exports can be combined.
      // Use the structured digest when the upload is one of this suite's reports -
      // boilerplate stripped, findings and tables preserved. Falls back to raw text
      // for anything else, so a third-party document still works.
      const body = res.digest || res.text;
      setBrief((prev) => (prev ? prev.trim() + "\n\n" : "") + `--- ${file.name} ---\n` + body);
      setBriefFileNote(`${file.name}: ${res.note}`);
    } catch (err) {
      setBriefFileNote(""); setBriefFileError(err.message || "Could not read that file.");
    }
  }
  const [userIdeas, setUserIdeas] = useState("");
  const [siteAreaM2, setSiteAreaM2] = useState("");
  const [siteContext, setSiteContext] = useState({ N: "", E: "", S: "", W: "" });
  const [numConcepts, setNumConcepts] = useState(3);
  const [concepts, setConcepts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recommendation, setRecommendation] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");

  const [locationCtx, setLocationCtx] = useState("");
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxError, setCtxError] = useState("");
  const [projectLocation, setProjectLocation] = useState("");

  // Researches how comparable spaces are actually designed at this location, so concepts
  // respond to real local practice rather than generic park thinking.
  async function researchLocalContext() {
    if (!projectLocation.trim()) { setCtxError("Enter the project location first."); return; }
    setCtxLoading(true); setCtxError("");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 2200, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content:
          `For a public open space / park project at "${projectLocation}", research and report what genuinely informs design there. ` +
          "Cover: (a) comparable public spaces in that city or region and what they actually provide, " +
          "(b) planning or design standards that govern public open space there, " +
          "(c) climate-driven design responses that are standard local practice, " +
          "(d) cultural or social use patterns that shape how public space is used locally, " +
          "(e) typical facility mixes for this kind of space in that context. " +
          "Report only what you can attribute to a real source or established local practice - mark anything uncertain as 'unverified'. " +
          "Respond with ONLY valid JSON, no markdown fences: {\"comparable_projects\":[{\"name\":\"\",\"where\":\"\",\"relevant_lesson\":\"\"}]," +
          "\"local_standards\":[{\"standard\":\"\",\"requirement\":\"\",\"source\":\"\"}]," +
          "\"climate_responses\":[\"\"],\"cultural_use_patterns\":[\"\"],\"typical_facilities\":[\"\"],\"unverified_notes\":[\"\"]}",
      });
      const parsed = extractJSON(text);
      if (!parsed) throw new Error("The research came back in an unexpected format. Try again.");
      setLocationCtx(JSON.stringify(parsed, null, 2));
    } catch (e) {
      setCtxError(e.message || "Could not research local context.");
    } finally { setCtxLoading(false); }
  }

  async function generateConcepts() {
    if (!brief.trim()) { setError("Paste your site analysis findings and program requirements above first."); return; }
    setLoading(true); setError(""); setConcepts(null); setRecommendation(null);
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 6000,
        content:
          `You are a landscape architecture concept-design assistant. Given the site analysis findings and program brief below, generate ${numConcepts} DISTINCT zoning concept variants for a park redesign. Each concept should meaningfully differ in spatial organization, not just wording. ` +
          "For each concept output: 'name' (short, evocative), 'vision' (1-2 sentence design narrative), 'zones' (array of {name, category, area_pct (number, all zones sum to ~100), position (one of exactly: N, NE, E, SE, S, SW, W, NW, Center), rationale (1 sentence tying placement to a SPECIFIC finding from the brief - cite the actual data point), facilities (array of short strings naming the BUILT facilities in that zone, e.g. 'shade pergola', 'play equipment', 'cafe kiosk', 'paved plaza' - these feed a cost estimate so be concrete and complete)}), and 'scores' (object with keys innovation, human_centered, design_ux, feasibility, each 1-10 as your honest judgment). " +
          "Every zone rationale MUST reference something specific from the brief - no generic rationale. " +
          `Respond with ONLY a valid JSON array of ${numConcepts} concept objects, no markdown fences.` + checklistPrompt("CPT") + (locationCtx ? `\n\nRESEARCHED LOCAL CONTEXT for ${projectLocation} - use this so concepts respond to real local practice, and say in a zone rationale where a concept follows or deliberately departs from it:\n${locationCtx}` : "") + `\n\nSITE ANALYSIS & PROGRAM BRIEF:\n${brief}`,
      });
      const parsed = extractJSON(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a list of concepts but got something else. Try again.");
      setConcepts(parsed);
    } catch (e) {
      setError(e.message || "Something went wrong generating concepts. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function generateRecommendation() {
    if (!concepts) return;
    setRecLoading(true); setRecError(""); setRecommendation(null);
    try {
      const summary = concepts.map((c) => ({ name: c.name, vision: c.vision, scores: c.scores, overall: overallScore(c) }));
      const text = await callAI({
        provider, apiKey, maxTokens: 800,
        content: "Given these scored park design concepts, write a 'recommendation' field (2-3 sentences, cite specific scores) on which to move forward with, and a 'tradeoffs' field (1 sentence) on what's given up by not choosing a runner-up. Respond with ONLY valid JSON, no markdown fences: {\"recommendation\": \"\", \"tradeoffs\": \"\"}\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });
      setRecommendation(extractJSON(text));
    } catch (e) {
      setRecError(e.message || "Something went wrong. Try again.");
    } finally {
      setRecLoading(false);
    }
  }

  function buildReportText() {
    let lines = ["CONCEPT GENERATOR OUTPUT (MVP / PROTOTYPE)", "Bubble diagrams are schematic AI-reasoned placements, not survey-precise geometry.", ""];
    (concepts || []).forEach((c, i) => {
      lines.push(`CONCEPT ${i + 1}: ${c.name}`, c.vision, "");
      (c.zones || []).forEach((z) => lines.push(`  - ${z.name} (${z.position}, ~${z.area_pct}%): ${z.rationale}`));
      lines.push("  Scores: " + SCORE_CRITERIA.map((sc) => `${sc.label}=${c.scores?.[sc.id] ?? "-"}`).join(", "), `  Overall: ${overallScore(c)}/10`, "");
      const fac = (c.zones || []).flatMap((z) => (z.facilities || []).map((f) => `${f} (${z.name}${siteAreaM2 ? `, ~${Math.round((Number(z.area_pct)||0)/100*Number(siteAreaM2)).toLocaleString()} m2 zone` : ""})`));
      if (fac.length) { lines.push("  FACILITY SCHEDULE (for cost estimating):"); fac.forEach((f) => lines.push(`    - ${f}`)); lines.push(""); }
    });
    if (recommendation) {
      lines.push("RECOMMENDED CONCEPT", recommendation.recommendation || "", "", "TRADE-OFFS", recommendation.tradeoffs || "", "");
    } else {
      lines.push("RECOMMENDED CONCEPT", "(not generated - click 'Recommend Best Concept' before exporting)", "");
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
      toolCode: "CPT",
      meta,
      inputRecord: [{label:"Brief supplied",value:(brief||"(none)").slice(0,400)},{label:"Concepts requested",value:String(numConcepts)}],
      // Section 6 built as separate findings per concept rather than one text blob,
      // so each concept reads as its own subsection with a real zone table instead of
      // every internal heading rendering at the same level.
      findings: (() => {
        const F = [];
        const list = concepts || [];
        if (list.length) F.push({
          title: "Comparative scoring",
          note: "Deterministic: overall is the arithmetic mean of the criterion scores. The criterion scores themselves are the model's structured judgment, not measurement - they order options for deliberation and are not evidence of quality.",
          headers: ["Concept", ...SCORE_CRITERIA.map((sc) => sc.label), "Overall"],
          rows: list.map((c) => [c.name || "-", ...SCORE_CRITERIA.map((sc) => c.scores?.[sc.id] ?? "-"), overallScore(c)]),
        });
        list.forEach((c, i) => {
          F.push({
            title: `Concept ${i + 1}: ${c.name || "(unnamed)"}`,
            text: c.vision || "",
            headers: ["Zone", "Position", "Area %", "Area m2", "Rationale"],
            rows: (c.zones || []).map((z) => [
              z.name || "-", z.position || "-", z.area_pct ?? "-",
              siteAreaM2 && z.area_pct ? Math.round((Number(z.area_pct) || 0) / 100 * Number(siteAreaM2)).toLocaleString() : "-",
              z.rationale || "-",
            ]),
          });
          const fac = (c.zones || []).flatMap((z) => (z.facilities || []).map((x) => `${x} (${z.name})`));
          if (fac.length) F.push({ title: `${c.name || `Concept ${i + 1}`} - facility schedule for cost estimating`, items: fac });
        });
        return F.length ? F : [{ title: "Analysis output", text: buildReportText() }];
      })(),
      chartNote: (concepts && concepts.length)
        ? `${concepts.length} bubble diagram(s) and a concept comparison table are reproduced in the PDF export of this report.`
        : "No concepts generated, so no diagrams are included.",
      chartsHtml: (concepts || []).length
        ? tableHTML(["Concept", ...SCORE_CRITERIA.map((s) => s.label), "Overall"],
            concepts.map((c) => [c.name, ...SCORE_CRITERIA.map((s) => c.scores?.[s.id] ?? ""), overallScore(c)]),
            "Concept comparison")
          + concepts.map((c) =>
              `<div style="margin:14px 0;">${bubbleDiagramSVG(c.zones || [], c.name, { siteAreaM2: Number(siteAreaM2) || 0, context: siteContext, vision: c.vision })}</div>`
              + tableHTML(["Zone", "Position", "Area %", "Rationale"],
                  (c.zones || []).map((z) => [z.name, z.position, z.area_pct, z.rationale]),
                  `${c.name} - zone schedule`)
            ).join("")
        : "",
      interpretation: recommendation ? `${recommendation.recommendation || ""}${recommendation.tradeoffs ? "\n\nTrade-offs: " + recommendation.tradeoffs : ""}` : "",
      conclusions: recommendation ? [recommendation.recommendation, recommendation.tradeoffs].filter(Boolean) : [],
      runLimitations: [],
      extraRefs: webSources,
      overflow: overflowText,
    };
  }

  async function withOverflow(run) {
    if (includeOverflow && !overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "CPT",
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
      <ToolIntro toolCode="CPT" />

      <div className="bg-brand-warm border border-brand-border rounded-lg p-4 flex gap-3">
        <AlertTriangle size={18} className="text-brand-danger shrink-0 mt-0.5" />
        <p className="text-sm text-brand-text"><span className="font-semibold">MVP/Prototype tool.</span> Bubble diagrams are AI-reasoned schematic placements from your text brief, not precise survey geometry - the level architects use at concept stage, built here to demonstrate AI-integrated workflow.</p>
      </div>

      <div className="card">
        <div className="card-header">Step 1 - Site Findings & Program Brief</div>
        <div className="p-4 space-y-3">
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Paste your key site analysis findings, or upload the reports exported by the analysis tools below..." rows={9} className="textarea" />
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <label className="text-xs font-semibold px-3 py-2 rounded-md border border-[#DDD6C9] cursor-pointer flex items-center gap-1 hover:border-[#C9A46A]">
              <Upload size={12} /> Upload analysis report
              <input type="file" accept={EXPORT_ACCEPT} onChange={(e) => { handleBriefFile(e.target.files[0]); e.target.value = ""; }} className="sr-only" />
            </label>
            {brief && <button onClick={() => { setBrief(""); setBriefFileNote(""); }} className="text-xs text-brand-danger underline">Clear brief</button>}
          </div>
          <p className="text-[10px] text-brand-muted mt-1">Accepts any report exported by this suite (.xlsx, .rtf, .pdf) plus .docx, .txt, .csv. Upload several to combine them. Read locally - no AI, no API key.</p>
          {briefFileNote && <p className="text-[10px] text-brand-success mt-1">{briefFileNote}</p>}
          {briefFileError && <p className="text-[10px] text-brand-danger mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {briefFileError}</p>}
          <div className="border border-brand-border rounded-lg p-3 space-y-2">
            <label className="text-xs font-semibold text-brand-text uppercase tracking-wide">Project location - research local practice (recommended)</label>
            <p className="text-[10px] text-brand-text/60">
              Researches comparable spaces, governing standards, climate responses and local use patterns for this
              location, so concepts respond to real local practice rather than generic park thinking. Each concept
              then says where it follows or deliberately departs from it.
            </p>
            <input value={projectLocation} onChange={(e) => setProjectLocation(e.target.value)}
              placeholder="e.g. Riverside Park, Chicago, USA" className="input" />
            <button onClick={researchLocalContext} disabled={ctxLoading || !apiKey} className="btn-dark w-full">
              <Sparkles size={15} /> {ctxLoading ? "Researching local practice..." : "Research Local Design Context"}
            </button>
            {ctxError && <p className="text-[11px] text-brand-danger">{friendlyError(ctxError)}</p>}
            {locationCtx && (
              <details className="text-[10px] text-brand-text">
                <summary className="cursor-pointer text-brand-success">Local context researched - view what was found</summary>
                <pre className="whitespace-pre-wrap mt-1 max-h-44 overflow-y-auto bg-[#F7F5F1] p-2 rounded border border-brand-border">{locationCtx}</pre>
              </details>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-brand-text uppercase tracking-wide">Your own zone / facility ideas (optional)</label>
            <p className="text-[10px] text-brand-text/60 mb-1">
              Your design intent enters here rather than in the analysis tools. Where an idea conflicts
              with an analysis finding, the concepts will say so explicitly instead of silently dropping it.
            </p>
            <textarea value={userIdeas} onChange={(e) => setUserIdeas(e.target.value)} rows={4}
              placeholder="e.g. a central event lawn, separated jogging loop, cafe near the metro edge, inclusive playground..."
              className="textarea" />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-brand-text uppercase tracking-wide">Total site area (m2)</label>
              <p className="text-[10px] text-brand-text/60 mb-1">Needed so each bubble shows a real area for cost estimating.</p>
              <input type="number" value={siteAreaM2} onChange={(e) => setSiteAreaM2(e.target.value)} placeholder="15000" className="input font-mono" />
            </div>
            <div>
              <label className="text-xs font-semibold text-brand-text uppercase tracking-wide">Site context (optional)</label>
              <p className="text-[10px] text-brand-text/60 mb-1">Labels the diagram edges so orientation is readable.</p>
              <div className="grid grid-cols-2 gap-1.5">
                {["N", "E", "S", "W"].map((d) => (
                  <input key={d} value={siteContext[d]} onChange={(e) => setSiteContext({ ...siteContext, [d]: e.target.value })}
                    placeholder={`${d}: e.g. main road`} className="input text-xs" />
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-brand-text">Number of concepts:</label>
            <select value={numConcepts} onChange={(e) => setNumConcepts(Number(e.target.value))} className="text-sm bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5"><option value={3}>3</option><option value={4}>4</option></select>
          </div>
          <button onClick={generateConcepts} disabled={loading || !apiKey} className="btn-gold w-full"><Sparkles size={18} /> {loading ? "Generating concepts..." : "Generate Concepts"}</button>
          {loading && <p className="text-xs text-brand-text">This can take a moment - generating multiple distinct, scored concepts at once.</p>}
          {error && (<div className="space-y-1"><p className="text-xs text-brand-dark flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(error)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-4">Technical: {error}</p></div>)}
        </div>
      </div>

      {concepts && (
        <>
          <div className="card p-4 overflow-x-auto">
            <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Concept Comparison</h3>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-brand-text/60 border-b border-brand-border"><th className="py-2 pr-3">Concept</th>{SCORE_CRITERIA.map((s) => <th key={s.id} className="py-2 pr-3">{s.label}</th>)}<th className="py-2">Overall</th></tr></thead>
              <tbody>{concepts.map((c, i) => (<tr key={i} className="border-b border-brand-border/50"><td className="py-2 pr-3 font-semibold">{c.name}</td>{SCORE_CRITERIA.map((s) => <td key={s.id} className="py-2 pr-3 font-mono">{c.scores?.[s.id] ?? "-"}</td>)}<td className="py-2 font-mono font-bold">{overallScore(c)}</td></tr>))}</tbody>
            </table>
          </div>

          {concepts.map((c, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div><h3 className="text-base font-bold">{c.name}</h3><p className="text-sm text-brand-text italic">{c.vision}</p></div>
              <div dangerouslySetInnerHTML={{ __html: bubbleDiagramSVG(c.zones || [], c.name, { siteAreaM2: Number(siteAreaM2) || 0, context: siteContext, vision: c.vision }) }} />
              <div className="space-y-1">{(c.zones || []).map((z, zi) => (<p key={zi} className="text-xs text-brand-dark"><span className="font-semibold">{z.name}</span> ({z.position}, ~{z.area_pct}%): {z.rationale}</p>))}</div>
            </div>
          ))}

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text">Recommendation</h3>
              <button onClick={generateRecommendation} disabled={recLoading || !apiKey} className="btn-dark"><Sparkles size={15} /> {recLoading ? "Analyzing..." : "Recommend Best Concept"}</button>
            </div>
            {recLoading && <p className="text-sm text-brand-text">Comparing concept scores...</p>}
            {recError && (<div className="space-y-1"><p className="text-sm text-brand-dark flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(recError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {recError}</p></div>)}
            {recommendation && (<div className="space-y-2 text-sm text-brand-dark"><p><span className="font-semibold">Recommendation:</span> {recommendation.recommendation}</p><p><span className="font-semibold">Tradeoffs:</span> {recommendation.tradeoffs}</p></div>)}
            {recError && <p className="text-xs text-brand-danger mb-2">{recError}</p>}
            {!recommendation && concepts && concepts.length > 0 && !recLoading && (
              <p className="text-xs text-brand-danger font-semibold mb-2">
                No recommendation has been generated yet. Sections 8 and 10 of the exported report will be
                empty until you press the button above.
              </p>
            )}
            {!recommendation && !recLoading && !recError && (
              <p className="text-sm text-brand-text">
                Once concepts are generated, get an AI recommendation on which to move forward with.
                <span className="block text-[11px] text-brand-warning mt-1">
                  The recommendation is included in the exported report - generate it before exporting.
                </span>
              </p>
            )}
          </div>

          <ReportPreview

            reportText={buildStructuredReport({ ...structuredOpts(), docRef: "preview" })}

            chartsHtml={structuredOpts().chartsHtml}

            includeOverflow={includeOverflow}

            setIncludeOverflow={setIncludeOverflow}

            sourceNote={groundingNote}

            sourceCount={webSources.length}

          />


          <div className="card p-4">
            <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h3>
            <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
          </div>
        </>
      )}
    </div>
  );
}
