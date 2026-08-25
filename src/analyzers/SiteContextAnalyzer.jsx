import React, { useState, useEffect, useRef } from "react";
import { Sparkles, Plus, Trash2, MapPin, Info, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, FileText, Printer, Search, Image as ImageIcon } from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { getUsage, recordUsage, resetUsage, estimateRun, countTokensExact } from "../utils/tokenMeter";
import { setActiveTool, setActiveEstimate, setActivePartial, clearActiveTool, setActiveBusy } from "../utils/toolBridge";
import {
  buildChunkedPrompt, emptyState, mergeChunk, isComplete,
  progressLabel, savePartial, loadPartial, clearPartial,
} from "../utils/chunkedGeneration";
import { checklistPrompt } from "../utils/methodology";
import { friendlyError, fileToBase64Raw, fileToImagePart, extractJSON } from "../utils/helpers";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, tableHTML, barChartSVG, missingFields, missingFieldsNote } from "../utils/reportTemplate";

const BTN_DARK = { backgroundColor: "#E8EFF7", color: "#0E1520" };
const BTN_GOLD = { backgroundColor: "#FF8A3D", color: "#E8EFF7" };

const CAPACITY_LOW = 150 / 10000;
const CAPACITY_HIGH = 400 / 10000;

function uid() { return Math.random().toString(36).slice(2, 9); }

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}



// NOTE: this file previously defined its own extractJSON here. It shadowed the
// shared one in utils/helpers.js and had NO truncation repair, which is why this
// tool - and only this tool - failed outright on a cut-off reply with
// "Expected ',' or ']' after array element". It now uses the shared parser.

const SITE_PROMPT =
  "You are a site analyst preparing a professional site context and accessibility analysis. Use only the location, description and any images supplied. " +
  "Return ONLY valid JSON, no markdown fences, with these keys: " +
  "{\"adjacencies\":[{\"direction\":\"N|NE|E|SE|S|SW|W|NW\",\"land_use\":\"\",\"demand_implication\":\"what this generates at that edge\",\"design_response\":\"the specific spatial move it calls for\"}]," +
  "\"accessibility_standards\":[{\"requirement\":\"\",\"value\":\"\",\"source\":\"the actual code/standard for THIS jurisdiction\"}]," +
  "\"hazard_screening\":[{\"hazard\":\"flood|seismic|subsidence|contamination|high water table|coastal|storm|other\",\"likelihood\":\"Documented|Possible|Unlikely|Unknown\",\"basis\":\"why - cite what is publicly documented for this region\",\"design_implication\":\"\"}]," +
  "\"quiet_and_active_zoning\":[{\"edge\":\"\",\"suggested_character\":\"quiet/green buffer OR active/high-throughput\",\"reason\":\"tie to the adjacency - e.g. a school edge needs buffering, a transit edge needs capacity\"}]," +
  "\"key_findings\":[\"\"],\"constraints\":[\"\"],\"conclusion\":\"2-3 sentences naming the single highest-priority action\"}. " +
  "For adjacencies: return an entry for EVERY compass edge you can establish. If an edge cannot be determined from the description, image or research, still return it with land_use set to \"Not determined - requires site visit\" rather than omitting it, so no edge silently disappears from the report. " +
  "For hazard_screening: this is a PRELIMINARY DESK SCREENING prompting professional assessment, not a hazard assessment - only report what is genuinely documented for the region and mark anything else Unknown. " +
  "For accessibility_standards: cite the standards that actually apply in the country/city given, never a default jurisdiction.";

