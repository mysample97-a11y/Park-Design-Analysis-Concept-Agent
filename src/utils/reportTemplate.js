// src/utils/reportTemplate.js
// Structured 11-section report scaffolding.
//
// DESIGN RULE (important):
//   STATIC  (hardcoded here): sections 3, 4, 11 and the standing part of 9.
//           These describe what a tool IS and HOW it works - true on every run.
//   DYNAMIC (passed in by the tool): sections 5, 6, 7, 8, 10 and run-specific 9.
//           These come from the actual analysis. NEVER hardcode findings.
// This separation is what prevents the app emitting invented results.

export const TOOL_SPECS = {
  SCX: {
    inputs: "A project location, plus a description of what surrounds the site (or a GIS/map image). Optionally add zones with areas, and paths/ramps with widths, to run capacity and accessibility checks.",
    name: "Site Context & Accessibility Analysis",
    covers:
      "the site's surrounding land uses and adjacencies, arrival and access conditions, indicative visitor capacity, and a check of proposed paths, ramps and crossings against accessibility thresholds.",
    excludes:
      "subsurface or geotechnical conditions, utility capacity, traffic modelling, and microclimate - the last of which is addressed by the Solar and Wind analyses.",
    deterministic: [
      "Visitor capacity calculated from site area against stated capacity bands",
      "Path, ramp and crossing dimensions compared against fixed accessibility thresholds, each returned as Pass / Needs Review / Pending",
    ],
    inferential: [
      "Interpretation of adjacency significance from the supplied description and any uploaded map or GIS image",
      "Contextual insight on how surrounding uses generate demand at particular site edges",
    ],
    limitations: [
      "Adjacency interpretation depends on the accuracy and completeness of the description or image supplied; it is not a cadastral survey.",
      "Gradient and cross-fall compliance cannot be verified without survey-grade elevation data. Where elevation data is absent, gradient items are reported as Pending rather than Pass.",
      "Capacity figures are indicative planning bands, not modelled occupancy.",
    ],
    refs: [],
    convention:
      "Accessibility findings should record the specific standard each element was measured against, not a bare pass or fail, so the check is auditable.",
  },

  SOL: {
    inputs: "A project location. The tool resolves it to coordinates and computes sun positions. Optionally add zones and mark which compass directions are already shaded.",
    name: "Solar Exposure Analysis",
    covers:
      "computed sun position across reference days, per-zone exposure duration at defined intensity tiers, and the shade implications that follow.",
    excludes:
      "air temperature, humidity, radiant or surface temperature, wind cooling, and thermal comfort simulation.",
    deterministic: [
      "Sun elevation and azimuth computed using the NOAA General Solar Position Calculations (declination, equation of time, hour angle)",
      "Per-zone exposure hours derived by comparing computed sun direction against user-declared existing shade",
    ],
    inferential: [
      "Resolution of a location description to latitude, longitude and UTC offset",
      "Shade strategy recommendation per zone",
    ],
    limitations: [
      "Sun position is geometric. Atmospheric refraction, dust attenuation, cloud cover and urban heat island effects are not modelled.",
      "Existing shade is recorded as user-declared compass directions per zone, not as surveyed canopy or building geometry.",
      "Heat tier thresholds are a comparative convention for ranking exposure, not a temperature measurement.",
      "Resolved coordinates are AI-derived from a location description and should be confirmed against survey data.",
    ],
    refs: [
      { t: "General Solar Position Calculations", o: "NOAA Global Monitoring Laboratory", y: "",
        u: "https://gml.noaa.gov/grad/solcalc/solareqns.PDF" },
      { t: "Solar Calculator - calculation details (after Meeus, Astronomical Algorithms)", o: "NOAA GML", y: "",
        u: "https://gml.noaa.gov/grad/solcalc/calcdetails.html" },
    ],
    convention:
      "Solar analysis should state the reference days used and the latitude applied, so results are reproducible by a third party.",
  },

  SUR: {
    inputs: "Community survey responses, pasted as CSV or uploaded. Include the question headers row.",
    name: "Community Survey Analysis",
    covers:
      "tabulation of supplied survey responses, frequency distribution, and thematic grouping of open-text answers.",
    excludes:
      "sampling design, statistical significance testing, and any claim that responses are representative of the wider population.",
    deterministic: [
      "Response tabulation and frequency counts",
      "Chart generation from tabulated values",
    ],
    inferential: [
      "Thematic clustering of open-text responses",
      "Identification of recurring concerns and priorities across responses",
    ],
    limitations: [
      "Representativeness is unknown unless the sampling method is stated by the user. Response counts are reported as supplied; no weighting is applied.",
      "Thematic clustering is model-generated grouping, not coded qualitative analysis by a trained researcher.",
      "Small response counts produce unreliable thematic groupings; interpret with caution below approximately 30 responses.",
    ],
    refs: [],
    convention:
      "Survey reporting should always state the response count and, where known, how respondents were recruited. Findings without a stated denominator are not interpretable.",
  },

  WND: {
    inputs: "A project location. Optionally research it to replace the built-in reference data, then add zones to assess exposure.",
    name: "Wind Exposure Analysis",
    covers:
      "prevailing and seasonal wind direction for the project location, per-zone exposure to those directions, and shelter or filtration implications.",
    excludes:
      "computational fluid dynamics, turbulence modelling, pressure loads on structures, and pollutant dispersion.",
    deterministic: [
      "Per-zone exposure logic comparing zone orientation and declared existing shelter against stated prevailing directions",
    ],
    inferential: [
      "Retrieval and interpretation of prevailing and seasonal wind characteristics for the supplied location",
      "Zone-specific shelter, filtration or channelling recommendations",
    ],
    limitations: [
      "Wind characterisation is drawn from general published climate information for the location, not from site-specific meteorological station data. It should be corroborated before design freeze.",
      "No airflow simulation is performed. Recommendations follow directional reasoning, not modelled velocity or pressure.",
      "Local obstructions - adjacent buildings, existing planting - are accounted for only insofar as the user declares them.",
    ],
    refs: [],
    convention:
      "Wind reporting should distinguish prevailing direction from seasonal variation, and state whether the data source is site-specific or regional.",
  },

  VEG: {
    inputs: "A project location, plus a description or photograph of existing vegetation. Optionally research the location to replace the built-in planting palette.",
    name: "Vegetation, Terrain and Soil Analysis",
    covers:
      "assessment of existing vegetation as described or photographed, and a proposed planting palette appropriate to the project's climate and water context.",
    excludes:
      "arboricultural condition survey, soil laboratory testing, geotechnical investigation, and irrigation hydraulic design.",
    deterministic: [
      "Matching of proposed species against the climate and water-demand characteristics recorded for each species",
    ],
    inferential: [
      "Identification and interpretation of existing vegetation from description or photographs",
      "Species suitability reasoning for the supplied location and stated conditions",
      "Water-demand and maintenance implications of the proposed palette",
    ],
    limitations: [
      "Species identification from photographs is indicative and should be confirmed by a qualified arborist or horticulturalist.",
      "No soil testing or geotechnical data informs these recommendations unless supplied by the user.",
      "Water-demand categories are relative bands, not measured irrigation rates. Actual demand depends on soil, exposure, planting density and irrigation method.",
      "Species availability from local nurseries is not verified.",
    ],
    refs: [],
    convention:
      "Planting schedules should record botanical name, water-demand band and minimum rootable soil volume. Soil volume is the parameter most often omitted and the most common cause of canopy failure in arid urban planting.",
  },

  CPT: {
    inputs: "A site analysis brief - the findings, constraints and programme requirements the concepts must respond to. The Combined Document Generator produces one in the right format.",
    name: "Concept Options Report",
    covers:
      "generation of distinct spatial concept variants from a supplied analysis brief, each with a zone schedule, placement rationale and comparative scoring.",
    excludes:
      "detailed design, dimensioned layout, engineering feasibility, and any claim of geometric accuracy.",
    deterministic: [
      "Schematic bubble diagram geometry from zone position and relative area",
      "Arithmetic averaging of criterion scores into an overall score",
    ],
    inferential: [
      "Generation of the concept variants themselves",
      "Zone placement and the rationale linking each zone to a finding in the supplied brief",
      "Scoring of each concept against the stated criteria",
    ],
    limitations: [
      "Scores are the model's structured judgment, not measurement. They are useful for ordering options for human deliberation; they are not evidence of design quality.",
      "Bubble diagrams are schematic representations of relative position and area. They are not survey-based geometry and carry no dimensional accuracy.",
      "Concept quality depends entirely on the quality and specificity of the supplied brief. A vague brief produces generic concepts.",
      "Concepts require review by a qualified designer before selection.",
    ],
    refs: [],
    convention:
      "Concept options should always be presented as a set with comparative scoring, never as a single recommendation, so the selection decision visibly remains with the human designer.",
  },

  BDG: {
    inputs: "A list of facilities with areas, or a text description the tool can extract them from. Rates and wrapper percentages are editable.",
    name: "Cost Estimate and Feasibility Report",
    covers:
      "an order-of-cost estimate built from facility areas and unit rates, with a cascading build-up to capital and annual operating cost, tested against a stated budget cap.",
    excludes:
      "measured quantity surveying, tender pricing, cash-flow modelling, whole-life costing, and any warranty as to actual construction cost.",
    deterministic: [
      "Cascading cost build-up following the RICS NRM1 structure: measured works, then preliminaries, overheads and profit, contingency and inflation applied in sequence",
      "Comparison of computed capital cost against the stated budget cap",
    ],
    inferential: [
      "Extraction of a facility and area schedule from a supplied text description",
      "Identification of principal cost drivers and qualitative risk commentary",
    ],
    limitations: [
      "This is an order-of-cost estimate at concept stage, not a quantity-surveyed cost plan. It carries no pricing warranty.",
      "Unit rates carry confidence bands. Rates marked Assumption-Flagged have no confirmed published benchmark and must be verified before reliance.",
      "Risk is expressed in qualitative bands rather than numeric confidence percentages, which would imply a statistical basis that does not exist.",
      "Areas extracted from text descriptions are estimates unless explicitly stated by the user, and are flagged where assumed.",
    ],
    refs: [
      { t: "NRM 1: Order of Cost Estimating and Cost Planning for Capital Building Works (3rd edition)", o: "RICS", y: "2021",
        u: "https://www.rics.org/content/dam/ricsglobal/documents/standards/october_2021_nrm_1.pdf" },
    ],
    convention:
      "Order-of-cost estimates must state the basis of every rate and distinguish measured works from the preliminaries, overheads, contingency and inflation applied on top of them.",
  },

  CMB: {
    inputs: "The outputs of the other analysis tools, pasted or uploaded per section. At least three sections are needed to synthesise.",
    name: "Consolidated Analysis and Opportunities Report",
    covers:
      "synthesis of the supplied analysis sections into a cross-referenced constraints and opportunities matrix, a set of design implications, and a consolidated brief formatted for use in concept generation.",
    excludes:
      "new analysis. This tool synthesises only what is supplied to it and introduces no independent findings.",
    deterministic: [
      "Parsing of supplied documents (.docx, .rtf, .txt) into text for synthesis",
      "Structural assembly of the compiled report from its constituent sections",
    ],
    inferential: [
      "Cross-referencing of findings across sections into themed constraint and opportunity pairs",
      "Derivation of design implications from the matrix",
      "Composition of the consolidated concept brief",
    ],
    limitations: [
      "This report inherits every assumption and limitation of the sections supplied to it. It cannot be more reliable than its inputs.",
      "Synthesis is model-generated. Cross-references should be checked against the source sections before reliance.",
      "Sections left empty by the user are simply absent from the synthesis; their absence is not flagged as a gap unless the user states it.",
    ],
    refs: [],
    convention:
      "A consolidated report should make its cross-disciplinary conflicts visible rather than harmonising them away, so that unresolved tensions reach the designer rather than being smoothed over.",
  },
};

