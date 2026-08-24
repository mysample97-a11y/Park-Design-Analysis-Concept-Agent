// src/utils/methodology.js
//
// METHODOLOGY CHECKLISTS
// ----------------------
// Distilled from published professional references. Each item states WHAT must be
// covered and WHERE that expectation comes from - never a value, threshold or formula.
//
// This distinction is deliberate and load-bearing:
//   - The checklist supplies SCOPE, so nothing standard is missed.
//   - The AI supplies CONTENT for the actual location, citing sources that govern there.
// A site in Toronto is therefore checked for flood risk (because that is universally
// expected) but reports Ontario sources - not the sources of whichever document the
// checklist item came from.
//
// Sending the reference documents themselves is not viable: they run to megabytes,
// far beyond any practical prompt budget. Distilling them to scope is what makes this work.

/**
 * REFERENCE ONLY - nothing consumes this at runtime.
 * Standing references reaching the report come from TOOL_SPECS.refs in
 * reportTemplate.js. This list is retained as documentation of the wider
 * methodology base; if it is ever wired in, note that naming a body here does
 * NOT make it govern at the project location (see JURISDICTION_RULE).
 */
export const REFERENCE_LIBRARY = [
  { id: "arcon", title: "Comprehensive Guide to Site Analysis", org: "Architects Registration Council of Nigeria (ARCON)",
    covers: "Site analysis scope: physical, environmental, regulatory, hazard and contextual factors" },
  { id: "duac", title: "Park Design Guidelines", org: "Delhi Urban Art Commission",
    covers: "Shade coverage, spatial organisation, play and vehicular separation, planting" },
  { id: "ottawa", title: "Wind Analysis - Terms of Reference", org: "City of Ottawa",
    covers: "Pedestrian wind comfort and safety criteria, wind rose method, mitigation measures" },
  { id: "noaa", title: "General Solar Position Calculations", org: "NOAA Global Monitoring Laboratory",
    covers: "Solar position algorithm", url: "https://gml.noaa.gov/grad/solcalc/solareqns.PDF" },
  { id: "ashrae", title: "Clear-sky irradiance model", org: "ASHRAE Handbook of Fundamentals",
    covers: "Clear-sky direct, diffuse and global horizontal irradiance" },
  { id: "nrm1", title: "NRM 1: Order of Cost Estimating and Cost Planning", org: "RICS",
    covers: "Cost estimate structure: measured works, preliminaries, OH&P, risk, inflation",
    url: "https://www.rics.org/content/dam/ricsglobal/documents/standards/october_2021_nrm_1.pdf" },
];