export default function SiteContextAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();
  const [imageNotes, setImageNotes] = useState("");
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

  const [tokenUsage, setTokenUsage] = useState(() => getUsage("SCX"));
  const noteUsage = (u) => setTokenUsage(recordUsage("SCX", u));
  /*
    CHUNKED INSIGHT (F13b). The model returns only sections it can COMPLETE and
    declares what remains; whatever arrives is merged and kept, so a budget that
    runs out mid-reply no longer discards the whole run. maxTokens is untouched.
  */
  const INSIGHT_TOPICS = [
    { key: "findings", label: "Key findings" },
    { key: "forward_constraints", label: "Forward constraints" },
    { key: "conclusion", label: "Conclusions and recommendations" },
  ];
  const [chunkState, setChunkState] = useState(() => loadPartial("SCX", INSIGHT_TOPICS) || emptyState(INSIGHT_TOPICS));
  const chunkProgress = progressLabel(chunkState, INSIGHT_TOPICS);
  const insightComplete = isComplete(chunkState, INSIGHT_TOPICS);
  const [exactEstimate, setExactEstimate] = useState(null);
  const [counting, setCounting] = useState(false);
  async function calculateTokens() {
    setCounting(true);
    try {
      const preview = JSON.stringify({ location, siteArea, description }).slice(0, 20000);
      const exact = await countTokensExact({ provider, apiKey, model: undefined,
        systemText: "site context system instruction and methodology checklist", userText: preview });
      setExactEstimate(exact && exact.exact
        ? { input: exact.input, output: Math.ceil(2500 * 0.7), total: exact.input + Math.ceil(2500 * 0.7), calls: 1, exact: true }
        : { ...estimateRun({ userText: preview, maxTokens: 2500, calls: 1 }), exact: false });
    } catch { setExactEstimate(null); } finally { setCounting(false); }
  }

  // Publish this tool's estimator and reset to the rails. Registered on mount
  // and refreshed whenever the estimate changes, so the Budget rail can offer
  // "Calculate tokens" and show the result for the tool actually on screen.
  useEffect(() => {
    setActiveTool("SCX", {
      calculate: calculateTokens,
      cancel: cancelRequest,
    resetUsage: () => setTokenUsage(resetUsage("SCX")),
      estimate: exactEstimate,
    });
    return () => clearActiveTool("SCX");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setActiveEstimate("SCX", exactEstimate); }, [exactEstimate]);
  useEffect(() => { setActiveBusy("SCX", busy); }, [busy]);
  // Publish progress so the Budget/Usage rail can show an unfinished report -
  // the rail is where a user is looking while a long run is in flight.
  useEffect(() => {
    setActivePartial("SCX", chunkProgress.complete ? null : {
      done: chunkProgress.doneLabels, remaining: chunkProgress.remainingLabels,
    });
  }, [chunkProgress.doneCount, chunkProgress.complete]);
  // PDF export opens a new tab; browsers block that silently. This surfaces it -
  // the previous code called a setError() never declared in this file, so the typeof
  // guard swallowed the message and the click appeared to do nothing at all.
  const [pdfError, setPdfError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageStatus, setImageStatus] = useState("");
  const [location, setLocation] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");

  // Total site area. autoSuggestZones apportions zone areas from this, and it drives
  // the site-wide capacity band. It was referenced before it existed - the tool would
  // have thrown "siteArea is not defined" on every research run.
  const [siteArea, setSiteArea] = useState("");
  const [zones, setZones] = useState([{ id: uid(), name: "", area: "" }]);
  const [paths, setPaths] = useState([{ id: uid(), name: "", type: "path", width: "", levelChange: "" }]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");
  // Partial success is not failure: a dropped tail field means some sections
  // are thin, not that the run failed.
  const [insightWarning, setInsightWarning] = useState("");

  async function handleImageUpload(e) {
    const files = Array.from(e.target.files || []).slice(0, 4);
    if (!files.length) return;
    setImageLoading(true);
    setContextError("");
    setImageStatus("");
    try {
      const blocks = [];
      for (const f of files) {
        // media_type MUST come from the encoder, not from the original file:
        // the image is re-encoded to JPEG on the way through.
        const part = await fileToImagePart(f);
        if (!part || !part.base64) throw new Error(`"${f.name}" could not be read as an image.`);
        blocks.push({ type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } });
      }
      blocks.push({ type: "text", text: "These are site/GIS/map images for a park design project. Describe what surrounds the site on each edge - adjacent land uses, roads, buildings, transit, open space. Note anything relevant to arrival, access or noise. Write plain factual observations, no speculation." });
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(), provider, apiKey, maxTokens: 2500, content: blocks });
      if (!text) throw new Error("The AI returned no description for these images.");
      setImageNotes((prev) => (prev ? prev + "\n\n" : "") + text);
      // Confirm on screen. Previously the button simply reverted to its idle
      // label and nothing said whether the read had worked.
      setImageStatus(`Read ${files.length} image${files.length === 1 ? "" : "s"}. The interpretation is included in the analysis below.`);
    } catch (e) {
      setContextError(e.message || "Could not read these images.");
    } finally {
      setImageLoading(false);
      e.target.value = "";
    }
  }

  async function analyzeSiteContext() {
    if (!location.trim() && !siteDescription.trim() && !imageNotes) {
      setContextError("Give the tool a location, a description, or an uploaded map before analysing.");
      return;
    }
    setContextLoading(true); setContextError("");
    try {
      const resText = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 4000, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content: SITE_PROMPT + checklistPrompt("SCX") +
          "\n\nLOCATION: " + (location || "(not stated)") +
          "\nDESCRIPTION: " + (siteDescription || "(none)") +
          (imageNotes ? "\n\nIMAGE INTERPRETATION:\n" + imageNotes : ""),
      });
      if (!resText) throw new Error("The AI returned an empty response.");
      const parsed = extractJSON(resText);
      if (!parsed) throw new Error(
        "The AI's reply could not be read as structured data, even after recovery. " +
        "This is usually an over-long reply - shorten the site description and try again.");
      if (!parsed) throw new Error("The AI's reply could not be read as structured data. Try again.");
      setContext(parsed);
      // Do NOT populate the insight here. Research and insight are two separate,
      // separately-consented AI steps: this call establishes the standards and
      // adjacencies, and "Generate AI Insight" interprets them. Setting both from
      // one run made the research button appear to trigger insight generation.
      // Clearing it also prevents a previous location's insight persisting.
      setInsight(null);
      setInsightError("");
      // Propose zones from the researched context, as the Solar tool does, so the
      // capacity table and charts are populated on a first run. Fully editable.
      if (siteArea && !zones.filter((z) => z.name.trim()).length) autoSuggestZones(parsed);
    } catch (e) {
      setContextError(e.message || "Something went wrong analysing the site. Try again.");
    } finally {
      setContextLoading(false);
    }
  }

  function addZone() { setZones([...zones, { id: uid(), name: "", area: "" }]); }
  function updateZone(id, patch) { setZones(zones.map((z) => (z.id === id ? { ...z, ...patch } : z))); }
  function removeZone(id) { setZones(zones.filter((z) => z.id !== id)); }
  function addPath() { setPaths([...paths, { id: uid(), name: "", type: "path", width: "", levelChange: "" }]); }
  function updatePath(id, patch) { setPaths(paths.map((p) => (p.id === id ? { ...p, ...patch } : p))); }
  function removePath(id) { setPaths(paths.filter((p) => p.id !== id)); }

  function capacityRange(area) {
    const a = Number(area) || 0;
    return { low: Math.round(a * CAPACITY_LOW), high: Math.round(a * CAPACITY_HIGH) };
  }

  function minWidthFor(type) {
    if (!context?.accessibility_standards) return type === "ramp" ? 1.0 : type === "crossing" ? 2.0 : 1.8;
    const match = context.accessibility_standards.find((s) => (s.label || "").toLowerCase().includes(type));
    return match?.min_width_m || (type === "ramp" ? 1.0 : type === "crossing" ? 2.0 : 1.8);
  }

  function checkPath(p) {
    const w = Number(p.width);
    const minWidth = minWidthFor(p.type);
    const lc = Number(p.levelChange) || 0;
    const issues = [];
    if (!w) return { status: "pending", label: "Enter width to check" };
    if (w < minWidth) issues.push(`Width ${w}m is below the ${minWidth}m minimum for a ${p.type}`);
    if (p.type === "ramp" && lc > 0.5) issues.push(`Level change ${lc}m may require handrails - verify local threshold`);
    if (p.type === "ramp" && lc === 0) issues.push(`Gradient can't be checked - enter level change or get real elevation data`);
    if (issues.length === 0) return { status: "pass", label: "Width meets minimum standard" };
    return { status: "review", label: issues.join("; ") };
  }

  // Generate = start over. Continue = add the sections still missing.

  // One button doing both meant there was no way to restart cleanly.

  function startFreshInsight() {

    clearPartial("SCX");

    setChunkState(emptyState(INSIGHT_TOPICS));

    generateInsight();

  }

  function continueInsight() { generateInsight(); }


  async function generateInsight() {
    if (!context) { setInsightError("Run 'Analyze Site Context' above first - this insight builds on that analysis."); return; }
    setInsightLoading(true); setInsight(null); setInsightError(""); setInsightWarning("");
    const summary = {
      location: location || "Not specified",
      adjacencies: context.adjacencies,
      accessibility_standards_used: context.accessibility_standards,
      zone_capacity: zones.filter((z) => z.name.trim()).map((z) => ({ zone: z.name, area_m2: z.area, capacity_range: capacityRange(z.area) })),
      path_accessibility: paths.filter((p) => p.name.trim()).map((p) => ({ path: p.name, type: p.type, width_m: p.width, level_change_m: p.levelChange, check: checkPath(p) })),
    };

    try {

      const prompt = `You are a landscape architecture assistant reviewing site context, crowd capacity, and accessibility compliance for a park redesign project, using only the data given - no invented figures. Provide: (1) 1-2 sentences on how adjacent land uses should shape circulation/entry design, (2) any zone whose capacity range looks like it could create crowding or underuse, (3) any path/ramp that failed or needs review, (4) explicitly list the minimum required parameters that should be fed forward as constraints into the Concept Generator step. Then write a 'conclusion' field: 2-3 sentences naming the single highest-priority action. Respond with ONLY valid JSON, no markdown fences: {"findings": [""], "forward_constraints": [""], "conclusion": ""}\n\nDATA:\n${JSON.stringify(summary, null, 2)}`;

      const resText = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider,
        apiKey: apiKey,
        maxTokens: 4000,
        // Continuation-aware: the instruction names what is already written and
        // what still needs writing. Empty on a first run.
        prompt: prompt + chunkInstruction,
        systemInstruction: "You are an architectural strategy expert. Output valid JSON only.",
      });

      if (!resText) throw new Error("The AI returned an empty response.");
     
      const chunkInstruction = buildChunkedPrompt({ topics: INSIGHT_TOPICS,
        done: chunkState.done, continuationSummary: chunkState.continuationSummary });
 const parsedInsight = extractJSON(resText);
      if (!parsedInsight) throw new Error(
        "The AI's reply could not be read as structured data, even after recovery. Try again.");
      // Merge into accumulated state - never overwrites longer content with
      // shorter, ignores invented keys, rejects a false completion claim.
      const _merged = mergeChunk(chunkState, {
        sections: parsedInsight.sections || parsedInsight,
        completed: parsedInsight.completed, remaining: parsedInsight.remaining,
        continuation_summary: parsedInsight.continuation_summary,
      }, INSIGHT_TOPICS);
      setChunkState(_merged); savePartial("SCX", _merged);
      setInsight({ ...parsedInsight, ..._merged.sections });
      // Field guard: a run short of budget drops the TAIL fields of a schema and
      // the report then prints "(not generated)" with nothing on screen to say why.
      const gaps = missingFields(parsedInsight, ["findings", "forward_constraints", "conclusion"]);
      setInsightWarning(gaps.length ? missingFieldsNote(gaps) : "");
    } catch (e) {
      setInsightError(e.message || "Something went wrong generating the insight. Try again.");
    } finally {
      setInsightLoading(false);
    }
  }

  function buildReportText() {
    let lines = ["SITE CONTEXT, URBAN FABRIC & ACCESSIBILITY", `Location: ${location || "Not specified"}`, ""];
    if (context) {
      lines.push("ADJACENT LAND-USE");
      (context.adjacencies || []).forEach((a) => lines.push(`  ${a.direction}: ${a.land_use || "not determined"} - ${a.demand_implication || "not determined"}`));
      lines.push("", "ACCESSIBILITY STANDARDS");
      (context.accessibility_standards || []).forEach((s) => lines.push(`  ${s.requirement || s.label}: ${s.value} (source: ${s.source})`));
    }
    lines.push("", "ZONE CAPACITY");
    zones.filter((z) => z.name.trim()).forEach((z) => { const c = capacityRange(z.area); lines.push(`  ${z.name} (${z.area}m2): ${c.low}-${c.high} peak visitors`); });
    lines.push("", "PATH & RAMP ACCESSIBILITY CHECK");
    paths.filter((p) => p.name.trim()).forEach((p) => lines.push(`  ${p.name} (${p.type}, ${p.width}m): ${checkPath(p).label}`));
    if (insight) {
      lines.push("", "KEY FINDINGS");
      keyFindings().forEach((f) => lines.push(`  - ${f}`));
      lines.push("", "CONSTRAINTS FOR CONCEPT GENERATOR");
      (insight.constraints || []).forEach((f) => lines.push(`  - ${f}`));
      lines.push("", "CONCLUSION", overallConclusion());
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
      toolCode: "SCX",
      meta,
      inputRecord: [{label:"Location",value:location||"(not stated)"},{label:"Description",value:(siteDescription||"(none)").slice(0,400)}],
      // Section 6 is built as SEPARATE findings, each with its own heading and table.
      // Previously the whole report was pushed in as one "Analysis output" text blob,
      // so every internal heading rendered at the same level and the section read as
      // one merged dump rather than structured subsections.
      findings: (() => {
        const F = [];
        if ((context?.adjacencies || []).length) F.push({
          title: "Adjacent land use",
          headers: ["Edge", "Adjacent land use", "Implication"],
          rows: context.adjacencies.map((a) => [a.direction || "-", a.land_use || "Not determined", a.demand_implication || "Not determined"]),
        });
        if ((context?.accessibility_standards || []).length) F.push({
          title: "Accessibility standards researched for this location",
          note: "Each threshold is recorded with the standard it derives from, so the check is auditable.",
          headers: ["Requirement", "Value", "Source"],
          rows: context.accessibility_standards.map((x) => [x.requirement || x.label || "-", x.value || "-", x.source || "-"]),
        });
        const namedZones = zones.filter((z) => z.name.trim());
        if (namedZones.length) F.push({
          title: "Indicative visitor capacity by zone",
          note: "Deterministic. Indicative planning bands, not modelled occupancy.",
          headers: ["Zone", "Area (m2)", "Low", "High"],
          rows: namedZones.map((z) => { const c = capacityRange(z.area); return [z.name, z.area || "-", c.low, c.high]; }),
        });
        const namedPaths = paths.filter((p) => p.name.trim());
        if (namedPaths.length) F.push({
          title: "Path and ramp accessibility check",
          note: "Deterministic. Width compared against the threshold named in the standards table.",
          headers: ["Element", "Type", "Width (m)", "Result"],
          rows: namedPaths.map((p) => [p.name, p.type, p.width || "-", checkPath(p).label]),
        });
        if (keyFindings().length) F.push({ title: "Key findings", items: keyFindings() });
        if (forwardConstraints().length) F.push({ title: "Constraints for the concept generator", items: forwardConstraints() });
        return F.length ? F : [{ title: "Analysis output", text: buildReportText() }];
      })(),
      chartNote: (zones.filter((z) => z.name.trim()).length || adjacencies().length)
        ? "Adjacency map, zone capacity chart and accessibility check table are reproduced in the PDF export."
        : "No charts - add zones or run the analysis first.",
      chartsHtml:
        (adjacencies().length
          ? tableHTML(["Direction", "Adjacent land use", "Demand implication", "Design response"],
              adjacencies().map((a) => [a.direction, a.land_use, a.demand_implication, a.design_response]),
              "Adjacent land use by edge")
          : "") +
        (hazards().length
          ? tableHTML(["Hazard", "Likelihood", "Basis", "Design implication"],
              hazards().map((hz) => [hz.hazard, hz.likelihood, hz.basis, hz.design_implication]),
              "Preliminary hazard screening (desk study - prompts professional assessment)")
          : "") +
        (zoning().length
          ? tableHTML(["Edge", "Suggested character", "Reason"],
              zoning().map((q) => [q.edge, q.suggested_character, q.reason]),
              "Suggested edge character")
          : "") +
        (zones.filter((z) => z.name.trim()).length
          ? barChartSVG(zones.filter((z) => z.name.trim()).map((z) => {
              const c = capacityRange(z.area);
              return { label: z.name, value: c.high, display: `${c.low}-${c.high} people` };
            }), { title: "Indicative peak capacity by zone" })
          : ""),
      interpretation: overallConclusion(),
      conclusions: [...keyFindings(), ...forwardConstraints()].filter(Boolean),
      runLimitations: [],
      extraRefs: webSources,
      // F3: report which research mode actually produced this run. Derived from
      // the sources the provider returned, not assumed - a report that claims
      // live research it did not do is worse than one that admits training data.
      // Live research may surface material the fixed checklist does not cover.
      // It is appended INSIDE section 6 as further numbered findings, so the
      // twelve-block structure every deliverable cross-references is untouched.
      extraFindings: (insight && Array.isArray(insight.extra_findings))
        ? insight.extra_findings : [],
      provenance: {
        mode: (webSources && webSources.length) ? "web" : "training",
        searchedAt: (webSources && webSources.length) ? new Date().toISOString().slice(0, 10) : null,
      },
      overflow: overflowText,
    };
  }

  async function withOverflow(run) {
    if (includeOverflow && !overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "SCX",
        reportText: buildReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() { withOverflow((o) => exportStructuredExcel(o, XLSX)); }

  function exportWord() { withOverflow((o) => exportStructuredWord(o)); }




  // Mirrors the Solar tool: propose the zones a park of this size and context would
  // contain, so capacity and charts work on a first run without the user having to
  // hand-enter a zone schedule. Everything proposed stays fully editable.
  const [autoZoneNote, setAutoZoneNote] = useState("");
  const [autoZoneLoading, setAutoZoneLoading] = useState(false);
  async function autoSuggestZones(ctxData) {
    if (!siteArea) { setAutoZoneNote("Enter a site area first - zone areas are apportioned from it."); return; }
    setAutoZoneLoading(true); setAutoZoneNote("");
    try {
      const adj = (ctxData?.adjacencies || []).map((a) => `${a.direction}: ${a.land_use || "unknown"}`).join("; ");
      const resText = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        // No `model` - this context exposes { provider, apiKey, meta } only.
        provider, apiKey, maxTokens: 1200,
        content:
          `For a public park of ${siteArea} m2 at "${location || "the stated location"}", propose the functional zones such a park would typically contain. ` +
          `Adjacent land uses by edge: ${adj || "not established"}. ` +
          "Apportion areas so they sum to approximately the total site area. Respond with ONLY valid JSON, no markdown fences: " +
          '{"zones":[{"name":"","area":0}]}',
      });
      const parsed = extractJSON(resText);
      if (!parsed) throw new Error("The reply could not be read as structured data, even after recovery. "
        + "This is usually a truncated response - shorten the input or run it again.");
      const proposed = (parsed?.zones || []).filter((z) => z?.name).map((z) => ({
        id: uid("zone"), name: String(z.name), area: String(Math.round(Number(z.area) || 0)),
      }));
      if (!proposed.length) throw new Error("No zones were proposed. Add them manually below.");
      setZones((prev) => [...prev.filter((z) => z.name.trim()), ...proposed]);
      setAutoZoneNote(`${proposed.length} zones proposed from the site context. Edit or delete any of them - they are a starting point, not a decision.`);
    } catch (err) {
      setAutoZoneNote(friendlyError(err.message) || "Could not propose zones. Add them manually below.");
    } finally { setAutoZoneLoading(false); }
  }

  // These four come from the RESEARCH call (context), not the insight call. Reading
  // them off `insight` returned undefined - which is why chartsHtml was always empty
  // and "no chartable data" appeared even on a run with eight populated edges.
  const adjacencies = () => context?.adjacencies || insight?.adjacencies || [];
  const hazards = () => context?.hazard_screening || insight?.hazard_screening || [];
  const zoning = () => context?.quiet_and_active_zoning || insight?.quiet_and_active_zoning || [];
  const accessStandards = () => context?.accessibility_standards || insight?.accessibility_standards || [];

  // ── Field reconciliation ────────────────────────────────────────────────
  // Two AI calls populate this tool and they use DIFFERENT key names:
  //   research (context) returns  key_findings / constraints / conclusion
  //   insight            returns  findings / forward_constraints / conclusion
  // The report previously read insight.key_findings and insight.constraints -
  // names neither call produces - so section 10 was always empty and the on-screen
  // findings list was always blank, no matter how good the model's answer was.
  // Read both shapes, from both objects, in one place.
  const keyFindings = () =>
    (insight?.findings?.length && insight.findings) ||
    (insight?.key_findings?.length && insight.key_findings) ||
    (context?.key_findings?.length && context.key_findings) || [];
  const forwardConstraints = () =>
    (insight?.forward_constraints?.length && insight.forward_constraints) ||
    (insight?.constraints?.length && insight.constraints) ||
    (context?.constraints?.length && context.constraints) || [];
  const overallConclusion = () => insight?.conclusion || context?.conclusion || "";

  function exportPDF() {
    setPdfError("");
    withOverflow((o) => exportStructuredPDF(o, () => {
      setPdfError("Your browser blocked the new tab needed for PDF export. Allow pop-ups for this site and try again.");
    }));
  }

  const STATUS_ICON = { pass: <CheckCircle2 size={14} className="text-[#3D7A5C]" />, review: <AlertTriangle size={14} className="text-[#B8863B]" />, pending: <XCircle size={14} className="text-[#8A8474]" /> };

  return (
    <div className="min-h-screen bg-[#F7F5F1] text-[#1C2333] font-sans">
      <ToolIntro toolCode="SCX" />

      <header style={BTN_DARK} className="px-6 py-5">
        <p className="text-xs tracking-[0.2em] uppercase" style={{ color: "#FF8A3D" }}>Site Analysis Tool</p>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><MapPin size={20} style={{ color: "#FF8A3D" }} /> Site Context, Urban Fabric & Accessibility</h1>
        <p className="text-sm mt-1" style={{ color: "#C9C6BE" }}>Give it your site's location, a description, or an image - it researches real adjacency and accessibility standards, then checks your zones/paths against them.</p>
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-lg border-2 border-[#E8E2D5] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E2D5] bg-[#FBF7EE]"><h2 className="font-bold text-sm uppercase tracking-wide">Step 1 - Describe Your Site</h2></div>
          <div className="p-4 space-y-3">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Project location (e.g. Riverside Park, Chicago, USA)" className="w-full text-sm bg-[#F7F5F1] border-2 border-[#E8E2D5] rounded-md p-2.5 focus:border-[#C9A46A] outline-none" />
            <input type="number" value={siteArea} onChange={(e) => setSiteArea(e.target.value)} placeholder="Total site area in m2 (optional - enables capacity estimate and proposed zones)" className="w-full text-sm bg-[#F7F5F1] border-2 border-[#E8E2D5] rounded-md p-2.5 focus:border-[#C9A46A] outline-none font-mono" />
            <textarea value={siteDescription} onChange={(e) => setSiteDescription(e.target.value)} placeholder="Describe what's around the site (adjacent buildings, roads, land uses) - or upload a GIS/map image below instead" rows={4} className="w-full text-sm bg-[#F7F5F1] border-2 border-[#E8E2D5] rounded-md p-3 focus:border-[#C9A46A] outline-none resize-y" />
            <label className="text-sm font-semibold border-2 px-4 py-2.5 rounded-md flex items-center gap-2 cursor-pointer w-fit" style={{ borderColor: "#4DA3FF", color: "#EAF3FF", backgroundColor: "#131C29" }}>
              <ImageIcon size={15} /> {imageLoading ? "Reading images..." : "Upload Site / GIS Map Images (up to 4, optional)"}
              <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="sr-only" />
            </label>
            {imageNotes && (
              <div className="mt-2 border border-brand-border rounded p-2.5 bg-[#F7F5F1]">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-semibold text-brand-text uppercase tracking-wide">Map / photo interpretation (AI-generated)</p>
                  <button onClick={() => setImageNotes("")} className="text-[10px] text-brand-danger hover:underline">Clear</button>
                </div>
                <p className="text-[10px] text-brand-text whitespace-pre-wrap max-h-32 overflow-y-auto">{imageNotes}</p>
              </div>
            )}
            {imageStatus && (
              <p className="text-xs text-[#2F5D3F] bg-[#EAF3EC] border border-[#BBD6C2] rounded p-2 mt-2">{imageStatus}</p>
            )}
            <p className="text-[10px] text-[#8A8474]">Up to 4 images. Image upload may not work inside the Claude mobile app (platform restriction) - try your phone's regular browser, or use the text fields above.</p>
            <button onClick={analyzeSiteContext} disabled={contextLoading} style={BTN_GOLD} className="w-full text-base font-bold px-4 py-3 rounded-md flex items-center justify-center gap-2 disabled:opacity-40 shadow-md">
              <Search size={18} /> {contextLoading ? "Researching site context..." : "Analyze Site Context"}
            </button>
            {contextLoading && <p className="text-xs text-[#8A8474]">Reading your input and, if needed, searching for real local accessibility standards - this can take a moment.</p>}
            {contextError && (<div className="space-y-1"><p className="text-xs text-[#E8EFF7] flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-[#B84C3D]" /> {friendlyError(contextError)}</p><p className="text-[10px] text-[#8A8474] font-mono pl-4">Technical: {contextError}</p></div>)}
            {context?.note && <p className="text-xs text-[#B8863B] flex items-center gap-1"><Info size={12} /> {context.note}</p>}
          </div>
        </div>

        {context && (
          <>
            <div className="bg-white rounded-lg border border-[#E8E2D5] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E8E2D5]"><h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Adjacent Land-Use & Urban Fabric</h2></div>
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[#8A8474] text-xs uppercase tracking-wide border-b border-[#E8E2D5]"><th className="px-4 py-2">Direction</th><th className="px-4 py-2">Adjacent Use</th><th className="px-4 py-2">Design Implication</th></tr></thead><tbody>{adjacencies().map((a, i) => (<tr key={i} className="border-b border-[#F0EBDF]"><td className="px-4 py-2 font-medium">{a.direction}</td><td className="px-4 py-2">{a.land_use || a.use || <span className="text-[#B8863B]">Not determined</span>}</td><td className="px-4 py-2 text-[#5A5445] text-xs">{a.demand_implication || a.implication || "—"}</td></tr>))}</tbody></table></div>
            </div>

            <div className="bg-white rounded-lg border border-[#E8E2D5] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E8E2D5]"><h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Accessibility Standards (researched for this location)</h2></div>
              <div className="p-4 space-y-2">{(context.accessibility_standards || []).map((s, i) => (<div key={i} className="flex items-center justify-between text-xs border border-[#F0EBDF] rounded px-3 py-2"><span className="text-[#5A5445]">{s.requirement || s.label}</span><span className="font-mono font-semibold">{s.value}</span><span className="text-[9px] text-[#8A8474] italic">{s.source}</span></div>))}</div>
            </div>
          </>
        )}

        <div className="bg-white rounded-lg border border-[#E8E2D5] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E2D5] flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Zone Capacity</h2>
              <p className="text-[10px] text-brand-text/60 font-normal normal-case mt-0.5">
                Optional. Add a zone and its area to estimate how many visitors it can hold at peak.
                Leave empty if you only want the context analysis.
              </p>
            </div>
            <button onClick={addZone} style={BTN_GOLD} className="text-xs font-semibold px-3 py-1.5 rounded-md flex items-center gap-1"><Plus size={13} /> Add zone</button>
          </div>
          {(autoZoneLoading || autoZoneNote) && (
            <p className="text-[10px] mb-2 flex items-start gap-1" style={{ color: autoZoneLoading ? "#93A6BC" : "#4DD091" }}>
              <Info size={10} className="mt-0.5 flex-shrink-0" /> {autoZoneLoading ? "Proposing zones from the site context..." : autoZoneNote}
            </p>
          )}
          <div className="hidden">
          </div>
          <div className="p-4 space-y-2">
            {zones.map((z) => { const c = capacityRange(z.area); return (<div key={z.id} className="flex items-center gap-2 text-sm"><input value={z.name} onChange={(e) => updateZone(z.id, { name: e.target.value })} placeholder="Zone name" className="flex-1 bg-[#F7F5F1] border border-[#E8E2D5] rounded px-2 py-1.5 focus:border-[#C9A46A] outline-none" /><input type="number" value={z.area} onChange={(e) => updateZone(z.id, { area: e.target.value })} placeholder="Area m2" className="w-24 bg-[#F7F5F1] border border-[#E8E2D5] rounded px-2 py-1.5 font-mono focus:border-[#C9A46A] outline-none" /><span className="w-32 text-xs font-mono text-[#FF8A3D] text-right">{z.area ? `${c.low}-${c.high} visitors` : "--"}</span><button onClick={() => removeZone(z.id)} className="text-[#B8A98F] hover:text-[#B84C3D]"><Trash2 size={14} /></button></div>); })}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-[#E8E2D5] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E2D5] flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Path &amp; Ramp Accessibility Check</h2>
              <p className="text-[10px] text-brand-text/60 font-normal normal-case mt-0.5">
                Optional. Enter a path or ramp width in metres to check it against accessibility
                minimums. Gradient cannot be checked without survey data and is reported as Pending.
              </p>
            </div>
            <button onClick={addPath} style={BTN_GOLD} className="text-xs font-semibold px-3 py-1.5 rounded-md flex items-center gap-1"><Plus size={13} /> Add path</button>
          </div>
          <div className="p-4 space-y-2">
            {paths.map((p) => {
              const c = checkPath(p);
              return (
                <div key={p.id} className="border border-[#E8E2D5] rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <input value={p.name} onChange={(e) => updatePath(p.id, { name: e.target.value })} placeholder="Path/ramp name" className="flex-1 bg-[#F7F5F1] border border-[#E8E2D5] rounded px-2 py-1.5 focus:border-[#C9A46A] outline-none" />
                    <select value={p.type} onChange={(e) => updatePath(p.id, { type: e.target.value })} className="text-xs bg-[#F7F5F1] border border-[#E8E2D5] rounded px-2 py-1.5"><option value="path">Path</option><option value="ramp">Ramp</option><option value="crossing">Crossing</option></select>
                    <button onClick={() => removePath(p.id)} className="text-[#B8A98F] hover:text-[#B84C3D]"><Trash2 size={14} /></button>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">Width (m)<input type="number" step="0.1" value={p.width} onChange={(e) => updatePath(p.id, { width: e.target.value })} className="w-16 bg-[#F7F5F1] border border-[#E8E2D5] rounded px-1.5 py-1 font-mono" /></label>
                    {p.type === "ramp" && (<label className="flex items-center gap-1">Level change (m)<input type="number" step="0.1" value={p.levelChange} onChange={(e) => updatePath(p.id, { levelChange: e.target.value })} className="w-16 bg-[#F7F5F1] border border-[#E8E2D5] rounded px-1.5 py-1 font-mono" /></label>)}
                    <span className="flex items-center gap-1 ml-auto" style={{ color: c.status === "pass" ? "#4DD091" : c.status === "review" ? "#FFB454" : "#93A6BC" }}>{STATUS_ICON[c.status]} {c.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-lg border-2 border-[#E8E2D5] p-4">
          <div className="flex items-center mb-2 flex-wrap gap-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Step 2 - AI Insight & Recommendation</h2>
            <button onClick={startFreshInsight} disabled={insightLoading} title={chunkState.done.length && !insightComplete ? "Continue generating the remaining sections" : undefined} style={BTN_DARK} className="text-sm font-bold px-4 py-2.5 rounded-md flex items-center gap-2 disabled:opacity-40 shadow-md">
              <Sparkles size={15} /> {insightLoading ? "Analyzing..." : "Generate AI Insight"}
            </button>
            {chunkState.done.length > 0 && !insightComplete && (
              <button type="button" onClick={continueInsight} disabled={insightLoading}
                className="btn-gold ml-2">
                {insightLoading ? "Continuing..." : `Continue insight (${chunkProgress.remainingLabels.length} left)`}
              </button>
            )}
            {chunkState.done.length > 0 && !insightComplete && (
              <div className="mt-2 text-xs bg-[#FBF3E4] border border-[#E4D2A8] text-[#7A5B18] rounded p-2">
                <strong>{chunkProgress.text}</strong>{" "}Generated: {chunkProgress.doneLabels.join(", ")}.{" "}
                Still to generate: {chunkProgress.remainingLabels.join(", ")}.
                <div className="text-brand-muted mt-1">Nothing already generated is lost. You may switch API key first, then press again to continue.</div>
              </div>
            )}
            {chunkState.done.length > 0 && (
              <button type="button" className="mt-2 text-xs underline text-brand-muted"
                onClick={() => { clearPartial("SCX"); setChunkState(emptyState(INSIGHT_TOPICS)); setInsight(null); }}>
                {insightComplete ? "Clear and start over" : "Discard partial insight and start over"}
              </button>
            )}
          </div>
          {insightLoading && <p className="text-sm text-[#8A8474]">Reviewing adjacency, capacity, and accessibility data...</p>}
          {insightError && (<div className="space-y-1"><p className="text-sm text-[#E8EFF7] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-[#B84C3D]" /> {friendlyError(insightError)}</p><p className="text-[10px] text-[#8A8474] font-mono pl-5">Technical: {insightError}</p></div>)}
          {insight && (
            <div className="space-y-3">
              <div className="space-y-1">{keyFindings().map((f, i) => (<p key={i} className="text-sm text-[#E8EFF7]">- {f}</p>))}</div>

              {adjacencies()?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#FF8A3D] uppercase tracking-wide mb-1">Adjacent land use by edge</p>
                  {adjacencies().map((a, i) => (
                    <p key={i} className="text-xs text-[#5A5445] mb-1">
                      <span className="font-semibold">{a.direction}:</span> {a.land_use} - {a.demand_implication} <span className="text-brand-success">{a.design_response}</span>
                    </p>
                  ))}
                </div>
              )}

              {zoning()?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#FF8A3D] uppercase tracking-wide mb-1">Suggested edge character</p>
                  {zoning().map((q, i) => (
                    <p key={i} className="text-xs text-[#5A5445]"><span className="font-semibold">{q.edge}:</span> {q.suggested_character} - {q.reason}</p>
                  ))}
                </div>
              )}

              {hazards()?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#B84C3D] uppercase tracking-wide mb-1">Preliminary hazard screening</p>
                  <p className="text-[10px] text-[#8A8474] mb-1">Desk screening only - prompts professional assessment, it is not a hazard assessment.</p>
                  {hazards().map((hz, i) => (
                    <p key={i} className="text-xs text-[#5A5445]">
                      <span className="font-semibold">{hz.hazard}</span> ({hz.likelihood}): {hz.basis} - {hz.design_implication}
                    </p>
                  ))}
                </div>
              )}

              {accessStandards()?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#FF8A3D] uppercase tracking-wide mb-1">Accessibility standards applied</p>
                  {accessStandards().map((a, i) => (
                    <p key={i} className="text-xs text-[#5A5445]"><span className="font-semibold">{a.requirement}:</span> {a.value} <span className="text-[10px]">({a.source})</span></p>
                  ))}
                </div>
              )}

              {insight.constraints?.length > 0 && (<div className="border-t border-[#F0EBDF] pt-2"><p className="text-xs font-semibold text-[#FF8A3D] uppercase tracking-wide mb-1">Constraints to carry into Concept Generator</p>{insight.constraints.map((f, i) => (<p key={i} className="text-xs text-[#5A5445]">- {f}</p>))}</div>)}
            </div>
          )}
          {!insight && !insightLoading && !insightError && <p className="text-sm text-[#8A8474]">Analyze site context above (Step 1), fill in zones/paths, then generate a synthesis.</p>}
        </div>

        {overallConclusion() && (<div className="rounded-lg border-2 p-4" style={{ borderColor: "#FF8A3D", backgroundColor: "rgba(255,255,255,0.03)" }}><h2 className="font-bold text-sm uppercase tracking-wide text-[#FF8A3D] mb-2">Conclusion</h2><p className="text-sm text-[#E8EFF7] leading-relaxed font-medium">{overallConclusion()}</p></div>)}

        <ReportPreview

          reportText={buildStructuredReport({ ...structuredOpts(), docRef: "preview" })}

          chartsHtml={structuredOpts().chartsHtml}

          includeOverflow={includeOverflow}

          setIncludeOverflow={setIncludeOverflow}

          sourceNote={groundingNote}

          sourceCount={webSources.length}

        />


        <div className="bg-[#FFFFFF] rounded-lg border-2 border-[#E8E2D5] p-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445] mb-3">Export Report</h2>
          {pdfError && <p className="text-[11px] text-brand-danger mb-2 flex items-center gap-1"><AlertTriangle size={11} /> {pdfError}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={exportExcel} className="text-xs font-medium border border-[#DDD6C9] px-3 py-2 rounded-md flex items-center gap-1 hover:border-[#C9A46A]"><FileSpreadsheet size={13} /> Excel (.xlsx)</button>
            <button onClick={exportWord} className="text-xs font-medium border border-[#DDD6C9] px-3 py-2 rounded-md flex items-center gap-1 hover:border-[#C9A46A]"><FileText size={13} /> Word (.rtf)</button>
            <button onClick={exportPDF} className="text-xs font-medium border border-[#DDD6C9] px-3 py-2 rounded-md flex items-center gap-1 hover:border-[#C9A46A]"><Printer size={13} /> PDF (print)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
