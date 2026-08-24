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
    needs: "A project location is the minimum. A site plan, GIS extract or satellite screenshot makes a substantial difference - without one the tool has no spatial context beyond what is published in text.",
    needsImages: true,
    needsWebSearch: true,
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
    refs: [
      { t: "Comprehensive Guide to Site Analysis Checklist for Architectural Projects", o: "Architects Registration Council of Nigeria (ARCON)", y: "", u: "" },
    ],
    convention:
      "Accessibility findings should record the specific standard each element was measured against, not a bare pass or fail, so the check is auditable.",
  },

  SOL: {
    needs: "A project location. Nothing else is required - zones and likely existing shade are proposed by the tool, and the analysis runs site-wide without them.",
    needsWebSearch: true,
    inputs: "A project location. The tool resolves it to coordinates and computes sun positions. Optionally add zones and mark which compass directions are already shaded.",
    name: "Solar Exposure Analysis",
    covers:
      "computed sun position across reference days, per-zone exposure duration at defined intensity tiers, and the shade implications that follow.",
    excludes:
      "air temperature, humidity, radiant or surface temperature, wind cooling, and thermal comfort simulation.",
    deterministic: [
      "Sun elevation and azimuth computed using the NOAA General Solar Position Calculations (declination, equation of time, hour angle)",
      "Clear-sky solar irradiance computed with the ASHRAE clear-sky model, integrated to give daily insolation in kWh/m2 - the metric professional solar analysis reports",
      "Per-zone exposure hours derived by comparing computed sun direction against declared existing shade",
      "Shadow length per metre of height derived from computed peak sun elevation",
    ],
    inferential: [
      "Resolution of a location description to latitude, longitude and UTC offset",
      "Shade strategy recommendation per zone",
    ],
    limitations: [
      "Sun position is geometric. Atmospheric refraction and urban heat island effects are not modelled.",
      "Insolation figures are CLEAR-SKY. No cloud cover, aerosol, dust or humidity attenuation is applied, so values are an upper bound. Real annual yield at a given site is typically lower and requires measured meteorological data (a TMY dataset) or a tool such as Autodesk Insight for a model-based cumulative study.",
      "This is a site-level solar study, not a surface-by-surface insolation analysis of a 3D model. It does not compute shading cast by specific proposed built form. Deriving shade geometry from an actual site boundary and surrounding built form requires a 3D mesh - typically from UAV photogrammetry or LiDAR - processed as in Jaczewska et al. (2025). That is the correct next-stage method and is beyond this tool.",
      "Existing shade is recorded as user-declared compass directions per zone, not as surveyed canopy or building geometry.",
      "Heat tier thresholds are a comparative convention for ranking exposure, not a temperature measurement.",
      "Resolved coordinates are AI-derived from a location description and should be confirmed against survey data.",
    ],
    refs: [
      { t: "General Solar Position Calculations", o: "NOAA Global Monitoring Laboratory", y: "",
        u: "https://gml.noaa.gov/grad/solcalc/solareqns.PDF" },
      { t: "Solar Calculator - calculation details (after Meeus, Astronomical Algorithms)", o: "NOAA GML", y: "",
        u: "https://gml.noaa.gov/grad/solcalc/calcdetails.html" },
      { t: "Clear-sky irradiance model (A, B, C coefficient method)", o: "ASHRAE Handbook of Fundamentals", y: "", u: "" },
      { t: "Park Design Guidelines - shade coverage requirements", o: "Delhi Urban Art Commission", y: "", u: "" },
      { t: "Assessment of the Solar Potential of Buildings Based on Photogrammetric Data (the established method for deriving shade and solar potential from site geometry - requires 3D mesh data this tool does not hold)", o: "Jaczewska, Sybilski & Tywonek, Energies 18(4):868", y: "2025", u: "https://www.mdpi.com/1996-1073/18/4/868" },
    ],
    convention:
      "Solar analysis should state the reference days used and the latitude applied, so results are reproducible by a third party.",
  },

  SUR: {
    needs: "Survey responses as .xlsx, .csv or pasted text, including the header row. A photograph of a paper survey sheet also works. Without a stated response count and recruitment method, results cannot be called representative.",
    needsImages: true,
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
    refs: [
      { t: "Assessment of the quality of urban parks and their impact on user satisfaction", o: "Jung et al.", y: "", u: "" },
    ],
    convention:
      "Survey reporting should always state the response count and, where known, how respondents were recruited. Findings without a stated denominator are not interpretable.",
  },

  WND: {
    needs: "A project location, then research it - wind data is entirely location-specific and the tool holds no default climate. Nothing is analysed until the research step is run.",
    needsWebSearch: true,
    inputs: "A project location. Optionally research it to replace the built-in reference data, then add zones to assess exposure.",
    name: "Wind Exposure Analysis",
    covers:
      "prevailing and seasonal wind direction for the project location, per-zone exposure to those directions, and shelter or filtration implications.",
    excludes:
      "computational fluid dynamics, turbulence modelling, pressure loads on structures, and pollutant dispersion.",
    deterministic: [
      "Per-zone exposure logic comparing zone orientation and declared existing shelter against stated prevailing directions",
      "Assessment of stated peak wind speeds against pedestrian comfort thresholds for sitting, standing, strolling and walking, plus the wind safety limit. Where the project location publishes its own criteria those are applied and named; otherwise the widely-used Lawson/Davenport-type thresholds are used as a stated fallback",
    ],
    inferential: [
      "Retrieval and interpretation of prevailing and seasonal wind characteristics for the supplied location",
      "Zone-specific shelter, filtration or channelling recommendations",
    ],
    limitations: [
      "Wind characterisation is drawn from general published climate information for the location, not from site-specific meteorological station data. It should be corroborated before design freeze.",
      "No airflow simulation is performed. Professional practice for a full pedestrian-level wind study uses either wind tunnel testing or computational fluid dynamics against a 3D model of the proposed massing and its surroundings; neither is performed here.",
      "The wind rose is schematic - built from stated prevailing directions and peak speeds, not from hourly meteorological station records. A defensible study uses a long record; published terms of reference commonly require a minimum of 30 years of hourly data from a named station.",
      "Extreme-event commentary is a design prompt, not a structural wind-loading assessment. Structures must be designed to the wind loading code applying at the location by a qualified engineer.",
      "Comfort thresholds are applied to a stated seasonal peak, not to a measured exceedance distribution. Published criteria are defined on an exceedance basis (typically the speed exceeded no more than 20 per cent of the time).",
      "Local obstructions - adjacent buildings, existing planting - are accounted for only insofar as the user declares them.",
    ],
    refs: [
      { t: "Pedestrian wind comfort criteria (Lawson/Davenport-type family, reflected in NEN 8100 and numerous municipal terms of reference)", o: "International practice", y: "", u: "" },
      { t: "Wind Analysis - Terms of Reference (a clearly published implementation of these criteria, used here as the reference case)", o: "City of Ottawa", y: "", u: "" },
    ],
    convention:
      "Wind reporting should distinguish prevailing direction from seasonal variation, state whether the data source is site-specific or regional, and assess results against published pedestrian comfort criteria rather than describing conditions qualitatively.",
  },

  VEG: {
    needs: "A project location, then research the palette. Site photographs are strongly recommended - they are the only way the tool sees existing planting and its condition.",
    needsImages: true,
    needsWebSearch: true,
    inputs: "A project location, plus a description or photograph of existing vegetation. Optionally research the location to replace the built-in planting palette.",
    name: "Vegetation, Terrain and Soil Analysis",
    covers:
      "assessment of existing vegetation as described or photographed - including a retain, relocate or remove position for each with its reason - and a proposed planting palette appropriate to the project's climate and water context. Both the existing and the proposed are reported; a palette without an assessment of what is already there is an incomplete analysis.",
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
    refs: [
      { t: "Park Design Guidelines - planting, species selection and water demand", o: "Delhi Urban Art Commission", y: "", u: "" },
    ],
    convention:
      "Planting schedules should record botanical name, water-demand band and minimum rootable soil volume. Soil volume is the parameter most often omitted and the most common cause of canopy failure in arid urban planting.",
  },

  CPT: {
    needsWebSearch: true,
    needs: "A site analysis brief. The Consolidator produces one in exactly the right format. A total site area is needed for the bubble diagrams to carry real areas for cost estimating.",
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
      "Research of comparable spaces, governing standards and local design practice at the project location (Claude web search / Gemini Google Search grounding)",
      "Generation of the concept variants themselves",
      "Zone placement and the rationale linking each zone to a finding in the supplied brief",
      "Scoring of each concept against the stated criteria",
    ],
    limitations: [
      "Scores are the model's structured judgment, not measurement. They are useful for ordering options for human deliberation; they are not evidence of design quality.",
      "Bubble diagrams are schematic representations of relative position and area. They are not survey-based geometry and carry no dimensional accuracy.",
      "Concept quality depends entirely on the quality and specificity of the supplied brief. A vague brief produces generic concepts.",
      "Where local design context was researched, it reflects published sources and general practice - not a survey of local projects. Treat comparable-project references as leads to verify, not as established fact.",
      "Concepts require review by a qualified designer before selection.",
    ],
    refs: [
      { t: "Park Design Guidelines - zoning, circulation and facility provision", o: "Delhi Urban Art Commission", y: "", u: "" },
      { t: "Comprehensive Guide to Site Analysis Checklist for Architectural Projects", o: "Architects Registration Council of Nigeria (ARCON)", y: "", u: "" },
    ],
    convention:
      "Concept options should always be presented as a set with comparative scoring, never as a single recommendation, so the selection decision visibly remains with the human designer.",
  },

  BDG: {
    needs: "A facility list with areas, plus a project location and currency so rates can be researched. Without rates every figure is zero.",
    needsWebSearch: true,
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
    needsWebSearch: true,
    needs: "The outputs of the other tools, pasted or uploaded per section. At least three sections are needed before a synthesis is meaningful.",
    inputs: "The outputs of the other analysis tools, pasted or uploaded per section. At least three sections are needed to synthesise.",
    name: "Consolidated Analysis and Opportunities Report",
    covers:
      "synthesis of the supplied analysis sections into a cross-referenced constraints and opportunities matrix, a set of design implications, and a consolidated brief formatted for use in concept generation.",
    excludes:
      "new analysis within the synthesis itself. The constraints matrix, design implications and concept brief are built ONLY from what you supply. The optional Completeness Check does look outward - but its output is kept in a separate section and never merged into the matrix, so your findings and the model's commentary remain distinguishable.",
    deterministic: [
      "Parsing of supplied documents (.docx, .rtf, .txt, .pdf) into text for synthesis. PDF text is extracted locally in the browser via the embedded text layer - no AI and no API key involved, so it is reproducible and works on every provider",
      "Structural assembly of the compiled report from its constituent sections",
    ],
    inferential: [
      "Cross-referencing of findings across sections into themed constraint and opportunity pairs",
      "Optional completeness check: reviewing the supplied analysis against what a competent study at this location would cover (both providers search live sources)",
      "Derivation of design implications from the matrix",
      "Composition of the consolidated concept brief",
    ],
    limitations: [
      "PDF extraction reads the embedded text layer. A scanned or image-only PDF has no text layer and cannot be read this way; it is detected and reported rather than returning an empty section.",
      "This report inherits every assumption and limitation of the sections supplied to it. It cannot be more reliable than its inputs.",
      "Synthesis is model-generated. Cross-references should be checked against the source sections before reliance.",
      "Sections left empty by the user are absent from the synthesis. Run the Completeness Check to have gaps identified explicitly.",
      "The Completeness Check is model-generated commentary, not an audit. It may raise items that do not apply and may miss items that do. It requires human judgement before acting on.",
    ],
    refs: [
      { t: "Comprehensive Guide to Site Analysis Checklist for Architectural Projects", o: "Architects Registration Council of Nigeria (ARCON)", y: "", u: "" },
    ],
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


/* ---------------------------------------------------------------------------
 * NARRATIVE SANITISER
 *
 * Last line of defence for the jurisdiction problem. The prompt now forbids
 * naming checklist sources in the body, but a prompt is guidance, not a
 * guarantee - the model can still slip. This strips inline attributions to
 * bodies that do not govern at the project location out of the narrative and
 * routes them to the references section instead.
 *
 * METHOD sources (NOAA, ASHRAE, RICS NRM1, Lawson) are deliberately NOT
 * stripped. They describe how a number was computed, so naming them inline is
 * correct and is the basis of the determinism claim.
 * ------------------------------------------------------------------------- */
const NON_GOVERNING_BODIES = [
  "Delhi Urban Art Commission", "Delhi UAC", "DUAC", "Delhi",
  "Architects Registration Council of Nigeria", "ARCON",
  "City of Ottawa", "Ottawa",
];

/** Strips inline attributions to non-governing bodies from a narrative string. */
export function sanitiseNarrative(text, collected) {
  if (!text) return text;
  let out = String(text);
  NON_GOVERNING_BODIES.forEach((body) => {
    const esc = body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "(Delhi Urban Art Commission)" / "[per ARCON]" -> removed, noted
    const paren = new RegExp("\\s*[\\(\\[](?:per |as per |source: |ref: )?" + esc + "[^\\)\\]]*[\\)\\]]", "gi");
    if (paren.test(out)) { if (collected) collected.add(body); out = out.replace(paren, ""); }
    // "per ARCON" / "to satisfy Delhi UAC guidelines" -> neutral wording
    const inline = new RegExp("(?:,\\s*)?\\b(?:per|as per|to satisfy|following|in accordance with|according to)\\s+" + esc + "\\b[^,.;]*", "gi");
    if (inline.test(out)) { if (collected) collected.add(body); out = out.replace(inline, ""); }
    // bare mention left over -> flag as unverified external benchmark
    const bare = new RegExp("\\b" + esc + "\\b", "gi");
    if (bare.test(out)) {
      if (collected) collected.add(body);
      out = out.replace(bare, "an external reference (not verified against local requirements)");
    }
  });
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

/** Builds the source-provenance block for the references section. */
export function provenanceLines(provenance) {
  const L = [];
  const mode = (provenance && provenance.mode) || "training";
  L.push("  SOURCE PROVENANCE");
  if (mode === "web") {
    L.push("    Research mode: LIVE WEB RESEARCH. The retrieved sources are listed above with");
    L.push("    their URLs as returned at the time of the run.");
    L.push("    Credibility note: retrieved sources have NOT been independently assessed for");
    L.push("    authority, currency or accuracy. A retrieved page is evidence that a claim was");
    L.push("    published, not that it is correct or that it governs at this location. Verify");
    L.push("    any figure that will carry a design decision.");
    if (provenance && provenance.searchedAt) L.push(`    Retrieved: ${provenance.searchedAt}`);
  } else {
    L.push("    Research mode: MODEL TRAINING KNOWLEDGE ONLY. No live web research was performed");
    L.push("    for this run - either no research step was requested, or the API tier in use does");
    L.push("    not provide web access.");
    L.push("    Consequence: statements not derived from the computed values or from the standing");
    L.push("    references above come from the model's training data. They carry no retrievable");
    L.push("    citation, may be out of date, and must be verified before use. Figures that");
    L.push("    govern a design decision should be confirmed against the local authority.");
  }
  L.push("");
  return L;
}

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
  extraFindings = [],    // optional live-research findings, appended INSIDE [6]
  overflow = "",         // model-generated overflow appendix
  provenance = null,     // {mode:"web"|"training", searchedAt}
}) {
  const spec = TOOL_SPECS[toolCode];
  if (!spec) throw new Error(`Unknown tool code: ${toolCode}`);
  const date = new Date().toISOString().slice(0, 10);
  const L = [];
  const stripped = new Set();   // non-governing bodies removed from narrative

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
        sanitiseNarrative(String(f.text), stripped).split("\n").forEach((ln) => L.push(`       ${ln}`));
      }
      if (f.items && f.items.length) {
        f.items.forEach((it) => L.push(`       - ${sanitiseNarrative(String(it), stripped)}`));
      }
      if (f.headers && f.rows) {
        L.push("       " + f.headers.join(" | "));
        f.rows.forEach((r) => L.push("       " + r.map((c) => String(c == null ? "" : c)).join(" | ")));
      }
      L.push("");
    });
    /*
     * LIVE-RESEARCH ADDITIONS (optional).
     *
     * Where live web research surfaces something material that the fixed
     * checklist does not cover - a local code requirement, a published
     * site-specific constraint - it is appended here as further numbered
     * findings, continuing the 6.n sequence.
     *
     * DELIBERATELY INSIDE SECTION 6. The twelve-block structure is the contract
     * every deliverable cross-references, so nothing may add, remove or reorder
     * a block. Extra material becomes another finding, never another section.
     * Each one is marked so a reader can tell retrieved material from the
     * standing methodology.
     */
    if (extraFindings.length) {
      const base = findings.length;
      extraFindings.forEach((f, xi) => {
        L.push(`  6.${base + xi + 1}  ${String(f.title || "ADDITIONAL FINDING").toUpperCase()}`);
        L.push("       [From live web research - see [11] for the source]");
        if (f.text) {
          sanitiseNarrative(String(f.text), stripped).split("\n").forEach((ln) => L.push(`       ${ln}`));
        }
        if (f.items && f.items.length) {
          f.items.forEach((it) => L.push(`       - ${sanitiseNarrative(String(it), stripped)}`));
        }
        if (f.headers && f.rows) {
          L.push("       " + f.headers.join(" | "));
          f.rows.forEach((r) => L.push("       " + r.map((c) => String(c == null ? "" : c)).join(" | ")));
        }
        L.push("");
      });
    }
  } else L.push("  (no findings generated - run the analysis before exporting)");
  L.push("");

  L.push("[7] DATA VISUALISATIONS");
  L.push(`  ${chartNote || "Charts are included in the PDF export of this report."}`);
  L.push("");

  L.push("[8] INTERPRETATION");
  L.push(`  ${interpretation ? sanitiseNarrative(interpretation, stripped) : "(not generated)"}`);
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
  if (conclusions.length) {
    // Two different kinds of statement were being emitted into one flat list:
    // assessments against a target, and actions to take. Rendered together they
    // read as the same point stated twice. Split them under sub-headings.
    const clean = conclusions.map((c) => sanitiseNarrative(String(c), stripped));
    const assessments = clean.filter((c) => /\btarget\b|\bbenchmark\b|Fails|meets |Exposed for/i.test(c));
    const actions = clean.filter((c) => !assessments.includes(c));
    if (assessments.length) {
      L.push("  10.1  ASSESSMENT AGAINST TARGETS");
      assessments.forEach((c) => L.push(`       - ${c}`));
      L.push("");
    }
    if (actions.length) {
      L.push(assessments.length ? "  10.2  RECOMMENDED ACTIONS" : "  10.1  RECOMMENDED ACTIONS");
      actions.forEach((c) => L.push(`       - ${c}`));
    }
  }
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
  provenanceLines(provenance).forEach((ln) => L.push(ln));
  if (stripped.size) {
    L.push("  EXTERNAL REFERENCES REMOVED FROM THE NARRATIVE");
    L.push("    The following were cited inside the analysis text and have been moved here.");
    L.push("    They are methodological references only and do not govern at this location:");
    Array.from(stripped).forEach((b) => L.push(`      - ${b}`));
    L.push("");
  }

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
  // Heading hierarchy. The previous rule promoted ANY all-caps line over 8 chars to
  // <h1> - so model-written headings inside the findings ("ADJACENT LAND-USE",
  // "ACCESSIBILITY STANDARDS") rendered LARGER than the "[6] FINDINGS" heading that
  // contains them, and the report read as a flat merge rather than nested sections.
  // Now: line 0 is the report title, [n]/APPENDIX are sections, "6.1 TITLE" is a
  // finding, and any other all-caps line is subordinate content inside a finding.
  const body = text
    .split("\n")
    .map((line, i) => {
      const t = line.trim();
      if (i === 0) return `<h1>${esc(t)}</h1>`;
      if (/^\[\d+\]/.test(line) || /^APPENDIX/.test(line)) return `<h2>${esc(t)}</h2>`;
      if (/^\s+\d+\.\d+\s+/.test(line)) return `<h3>${esc(t)}</h3>`;
      if (/^[A-Z][A-Z0-9 &,\-/()]+$/.test(t) && t.length > 8) return `<h4>${esc(t)}</h4>`;
      if (line.trim() === "---") return "<hr/>";
      return `<p>${esc(line)}</p>`;
    })
    .join("");
  const injected = chartsHtml
    ? body.replace("<h2>[8] INTERPRETATION</h2>", `${chartsHtml}<h2>[8] INTERPRETATION</h2>`)
    : body;
  return `<html><head><title>${esc(spec.name)} - ${esc(docRef)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#1C2333;line-height:1.45;}
    h1{font-size:20px;color:#1C2333;border-bottom:2px solid #C9A46A;padding-bottom:6px;margin-bottom:14px;}
    h2{font-size:14px;color:#1C2333;font-weight:700;letter-spacing:.04em;margin-top:22px;margin-bottom:6px;
       border-bottom:1px solid #C9A46A;padding-bottom:3px;}
    h3{font-size:12px;color:#5A5445;font-weight:700;margin:14px 0 3px 14px;letter-spacing:.03em;}
    h4{font-size:11px;color:#8A6A3A;font-weight:700;margin:10px 0 2px 26px;letter-spacing:.05em;
       text-transform:uppercase;}
    p{font-size:11.5px;margin:2px 0 2px 26px;white-space:pre-wrap;}
    hr{border:none;border-top:1px solid #E8E2D5;margin:18px 0;}
    .charts{margin:12px 0 12px 26px;}
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

/** Sun-path compass: where solar exposure arrives from, by intensity, plus shaded arcs.
 *  points: [{az, elev, tier, hourLabel}]  shadedDirs: ["N","NE"...] */
export function sunPathCompassSVG(points = [], shadedDirs = [], title = "") {
  if (!points.length) return "";
  const size = 360, cx = size / 2, cy = size / 2 + 12, R = 130;
  const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const TIER = { High: "#B84C3D", Medium: "#B8863B", Low: "#3D7A5C" };
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 40}" width="${size}" height="${size + 40}" font-family="Arial, Helvetica, sans-serif">`;
  svg += `<rect width="${size}" height="${size + 40}" fill="#ffffff"/>`;
  if (title) svg += `<text x="${cx}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="#1C2333">${esc(title)}</text>`;

  // shaded sectors (45 deg each) drawn first
  shadedDirs.forEach((d) => {
    const i = DIRS.indexOf(d);
    if (i < 0) return;
    const a0 = ((i * 45 - 22.5 - 90) * Math.PI) / 180;
    const a1 = ((i * 45 + 22.5 - 90) * Math.PI) / 180;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    svg += `<path d="M ${cx} ${cy} L ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1} Z" fill="#3D7A5C" fill-opacity="0.13"/>`;
  });

  // rings = elevation (centre 90 deg, edge horizon)
  [0.33, 0.66, 1].forEach((f) => {
    svg += `<circle cx="${cx}" cy="${cy}" r="${R * f}" fill="none" stroke="#E8E2D5"/>`;
  });
  svg += `<text x="${cx + 3}" y="${cy - R * 0.33 + 10}" font-size="7" fill="#C9C6BE">60 deg</text>`;
  svg += `<text x="${cx + 3}" y="${cy - R * 0.66 + 10}" font-size="7" fill="#C9C6BE">30 deg</text>`;

  // compass labels + spokes
  DIRS.forEach((d, i) => {
    const a = ((i * 45 - 90) * Math.PI) / 180;
    svg += `<line x1="${cx}" y1="${cy}" x2="${cx + R * Math.cos(a)}" y2="${cy + R * Math.sin(a)}" stroke="#F0EBDF"/>`;
    const lx = cx + (R + 14) * Math.cos(a), ly = cy + (R + 14) * Math.sin(a) + 3;
    svg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" font-weight="bold" fill="#1C2333">${d}</text>`;
  });

  // sun path points: radius from elevation (90 deg = centre)
  points.forEach((pt) => {
    const rr = R * (1 - Math.max(0, Math.min(90, pt.elev)) / 90);
    const a = ((pt.az - 90) * Math.PI) / 180;
    const x = cx + rr * Math.cos(a), y = cy + rr * Math.sin(a);
    svg += `<circle cx="${x}" cy="${y}" r="${pt.tier === "High" ? 5 : pt.tier === "Medium" ? 4 : 3}" fill="${TIER[pt.tier] || "#5A5445"}" fill-opacity="0.9"/>`;
  });
  // label a few hours
  points.filter((_, i) => i % 4 === 0).forEach((pt) => {
    const rr = R * (1 - Math.max(0, Math.min(90, pt.elev)) / 90);
    const a = ((pt.az - 90) * Math.PI) / 180;
    svg += `<text x="${cx + rr * Math.cos(a) + 7}" y="${cy + rr * Math.sin(a) + 3}" font-size="7" fill="#5A5445">${esc(pt.hourLabel)}</text>`;
  });

  // legend
  const ly = size + 14;
  let lx = 16;
  [["High", "High heat (above 55 deg)"], ["Medium", "Medium (25-55 deg)"], ["Low", "Low (below 25 deg)"]].forEach(([k, lab]) => {
    svg += `<circle cx="${lx}" cy="${ly - 3}" r="4" fill="${TIER[k]}"/><text x="${lx + 8}" y="${ly}" font-size="8" fill="#5A5445">${esc(lab)}</text>`;
    lx += 108;
  });
  svg += `<rect x="16" y="${ly + 8}" width="10" height="8" fill="#3D7A5C" fill-opacity="0.13"/><text x="30" y="${ly + 15}" font-size="8" fill="#5A5445">Shaded direction (existing)</text>`;
  svg += `<text x="${cx}" y="${ly + 28}" text-anchor="middle" font-size="7" fill="#8A8474">Centre = sun overhead. Edge = horizon. Computed via NOAA solar position algorithm.</text>`;
  svg += `</svg>`;
  return svg;
}

