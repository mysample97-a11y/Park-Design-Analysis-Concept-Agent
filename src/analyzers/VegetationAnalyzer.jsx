import { useState, useEffect, useRef } from "react";
import { Sparkles, Leaf, Info, Mountain, AlertTriangle, ImageIcon, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import SectionSelector from "../components/SectionSelector";
import ReportPreview from "../components/ReportPreview";
import { callAI } from "../utils/ai";
import {
  buildChunkedPrompt, emptyState, mergeChunk, isComplete,
  progressLabel, savePartial, loadPartial, clearPartial,
} from "../utils/chunkedGeneration";
import { getUsage, recordUsage, resetUsage, estimateRun, countTokensExact, getLimits } from "../utils/tokenMeter";
import { setActiveTool, setActiveEstimate, setActivePartial, clearActiveTool, setActiveBusy, registerToolState, unregisterToolState, takePendingState } from "../utils/toolBridge";
import { checklistPrompt } from "../utils/methodology";
import { friendlyError, extractJSON, fileToBase64 , fileToBase64Raw, fileToImagePart } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, tableHTML, missingFields, missingFieldsNote } from "../utils/reportTemplate";
import * as XLSX from "xlsx";

const MAX_IMAGES = 5;


export default function VegetationAnalyzer() {
  const { provider, apiKey, meta, grounding } = useAppContext();
  const [location, setLocation] = useState("");
  // Live handle on the current render's closures for the rails bridge.
  const bridgeRef = useRef({});
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
    abortRef.current = null;
    setBusy(false);
  }
  /*
   * Clears the in-flight flag when a request finishes, however it finishes.
   *
   * It used to be cleared ONLY by cancelRequest(), so after a successful run
   * `busy` stayed true forever: the Cancel button never disappeared and the rail
   * reported a request permanently in flight.
   *
   * The controller identity is checked so a slow earlier request cannot clear
   * the flag belonging to a newer one that is still running.
   */
  function endBusy(ctrl) {
    if (ctrl && abortRef.current && ctrl !== abortRef.current) return;
    abortRef.current = null;
    setBusy(false);
  }
  useEffect(() => () => { if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } } }, []);

  const [tokenUsage, setTokenUsage] = useState(() => getUsage("VEG"));
  const noteUsage = (u) => setTokenUsage(recordUsage("VEG", u));
  /*
    CHUNKED INSIGHT (F13b). Not about generating LESS - about not losing
    everything when the budget runs out mid-reply. The model returns only
    sections it can COMPLETE and declares what remains; whatever arrives is
    merged and kept, and the next call continues from there - on a different
    API key if needed. maxTokens is untouched, so depth per section is unchanged.
  */
  const INSIGHT_TOPICS = [
    { key: "terrain_soil_note", label: "Terrain soil note" },
    { key: "inventory_guidance", label: "Inventory guidance" },
    { key: "suggested_species", label: "Suggested species" },
    { key: "existing_value", label: "Existing value" },
    { key: "existing_vegetation", label: "Existing vegetation" },
    { key: "conclusion", label: "Conclusion" },
  ];
  const [chunkState, setChunkState] = useState(() => loadPartial("VEG", INSIGHT_TOPICS) || emptyState(INSIGHT_TOPICS));
  const chunkProgress = progressLabel(chunkState, INSIGHT_TOPICS);
  const insightComplete = isComplete(chunkState, INSIGHT_TOPICS);
  // Which sections the next run should produce. Defaults to everything not yet
  // generated; the user narrows it to keep each request small on a free key.
  const [selectedTopics, setSelectedTopics] = useState(() => INSIGHT_TOPICS.map((t) => t.key));
  const outstandingKeys = INSIGHT_TOPICS.filter((t) => !chunkState.done.includes(t.key)).map((t) => t.key);
  const activeSelection = selectedTopics.filter((k) => outstandingKeys.includes(k));
  // Exact token count on demand. On a button, not automatic: the counting call
  // still costs one REQUEST, and requests are the scarce resource on a free key.
  const [exactEstimate, setExactEstimate] = useState(null);
  const [counting, setCounting] = useState(false);
  async function calculateTokens() {
    setCounting(true);
    try {
      // Estimate from the tool's ACTUAL inputs, not from chunkState.sections -
      // that is empty before a run, so the figure was a constant (~1 in, 1.4k out)
      // regardless of what the user had typed.
      const o = (() => { try { return structuredOpts(); } catch { return {}; } })();
      const preview = JSON.stringify({
        inputs: o.inputs || [],
        findings: o.findings || [],
        already: chunkState.sections || {},
      }).slice(0, 60000);
      const exact = await countTokensExact({ provider, apiKey, model: undefined,
        systemText: "analysis system instruction and methodology checklist", userText: preview });
      setExactEstimate(exact && exact.exact
        ? { input: exact.input, output: Math.ceil(2000 * 0.7), total: exact.input + Math.ceil(2000 * 0.7), calls: 1, exact: true }
        : { ...estimateRun({ userText: preview, maxTokens: 2000, calls: 1 }), exact: false });
    } catch { setExactEstimate(null); } finally { endBusy(); setCounting(false); }
  }

  // Publish this tool's estimator and reset to the rails. Registered on mount
  // and refreshed whenever the estimate changes, so the Budget rail can offer
  // "Calculate tokens" and show the result for the tool actually on screen.
  // Session save/load. The snapshot is this tool's USER INPUT - not derived
  // values, not loading flags - so a restored session looks like the moment
  // it was saved. Registered on mount; pending state from a session loaded
  // before this tool was opened is collected here too.
  useEffect(() => {
    registerToolState("VEG", {
      snapshot: () => (bridgeRef.current.getState ? { ...bridgeRef.current.getState() } : {}),
      restore: (s) => {
        if (!s || typeof s !== "object") return;
      if (s.location !== undefined) setLocation(s.location);
      if (s.PLANT_PALETTE !== undefined) setPalette(s.PLANT_PALETTE);
      if (s.researching !== undefined) setResearching(s.researching);
      if (s.researchNote !== undefined) setResearchNote(s.researchNote);
      if (s.terrainNote !== undefined) setTerrainNote(s.terrainNote);
      if (s.photoNotes !== undefined) setPhotoNotes(s.photoNotes);
      if (s.waterFilter !== undefined) setWaterFilter(s.waterFilter);
      if (s.siteContext !== undefined) setSiteContext(s.siteContext);
      if (s.structuring !== undefined) setStructuring(s.structuring);
      if (s.inventory !== undefined) setInventory(s.inventory);
      if (s.insight !== undefined) setInsight(s.insight);
      if (s.overflowText !== undefined) setOverflowText(s.overflowText);
      if (s.webSources !== undefined) setWebSources(s.webSources);
      if (s.groundingNote !== undefined) setGroundingNote(s.groundingNote);
      if (s.includeOverflow !== undefined) setIncludeOverflow(s.includeOverflow);
      },
    });
    const waiting = takePendingState("VEG");
    if (waiting) {
      if (waiting.location !== undefined) setLocation(waiting.location);
      if (waiting.PLANT_PALETTE !== undefined) setPalette(waiting.PLANT_PALETTE);
      if (waiting.researching !== undefined) setResearching(waiting.researching);
      if (waiting.researchNote !== undefined) setResearchNote(waiting.researchNote);
      if (waiting.terrainNote !== undefined) setTerrainNote(waiting.terrainNote);
      if (waiting.photoNotes !== undefined) setPhotoNotes(waiting.photoNotes);
      if (waiting.waterFilter !== undefined) setWaterFilter(waiting.waterFilter);
      if (waiting.siteContext !== undefined) setSiteContext(waiting.siteContext);
      if (waiting.structuring !== undefined) setStructuring(waiting.structuring);
      if (waiting.inventory !== undefined) setInventory(waiting.inventory);
      if (waiting.insight !== undefined) setInsight(waiting.insight);
      if (waiting.overflowText !== undefined) setOverflowText(waiting.overflowText);
      if (waiting.webSources !== undefined) setWebSources(waiting.webSources);
      if (waiting.groundingNote !== undefined) setGroundingNote(waiting.groundingNote);
      if (waiting.includeOverflow !== undefined) setIncludeOverflow(waiting.includeOverflow);
    }
    return () => unregisterToolState("VEG");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setActiveTool("VEG", {
      calculate: () => bridgeRef.current.calculate && bridgeRef.current.calculate(),
      cancel: () => bridgeRef.current.cancel && bridgeRef.current.cancel(),
    resetUsage: () => setTokenUsage(resetUsage("VEG")),
      estimate: exactEstimate,
    });
    return () => clearActiveTool("VEG");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setActiveEstimate("VEG", exactEstimate); }, [exactEstimate]);
  useEffect(() => { setActiveBusy("VEG", busy); }, [busy]);
  // Publish progress so the Budget/Usage rail can show an unfinished report -
  // the rail is where a user is looking while a long run is in flight.
  useEffect(() => {
    setActivePartial("VEG", chunkProgress.complete ? null : {
      done: chunkProgress.doneLabels, remaining: chunkProgress.remainingLabels,
    });
  }, [chunkProgress.doneCount, chunkProgress.complete]);
  // PDF export opens a new tab; browsers block that silently. This surfaces it -
  // the previous code called a setError() never declared in this file, so the typeof
  // guard swallowed the message and the click appeared to do nothing at all.
  const [pdfError, setPdfError] = useState("");
  const [PLANT_PALETTE, setPalette] = useState([]);
  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState("");
  const [researchError, setResearchError] = useState("");
  const [terrainNote, setTerrainNote] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");

  async function researchPalette() {
    if (!location.trim()) { setResearchError("Enter a project location first."); return; }
    setResearching(true); setResearchError("");
    try {
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 3000, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content: `For the location "${location}", give a reference planting palette of 10-14 species suitable for public landscape there, prioritising native and climate-adapted species. Respond with ONLY a JSON array, no markdown fences: [{"id":"short_id","name":"Common name (Botanical name)","type":"Canopy Tree|Palm|Shrub|Groundcover|Accent","water":"Low|Medium|High","shade":"Full Sun|Part Shade|Shade","origin":"Native|Adaptive|Introduced - note"}]. Use real species that genuinely grow in that climate. Do not invent species.`,
      });
      let parsed = extractJSON(text);
      if (!parsed) throw new Error("The reply could not be read as structured data, even after recovery. "
        + "This is usually a truncated response - shorten the input or run it again.");
      if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
        const arr = Object.values(parsed).find((v) => Array.isArray(v) && v.length);
        if (arr) parsed = arr;
      }
      if (!Array.isArray(parsed) || !parsed.length) {
        throw new Error("The AI did not return a planting palette for this location. Try a more specific location, or retry.");
      }
      setPalette(parsed);
      setResearchNote(`Palette researched for: ${location}`);
    } catch (e) {
      setResearchError(e.message || "Could not research this location. The default palette remains in use.");
    } finally { endBusy(); setResearching(false); }
  }


  const [waterFilter, setWaterFilter] = useState("all");
  const [siteContext, setSiteContext] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState("");
  const [inventory, setInventory] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");
  // Partial success is NOT failure. A dropped tail field means some sections
  // will be thin - the rest of the report is valid and must not be presented
  // as a failed run.
  const [insightWarning, setInsightWarning] = useState("");

  const filteredPalette = PLANT_PALETTE.filter((p) => waterFilter === "all" || p.water === waterFilter);

  async function structureNotes() {
    if (!siteContext.trim()) return;
    setStructuring(true); setStructureError("");
    try {
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 1000,
        content: "Extract a structured inventory of EXISTING vegetation from these landscape architect site-visit notes/photo descriptions - only plants that are CURRENTLY on site right now, not suggestions for the future. For each distinct plant/tree mentioned, output: name, estimated_count (number or 'several'/'unclear'), condition (Healthy/Fair/Poor/Unclear), recommendation (Retain/Remove/Relocate/Assess further), notes (brief). If no existing vegetation is described (e.g. the text is only a general site description with no plants mentioned), return an empty array. Respond with ONLY a valid JSON array, no markdown, no prose.\n\nNOTES:\n" + (siteContext + (photoNotes ? "\n\nPHOTO OBSERVATIONS (AI-generated from uploaded site photos):\n" + photoNotes : "")),
      });
      const start = text.indexOf("["); const end = text.lastIndexOf("]");
      if (start === -1 || end === -1) throw new Error("Could not find a JSON list in the AI's response.");
      setInventory(JSON.parse(text.slice(start, end + 1)));
    } catch (e) {
      setStructureError(e.message || "Could not structure the notes. Try again.");
    } finally { endBusy(); setStructuring(false); }
  }

  async function handleImageUpload(e) {
    const files = Array.from(e.target.files || []).slice(0, MAX_IMAGES);
    if (files.length === 0) return;
    if (e.target.files.length > MAX_IMAGES) {
      setImageError(`Only the first ${MAX_IMAGES} images were used (limit is ${MAX_IMAGES} per upload, to keep this usable on a free Claude account).`);
    } else {
      setImageError("");
    }
    setImageLoading(true);
    try {
      const contentBlocks = [];
      for (const file of files) {
        // media_type MUST come from the encoder: fileToImagePart re-encodes to
        // JPEG, so labelling the block with the ORIGINAL file.type sends JPEG
        // bytes tagged image/png and the provider rejects them silently.
        const part = await fileToImagePart(file);
        if (!part || !part.base64) throw new Error(`"${file.name}" could not be read as an image.`);
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: part.mediaType, data: part.base64 } });
      }
      contentBlocks.push({ type: "text", text: "These are site-visit photos from a park redesign project. Describe what vegetation/trees/plants are visible across all photos - species if identifiable, apparent condition, approximate count per photo. Write this as plain field notes (a few sentences per photo), the way a landscape architect would jot down observations. Do not describe anything other than vegetation." });
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 3000,
        content: contentBlocks,
      });
      if (!text) throw new Error("empty description");
      setPhotoNotes((prev) => (prev ? prev + "\n\n" : "") + text);
    } catch (err) {
      setImageError((imageError ? imageError + " " : "") + friendlyError(err.message) + " (Technical: " + err.message + ")");
    } finally {
      endBusy();
      setImageLoading(false);
      e.target.value = "";
    }
  }

  // Generate = start over. Continue = add the sections still missing.

  // One button doing both meant there was no way to restart cleanly.

  function startFreshInsight() {

    clearPartial("VEG");

    setChunkState(emptyState(INSIGHT_TOPICS));

    generateInsight();

  }

  function continueInsight() { generateInsight(); }


  async function generateInsight() {
    setInsightLoading(true); setInsightWarning(""); setInsight(null); setInsightError("");
    const summary = {
      site: location || meta?.siteDescription || meta?.projectName || "(location not stated)",
      terrain_reference: terrainNote || "No survey-grade terrain data supplied. Terrain characteristics should be confirmed against site survey before reliance.",
      soil_reference: "No public dataset available for this site - unverified assumption until geotechnical data is sourced.",
      user_provided_site_context: siteContext + (photoNotes ? "\n\nPHOTO OBSERVATIONS:\n" + photoNotes : "") || "None provided.",
      existing_vegetation_inventory: inventory || "Not structured yet.",
      general_reference_palette: PLANT_PALETTE.map((p) => ({ name: p.name, water: p.water, shade: p.shade, origin: p.origin })),
    };
    try {
      const chunkInstruction = buildChunkedPrompt({
        topics: INSIGHT_TOPICS,
        done: chunkState.done,
        continuationSummary: chunkState.continuationSummary,
        // Narrows the OUTPUT only. Every input and all prior section text still go.
        requested: activeSelection,
        sections: chunkState.sections,
      });
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 1500,
        content: "You are a landscape architecture assistant giving planting and site-condition guidance for a park design at the stated location. The 'general_reference_palette' is a reference list of species appropriate to that region - it is NOT specific to this site yet; your job is to reason about which of these actually fit THIS site given the terrain/soil reference and any user-provided site context or existing inventory. Do not invent species outside the reference list, and do not invent terrain/soil facts beyond what's given. Provide: " +
          "(1) 'terrain_soil_note': 1-2 sentences on what the terrain/soil data means for planting choices and what to verify once real data arrives, " +
          "(2) 'inventory_guidance': 1-2 sentences on how any existing inventory should inform retain/remove decisions (or note if none was provided), " +
          "(3) 'suggested_species': an array of 3-5 objects {name, reason} - species FROM THE REFERENCE PALETTE ONLY, each with a one-line reason tied to this site's actual conditions, " +
          "(4) 'conclusion': 2-3 sentences giving the single clearest planting/terrain/soil action to take next. " +
          "Also return 'existing_value': a short paragraph on the ecological and amenity value of the existing planting and what is lost if it is cleared. Also return 'existing_vegetation': an array of {species, approx_count, condition, position, verdict (retain/relocate/remove), reason} assessing the existing planting inventory supplied - return an empty array if no inventory was given. Respond with ONLY valid JSON, no markdown fences: {\"terrain_soil_note\": \"\", \"inventory_guidance\": \"\", \"suggested_species\": [{\"name\": \"\", \"reason\": \"\"}], \"existing_value\": \"\", \"existing_vegetation\": [{\"species\": \"\", \"approx_count\": \"\", \"condition\": \"\", \"position\": \"\", \"verdict\": \"\", \"reason\": \"\"}], \"conclusion\": \"\"}" + checklistPrompt("VEG") + "\n\nDATA:\n" + JSON.stringify(summary, null, 2) + chunkInstruction,
      });
      // extractJSON returns NULL on an unrecoverable reply - it does not throw.
      // Passing that null into state leaves the section silently empty.
      const parsedInsight = extractJSON(text);
      if (!parsedInsight) throw new Error("The reply could not be read as structured data, even after recovery. "
        + "This is usually a truncated response - shorten the input or run it again.");
      // Merge into accumulated state - never overwrites longer content with

      // shorter, ignores invented keys, rejects a false completion claim.

     
        // Tells the model what is already written (so it is not repeated) and what
        // still needs writing. On a first run `done` is empty and this behaves
        // exactly like a normal single-pass call.
 const _merged = mergeChunk(chunkState, { sections: parsedInsight.sections || parsedInsight,

        completed: parsedInsight.completed, remaining: parsedInsight.remaining,

        continuation_summary: parsedInsight.continuation_summary }, INSIGHT_TOPICS);

      setChunkState(_merged); savePartial("VEG", _merged);

      setInsight({ ...parsedInsight, ..._merged.sections });
      // Field-completeness guard. When the output budget runs short the model
      // drops the TAIL fields of a schema; the report then prints
      // "(not generated)" into those sections with nothing on screen to say
      // why. Keys are taken from THIS tool's own prompt so the check cannot
      // drift away from the contract it is checking.
      // Judge against the MERGED state, not this one reply. With section
      // selection a reply contains only the keys that were requested, so
      // checking the reply alone flagged every other section as missing -
      // including ones already generated and saved.
      const _requestedNow = (activeSelection && activeSelection.length)
        ? activeSelection
        : INSIGHT_TOPICS.map((t) => t.key);
      const gaps = _requestedNow.filter((k) => {
        const v = _merged.sections[k];
        if (v == null) return true;
        if (typeof v === "string") return !v.trim();
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === "object") return Object.keys(v).length === 0;
        return false;
      });
      setInsightWarning(gaps.length ? missingFieldsNote(gaps) : "");
    } catch (e) {
      setInsightError(e.message || "Something went wrong generating the insight. Try again.");
    } finally {
      endBusy();
      setInsightLoading(false);
    }
  }

  function buildReportText() {
    let lines = ["VEGETATION, TERRAIN & SOIL ANALYSIS", `Location: ${location || meta?.siteDescription || "(not stated)"}`, "", "TERRAIN: " + (terrainNote || "No survey data supplied - confirm against site survey."), "SOIL: No dataset supplied - unverified until geotechnical data is sourced.", "", "GENERAL REFERENCE PALETTE (regional, not yet site-specific)"];
    PLANT_PALETTE.forEach((p) => lines.push(`  ${p.name} - ${p.type}, water: ${p.water}, shade: ${p.shade}, origin: ${p.origin}`));
    if (inventory && inventory.length) { lines.push("", "EXISTING VEGETATION INVENTORY"); inventory.forEach((v) => lines.push(`  ${v.name} - count: ${v.estimated_count}, condition: ${v.condition} -> ${v.recommendation}. ${v.notes}`)); }
    if (insight) {
      lines.push("", "TERRAIN/SOIL NOTE", insight.terrain_soil_note || "");
      lines.push("", "INVENTORY GUIDANCE", insight.inventory_guidance || "");
      lines.push("", "SITE-SPECIFIC SUGGESTED SPECIES");
      (insight.suggested_species || []).forEach((s) => lines.push(`  ${s.name}: ${s.reason}`));
      lines.push("", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  const [webSources, setWebSources] = useState([]);
  const [groundingNote, setGroundingNote] = useState("");

  /*
    Assigned in an effect with NO dependency array: it runs after EVERY render,
    and effects run after the component body completes. Assigning during render
    instead threw "Cannot access X before initialization" for whichever state
    happened to be declared below it.
  */
  useEffect(() => {
        bridgeRef.current = {
      // Lazy: evaluated when the bridge calls it, not during render, so it can
      // safely reference state declared further down the component body.
      getState: () => ({ location, PLANT_PALETTE, researching, researchNote, terrainNote, photoNotes, waterFilter, siteContext, structuring, inventory, insight, overflowText, webSources, groundingNote, includeOverflow }),
      calculate: calculateTokens,
      cancel: typeof cancelRequest === "function" ? cancelRequest : null,
    };
  });
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "VEG",
      meta,
      inputRecord: [{label:"Location",value:(typeof location!=="undefined"&&location)||"(not stated)"}],
      findings: [
        ...(insight?.existing_vegetation?.length ? [{
          title: "Existing vegetation on site",
          note: "Identification from description or photographs is indicative and requires confirmation by a qualified arborist.",
          headers: ["Species", "Approx. count", "Condition", "Position", "Verdict", "Reason"],
          rows: insight.existing_vegetation.map((e) => [e.species, e.approx_count, e.condition, e.position, e.verdict, e.reason]),
        }] : []),
        ...(insight?.existing_value ? [{
          title: "Value of existing planting",
          text: insight.existing_value,
        }] : []),{ title: "Analysis output", text: buildReportText() }],
      chartNote: "Reference planting palette is reproduced in the PDF export.",
      chartsHtml: (PLANT_PALETTE.length ? tableHTML(["Species", "Type", "Water", "Shade", "Origin"],
          PLANT_PALETTE.map((p) => [p.name, p.type, p.water, p.shade, p.origin]), "Reference planting palette") : ""),
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.suggested_species || []).map((r) => typeof r === "string" ? r : `${r.name || r.species || ""}: ${r.reason || ""}`),
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
      const o = await generateOverflow({ provider, apiKey, toolCode: "VEG",
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
      <ToolIntro toolCode="VEG" />

      <div className="card">
        <div className="card-header">Project Location - Planting Palette</div>
        <div className="p-4 space-y-2">
          <input value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Riverside Park, Chicago, USA"
            className="input" />
          <button onClick={researchPalette} disabled={researching || !apiKey} className="btn-gold w-full">
            {researching ? "Researching..." : "Research Planting Palette for This Location"}
          </button>
          <p className="text-[10px] text-brand-text/60">
            Required. Planting is entirely climate- and region-specific, so the tool researches a palette for your location rather than assuming one. Nothing is suggested until this is done.
          </p>
          {researchNote && <p className="text-xs text-brand-success">{researchNote}</p>}
          {researchError && <p className="text-xs text-brand-danger">{friendlyError(researchError)}</p>}
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <div>Step 1 — Give This Tool Site Context</div>
          <div className="text-[10px] text-brand-text/60 font-normal normal-case tracking-normal mt-0.5">Type field notes, paste a description, or upload site-visit photos directly - up to {MAX_IMAGES} at once.</div>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            value={siteContext}
            onChange={(e) => setSiteContext(e.target.value)}
            placeholder="e.g. Several mature shade trees along the west boundary, appear healthy. Large specimen tree near the central plaza, good condition. Site is exposed to full sun most of the day, no existing shade structures..."
            rows={6}
            className="textarea"
          />
          <label className="text-sm font-semibold border-2 px-4 py-2.5 rounded-md flex items-center gap-2 cursor-pointer w-fit" style={{ borderColor: "#4DA3FF", color: "#EAF3FF", backgroundColor: "#131C29", opacity: imageLoading ? 0.4 : 1, pointerEvents: imageLoading ? "none" : "auto" }}>
            <ImageIcon size={15} /> {imageLoading ? "Reading photos..." : `Upload Site Photos (up to ${MAX_IMAGES})`}
            <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="sr-only" />
          </label>
          <p className="text-[10px] text-brand-text/60">Photo upload may not work inside the Claude mobile app (a platform restriction). Try your phone's regular browser instead, or type/paste notes above.</p>
          {imageError && <p className="text-xs text-brand-danger flex items-center gap-1"><AlertTriangle size={12} /> {imageError}</p>}

          <div className="pt-2 border-t border-[#F0EBDF]">
            <button onClick={structureNotes} disabled={!siteContext.trim() || structuring || !apiKey} className="btn-gold text-sm px-4 py-2.5">
              <Sparkles size={15} /> {structuring ? "Structuring..." : "Structure Existing Vegetation (optional)"}
            </button>
            <p className="text-[10px] text-brand-text/60 mt-1">Only needed if your notes describe plants already on site and you want a clean retain/remove table. Skip this if you're only giving general site context - the "Generate AI Insight" button below will still use your notes either way.</p>
          </div>
          {structureError && <p className="text-xs text-brand-danger flex items-center gap-1"><AlertTriangle size={12} /> {structureError}</p>}
          {inventory && inventory.length > 0 && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-brand-text/60 border-b border-brand-border"><th className="py-2 pr-3">Species</th><th className="py-2 pr-3">Count</th><th className="py-2 pr-3">Condition</th><th className="py-2 pr-3">Recommendation</th><th className="py-2">Notes</th></tr></thead>
                <tbody>{inventory.map((v, i) => (<tr key={i} className="border-b border-[#F0EBDF]"><td className="py-2 pr-3 font-medium">{v.name}</td><td className="py-2 pr-3">{v.estimated_count}</td><td className="py-2 pr-3">{v.condition}</td><td className="py-2 pr-3 font-medium">{v.recommendation}</td><td className="py-2 text-brand-text/60">{v.notes}</td></tr>))}</tbody>
              </table>
            </div>
          )}
          {inventory && inventory.length === 0 && <p className="text-xs text-brand-text/60">No existing vegetation was described in your notes - that's fine if this is general site context rather than a plant inventory.</p>}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-brand-border p-4 flex gap-3">
        <Mountain size={18} className="text-[#FF8A3D] shrink-0 mt-0.5" />
        <div className="text-sm text-brand-text">
          <p><span className="font-semibold">Terrain:</span> {terrainNote || "No survey data supplied - terrain characteristics must be confirmed against a site survey before reliance."}</p>
          <p className="mt-1"><span className="font-semibold">Soil:</span> No public dataset found - unverified assumption until geotechnical data is sourced.</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-brand-border overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">General Reference Palette</h2>
            <p className="text-[10px] text-brand-text/60 mt-0.5">Researched for your location, NOT yet matched to this specific site - that matching happens in the AI Insight below.</p>
          </div>
          <select value={waterFilter} onChange={(e) => setWaterFilter(e.target.value)} className="text-xs bg-[#F7F5F1] border border-brand-border rounded px-2 py-1"><option value="all">All water needs</option><option value="Low">Low water only</option><option value="Medium">Medium water</option><option value="High">High water (flagged)</option></select>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-brand-text/60 text-xs uppercase tracking-wide border-b border-brand-border"><th className="px-4 py-2">Species</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Water</th><th className="px-4 py-2">Shade</th><th className="px-4 py-2">Origin</th></tr></thead><tbody>{filteredPalette.map((p) => (<tr key={p.id} className="border-b border-[#F0EBDF]"><td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2 text-xs">{p.type}</td><td className="px-4 py-2 text-xs font-mono">{p.water}</td><td className="px-4 py-2 text-xs">{p.shade}</td><td className="px-4 py-2 text-xs">{p.origin}</td></tr>))}</tbody></table></div>
      </div>

      <div className="card border-2">
        <div className="p-4">
          <div className="flex items-center mb-2 flex-wrap gap-4">
            <div>
              <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">Step 2 — AI Insight & Recommendation</h2>
              <p className="text-[10px] text-brand-text/60">Uses your site context + terrain/soil data + reference palette to suggest what actually fits this site.</p>
            </div>
            <SectionSelector
              topics={INSIGHT_TOPICS}
              selected={selectedTopics}
              onChange={setSelectedTopics}
              doneKeys={chunkState.done}
              disabled={busy}
              freeTier={(getLimits(provider) || {}).tier !== "paid"}
            />
            <button onClick={startFreshInsight} disabled={insightLoading || !apiKey} className="btn-dark">
              {chunkState.done.length === 0 ? "Generate AI Insight" : "Start over (regenerate all)"}
            </button>
            {busy && (
              <button type="button" onClick={cancelRequest} className="btn-gold ml-2">
                Cancel
              </button>
            )}
            {busy && (
              <button type="button" data-plain onClick={cancelRequest}
                className="as2p-inline-cancel ml-2 text-xs px-3 py-2 rounded-md"
                title="Stop the request now. Anything already generated is kept.">
                Cancel request
              </button>
            )}
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
                <div className="text-brand-muted mt-1">Nothing already generated is lost. You may switch API key first.</div>
              </div>
            )}
            {chunkState.done.length > 0 && (
              <button type="button" className="mt-2 text-xs underline text-brand-muted"
                onClick={() => { clearPartial("VEG"); setChunkState(emptyState(INSIGHT_TOPICS)); }}>
                Discard partial insight and start over
              </button>
            )}
          </div>
          {insightLoading && <p className="text-sm text-brand-text/60">Reviewing site context, inventory, and reference palette...</p>}
          {insightWarning && !insightError && (
            <div className="mt-2 text-xs bg-[#FBF3E4] border border-[#E4D2A8] text-[#7A5B18] rounded p-2">
              <strong>Partly generated.</strong> {insightWarning}
            </div>
          )}
          {insightError && (<div className="space-y-1"><p className="text-sm text-[#E8EFF7] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(insightError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {insightError}</p></div>)}
          {insight && (
            <div className="space-y-3 text-sm text-[#E8EFF7]">
              {insight.terrain_soil_note && <p><span className="font-semibold">Terrain/Soil:</span> {insight.terrain_soil_note}</p>}
              {insight.inventory_guidance && <p><span className="font-semibold">Existing Vegetation:</span> {insight.inventory_guidance}</p>}
              {insight.suggested_species?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="font-semibold text-[#FF8A3D] uppercase text-xs tracking-wide mb-1">Site-Specific Suggested Species</p>
                  {insight.suggested_species.map((s, i) => (<p key={i} className="text-xs">- <span className="font-semibold">{s.name}</span>: {s.reason}</p>))}
                </div>
              )}
            </div>
          )}
          {!insight && !insightLoading && !insightError && <p className="text-sm text-brand-text/60">Give this tool site context above (Step 1), then generate a site-reasoned planting recommendation.</p>}
        </div>
      </div>

      {insight?.conclusion && (
        <div className="rounded-lg border-2 p-4" style={{ borderColor: "#FF8A3D", backgroundColor: "rgba(255,255,255,0.03)" }}>
          <h2 className="font-bold text-sm uppercase tracking-wide text-[#FF8A3D] mb-2">Conclusion</h2>
          <p className="text-sm text-[#E8EFF7] leading-relaxed font-medium">{insight.conclusion}</p>
        </div>
      )}

      <div className="card">
        <ReportPreview
          reportText={buildStructuredReport({ ...structuredOpts(), docRef: "preview" })}
          chartsHtml={structuredOpts().chartsHtml}
          includeOverflow={includeOverflow}
          setIncludeOverflow={setIncludeOverflow}
          sourceNote={groundingNote}
          sourceCount={webSources.length}
        />

        <div className="p-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h2>
          {pdfError && <p className="text-[11px] text-brand-danger mb-2 flex items-center gap-1"><AlertTriangle size={11} /> {pdfError}</p>}
              <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
        </div>
      </div>
    </div>
  );
}
