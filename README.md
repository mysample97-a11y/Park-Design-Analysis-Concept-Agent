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
      { c: "Adjacent land use on every edge, and the demand each generates", src: "ARCON" },
      { c: "Access, arrival points, public transport and vehicular approach", src: "ARCON" },
      { c: "Pedestrian and cycle circulation, and their separation", src: "ARCON" },
      { c: "Accessibility standards that legally govern at this location", src: "ARCON + project" },
      { c: "Flood risk and surface water drainage", src: "ARCON" },
      { c: "Water table depth and groundwater conditions", src: "ARCON" },
      { c: "Soil contamination and previous site use", src: "ARCON" },
      { c: "Seismic, subsidence or other geotechnical hazard", src: "ARCON" },
      { c: "Topography, gradients and level change", src: "ARCON" },
      { c: "Existing structures, services and utilities on or crossing the site", src: "ARCON" },
      { c: "Noise, pollution and other environmental nuisance from adjacencies", src: "ARCON" },
      { c: "Views, orientation and visual character", src: "ARCON" },
      { c: "Statutory designations: heritage, conservation, protected trees, planning constraints", src: "ARCON" },
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
      { c: "Shade coverage requirements by space type", src: "Delhi UAC" },
      { c: "Seasonal variation and the differing demands of each season", src: "industry" },
      { c: "Thermal comfort implications, qualitatively derived", src: "industry" },
      { c: "Orientation guidance for heat-sensitive uses", src: "Delhi UAC" },
    ],
    rules: [
      "Never invent temperature, UV or radiation figures. Only the supplied computed values may be quoted.",
      "State explicitly that insolation is clear-sky and therefore an upper bound.",
      "Thermal comfort commentary is derived from sun geometry, not simulated. Say so.",
    ],
  },
  WND: {
    intro: "A professional wind study is expected to cover the following. Assess the researched wind data against them.",
    items: [
      { c: "Prevailing direction and seasonal variation", src: "City of Ottawa" },
      { c: "Wind speed ranges by season", src: "City of Ottawa" },
      { c: "Pedestrian comfort assessed by activity: sitting, standing, strolling, walking", src: "City of Ottawa" },
      { c: "Wind safety threshold check", src: "City of Ottawa" },
      { c: "Locally significant wind events, dust or storm conditions", src: "industry" },
      { c: "Site design mitigation: planting, berms, screens, built form", src: "City of Ottawa" },
      { c: "Where shelter is wanted versus where airflow is wanted for cooling", src: "industry" },
    ],
    rules: [
      "State that the data is regional rather than site-specific station data, and that no CFD or wind tunnel testing was performed.",
      "Published comfort criteria are defined on an exceedance basis; a seasonal peak is a coarser test. Say so.",
    ],
  },
  VEG: {
    intro: "A professional planting and ground-conditions assessment is expected to cover the following.",
    items: [
      { c: "Existing vegetation: species, condition, and what should be retained", src: "ARCON" },
      { c: "Native and climate-adapted species appropriate to this location", src: "industry" },
      { c: "Water demand and irrigation implications", src: "industry" },
      { c: "Minimum rootable soil volume for canopy trees", src: "industry" },
      { c: "Soil conditions, compaction and drainage", src: "ARCON" },
      { c: "Topography and terrain", src: "ARCON" },
      { c: "Canopy contribution to shade and thermal comfort", src: "Delhi UAC" },
      { c: "Biodiversity and habitat value", src: "industry" },
      { c: "Maintenance burden over the planting's life", src: "industry" },
    ],
    rules: [
      "Only propose species that genuinely grow in this climate and are available in this region.",
      "Species identification from photographs is indicative and requires arboricultural confirmation. State this.",
      "Where no soil or survey data was supplied, say what testing is required rather than assuming conditions.",
    ],
  },
  SUR: {
    intro: "A professional community engagement analysis is expected to cover the following.",
    items: [
      { c: "Recurring themes across responses, expressed as design themes", src: "industry" },
      { c: "Frequency of each theme", src: "industry" },
      { c: "Differences between user groups", src: "industry" },
      { c: "Conflicts where groups want incompatible things", src: "industry" },
      { c: "Priority ranking by weight of evidence", src: "industry" },
      { c: "Data quality limits affecting interpretation", src: "industry" },
    ],
    rules: [
      "Themes must be design themes, never respondent groupings.",
      "Never claim representativeness unless the sampling method was stated.",
      "Quote real phrases from responses; never invent a finding the data does not support.",
    ],
  },
  CPT: {
    intro: "Concept options are expected to demonstrate the following.",
    items: [
      { c: "Each zone traceable to a specific analytical finding", src: "industry" },
      { c: "Spatial organisation genuinely differing between options", src: "industry" },
      { c: "Circulation and accessibility integral to the layout", src: "ARCON" },
      { c: "Shade and microclimate response", src: "Delhi UAC" },
      { c: "Play and vehicular separation where children are provided for", src: "Delhi UAC" },
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

/** Renders a checklist into a compact prompt block (~300-600 tokens). */
export function checklistPrompt(toolCode) {
  const cl = CHECKLISTS[toolCode];
  if (!cl) return "";
  const items = cl.items.map((i) => `- ${i.c}  [expected by: ${i.src}]`).join("\n");
  const rules = cl.rules.map((r) => `- ${r}`).join("\n");
  return (
    "\n\n--- METHODOLOGY COVERAGE CHECKLIST ---\n" +
    cl.intro + "\n\n" + items +
    "\n\nRULES:\n" + rules +
    "\n\nIMPORTANT: this checklist defines SCOPE only. It tells you what a competent analysis covers - " +
    "it does NOT supply values, thresholds or formulas, and the sources named are not necessarily the ones " +
    "that govern this location. Establish the standards, figures and authorities that actually apply where " +
    "this project is, and cite those. Where an item does not apply here, say so briefly rather than omitting it.\n"
  );
}