/** Wind rose: directional frequency/speed petals by season.
 *  seasons: [{label, prevailing:"NW", speedRange:"15-30 km/h", dustRisk}]
 *  This is a SCHEMATIC rose built from stated prevailing directions and speed ranges,
 *  not from hourly meteorological station records - stated on the diagram itself. */
export function windRoseSVG(seasons = [], title = "") {
  if (!seasons.length) return "";
  const size = 360, cx = size / 2, cy = size / 2 + 10, R = 125;
  const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const SEASON_COLORS = ["#1C2333", "#C9A46A", "#3D7A5C", "#B8863B"];
  const dirIndex = (name) => {
    const key = String(name || "").toUpperCase().replace(/[^NSEW]/g, "");
    const i = DIRS.indexOf(key);
    return i >= 0 ? i : DIRS.indexOf(key.slice(0, 2)) >= 0 ? DIRS.indexOf(key.slice(0, 2)) : -1;
  };
  const topSpeed = (r) => { const n = String(r || "").match(/\d+/g); return n ? Math.max(...n.map(Number)) : 0; };
  const maxSpeed = Math.max(10, ...seasons.map((sn) => topSpeed(sn.speedRange)));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 56}" width="${size}" height="${size + 56}" font-family="Arial, Helvetica, sans-serif">`;
  svg += `<rect width="${size}" height="${size + 56}" fill="#ffffff"/>`;
  if (title) svg += `<text x="${cx}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="#1C2333">${esc(title)}</text>`;

  // speed rings
  [0.33, 0.66, 1].forEach((f) => {
    svg += `<circle cx="${cx}" cy="${cy}" r="${R * f}" fill="none" stroke="#E8E2D5"/>`;
    svg += `<text x="${cx + 3}" y="${cy - R * f + 10}" font-size="7" fill="#C9C6BE">${Math.round(maxSpeed * f)} km/h</text>`;
  });
  // 8 spokes + labels
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].forEach((d, i) => {
    const a = ((i * 45 - 90) * Math.PI) / 180;
    svg += `<line x1="${cx}" y1="${cy}" x2="${cx + R * Math.cos(a)}" y2="${cy + R * Math.sin(a)}" stroke="#F0EBDF"/>`;
    svg += `<text x="${cx + (R + 14) * Math.cos(a)}" y="${cy + (R + 14) * Math.sin(a) + 3}" text-anchor="middle" font-size="10" font-weight="bold" fill="#1C2333">${d}</text>`;
  });

  // petals - one per season, pointing FROM the prevailing direction
  seasons.forEach((sn, si) => {
    const idx = dirIndex(sn.prevailing);
    if (idx < 0) return;
    const speed = topSpeed(sn.speedRange);
    const len = R * (speed / maxSpeed);
    const ang = (idx * 22.5 - 90) * Math.PI / 180;
    const w = 11 * Math.PI / 180;
    const x1 = cx + len * Math.cos(ang - w), y1 = cy + len * Math.sin(ang - w);
    const x2 = cx + len * Math.cos(ang + w), y2 = cy + len * Math.sin(ang + w);
    svg += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${len} ${len} 0 0 1 ${x2} ${y2} Z" fill="${SEASON_COLORS[si % 4]}" fill-opacity="0.62" stroke="${SEASON_COLORS[si % 4]}"/>`;
    svg += `<text x="${cx + (len + 9) * Math.cos(ang)}" y="${cy + (len + 9) * Math.sin(ang) + 3}" text-anchor="middle" font-size="7.5" fill="${SEASON_COLORS[si % 4]}" font-weight="bold">${speed}</text>`;
  });

  // legend
  let ly = size + 16, lx = 14;
  seasons.forEach((sn, si) => {
    svg += `<rect x="${lx}" y="${ly - 7}" width="9" height="9" fill="${SEASON_COLORS[si % 4]}" fill-opacity="0.62"/>`;
    svg += `<text x="${lx + 13}" y="${ly}" font-size="7.5" fill="#5A5445">${esc(String(sn.label || "").slice(0, 20))} ${esc(sn.prevailing || "")}</text>`;
    lx += 88;
    if (lx > size - 70) { lx = 14; ly += 13; }
  });
  svg += `<text x="${cx}" y="${size + 50}" text-anchor="middle" font-size="7" fill="#8A8474">Schematic rose from stated prevailing directions and peak speeds - not hourly station records. Petal length = peak speed. Wind blows FROM the labelled direction.</text>`;
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