export const DEFAULT_META = {
  projectName: "",
  projectCode: "PRJ",
  siteDescription: "",
  author: "",
  status: "DRAFT",
};

function pad(n) { return String(n).padStart(3, "0"); }

/** Builds ALS2-SOL-001-P01 style reference. Sequence auto-increments per tool in localStorage. */
export function nextDocRef(projectCode, toolCode, rev = "P01") {
  const key = `report_seq_${projectCode}_${toolCode}`;
  let seq = 1;
  try {
    seq = parseInt(localStorage.getItem(key) || "0", 10) + 1;
    localStorage.setItem(key, String(seq));
  } catch { /* storage blocked */ }
  return `${projectCode || "PRJ"}-${toolCode}-${pad(seq)}-${rev}`;
}

export const OVERFLOW_PROMPT =
  "You have produced a structured analysis report. Identify any material observation, pattern, " +
  "risk or opportunity arising from THIS analysis that the structured sections did not capture. " +
  "Report only what is supported by the data you were given - do not introduce outside facts or figures. " +
  "If nothing material remains, respond with exactly: Nothing material remains. " +
  "Do not manufacture filler. Do not repeat content already in the report. Be concise.";

/**
 * Assemble the 11-section report.
 * Static sections come from TOOL_SPECS; everything else must be supplied by the caller
 * from the actual analysis run.
 */