export const CHECKLISTS = {
  SCX: {
    intro: "A professional site analysis is expected to cover the following. Determine which apply to THIS location, and for each, report what is actually documented for this jurisdiction.",
    items: [
      { c: "Adjacent land use on every edge, and the demand each generates", src: "professional site-analysis practice" },
      { c: "Access, arrival points, public transport and vehicular approach", src: "professional site-analysis practice" },
      { c: "Pedestrian and cycle circulation, and their separation", src: "professional site-analysis practice" },
      { c: "Accessibility standards that legally govern at this location", src: "professional site-analysis practice + project brief" },
      { c: "Flood risk and surface water drainage", src: "professional site-analysis practice" },
      { c: "Water table depth and groundwater conditions", src: "professional site-analysis practice" },
      { c: "Soil contamination and previous site use", src: "professional site-analysis practice" },
      { c: "Seismic, subsidence or other geotechnical hazard", src: "professional site-analysis practice" },
      { c: "Topography, gradients and level change", src: "professional site-analysis practice" },
      { c: "Existing structures, services and utilities on or crossing the site", src: "professional site-analysis practice" },
      { c: "Noise, pollution and other environmental nuisance from adjacencies", src: "professional site-analysis practice" },
      { c: "Views, orientation and visual character", src: "professional site-analysis practice" },
      { c: "Statutory designations: heritage, conservation, protected trees, planning constraints", src: "professional site-analysis practice" },
      { c: "Occupancy or capacity expectations for this facility type", src: "project" },
    ],
    rules: [
      "Report only what is genuinely documented for this location. Mark anything you cannot establish as 'Unknown - requires investigation' rather than inferring it.",
      "Cite the standards, codes and authorities that actually apply in this country and city. Never carry over a standard from another jurisdiction.",
      "Hazard items are a PRELIMINARY DESK SCREENING that prompts professional assessment. They are not a hazard assessment and must not be presented as one.",
    ],
  },
  SOL: {
    intro: "A professional solar study is expected to cover the following. Sun position and irradiance are already computed and supplied - interpret them.",
    items: [
      { c: "Sun position across representative days of the year", src: "NOAA" },
      { c: "Solar insolation in kWh/m2 - the metric professional practice reports", src: "ASHRAE / industry" },
      { c: "Shadow geometry consequences for shading device selection", src: "industry" },
      { c: "Shade coverage requirements by space type", src: "published park design guidance" },
      { c: "Seasonal variation and the differing demands of each season", src: "industry" },
      { c: "Thermal comfort implications, qualitatively derived", src: "industry" },
      { c: "Orientation guidance for heat-sensitive uses", src: "published park design guidance" },
      { c: "Solar energy generation potential from the computed insolation - which surfaces are viable, indicative array area, and what that could offset", src: "industry" },
      { c: "Where shade structures could double as PV canopies", src: "industry" },
    ],
    rules: [
      "Never invent temperature, UV or radiation figures. Only the supplied computed values may be quoted.",
      "State explicitly that insolation is clear-sky and therefore an upper bound.",
      "Thermal comfort commentary is derived from sun geometry, not simulated. Say so.",
      "Any energy-generation figure is an indicative upper bound from clear-sky insolation. It ignores panel efficiency losses, soiling, temperature derating, inverter losses and shading from surroundings. State that a real yield assessment requires measured irradiance data and a PV design tool.",
    ],
  },
  WND: {
    intro: "A professional wind study is expected to cover the following. Assess the researched wind data against them.",
    items: [
      { c: "Prevailing direction and seasonal variation", src: "industry" },
      { c: "Wind speed ranges by season", src: "industry" },
      { c: "Pedestrian comfort assessed by activity: sitting, standing, strolling, walking", src: "Lawson-type criteria" },
      { c: "Wind safety threshold check", src: "Lawson-type criteria" },
      { c: "Which pedestrian wind comfort criteria actually govern at THIS location, and the authority that sets them", src: "jurisdiction" },
      { c: "Extreme wind events documented for this region: storms, cyclones, hurricanes, tornadoes, monsoon, Shamal or equivalent - with recurrence and typical severity", src: "industry" },
      { c: "Design response to extreme events: anchoring and wind loading of shade structures and furniture, species selection for wind resistance, whether any element must be demountable ahead of a storm season", src: "industry" },
      { c: "Coastal exposure where applicable: salt spray, accelerated corrosion, onshore/offshore diurnal reversal, dune or shoreline effects", src: "industry" },
      { c: "Adjacent high-rise effects where applicable: downwash at tower bases, channelling between buildings, corner acceleration, and where these land in the public realm", src: "industry" },
      { c: "Dust, sand or airborne particulate carried on the prevailing wind, and whether the response is to block or to filter", src: "industry" },
      { c: "Wind-driven rain exposure and its effect on shelter and seating orientation", src: "industry" },
      { c: "Site design mitigation: planting, berms, screens, built form", src: "industry" },
      { c: "Where shelter is wanted versus where airflow is wanted for passive cooling - these often conflict and the conflict should be stated", src: "industry" },
      { c: "Seasonal usability windows: which parts of the year each outdoor space is actually comfortable", src: "industry" },
    ],
    rules: [
      "State that the data is regional rather than site-specific station data, and that no CFD or wind tunnel testing was performed.",
      "Comfort thresholds are a widely-used international family (Lawson/Davenport-type, also expressed in standards such as NEN 8100 and in many municipal terms of reference). Where the project location has its own published criteria, use those and name the authority. Only fall back to the generic thresholds if nothing local can be established, and say so.",
      "Extreme-event commentary is a design prompt, not a structural wind-loading assessment. Any structure must be designed to the wind loading code that applies at the location by a qualified engineer.",
      "Published comfort criteria are defined on an exceedance basis; a seasonal peak is a coarser test. Say so.",
    ],
  },
  VEG: {
    intro: "A professional planting and ground-conditions assessment is expected to cover the following.",
    items: [
      { c: "Existing vegetation: species, approximate numbers, condition, and a clear retain / relocate / remove position for each with the reason", src: "professional site-analysis practice" },
      { c: "Value of what already exists - mature canopy, habitat, screening, identity - and what would be lost by removing it", src: "industry" },
      { c: "Native and climate-adapted species appropriate to this location", src: "industry" },
      { c: "Water demand and irrigation implications", src: "industry" },
      { c: "Minimum rootable soil volume for canopy trees", src: "industry" },
      { c: "Soil conditions, compaction and drainage", src: "professional site-analysis practice" },
      { c: "Topography and terrain", src: "professional site-analysis practice" },
      { c: "Canopy contribution to shade and thermal comfort", src: "published park design guidance" },
      { c: "Biodiversity and habitat value", src: "industry" },
      { c: "Maintenance burden over the planting's life", src: "industry" },
    ],
    rules: [
      "Only propose species that genuinely grow in this climate and are available in this region.",
      "Species identification from photographs is indicative and requires arboricultural confirmation. State this.",
      "Where no soil or survey data was supplied, say what testing is required rather than assuming conditions.",
      "The report must cover BOTH what is already on site and what is proposed. A palette of new species without an assessment of existing planting is an incomplete analysis - existing mature vegetation is usually the most valuable asset on a site and takes decades to replace.",
    ],
  },
  SUR: {
    intro: "A professional community engagement analysis is expected to cover the following.",
    items: [
      { c: "Recurring themes across responses, derived from what respondents actually said - not from a predetermined list of expected themes", src: "industry" },
      { c: "Any concern raised that is unusual, site-specific or unexpected, and whether it is design-relevant", src: "industry" },
      { c: "Whether each theme is something the design can act on, something for management or operations, or something outside the project's control - stated explicitly", src: "industry" },
      { c: "Frequency of each theme", src: "industry" },
      { c: "Differences between user groups", src: "industry" },
      { c: "Conflicts where groups want incompatible things", src: "industry" },
      { c: "Priority ranking by weight of evidence", src: "industry" },
      { c: "Data quality limits affecting interpretation", src: "industry" },
    ],
    rules: [
      "Themes must be derived from the responses themselves. Do NOT force responses into a standard set such as shade, accessibility and safety - if respondents raised something else, report that. Only report a common theme if the data actually shows it.",
      "Themes must be substantive topics, never respondent groupings such as 'Respondents 1-10'.",
      "Never claim representativeness unless the sampling method was stated.",
      "Quote real phrases from responses; never invent a finding the data does not support.",
    ],
  },
  CPT: {
    intro: "Concept options are expected to demonstrate the following.",
    items: [
      { c: "Each zone traceable to a specific analytical finding", src: "industry" },
      { c: "Spatial organisation genuinely differing between options", src: "industry" },
      { c: "Circulation and accessibility integral to the layout", src: "professional site-analysis practice" },
      { c: "Shade and microclimate response", src: "published park design guidance" },
      { c: "Play and vehicular separation where children are provided for", src: "published park design guidance" },
      { c: "Facility schedule sufficient for cost estimating", src: "RICS NRM1" },
      { c: "Comparative scoring against stated criteria", src: "industry" },
    ],
    rules: [
      "Every zone rationale must cite an actual finding from the brief. Generic rationale is not acceptable.",
      "Scores are structured judgment, not measurement. Never present them as evidence of quality.",
    ],
  },
  BDG: {
    intro: "A concept-stage cost estimate is expected to cover the following.",
    items: [
      { c: "Measured works built from facility areas and unit rates", src: "RICS NRM1" },
      { c: "Preliminaries", src: "RICS NRM1" },
      { c: "Overheads and profit", src: "RICS NRM1" },
      { c: "Risk and contingency allowance", src: "RICS NRM1" },
      { c: "Inflation to the expected delivery date", src: "RICS NRM1" },
      { c: "Operating cost implication", src: "RICS NRM1" },
      { c: "The basis and confidence of every rate", src: "RICS NRM1" },
      { c: "Principal cost drivers", src: "industry" },
    ],
    rules: [
      "Every rate must state its basis. Rates without a published benchmark must be marked Assumption-Flagged.",
      "This is an order-of-cost estimate, not a quantity-surveyed cost plan. It carries no pricing warranty.",
    ],
  },
  CMB: {
    intro: "A consolidated analysis is expected to do the following.",
    items: [
      { c: "Cross-reference findings across every supplied discipline", src: "industry" },
      { c: "Pair each constraint with the opportunity it creates", src: "industry" },
      { c: "Surface conflicts between disciplines rather than smoothing them", src: "industry" },
      { c: "Translate findings into design implications", src: "industry" },
      { c: "Identify gaps where a section was not supplied", src: "industry" },
    ],
    rules: [
      "Introduce no new findings. Synthesise only what was supplied.",
      "Where two sections conflict, report the conflict rather than resolving it silently.",
    ],
  },
};