/**
 * Field-contract guard.
 *
 * The prompts ask the model for a fixed set of keys. When the model omits one -
 * which happens when the response is long and the tail fields get squeezed - the
 * report silently printed "(not generated)" in sections 8 and 10 and the user only
 * discovered it after exporting. This returns the names of expected keys that came
 * back missing or empty, so the tool can say so plainly instead.
 *
 * Returns [] when everything expected is present.
 */
export function missingFields(obj, expected = []) {
  if (!obj || typeof obj !== "object") return expected.slice();
  return expected.filter((k) => {
    const v = obj[k];
    if (v == null) return true;
    if (typeof v === "string") return v.trim() === "";
    if (Array.isArray(v)) return v.length === 0;
    return false;
  });
}

/** Human-readable warning for a set of missing keys. */
export function missingFieldsNote(missing = []) {
  if (!missing.length) return "";
  return (
    "The model did not return: " + missing.join(", ") +
    ". These sections of the report will be empty. Run the analysis again - this is " +
    "usually a truncated response rather than a failure of the input data."
  );
}

/**
 * Parse a model JSON reply, repairing a TRUNCATED response where possible.
 *
 * These prompts ask for several arrays at once, so a long reply can be cut mid-array
 * and produce "Expected ',' or ']' after array element in JSON at position N".
 * Throwing away a mostly-complete analysis is the wrong response to that. This closes
 * the open structures, keeps what parsed, and reports that it did so - the loss is
 * disclosed, never silent.
 *
 * Returns { data, truncated }.
 */