export function buildStructuredReport({
  toolCode,
  meta = {},
  docRef,
  inputRecord = [],      // [{label, value}]
  findings = [],         // [{title, rows:[[..]], headers:[..]}] or {title, text}
  chartNote = "",        // description of charts included in the export
  interpretation = "",   // generated
  conclusions = [],      // generated
  runLimitations = [],   // run-specific, added to standing ones
  extraRefs = [],        // [{t,o,y,u}] any AI-cited sources
  overflow = "",         // model-generated overflow appendix
}) {
  const spec = TOOL_SPECS[toolCode];
  if (!spec) throw new Error(`Unknown tool code: ${toolCode}`);
  const date = new Date().toISOString().slice(0, 10);
  const L = [];

  L.push(spec.name.toUpperCase());
  L.push("");
  L.push("[1] TITLE BLOCK");
  L.push(`  Project:            ${meta.projectName || "(not stated)"}`);
  L.push(`  Site:               ${meta.siteDescription || "(not stated)"}`);
  L.push(`  Report:             ${spec.name}`);
  L.push(`  Document reference: ${docRef}`);
  L.push(`  Prepared using:     Site Analysis Suite (AI-assisted)`);
  L.push(`  Date:               ${date}`);
  L.push(`  Status:             ${meta.status || "DRAFT"}`);
  L.push("");

  L.push("[2] DOCUMENT CONTROL");
  L.push("  Rev    Date          Author                Description");
  L.push(`  ${(docRef.split("-").pop() || "P01").padEnd(6)} ${date}    ${(meta.author || "(not stated)").padEnd(20)} Initial generation`);
  L.push("");

  L.push("[3] PURPOSE AND SCOPE");
  L.push(`  This report covers ${spec.covers}`);
  L.push(`  It explicitly does not cover ${spec.excludes}`);
  L.push("");

  L.push("[4] METHODOLOGY AND DATA SOURCES");
  L.push("  Deterministic computation - identical on every run, independently verifiable:");
  spec.deterministic.forEach((d) => L.push(`    - ${d}`));
  L.push("  AI inference - probabilistic, requires human review:");
  spec.inferential.forEach((d) => L.push(`    - ${d}`));
  L.push("");

  L.push("[5] INPUT RECORD");
  L.push("  Everything supplied by the user for this run, recorded so the result is reproducible.");
  if (inputRecord.length) {
    inputRecord.forEach((i) => {
      const v = String(i.value == null ? "" : i.value);
      if (v.includes("\n")) {
        L.push(`  ${i.label}:`);
        v.split("\n").forEach((ln) => L.push(`      ${ln}`));
      } else {
        L.push(`  ${i.label}: ${v}`);
      }
    });
  } else L.push("  (no inputs recorded)");
  L.push("");

  L.push("[6] FINDINGS");
  if (findings.length) {
    findings.forEach((f, fi) => {
      L.push(`  6.${fi + 1}  ${f.title.toUpperCase()}`);
      if (f.note) L.push(`       ${f.note}`);
      if (f.text) {
        String(f.text).split("\n").forEach((ln) => L.push(`       ${ln}`));
      }
      if (f.items && f.items.length) {
        f.items.forEach((it) => L.push(`       - ${it}`));
      }
      if (f.headers && f.rows) {
        L.push("       " + f.headers.join(" | "));
        f.rows.forEach((r) => L.push("       " + r.map((c) => String(c == null ? "" : c)).join(" | ")));
      }
      L.push("");
    });
  } else L.push("  (no findings generated - run the analysis before exporting)");
  L.push("");

  L.push("[7] DATA VISUALISATIONS");
  L.push(`  ${chartNote || "Charts are included in the PDF export of this report."}`);
  L.push("");

  L.push("[8] INTERPRETATION");
  L.push(`  ${interpretation || "(not generated)"}`);
  L.push("");

  L.push("[9] ASSUMPTIONS AND LIMITATIONS");
  L.push("  Standing limitations of this analysis method:");
  spec.limitations.forEach((x) => L.push(`    - ${x}`));
  if (runLimitations.length) {
    L.push("  Limitations specific to this run:");
    runLimitations.forEach((x) => L.push(`    - ${x}`));
  }
  L.push("");

  L.push("[10] CONCLUSIONS AND RECOMMENDATIONS");
  if (conclusions.length) conclusions.forEach((c) => L.push(`  - ${c}`));
  else L.push("  (not generated)");
  L.push("");

  L.push("[11] REFERENCES");
  const allRefs = [...spec.refs, ...extraRefs];
  if (allRefs.length) {
    allRefs.forEach((r, i) =>
      L.push(`  R${i + 1}. ${r.t}${r.o ? ", " + r.o : ""}${r.y ? ", " + r.y : ""}${r.u ? "  " + r.u : ""}`)
    );
  } else L.push("  No external sources were cited by this analysis.");
  L.push("");
  L.push(`  Professional convention: ${spec.convention}`);
  L.push("");

  L.push("APPENDIX A - ADDITIONAL ANALYTICAL OBSERVATIONS");
  L.push("  Model-generated commentary that did not fit the structured sections above.");
  L.push("  All contents require human review and professional validation.");
  L.push("");
  L.push(`  ${overflow || "Nothing material remains."}`);
  L.push("");
  L.push("---");
  L.push("MVP / prototype output. Generated by an AI-assisted analysis tool to demonstrate");
  L.push("an integrated workflow. Not a construction-grade deliverable.");

  return L.join("\n");
}