/**
 * The single most important instruction in this file.
 *
 * The bracketed source on each checklist item explains WHY the item is in scope.
 * It does NOT mean that body sets the value, and it usually has no authority at
 * the project location. An earlier build rendered these as "[expected by: X]",
 * and the model duly wrote "80% shade (Delhi Urban Art Commission)" into the
 * findings of a report for a site in Dubai. A reviewer in that jurisdiction
 * reads a foreign guideline quoted as governing and stops trusting the report.
 *
 * Names of reference-library bodies must therefore never appear in the
 * narrative sections. They belong in [11] REFERENCES and nowhere else.
 */
export const JURISDICTION_RULE =
  "\n\nHOW TO USE THIS CHECKLIST - READ CAREFULLY\n" +
  "1. This checklist defines SCOPE ONLY: what a competent analysis covers. It supplies\n" +
  "   no values, thresholds, percentages or formulas.\n" +
  "2. The bracketed source explains why an item is in scope. That body has NO authority\n" +
  "   at this project's location unless it happens to be the local authority.\n" +
  "3. Establish the standards and authorities that ACTUALLY GOVERN in this country and\n" +
  "   city, and work to those.\n" +
  "4. NEVER name a checklist source inside findings, interpretation or conclusions.\n" +
  "   Do not write phrases such as '(Delhi Urban Art Commission)', 'per ARCON' or\n" +
  "   'to satisfy Ottawa criteria' in the body of the analysis. Cited sources belong\n" +
  "   in the references section, which is assembled separately.\n" +
  "5. If you use a threshold that is NOT from this jurisdiction because no local figure\n" +
  "   could be established, you must (a) label it explicitly as an unverified external\n" +
  "   benchmark, (b) state that the governing local requirement was not established, and\n" +
  "   (c) NOT attribute it inline. Example of correct wording: 'Indicative benchmark 80%\n" +
  "   shade coverage - external reference, not verified against local requirements.'\n" +
  "6. Where an item does not apply here, say so briefly rather than omitting it.\n";

/** Renders a checklist into a compact prompt block (~300-600 tokens). */
export function checklistPrompt(toolCode) {
  const cl = CHECKLISTS[toolCode];
  if (!cl) return "";
  const items = cl.items.map((i) => `- ${i.c}  [why in scope: ${i.src}]`).join("\n");
  const rules = cl.rules.map((r) => `- ${r}`).join("\n");
  return (
    "\n\n--- METHODOLOGY COVERAGE CHECKLIST ---\n" +
    cl.intro + "\n\n" + items +
    "\n\nRULES:\n" + rules +
    JURISDICTION_RULE
  );
}
