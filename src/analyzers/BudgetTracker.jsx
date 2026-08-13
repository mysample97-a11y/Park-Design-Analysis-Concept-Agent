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
        content:
          "Extract EVERY built facility or zone from this park programme. Do not summarise, do not merge similar " +
          "items, and do not stop early - if the text lists ten zones, return ten. Every entry MUST have a numeric " +
          "area in square metres: if a facility has no stated area but its zone does, apportion the zone area across " +
          "its facilities; if only zone areas exist, return one entry per zone. " +
          'For each output {name, area (number, m2), category, concept (the name of the concept it belongs to, or "" if the text describes only one)}. ' +
          "Respond with ONLY a valid JSON array, no markdown fences.\n\n" +
          (detectedConcepts.length > 1
            ? "NOTE: this text contains " + detectedConcepts.length + " concepts (" +
              detectedConcepts.map((c) => c.label).join(", ") + "). Return the facilities of ALL of them, " +
              "each tagged with its concept, so the full programme is visible.\n\n"
            : "") +
          "DESCRIPTION:\n" + pasteText,
      });
      const parsed = extractJSON(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a list of facilities.");
      const rows = parsed.map((f) => ({
        id: uid(), name: f.name || "", area: f.area || "", rate: "",
        category: f.category || "", concept: f.concept || "",
      }));
      setFacilities(rows);
      const noArea = rows.filter((r) => !(Number(r.area) > 0)).length;
      const byConcept = {};
      rows.forEach((r) => { const k = r.concept || "(single concept)"; byConcept[k] = (byConcept[k] || 0) + 1; });
      const breakdown = Object.keys(byConcept).map((k) => `${k}: ${byConcept[k]}`).join(" · ");
      setDetectError(
        `${rows.length} facilities read` + (breakdown ? ` (${breakdown})` : "") +
        (noArea ? `. ${noArea} have no area and will not cost - fill them in or re-run the Concept Generator, which now emits facility areas.` : ". All carry an area.") +
        (Object.keys(byConcept).length > 1
          ? " Costing all concepts together would be meaningless, so use the 'Use <concept> as the facility schedule' buttons below to cost one at a time."
          : ""));
    } catch (e) {
      setDetectError(e.message || "Could not detect facilities. Try again or enter them manually.");
    } finally {
      setDetecting(false);
    }
  }

  // ---- Multi-concept comparison ----
  // How many concepts the pasted text / uploaded report contains. The user declares
  // it once; the tool splits the single input rather than asking for separate boxes.
  // "auto" lets the splitter decide from the document's own concept headings.
  // Total site area, needed to convert a zone percentage into m2. Read from the
  // project's site description (e.g. "15000sq.m") so it needs no extra input,
  // with the competition site area as the fallback.
  const siteAreaM2 = (function () {
    const m = String((meta && meta.siteDescription) || "").match(/([\d,]{3,})\s*(?:sq\.?\s*m|m2|m\u00b2|square\s*met)/i);
    const v = m ? Number(m[1].replace(/,/g, "")) : 0;
    return v > 0 ? v : 15000;
  })();

  const [conceptCount, setConceptCount] = useState("auto");
  const [compareWarning, setCompareWarning] = useState("");

  /**
   * Split one pasted body into N concepts. Reports from the Concept Generator label
   * concepts as "CONCEPT 1: name" or "6.2 CONCEPT 1: ...", so those headings are the
   * split points. Falls back to a single concept when no headings are present.
   */
  function splitConcepts(body) {
    const text = String(body || "").trim();
    if (!text) return [];
    // Concept boundaries appear in TWO forms across this suite's own exports and
    // the previous version only recognised the first:
    //   (a) "6.2 CONCEPT 1: THE SOLAR CANOPY HUB"   - the RTF / section 6 form
    //   (b) "The Solar Canopy Hub - zone schedule"  - the PDF visualisation form
    // A user pasting from the PDF got ONE concept containing all three, so all
    // three were costed in a single call against a single-concept schema. The
    // model returned one name and no numbers - which is exactly how report
    // AS2P-BDG-003-P01 came to recommend Concept 3 while costing Concept 1.
    const marks = [];
    const reNum = /(?:^|\n)\s*(?:\d+\.\d+\s+)?CONCEPT\s+(\d+)\s*[:\-\u2014]/gi;
    let m;
    while ((m = reNum.exec(text)) !== null) marks.push({ index: m.index, label: "Concept " + m[1] });
    if (marks.length < 2) {
      // Form (b): a titled block followed by its own zone schedule.
      marks.length = 0;
      const reName = /(?:^|\n)\s*([A-Z][A-Za-z0-9&'’\- ]{4,60}?)\s*[-\u2013\u2014]\s*zone schedule/gi;
      const seen = {};
      while ((m = reName.exec(text)) !== null) {
        const name = m[1].trim();
        if (seen[name.toLowerCase()]) continue;
        seen[name.toLowerCase()] = true;
        // Anchor on the FIRST appearance of the name, which is the block heading,
        // so the diagram and its schedule stay with the concept they belong to.
        const first = text.toLowerCase().indexOf(name.toLowerCase());
        marks.push({ index: first >= 0 ? first : m.index, label: name });
      }
      marks.sort(function (a, b) { return a.index - b.index; });
    }
    if (marks.length >= 2) {
      return marks.map((mk, i) => ({
        label: mk.label,
        text: text.slice(mk.index, i + 1 < marks.length ? marks[i + 1].index : text.length).trim(),
      }));
    }
    // No concept headings: if the user declared a count, split on the largest
    // structural break available so the tool still honours what they told it.
    const declared = conceptCount === "auto" ? 1 : Number(conceptCount) || 1;
    if (declared > 1) {
      const chunks = text.split(/\n\s*\n\s*\n+|\n\s*---+\s*\n/).filter((c) => c.trim());
      if (chunks.length >= declared) {
        const per = Math.ceil(chunks.length / declared);
        return Array.from({ length: declared }, (_, i) => ({
          label: `Concept ${i + 1}`,
          text: chunks.slice(i * per, (i + 1) * per).join("\n\n").trim(),
        })).filter((c) => c.text);
      }
    }
    return [{ label: "Concept 1", text }];
  }

  const detectedConcepts = splitConcepts(pasteText);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState("");


  /**
   * Pull a facility or zone schedule out of concept text WITHOUT an AI call.
   *
   * The concept reports emit two shapes, and both are machine-readable:
   *   facility lines  "- Entry Plaza Horizontal Overhead Canopy - 600 m2 (Zone)"
   *   zone table rows "Central Microclimate Spine | Center | 25 | 3,750 | ..."
   *                   "Central Microclimate Spine  Center  25  3,750"
   *
   * Asking the model to fall back to zone areas was unreliable - it returned
   * nothing usable and every concept was rejected. Reading them here makes the
   * comparison deterministic: if the areas are in the text, they are found.
   * Returns [] only when the text genuinely contains no areas.
   */
  function extractScheduleFromText(txt, siteArea) {
    const out = [];
    const seen = {};
    const push = (name, area) => {
      const n = String(name || "").replace(/\s+/g, " ").trim();
      const a = Number(area) || 0;
      if (!n || n.length < 3 || a <= 0) return;
      const k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push({ facility: n, area_m2: a });
    };
    const num = (x) => Number(String(x).replace(/[, ]/g, "")) || 0;

    // 1. facility schedule lines: "- Name - 600 m2 (Zone)"
    const reFac = /^[\s\-\u2022]*(.+?)\s+[-\u2013]\s+([\d,]+)\s*m2/gim;
    let m;
    while ((m = reFac.exec(txt)) !== null) push(m[1].replace(/^[\s\-\u2022]+/, ""), num(m[2]));

    // 2. zone rows carrying an explicit m2 column
    const reZoneM2 = /^\s*([A-Za-z][^|\n]{3,60}?)\s*\|\s*(?:N|NE|E|SE|S|SW|W|NW|Center)\s*\|\s*[\d.]+\s*\|\s*([\d,]+)/gim;
    while ((m = reZoneM2.exec(txt)) !== null) push(m[1], num(m[2]));

    // 3. zone rows with a percentage only - convert against the site area
    if (siteArea > 0) {
      const rePct = /^\s*([A-Za-z][^|\n]{3,60}?)\s*\|?\s*(?:N|NE|E|SE|S|SW|W|NW|Center)\s*\|?\s+([\d.]+)\s*%?\s*(?:\||$|\s)/gim;
      while ((m = rePct.exec(txt)) !== null) {
        const pct = Number(m[2]);
        if (pct > 0 && pct <= 100) push(m[1], Math.round((pct / 100) * siteArea));
      }
      // bubble-diagram labels: "30% ~4,500 m2" preceded by the zone name
      const reBubble = /([A-Za-z][A-Za-z0-9&'’,\- ]{3,60}?)\s*(\d{1,3})\s*%\s*~?\s*([\d,]+)\s*m2/gi;
      while ((m = reBubble.exec(txt)) !== null) push(m[1], num(m[3]));
    }
    return out;
  }

  async function compareConcepts() {
    // Sourced from the single paste box, split automatically - no separate boxes.
    const filled = detectedConcepts.map((c, i) => ({ i, t: c.text, label: c.label }));
    if (!filled.length) { setCompareError("Paste or upload the concept information first."); return; }
    setComparing(true); setCompareError(""); setComparison(null);
    try {
      // Cost each concept in its OWN call. One combined call asking for three full
      // cost breakdowns plus the comparison overflowed the response limit - the reply
      // was cut mid-array, so `recommended` never arrived and the report printed
      // "Recommended: undefined" with only the first concept in the table.
      const costed = [];
      const rejected = [];
      for (const x of filled) {
        setCompareError(`Costing concept ${x.i + 1} of ${filled.length}...`);
        const one = await callAI({
          // Web search OFF for the per-concept calls. Rates are researched once,
          // in the main estimate; repeating the search for every concept spent the
          // token budget on search results and left nothing for the reply.
          provider, apiKey, maxTokens: 2000,
          content:
            "You are a cost consultant. Extract every facility from this ONE park concept with its area and an " +
            "indicative construction unit rate for the stated location. Do NOT compute totals - they are calculated " +
            "separately. Return ONLY valid JSON, no markdown fences, with the SUMMARY FIELDS FIRST:\n" +
            '{"name":"the concept name",' +
            '"largest_cost_driver":"the single facility contributing most",' +
            '"confidence":"Verified-Macro|Verified-Adjacent-Scale|Assumption-Flagged",' +
            '"bottlenecks":["cost or delivery risks specific to this concept"],' +
            '"opportunities":["what could be added or improved if budget allows"],' +
            '"facilities":[{"facility":"","area_m2":0,"rate_per_m2":0}]}\n' +
            "Every facility MUST carry a positive area_m2 and rate_per_m2 - a facility without both cannot be costed " +
            "and will be discarded. If the text lists facilities WITHOUT their own areas but DOES give zone areas " +
            "(as a percentage of site area or in m2), apportion each zone's area across the facilities it contains " +
            "and say so. If neither is given, use the zone schedule itself as the facility list, one row per zone, " +
            "with that zone's area. Never return a facility with a zero or missing area. " +
            "Mark any rate you could not source against a published benchmark as Assumption-Flagged.\n\n" +
            `LOCATION: ${location || "(not stated)"}\nCURRENCY: ${currency}\n\n${x.label}:\n${x.t}`,
        });
        const p = extractJSON(one) || {};

        // Compute the NRM1 cascade HERE, deterministically, from the same
        // percentages used in section 6.2 - rather than asking the model for it.
        //
        // The previous version put estimated_capex AFTER the facilities array in
        // the requested schema. A long facilities list truncated the reply before
        // the totals were ever written, so every concept came back with no usable
        // figure. Beyond robustness, this is simply the correct division of work:
        // the cascade is arithmetic, and this report claims it as deterministic.
        // Deterministic fallback FIRST if the model gave nothing usable.
        let modelFacs = (p.facilities || [])
          .map((x2) => ({
            facility: String(x2.facility || "").trim(),
            area_m2: Number(x2.area_m2) || 0,
            rate_per_m2: Number(x2.rate_per_m2) || 0,
          }))
          .filter((x2) => x2.facility && x2.area_m2 > 0 && x2.rate_per_m2 > 0);
        // If the model returned no priced facilities, read the schedule out of the
        // concept text ourselves and apply the median researched rate, flagged.
        let facs = modelFacs;
        let derived = false;
        if (!facs.length) {
          const fromText = extractScheduleFromText(x.t, Number(siteAreaM2) || 15000);
          const known = facilities.map((ff) => Number(ff.rate)).filter((n) => n > 0).sort((a, b) => a - b);
          const fallbackRate = known.length ? known[Math.floor(known.length / 2)]
            : (p.facilities || []).map((ff) => Number(ff.rate_per_m2)).filter((n) => n > 0)[0] || 0;
          if (fromText.length && fallbackRate > 0) {
            facs = fromText.map((ff) => ({ ...ff, rate_per_m2: fallbackRate }));
            derived = true;
          }
        }
        facs.forEach((x2) => { x2.subtotal = x2.area_m2 * x2.rate_per_m2; });

        const construction = facs.reduce((a, x2) => a + x2.subtotal, 0);
        if (construction > 0) {
          // rates.<key> is an OBJECT { pct, base, confidence } - not a number.
          // Reading it as a number gave NaN, and the `|| 0` fallback silently
          // zeroed every wrapper, so CAPEX came out equal to the construction
          // subtotal. Same accessor as the main estimate at section 6.2.
          const pct = (k) => Number(rates[k] && rates[k].pct) || 0;
          const prelim = construction * pct("preliminaries") / 100;
          const ohp = (construction + prelim) * pct("ohp") / 100;
          const cont = (construction + prelim + ohp) * pct("contingency") / 100;
          const infl = (construction + prelim + ohp + cont) * pct("inflation") / 100;
          const capex = construction + prelim + ohp + cont + infl;
          const opex = capex * pct("opex") / 100;
          const cap = Number(budgetCap) || 0;
          const driver = facs.slice().sort((a, b) => b.subtotal - a.subtotal)[0];
          costed.push({
            ...p,
            name: p.name || x.label,
            facilities: facs,
            construction_subtotal: construction,
            preliminaries: prelim, ohp: ohp, contingency: cont, inflation: infl,
            estimated_capex: capex, annual_opex: opex,
            largest_cost_driver: p.largest_cost_driver || (driver ? driver.facility : ""),
            driver_share_pct: driver ? Math.round((driver.subtotal / construction) * 100) : 0,
            within_budget: cap ? capex <= cap : null,
            total_area_m2: facs.reduce((a, x2) => a + x2.area_m2, 0),
            rate_derived: derived,
          });
        } else {
          rejected.push(x.label + " - no facilities or zones with an area could be found in the text for this concept");
        }
      }
      if (!costed.length) throw new Error(
        "None of the concepts could be costed" +
        (rejected.length ? ": " + rejected.join("; ") : "") +
        ". Check the pasted text lists facilities with areas for each concept.");
      if (rejected.length) setCompareWarning(
        "Costed " + costed.length + " of " + filled.length + " detected concepts. Not costed: " +
        rejected.join("; ") + ". The comparison below is incomplete - re-run before using it in a deliverable.");
      else if (costed.length < 2 && filled.length < 2) setCompareWarning(
        "Only one concept was detected in the input, so this is a single-concept estimate rather than a comparison. " +
        "If you intended to compare several, check that each concept's heading is present in the pasted text.");
      else setCompareWarning("");
      setCompareError(`Comparing ${costed.length} costed concepts...`);

      // Second, much smaller call: compare the already-costed concepts.
      const text = await callAI({
        provider, apiKey, maxTokens: 2000,
        content: "You are a cost consultant. These park concepts have ALREADY been costed - do not recost them. Compare them on value for money, not simply lowest cost. Return ONLY valid JSON, no markdown fences: {" +
          "\"recommended\":\"name of the most FEASIBLE concept - deliverable within the budget while retaining the most design value, which is not necessarily the cheapest\"," +
          "\"recommendation_reason\":\"3-4 sentences: why this one is deliverable, what it retains that the others lose, and what the runner-up would have offered\"," +
          "\"feasibility_notes\":[{\"concept\":\"\",\"verdict\":\"Deliverable|Deliverable with reductions|Not deliverable within budget\",\"reason\":\"\"}]," +
          "\"cost_reduction_options\":[{\"concept\":\"\",\"facility\":\"\",\"action\":\"reduce, substitute or combine - and the approximate saving\"}]," +
          "\"hybrid_suggestion\":\"if elements of different concepts could be combined for better value, say how - otherwise empty string\"," +
          "\"decision_note\":\"one sentence stating plainly that this is a cost-based recommendation only and the design decision remains with the human designer\"}. " +
          "Explain WHY the recommended concept is the best value and how it is feasible, not merely that it is cheapest.\n\n" +
          `CURRENCY: ${currency}\nBUDGET CAP: ${budgetCap || "(none stated)"}\n\nCOSTED CONCEPTS:\n` +
          JSON.stringify(costed.map((c) => ({
            name: c.name, estimated_capex: c.estimated_capex, largest_cost_driver: c.largest_cost_driver,
            driver_share_pct: c.driver_share_pct, within_budget: c.within_budget, confidence: c.confidence,
            bottlenecks: c.bottlenecks, opportunities: c.opportunities,
          })), null, 2),
      });
      const parsed = extractJSON(text) || {};
      // The per-concept costings are authoritative and always present, so the
      // comparison never renders empty even if this second call disappoints.
      setComparison({ ...parsed, concepts: costed });
      setCompareError("");
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
      // Match researched rates to facilities. This used to require an EXACT name
      // match, so "Central Smart Solar Plaza" never matched "Smart Solar Plaza" and
      // every rate stayed blank - which is why the whole estimate came out as zero.
      const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const score = (a, b) => {
        const A = new Set(norm(a).split(" ").filter((w) => w.length > 2));
        const B = new Set(norm(b).split(" ").filter((w) => w.length > 2));
        if (!A.size || !B.size) return 0;
        let hit = 0; A.forEach((w) => { if (B.has(w)) hit++; });
        return hit / Math.min(A.size, B.size);
      };
      let matched = 0, unmatched = [];
      setFacilities((prev) => prev.map((f) => {
        if (!f.name.trim()) return f;
        let best = null, bestScore = 0;
        parsed.forEach((r) => { const sc = score(r.name, f.name); if (sc > bestScore) { bestScore = sc; best = r; } });
        // Exact or strong partial match wins outright.
        if (best && bestScore >= 0.5) {
          matched++;
          return { ...f, rate: String(best.rate_per_m2 ?? f.rate), rateBasis: best.basis || "", rateConfidence: best.confidence || "Assumption-Flagged" };
        }
        // No match: fall back to the median researched rate rather than leaving zero,
        // and flag it clearly so the user knows it is a stand-in.
        const nums = parsed.map((r) => Number(r.rate_per_m2)).filter((n) => n > 0).sort((a, b) => a - b);
        if (nums.length) {
          unmatched.push(f.name);
          const median = nums[Math.floor(nums.length / 2)];
          return { ...f, rate: String(median), rateBasis: "median of researched rates (no direct match)", rateConfidence: "Assumption-Flagged" };
        }
        return f;
      }));
      if (unmatched.length) setResearchError(
        `No researched rate matched: ${unmatched.join(", ")}. The median rate was applied and flagged as Assumption-Flagged - review these before relying on the total.`);
      setResearchNote(`Rates researched for ${location} in ${currency}. Every rate carries a confidence band - verify Assumption-Flagged items before relying on the total.`);
    } catch (e) {
      setResearchError(e.message || "Could not research rates.");
    } finally { setResearching(false); }
  }


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

  async function handleFacilityFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setDetectError("");
    try {
      // Shared reader. The old code read only the FIRST sheet of a workbook - but the
      // reports this suite exports carry eleven sheets, so the facility schedule was
      // silently missed. It also could not read PDF at all.
      setDetectError("Reading " + file.name + "...");
      const res = await readExportFile(file,
        (p, total) => setDetectError(`Reading page ${p} of ${total} of ${file.name}...`),
        readScannedPages);

      // Prefer the FULL text over the digest here. The digest drops section 7,
      // and on a Concept Options Report that is where the bubble-diagram area
      // labels live - the very numbers this tool needs. A digest that has lost
      // the areas is worse than raw text for costing.
      const hasAreas = (t) => /\d[\d,]*\s*m2/i.test(String(t || ""));
      const text = hasAreas(res.text) ? res.text : (res.digest || res.text);

      setPasteText((prev) => (prev ? prev + "\n\n" : "") + text);
      const found = extractScheduleFromText(text, Number(siteAreaM2) || 15000);
      setDetectError(
        `${file.name}: ${res.note} ` +
        (found.length
          ? `${found.length} facilities/zones with areas found in the text.`
          : "No areas were found in this file - check it is the concept or facility report, not a summary."));
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

  /**
   * One action, two behaviours. The tool decides from the input rather than making
   * the user pick: one concept -> estimate plus a direct conclusion; several ->
   * cost each, compare, recommend the best, and say what the budget headroom allows.
   */
  /**
   * Replace the facility schedule with the facilities of a costed concept.
   * Without this the headline estimate in 6.2 stays bound to whatever was
   * auto-detected first, which is how a report came to cost one scheme while
   * recommending another.
   */
  function loadConceptIntoSchedule(conceptName) {
    const c = (comparison && comparison.concepts || []).find((x) => x.name === conceptName);
    if (!c || !(c.facilities || []).length) return;
    setFacilities(c.facilities.map((f) => ({
      id: uid(), name: f.facility || "", area: String(f.area_m2 || ""),
      rate: String(f.rate_per_m2 || ""), category: "",
      rateBasis: "from costed concept: " + c.name,
      rateConfidence: c.confidence || "Assumption-Flagged",
    })));
    setDetectError("Facility schedule replaced with " + c.name + ". Sections 6.1 and 6.2 now describe that concept.");
  }

  async function generateInsight() {
    // Multiple concepts detected: run the comparison path instead, then continue
    // into the single-estimate insight so both sections are populated.
    if (detectedConcepts.length > 1) {
      await compareConcepts();
    }
    setInsightLoading(true); setInsight(null); setInsightError("");
    const summary = {
      facilities: facilities.filter((f) => f.name.trim()).map((f) => ({ name: f.name, area_m2: f.area, rate_per_m2: f.rate, subtotal: (Number(f.area) || 0) * (Number(f.rate) || 0) })),
      construction_subtotal: constructionSubtotal,
      total_capex: totalCapex,
      annual_opex: annualOpex,
      rate_assumptions: rates,
    };
    try {
      const multi = detectedConcepts.length > 1;
      const cap = Number(budgetCap) || 0;
      const bestCapex = multi && comparison?.concepts?.length
        ? Math.min(...comparison.concepts.map((c) => Number(c.estimated_capex) || Infinity))
        : totalCapex;
      const headroom = cap && bestCapex && Number.isFinite(bestCapex) ? cap - bestCapex : null;
      const headroomPct = cap && headroom !== null ? Math.round((headroom / cap) * 100) : null;

      const text = await callAI({
        provider, apiKey, maxTokens: 2500,
        content: "You are a cost-planning assistant reviewing a park redesign budget estimate built with a cascading wrapper method (RICS NRM1 style). Using ONLY the data given, provide: " +
          "(1) 'observations': array of short strings on where the biggest cost drivers are and any figures that look unusually high or low, " +
          "(2) 'confidence_note': 1-2 sentences on which parts rest on Assumption-Flagged rates and must be verified, " +
          (multi
            ? "(3) 'conclusion': 4-6 sentences naming which concept is the best value and WHY it is the best - not merely the cheapest. State how it is feasible within the budget, what the runner-up would have offered, and the principal bottlenecks that could still move the number. "
            : "(3) 'conclusion': 3-4 sentences on overall feasibility and the next cost-planning step. ") +
          (headroom !== null && headroom > 0
            ? `(4) 'optimisations': array of specific things that could be ADDED or upgraded with the remaining budget headroom of about ${formatNumber(headroom)} ${currency} (${headroomPct}% of the cap), each with an approximate cost. Only propose things consistent with the facilities listed. `
            : "(4) 'optimisations': array of cost reductions that would bring this within budget, each with an approximate saving. ") +
          "(5) 'bottlenecks': array of short strings on what could push the cost up. " +
          "Do not invent benchmark prices not present. Respond with ONLY valid JSON, no markdown fences: " +
          '{"observations": [""], "confidence_note": "", "conclusion": "", "optimisations": [""], "bottlenecks": [""]}' +
          checklistPrompt("BDG") + "\n\nMODE: " + (multi ? `comparison of ${detectedConcepts.length} concepts` : "single concept estimate") +
          (cap ? `\nBUDGET CAP: ${formatNumber(cap)} ${currency}` : "") +
          (headroom !== null ? `\nHEADROOM AGAINST BEST CONCEPT: ${formatNumber(headroom)} ${currency}` : "") +
          (multi && comparison?.concepts ? "\n\nCOSTED CONCEPTS:\n" + JSON.stringify(comparison.concepts, null, 2) : "") +
          "\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });
      // extractJSON returns NULL on an unrecoverable reply - it does not throw.
      // Passing that null into state leaves the section silently empty.
      const parsedInsight = extractJSON(text);
      if (!parsedInsight) throw new Error("The reply could not be read as structured data, even after recovery. "
        + "This is usually a truncated response - shorten the input or run it again.");
      setInsight(parsedInsight);
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
        ...(comparison && comparison.recommended && facilities.filter((x) => x.name.trim()).length
          ? (function () {
              // Does the facility schedule in 6.1 belong to the recommended concept?
              const rec = (comparison.concepts || []).find(
                (c) => (c.name || "").toLowerCase() === String(comparison.recommended).toLowerCase());
              const recFacilities = ((rec && rec.facilities) || []).map((x) => String(x.facility || "").toLowerCase());
              const mine = facilities.filter((x) => x.name.trim()).map((x) => x.name.toLowerCase());
              const overlap = mine.filter((n) => recFacilities.some((r) => r.includes(n) || n.includes(r)));
              if (recFacilities.length && overlap.length === 0) {
                return [{
                  title: "WARNING - the facility schedule does not match the recommended concept",
                  text:
                    "The cost build-up in 6.2 was computed from the facility schedule in 6.1, which does not " +
                    "correspond to " + comparison.recommended + ". The headline CAPEX above is therefore the cost of a " +
                    "different scheme and must not be quoted as the cost of the recommended concept. Load the " +
                    "recommended concept's facilities into the schedule and re-run before using either figure.",
                }];
              }
              return [];
            })()
          : []),
        ...(compareWarning ? [{ title: "WARNING - the comparison below is incomplete", text: compareWarning }] : []),
        // Per-concept, per-facility breakdown. Without it the comparison shows a
        // CAPEX with no way to check what produced it - the user cannot verify
        // the AI's arithmetic or adjust a line they disagree with.
        ...((comparison && (comparison.concepts || []).length)
          ? (comparison.concepts || []).map((c) => ({
              title: `Cost breakdown - ${c.name}`,
              note: (c.rate_derived
                ? "Facilities and areas were read directly from the concept text; the median researched rate was applied to each and is Assumption-Flagged. "
                : "Facilities, areas and rates as returned for this concept. ") +
                `Total area ${formatNumber(c.total_area_m2 || 0)} m2. Construction subtotal ${formatNumber(c.construction_subtotal)} ${currency}.`,
              headers: ["Facility / zone", "Area m2", `Rate ${currency}/m2`, `Subtotal ${currency}`, "% of construction"],
              rows: (c.facilities || []).map((x) => [
                x.facility,
                formatNumber(x.area_m2),
                formatNumber(x.rate_per_m2),
                formatNumber(x.subtotal || x.area_m2 * x.rate_per_m2),
                c.construction_subtotal ? Math.round(((x.subtotal || x.area_m2 * x.rate_per_m2) / c.construction_subtotal) * 100) + "%" : "-",
              ]).concat([[
                "TOTAL", formatNumber(c.total_area_m2 || 0), "",
                formatNumber(c.construction_subtotal), "100%",
              ]]),
            }))
          : []),
        ...(comparison ? [{ title: "Concept cost comparison - full cascade per concept",
          note: "Each concept was costed separately using the same RICS NRM1 cascade and the same wrapper percentages as section 6.2. The cascade is computed deterministically from facility areas and rates - only the facility schedule and unit rates are AI-derived. Concepts are compared on value for money rather than lowest cost.",
          headers: ["Concept", "Construction", "Prelims", "OH&P", "Contingency", "Inflation", `CAPEX ${currency}`, "Annual OPEX"],
          rows: (comparison.concepts || []).map((c) => [
            c.name, formatNumber(c.construction_subtotal), formatNumber(c.preliminaries), formatNumber(c.ohp),
            formatNumber(c.contingency), formatNumber(c.inflation), formatNumber(c.estimated_capex), formatNumber(c.annual_opex),
          ]) },
        { title: "Why the recommended concept is recommended",
          text: [
            comparison.recommended ? `Recommended: ${comparison.recommended}` : "",
            comparison.recommendation_reason || "",
          ].filter(Boolean).join("\n") },
        ...((comparison.concepts || []).some((c) => (c.bottlenecks || []).length || (c.opportunities || []).length)
          ? [{ title: "Bottlenecks and opportunities per concept",
              items: (comparison.concepts || []).flatMap((c) => [
                ...(c.bottlenecks || []).map((b) => `${c.name} - bottleneck: ${b}`),
                ...(c.opportunities || []).map((o) => `${c.name} - opportunity: ${o}`),
              ]) }]
          : []),
        ...((insight?.optimisations || []).length ? [{
          title: (Number(budgetCap) || 0) && totalCapex && Number(budgetCap) > totalCapex
            ? "Optimisations available within the remaining budget"
            : "Cost reduction options",
          items: insight.optimisations }] : []),
        ...((insight?.bottlenecks || []).length ? [{
          title: "Bottlenecks that could move the cost", items: insight.bottlenecks }] : []),
        { title: "Concept cost summary",
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
            <Plus size={12} /> Upload facility list or concept report (.xlsx, .csv, .docx, .rtf, .txt, .pdf, image)
            <input type="file" accept={EXPORT_ACCEPT} onChange={handleFacilityFile} className="sr-only" />
          </label>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <label className="text-[11px] font-semibold text-brand-text">How many concepts is this?</label>
            <select value={conceptCount} onChange={(e) => setConceptCount(e.target.value)}
              className="text-xs bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 outline-none">
              <option value="auto">Detect automatically</option>
              {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-[11px] text-brand-success">
              {detectedConcepts.length === 0 ? "Nothing detected yet"
                : detectedConcepts.length === 1 ? "1 concept detected - a single estimate and conclusion will be produced"
                : `${detectedConcepts.length} concepts detected - each will be costed and compared`}
            </span>
          </div>
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
              {/* Which concept this facility came from. Without it a schedule
                  assembled from several concepts is indistinguishable from one
                  describing a single scheme - the failure in AS2P-BDG-003-P01. */}
              {facilities.some((x) => x.concept) && (
                <span className="w-32 text-[10px] text-brand-muted truncate" title={f.concept || ""}>{f.concept || "-"}</span>
              )}
              <input type="number" value={f.area} onChange={(e) => updateFacility(f.id, { area: e.target.value })} placeholder="m2"
                className={"w-24 bg-[#F7F5F1] border rounded px-2 py-1.5 font-mono outline-none focus:border-brand-gold " +
                  (f.name.trim() && !(Number(f.area) > 0) ? "border-brand-danger" : "border-brand-border")} />
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
          <button onClick={generateInsight} disabled={insightLoading || comparing || !apiKey}
            className="btn-dark disabled:opacity-60 disabled:cursor-not-allowed">
            {insightLoading || comparing
              ? <span className="inline-block w-[15px] h-[15px] border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Sparkles size={15} />}
            {insightLoading || comparing ? "Working - do not navigate away" : "Generate AI Insight"}
          </button>
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
        <div className="card-header">Concept cost comparison</div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-brand-text">
            Populated automatically from the input above. {detectedConcepts.length > 1
              ? `${detectedConcepts.length} concepts detected - each is costed separately, then compared on value for money rather than lowest cost.`
              : "One concept detected, so this section stays empty. Paste or upload a report containing several concepts to compare them."}
          </p>
          {compareWarning && (
            <div className="rounded-md border-2 p-3 mb-2" style={{ borderColor: "#B8863B", backgroundColor: "#FBF1E1" }}>
              <p className="text-[11px] text-brand-text"><strong>Incomplete comparison.</strong> {compareWarning}</p>
            </div>
          )}
          {compareError && <p className="text-xs text-brand-danger">{friendlyError(compareError)}</p>}
          {comparison && (comparison.concepts || []).length > 0 && (
        <div className="px-4 pb-2 space-y-3">
          {(comparison.concepts || []).map((c) => (
            <details key={"bd-" + c.name} className="rounded-md border border-brand-border">
              <summary className="px-3 py-2 text-xs font-semibold cursor-pointer">
                {c.name} - {formatNumber(c.estimated_capex)} {currency} CAPEX
                <span className="font-normal text-brand-muted"> · {(c.facilities || []).length} items · {formatNumber(c.total_area_m2 || 0)} m2</span>
              </summary>
              <div className="px-3 pb-3 overflow-x-auto">
                {c.rate_derived && (
                  <p className="text-[10px] text-brand-warning mb-1">
                    Areas read from the concept text; median researched rate applied and Assumption-Flagged.
                  </p>
                )}
                <table className="w-full text-[11px]">
                  <thead><tr className="text-brand-muted">
                    <th className="text-left py-1">Facility / zone</th>
                    <th className="text-right py-1">Area m2</th>
                    <th className="text-right py-1">Rate</th>
                    <th className="text-right py-1">Subtotal</th>
                  </tr></thead>
                  <tbody>
                    {(c.facilities || []).map((x, i) => (
                      <tr key={i} className="border-t border-brand-border">
                        <td className="py-1">{x.facility}</td>
                        <td className="py-1 text-right font-mono">{formatNumber(x.area_m2)}</td>
                        <td className="py-1 text-right font-mono">{formatNumber(x.rate_per_m2)}</td>
                        <td className="py-1 text-right font-mono">{formatNumber(x.subtotal || x.area_m2 * x.rate_per_m2)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-brand-dark font-semibold">
                      <td className="py-1">Construction subtotal</td>
                      <td className="py-1 text-right font-mono">{formatNumber(c.total_area_m2 || 0)}</td>
                      <td />
                      <td className="py-1 text-right font-mono">{formatNumber(c.construction_subtotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
      {comparison && (comparison.concepts || []).length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {(comparison.concepts || []).map((c) => (
            <button key={c.name} onClick={() => loadConceptIntoSchedule(c.name)}
              className="text-[11px] font-semibold px-3 py-2 rounded-md border border-[#DDD6C9] hover:border-[#C9A46A]">
              Use {c.name} as the facility schedule
            </button>
          ))}
        </div>
      )}
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