/** HTML version for PDF export. chartsHtml is injected into section 7. */
export function buildStructuredReportHTML({ toolCode, meta = {}, docRef, chartsHtml = "", ...rest }) {
  const spec = TOOL_SPECS[toolCode];
  const text = buildStructuredReport({ toolCode, meta, docRef, ...rest });
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = text
    .split("\n")
    .map((line) => {
      if (/^\[\d+\]/.test(line) || /^APPENDIX/.test(line)) return `<h2>${esc(line)}</h2>`;
      if (/^[A-Z][A-Z &,\-]+$/.test(line.trim()) && line.trim().length > 8) return `<h1>${esc(line)}</h1>`;
      if (line.trim() === "---") return "<hr/>";
      return `<p>${esc(line)}</p>`;
    })
    .join("");
  const injected = chartsHtml
    ? body.replace("<h2>[8] INTERPRETATION</h2>", `${chartsHtml}<h2>[8] INTERPRETATION</h2>`)
    : body;
  return `<html><head><title>${esc(spec.name)} - ${esc(docRef)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#1C2333;line-height:1.45;}
    h1{font-size:19px;color:#1C2333;border-bottom:2px solid #C9A46A;padding-bottom:6px;}
    h2{font-size:13px;color:#5A5445;margin-top:20px;margin-bottom:4px;border-bottom:1px solid #E8E2D5;}
    p{font-size:11.5px;margin:2px 0;white-space:pre-wrap;}
    hr{border:none;border-top:1px solid #E8E2D5;margin:18px 0;}
    .charts{margin:12px 0;}
    </style></head><body>${injected}</body></html>`;
}

