import { useState, useEffect, useRef } from "react";
import { Sparkles, AlertTriangle, Layers, Upload} from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { getUsage, recordUsage, resetUsage, estimateRun, countTokensExact } from "../utils/tokenMeter";
import { setActiveTool, setActiveEstimate, setActiveBusy, clearActiveTool } from "../utils/toolBridge";
import { checklistPrompt } from "../utils/methodology";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML } from "../utils/helpers";
import { readExportFile, EXPORT_ACCEPT } from "../utils/readExport";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, bubbleDiagramSVG, tableHTML, missingFields, missingFieldsNote } from "../utils/reportTemplate";

const POSITIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "Center"];
const GRID_ORDER = ["NW", "N", "NE", "W", "Center", "E", "SW", "S", "SE"];
const SCORE_CRITERIA = [
  { id: "innovation", label: "Innovation & Creativity" },
  { id: "human_centered", label: "Human-Centered & Sustainability" },
  { id: "design_ux", label: "Design Quality & UX" },
  { id: "feasibility", label: "Feasibility & Implementation" },
];
const COLORS = ["#E8EFF7", "#FF8A3D", "#4DD091", "#FFB454", "#8A6A3A"];

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
  // Token accounting for this tool. Request limits are global; token
  // usage is reported per tool so you can see which one is expensive.
  /*
    CANCELLATION.
    fetch() has no default timeout, so a provider that accepts the connection
    and never replies leaves the UI on "Researching..." forever - no error, no
    failure, no way out. Requests now time out, and this lets the user stop one
    immediately. Nothing already generated is discarded by cancelling.
  */
  const abortRef = useRef(null);
  const [busy, setBusy] = useState(false);
  function newAbort() {
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* already done */ } }
    abortRef.current = new AbortController();
    setBusy(true);
    return abortRef.current.signal;
  }
  function cancelRequest() {
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } }
    setBusy(false);
  }
  useEffect(() => () => { if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } } }, []);

  const [tokenUsage, setTokenUsage] = useState(() => getUsage("CPT"));
  const noteUsage = (u) => setTokenUsage(recordUsage("CPT", u));
  /*
    NOTE: section-chunking (F13b) is deliberately NOT applied here.
  
    This tool already implements the same principle in a form that suits its
    output: it generates concepts ONE AT A TIME, keeps every concept that
    succeeded, names the ones that failed, and re-attempts only those on the
    next press. Its unit of work is a whole concept, not a report section, so
    layering section-chunking on top would duplicate the mechanism and could
    fight it. Exact token counting still applies.
  */
  const [exactEstimate, setExactEstimate] = useState(null);
  const [counting, setCounting] = useState(false);
  async function calculateTokens() {
    setCounting(true);
    try {
      const preview = JSON.stringify({ projectLocation, siteArea, numConcepts }).slice(0, 20000);
      const exact = await countTokensExact({ provider, apiKey, model: undefined,
        systemText: "concept generator system instruction and methodology checklist", userText: preview });
      // Cost scales with the number of concepts requested, so the estimate must too.
      const perCall = exact && exact.exact ? exact.input : null;
      const n = Number(numConcepts) || 1;
      setExactEstimate(perCall
        ? { input: perCall * n, output: Math.ceil(2500 * 0.7) * n,
            total: (perCall + Math.ceil(2500 * 0.7)) * n, calls: n, exact: true }
        : { ...estimateRun({ userText: preview, maxTokens: 2500, calls: n }), exact: false });
    } catch { setExactEstimate(null); } finally { setCounting(false); }
  }

  // Publish this tool's estimator and reset to the rails. Registered on mount
  // and refreshed whenever the estimate changes, so the Budget rail can offer
  // "Calculate tokens" and show the result for the tool actually on screen.
  useEffect(() => {
    setActiveTool("CPT", {
      calculate: calculateTokens,
      cancel: cancelRequest,
    resetUsage: () => setTokenUsage(resetUsage("CPT")),
      estimate: exactEstimate,
    });
    return () => clearActiveTool("CPT");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setActiveEstimate("CPT", exactEstimate); }, [exactEstimate]);
  useEffect(() => { setActiveBusy("CPT", busy); }, [busy]);
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
        onUsage: noteUsage,
      abortSignal: newAbort(),
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
  const [progress, setProgress] = useState("");

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
        onUsage: noteUsage,
      abortSignal: newAbort(),
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
    // Keep any concepts already generated and top up the missing ones. The old
    // code cleared them, which contradicted the "press Generate again for the
    // rest" message it showed after a partial run - pressing again discarded the
    // concepts the user had just paid for.
    const existing = (concepts || []).slice();
    setLoading(true); setError(""); setRecommendation(null);
    try {
      // Generate ONE concept per call.
      //
      // A single call for all three overflowed the reply. Zones plus a facility
      // schedule with an area on every line is roughly 700-900 tokens per
      // concept, so three concepts plus research context exceeded the ceiling:
      // concept 2 arrived with zones and facilities but no scores, and concept 3
      // was never written at all. Note the failure mode - `scores` sat AFTER the
      // long arrays in the schema, so truncation removed the scores first, which
      // is why an otherwise complete concept showed 0.0.
      const built = existing.slice();
      const failed = [];
      if (built.length >= numConcepts) {
        setProgress("");
        setError(`${built.length} concepts already generated. Increase the count above, or press "Clear concepts and start again".`);
        setLoading(false);
        return;
      }
      for (let ci = built.length + 1; ci <= numConcepts; ci++) {
        setProgress(`Generating concept ${ci} of ${numConcepts}${existing.length ? " (keeping " + existing.length + " already generated)" : ""}...`);
        const prior = built.map((c) => c.name).filter(Boolean);
        const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
          provider, apiKey, maxTokens: 4000,
          content:
            "You are a landscape architecture concept-design assistant. Given the site analysis findings and " +
            `program brief below, generate ONE zoning concept variant for a park redesign (concept ${ci} of ${numConcepts}). ` +
            (prior.length
              ? `It MUST differ meaningfully in spatial organisation from the concepts already generated: ${prior.join("; ")}. Do not restate them with different wording. `
              : "") +
            "Put the SUMMARY FIELDS FIRST so they survive any truncation. Respond with ONLY a valid JSON object, " +
            "no markdown fences, in exactly this order:\n" +
            '{"name":"short, evocative",' +
            '"scores":{"innovation":0,"human_centered":0,"design_ux":0,"feasibility":0},' +
            '"vision":"1-2 sentence design narrative",' +
            '"organising_idea":"what makes this structurally different from the alternatives",' +
            '"strengths":[""],"weaknesses":[""],' +
            '"zones":[{"name":"","category":"","area_pct":0,"position":"N|NE|E|SE|S|SW|W|NW|Center",' +
            '"rationale":"one sentence citing a SPECIFIC data point from the brief",' +
            '"facilities":[{"name":"","area_m2":0}]}]}\n' +
            "Each score is 1-10 as your honest judgment. Zone area_pct values must sum to approximately 100. " +
            "EVERY facility must carry a positive area_m2, and the facility areas within a zone must sum to " +
            "approximately that zone's area - these feed a cost estimate and a facility without an area cannot be costed. " +
            "Every zone rationale must reference something specific from the brief; generic rationale is not acceptable. " +
            checklistPrompt("CPT") +
            (locationCtx
              ? `\n\nRESEARCHED LOCAL CONTEXT for ${projectLocation} - use this so the concept responds to real local practice, and say in a zone rationale where it follows or deliberately departs from it:\n${locationCtx}`
              : "") +
            `\n\nSITE ANALYSIS & PROGRAM BRIEF:\n${brief}`,
        });
        const p = extractJSON(text);
        // A concept without scores or zones is not a concept. Report it rather
        // than rendering a row of dashes with an overall score of 0.0.
        const hasScores = p && p.scores && ["innovation", "human_centered", "design_ux", "feasibility"]
          .some((k) => Number(p.scores[k]) > 0);
        if (p && p.name && hasScores && (p.zones || []).length) {
          built.push(p);
        } else {
          const why = !p ? "reply could not be read"
            : !hasScores ? "no scores returned"
            : !(p.zones || []).length ? "no zones returned"
            : "incomplete";
          failed.push(`Concept ${ci} (${why})`);
        }
      }
      setProgress("");
      if (!built.length) throw new Error(
        "No complete concept could be generated: " + failed.join("; ") +
        ". Shorten the brief and try again.");
      if (failed.length) setError(
        `Generated ${built.length} of ${numConcepts} concepts. Not generated: ${failed.join("; ")}. ` +
        "Press Generate again - the concepts already produced are kept and only the missing ones are re-attempted. " +
        "If it fails repeatedly, shorten the brief or check your API quota.");
      setConcepts(built);
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
      const summary = concepts.map((c) => ({
        name: c.name, vision: c.vision, organising_idea: c.organising_idea,
        scores: c.scores, overall: overallScore(c),
        strengths: c.strengths, weaknesses: c.weaknesses,
      }));
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 1400,
        content:
          "Given these scored park design concepts, recommend which to move forward with. " +
          "Name the concept explicitly using its exact name from the data. Cite specific scores. " +
          "Respond with ONLY valid JSON, no markdown fences: " +
          '{"recommended_name":"the exact concept name","recommendation":"2-3 sentences on why","tradeoffs":"1-2 sentences on what is given up by not choosing the runner-up"}' +
          "\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });

      // extractJSON returns NULL on an unrecoverable reply - it does not throw.
      // The previous code passed that null straight into state, so a failed call
      // left the recommendation empty with no message and sections 8 and 10 of
      // the export silently blank. Fail loudly instead.
      const parsed = extractJSON(text);
      if (!parsed) throw new Error(
        "The reply could not be read as structured data, even after recovery. " +
        "This is usually a truncated response - press the button again.");

      // Tolerate the key names a model may substitute.
      const rec = {
        recommended_name: parsed.recommended_name || parsed.recommended || parsed.best_concept || "",
        recommendation: parsed.recommendation || parsed.reason || parsed.rationale || "",
        tradeoffs: parsed.tradeoffs || parsed.trade_offs || parsed.tradeoff || "",
      };
      if (!rec.recommendation) throw new Error(
        "The model returned no recommendation text. Press the button again.");
      setRecommendation(rec);
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
      // Facilities may arrive as {name, area_m2} (current) or as plain strings
      // (older runs). Handle both, and always state the area if one exists.
      const facName = (f) => (typeof f === "string" ? f : (f && f.name) || "");
      const facArea = (f) => (typeof f === "string" ? 0 : Number(f && f.area_m2) || 0);
      const fac = (c.zones || []).flatMap((z) => (z.facilities || []).map((f) => {
        const a = facArea(f);
        return `${facName(f)}${a ? ` - ${a.toLocaleString()} m2` : " - AREA NOT STATED"} (${z.name})`;
      }));
      if (fac.length) { lines.push("  FACILITY SCHEDULE (for cost estimating):"); fac.forEach((f) => lines.push(`    - ${f}`)); lines.push(""); }
    });
    if (recommendation) {
      lines.push("RECOMMENDED CONCEPT",
        (recommendation.recommended_name ? recommendation.recommended_name + " - " : "") + (recommendation.recommendation || ""),
        "", "TRADE-OFFS", recommendation.tradeoffs || "", "");
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
          const fName = (f) => (typeof f === "string" ? f : (f && f.name) || "");
          const fArea = (f) => (typeof f === "string" ? 0 : Number(f && f.area_m2) || 0);
          const fac = (c.zones || []).flatMap((z) => (z.facilities || []).map((x) => {
            const a = fArea(x);
            return `${fName(x)}${a ? ` - ${a.toLocaleString()} m2` : " - AREA NOT STATED"} (${z.name})`;
          }));
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
      conclusions: recommendation
        ? [recommendation.recommended_name ? "Recommended: " + recommendation.recommended_name : "",
           recommendation.recommendation, recommendation.tradeoffs].filter(Boolean)
        : [],
      runLimitations: [],
      extraRefs: webSources,
      // F3: report which research mode actually produced this run. Derived from
      // the sources the provider returned, not assumed - a report that claims
      // live research it did not do is worse than one that admits training data.
      // Live research may surface material the fixed checklist does not cover.
      // It is appended INSIDE section 6 as further numbered findings, so the
      // twelve-block structure every deliverable cross-references is untouched.
      // No extra findings here. This tool's output is an ARRAY of concepts, not a
      // single analysis object, so there is no top-level place for retrieved
      // extras to attach. Left explicit rather than as a line that could never fire.
      extraFindings: [],
      provenance: {
        mode: (webSources && webSources.length) ? "web" : "training",
        searchedAt: (webSources && webSources.length) ? new Date().toISOString().slice(0, 10) : null,
      },
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
          {(concepts || []).length > 0 && (
            <button
              onClick={() => { setConcepts(null); setRecommendation(null); setError(""); setProgress(""); }}
              className="text-xs text-brand-danger underline mb-2">
              Clear concepts and start again
            </button>
          )}
          <button onClick={generateConcepts} disabled={loading || !apiKey} className="btn-gold w-full disabled:opacity-60">
            {loading
              ? <span className="inline-block w-[18px] h-[18px] border-2 border-brand-dark/30 border-t-brand-dark rounded-full animate-spin" />
              : <Sparkles size={18} />}
            {loading ? (progress || "Generating concepts...") : "Generate Concepts"}
          </button>
          {loading && (
            <p className="text-[11px] text-brand-text mt-1">
              Each concept is generated in its own call so a long facility schedule cannot truncate the next one.
              {numConcepts > 1 ? ` ${numConcepts} calls, plus research - this takes a minute.` : ""}
            </p>
          )}
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
            <div className="flex items-center mb-2 flex-wrap gap-4">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text">Recommendation</h3>
              <button onClick={generateRecommendation} disabled={recLoading || !apiKey} className="btn-dark"><Sparkles size={15} /> {recLoading ? "Analyzing..." : "Recommend Best Concept"}</button>
            </div>
            {recLoading && <p className="text-sm text-brand-text">Comparing concept scores...</p>}
            {recError && (<div className="space-y-1"><p className="text-sm text-brand-dark flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(recError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {recError}</p></div>)}
            {recommendation && (<div className="space-y-2 text-sm text-brand-dark"><p><span className="font-semibold">Recommended:</span> {recommendation.recommended_name || "(not named)"}</p><p>{recommendation.recommendation}</p><p><span className="font-semibold">Tradeoffs:</span> {recommendation.tradeoffs}</p></div>)}
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