/** REFERENCE ONLY - extractJSON in helpers.js is the parser actually used. */
export function parseModelJSON(text) {
  const a = String(text || "").indexOf("{");
  if (a === -1) throw new Error("The AI's reply could not be read as structured data. Try again.");
  const src = String(text).slice(a);
  const b = src.lastIndexOf("}");
  if (b > 0) {
    try { return { data: JSON.parse(src.slice(0, b + 1)), truncated: false }; } catch { /* repair below */ }
  }
  const repaired = repairTruncatedJSON(src);
  if (repaired) return { data: repaired, truncated: true };
  throw new Error(
    "The AI's answer was cut off before it finished (response length limit) and could not be " +
    "recovered. Try again with fewer items, or shorten your input text."
  );
}

/** Drop the incomplete trailing element and close whatever brackets remain open. */
export function repairTruncatedJSON(src) {
  let inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "}" || ch === "]") lastSafe = i;
    else if (ch === ",") lastSafe = i - 1;
  }
  if (lastSafe < 0) return null;
  let out = src.slice(0, lastSafe + 1);
  const open = [];
  inStr = false; esc = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") open.push(ch);
    else if (ch === "}" || ch === "]") open.pop();
  }
  while (open.length) out += open.pop() === "{" ? "}" : "]";
  try { return JSON.parse(out); } catch { return null; }
}