// ---------------------------------------------------------------------------
// Shared export helpers - each analyzer calls these instead of hand-rolling
// its own Word/PDF builder. Keeps all 8 tools structurally identical.
// ---------------------------------------------------------------------------

import { buildRTF, downloadFile, printHTML } from "./helpers";
import { callAI } from "./ai";

/** Generate the overflow appendix via a second, separate AI call. Returns "" on failure. */
export async function generateOverflow({ provider, apiKey, toolCode, reportText }) {
  try {
    const spec = TOOL_SPECS[toolCode];
    const text = await callAI({
      provider, apiKey, maxTokens: 900,
      content: `${OVERFLOW_PROMPT}\n\nTOOL: ${spec ? spec.name : toolCode}\n\nSTRUCTURED REPORT ALREADY PRODUCED:\n${reportText}`,
    });
    let t = (text || "").trim();
    if (!t || /^nothing material remains\.?$/i.test(t)) return "Nothing material remains.";
    // Trim to the last complete sentence so the appendix never ends mid-word.
    const lastStop = Math.max(t.lastIndexOf(". "), t.lastIndexOf(".\n"), t.lastIndexOf("."));
    if (lastStop > 40 && lastStop < t.length - 1) t = t.slice(0, lastStop + 1);
    if (!/[.!?]$/.test(t)) {
      const cut = t.lastIndexOf(" ");
      if (cut > 40) t = t.slice(0, cut) + " [truncated]";
    }
    return t;
  } catch {
    return ""; // fall back to the default line in the template
  }
}

/** Excel export of the structured report - one sheet per major section. */
export function exportStructuredExcel(opts, XLSX) {
  const spec = TOOL_SPECS[opts.toolCode] || {};
  const docRef = opts.docRef || nextDocRef(opts.meta?.projectCode, opts.toolCode);
  const wb = XLSX.utils.book_new();
  const meta = opts.meta || {};
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Field", "Value"],
    ["Project", meta.projectName || ""], ["Site", meta.siteDescription || ""],
    ["Report", spec.name || opts.toolCode], ["Document reference", docRef],
    ["Date", new Date().toISOString().slice(0, 10)], ["Status", meta.status || "DRAFT"],
    ["Author", meta.author || ""],
  ]), "1 Title Block");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Purpose"], [spec.covers || ""], [], ["Does not cover"], [spec.excludes || ""], [],
    ["Deterministic computation"], ...((spec.deterministic || []).map((d) => [d])), [],
    ["AI inference"], ...((spec.inferential || []).map((d) => [d])),
  ]), "3-4 Scope & Method");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Input", "Value"], ...(opts.inputRecord || []).map((i) => [i.label, String(i.value ?? "")]),
  ]), "5 Input Record");
  (opts.findings || []).forEach((f, i) => {
    const rows = [];
    if (f.note) rows.push([f.note], []);
    if (f.text) String(f.text).split("\n").forEach((l) => rows.push([l]));
    if (f.items) f.items.forEach((it) => rows.push([it]));
    if (f.headers && f.rows) { rows.push(f.headers); f.rows.forEach((r) => rows.push(r)); }
    const name = `6.${i + 1} ${String(f.title || "Findings").slice(0, 22)}`.replace(/[\\\/\?\*\[\]:]/g, "");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.length ? rows : [["(no data)"]]), name.slice(0, 31));
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Interpretation"], [opts.interpretation || "(not generated)"], [],
    ["Conclusions"], ...((opts.conclusions || []).map((c) => [c])),
  ]), "8-10 Interpretation");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Standing limitations"], ...((spec.limitations || []).map((l) => [l])), [],
    ["This run"], ...((opts.runLimitations || []).map((l) => [l])),
  ]), "9 Limitations");
  const refs = [...(spec.refs || []), ...(opts.extraRefs || [])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["#", "Source", "Organisation", "Year", "Link"],
    ...refs.map((r, i) => [`R${i + 1}`, r.t || "", r.o || "", r.y || "", r.u || ""]),
  ]), "11 References");
  downloadFile(XLSX.write(wb, { bookType: "xlsx", type: "array" }), `${docRef}.xlsx`, "application/octet-stream");
  return docRef;
}

/** Word (.rtf) export in the structured 11-section format. */
export function exportStructuredWord(opts) {
  const docRef = opts.docRef || nextDocRef(opts.meta?.projectCode, opts.toolCode);
  const text = buildStructuredReport({ ...opts, docRef });
  downloadFile(buildRTF(text), `${docRef}.rtf`, "application/rtf");
  return docRef;
}

/** PDF (print) export in the structured 11-section format. */
export function exportStructuredPDF(opts, onBlocked) {
  const docRef = opts.docRef || nextDocRef(opts.meta?.projectCode, opts.toolCode);
  const html = buildStructuredReportHTML({ ...opts, docRef });
  printHTML(html, onBlocked);
  return docRef;
}

// ---------------------------------------------------------------------------
// Chart / diagram helpers for exports.
// On-screen React components do not survive into exported documents, so any
// visual that must appear in a report has to be re-rendered here as inline
// SVG or HTML. Anything not passed as `chartsHtml` will NOT be in the export.
// ---------------------------------------------------------------------------

const CHART_COLORS = ["#1C2333", "#C9A46A", "#3D7A5C", "#B8863B", "#8A6A3A", "#5A5445"];
const GRID_POS = ["NW", "N", "NE", "W", "Center", "E", "SW", "S", "SE"];

/** Renders one concept's bubble diagram as inline SVG.
 *  Shows: colour-coded zones, zone name, AREA (m2 and %), a site-context ring
 *  naming adjacent roads/facilities per edge, and a north point. */
export function bubbleDiagramSVG(zones = [], title = "", opts = {}) {
  if (!zones.length) return "";
  const { siteAreaM2 = 0, context = {}, vision = "" } = opts; // context: {N,NE,E,SE,S,SW,W,NW}
  const cell = 168, pad = 30, ctxBand = 46;
  const gridW = cell * 3, gridH = cell * 3;
  const w = gridW + pad * 2 + ctxBand * 2;
  const h = gridH + pad * 2 + ctxBand * 2 + 34;
  const maxArea = Math.max(1, ...zones.map((z) => Number(z.area_pct) || 5));
  const byPos = {};
  GRID_POS.forEach((p) => (byPos[p] = []));
  zones.forEach((z) => {
    const pos = GRID_POS.includes(z.position) ? z.position : "Center";
    byPos[pos].push(z);
  });
  const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const gx = pad + ctxBand, gy = 34 + pad + ctxBand;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, Helvetica, sans-serif">`;
  svg += `<rect width="${w}" height="${h}" fill="#ffffff"/>`;
  if (title) svg += `<text x="${w / 2}" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="#1C2333">${esc(title)}</text>`;
  if (siteAreaM2) svg += `<text x="${w / 2}" y="32" text-anchor="middle" font-size="9" fill="#5A5445">Site area ${Number(siteAreaM2).toLocaleString()} m2 - bubble size is proportional to zone area</text>`;

  // site boundary
  svg += `<rect x="${gx - 6}" y="${gy - 6}" width="${gridW + 12}" height="${gridH + 12}" fill="#FAF9F6" stroke="#1C2333" stroke-width="2" rx="6"/>`;

  // context ring labels
  const ctxAt = {
    N:  [gx + gridW / 2, gy - 16, "middle"],
    S:  [gx + gridW / 2, gy + gridH + 26, "middle"],
    W:  [gx - 12, gy + gridH / 2, "end"],
    E:  [gx + gridW + 12, gy + gridH / 2, "start"],
    NW: [gx - 12, gy - 16, "end"],
    NE: [gx + gridW + 12, gy - 16, "start"],
    SW: [gx - 12, gy + gridH + 26, "end"],
    SE: [gx + gridW + 12, gy + gridH + 26, "start"],
  };
  Object.entries(ctxAt).forEach(([dir, [x, y, anchor]]) => {
    const label = context[dir];
    if (!label) return;
    svg += `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="8.5" fill="#8A6A3A" font-weight="bold">${esc(String(label).slice(0, 34))}</text>`;
  });

  // north point
  svg += `<g transform="translate(${gx + gridW + 20},${gy + 14})"><polygon points="0,-11 5,6 0,2 -5,6" fill="#1C2333"/><text x="0" y="18" text-anchor="middle" font-size="8" fill="#1C2333" font-weight="bold">N</text></g>`;

  let ci = 0;
  GRID_POS.forEach((pos, idx) => {
    const col = idx % 3, row = Math.floor(idx / 3);
    const x = gx + col * cell, y = gy + row * cell;
    svg += `<rect x="${x + 3}" y="${y + 3}" width="${cell - 6}" height="${cell - 6}" fill="none" stroke="#E8E2D5" stroke-dasharray="4 3"/>`;
    svg += `<text x="${x + 8}" y="${y + 16}" font-size="8" fill="#D8D2C4">${pos}</text>`;
    const list = byPos[pos];
    list.forEach((z, k) => {
      const pct = Number(z.area_pct) || 5;
      const r = Math.max(30, Math.min(60, (pct / maxArea) * 58));
      const cx = x + (cell - 6) / 2 + (k - (list.length - 1) / 2) * (r * 1.9);
      const cy = y + (cell - 6) / 2 + 6;
      const fill = CHART_COLORS[ci % CHART_COLORS.length];
      ci++;
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" fill-opacity="0.92" stroke="#ffffff" stroke-width="1.5"/>`;
      // wrap zone name onto up to 3 lines that fit inside the circle
      const words = String(z.name || "").split(/\s+/);
      const maxChars = Math.max(7, Math.floor(r / 3.4));
      const lines = [];
      let cur = "";
      words.forEach((word) => {
        if ((cur + " " + word).trim().length <= maxChars) cur = (cur + " " + word).trim();
        else { if (cur) lines.push(cur); cur = word.slice(0, maxChars); }
      });
      if (cur) lines.push(cur);
      const shown = lines.slice(0, 3);
      const fs = Math.max(7, Math.min(10, r / 5.2));
      const startY = cy - ((shown.length - 1) * fs) / 2 - 3;
      shown.forEach((ln, i) => {
        svg += `<text x="${cx}" y="${startY + i * (fs + 1.5)}" text-anchor="middle" font-size="${fs}" fill="#ffffff" font-weight="600">${esc(ln)}</text>`;
      });
      // AREA label - required by the Budget Tracker
      const m2 = siteAreaM2 ? Math.round((pct / 100) * Number(siteAreaM2)) : 0;
      const areaTxt = m2 ? `${pct}%  ~${m2.toLocaleString()} m2` : `${pct}%`;
      svg += `<text x="${cx}" y="${startY + shown.length * (fs + 1.5) + 2}" text-anchor="middle" font-size="${Math.max(6.5, fs - 1.5)}" fill="#ffffff" fill-opacity="0.95">${esc(areaTxt)}</text>`;
    });
  });

  if (vision) {
    svg += `<text x="${w / 2}" y="${h - 6}" text-anchor="middle" font-size="8" fill="#5A5445" font-style="italic">${esc(String(vision).slice(0, 120))}</text>`;
  }
  svg += `</svg>`;
  return svg;
}

/** Simple horizontal bar chart as inline SVG, for exports. */
export function barChartSVG(items = [], { title = "", unit = "", color = "#C9A46A" } = {}) {
  if (!items.length) return "";
  const rowH = 22, labelW = 165, barW = 250, pad = 14;
  const w = labelW + barW + 90, h = items.length * rowH + pad * 2 + (title ? 22 : 0);
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;
  svg += `<rect width="${w}" height="${h}" fill="#ffffff"/>`;
  if (title) svg += `<text x="${pad}" y="15" font-family="Arial" font-size="12" font-weight="bold" fill="#1C2333">${esc(title)}</text>`;
  items.forEach((it, i) => {
    const y = pad + (title ? 22 : 0) + i * rowH;
    const bw = Math.max(2, ((Number(it.value) || 0) / max) * barW);
    svg += `<text x="${labelW - 6}" y="${y + 12}" text-anchor="end" font-family="Arial" font-size="9" fill="#5A5445">${esc(it.label).slice(0, 34)}</text>`;
    svg += `<rect x="${labelW}" y="${y + 3}" width="${bw}" height="12" fill="${it.color || color}" rx="2"/>`;
    svg += `<text x="${labelW + bw + 6}" y="${y + 13}" font-family="Arial" font-size="9" fill="#1C2333">${esc(it.display != null ? it.display : it.value)}${esc(unit)}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

/** Wraps a simple data table for export HTML. */
export function tableHTML(headers, rows, caption = "") {
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let t = caption ? `<p style="font-size:11px;font-weight:bold;margin:10px 0 4px;">${esc(caption)}</p>` : "";
  t += `<table style="border-collapse:collapse;width:100%;font-size:10px;margin-bottom:10px;">`;
  t += `<tr>${headers.map((h) => `<th style="border:1px solid #ddd;padding:4px;background:#1C2333;color:#fff;text-align:left;">${esc(h)}</th>`).join("")}</tr>`;
  rows.forEach((r) => {
    t += `<tr>${r.map((c) => `<td style="border:1px solid #ddd;padding:4px;">${esc(c)}</td>`).join("")}</tr>`;
  });
  t += `</table>`;
  return t;
}
