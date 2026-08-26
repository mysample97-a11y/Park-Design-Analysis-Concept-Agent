/**
 * Parser for the report format this suite produces.
 *
 * All five analysis tools export the SAME eleven-section structure, and all three
 * export formats derive from the same plain text:
 *   .xlsx  one sheet per section, sheet name = section heading
 *   .rtf   the plain text, RTF-wrapped
 *   .pdf   the plain text, HTML-rendered then printed
 *
 * So one parser handles every route. The consumer tools (Concept, Budget, Combined)
 * previously received an undifferentiated blob of text and had to re-infer structure
 * the exporter already knew. This recovers it: sections, findings, and the tables
 * inside findings come back as data.
 *
 * Degrades gracefully. A document that is not one of our reports still returns
 * usable text, just with recognised:false - so nothing ever hard-fails.
 */

const TOOL_NAMES = {
  SCX: "Site Context & Accessibility Analysis",
  SOL: "Solar Exposure Analysis",
  SUR: "Community Survey Analysis",
  WND: "Wind Exposure Analysis",
  VEG: "Vegetation & Soil Analysis",
  CPT: "Concept Options Report",
  BDG: "Budget Estimate",
  CMB: "Combined Site Analysis Report",
};

const SECTION_TITLES = {
  1: "titleBlock", 2: "documentControl", 3: "purposeScope", 4: "methodology",
  5: "inputRecord", 6: "findings", 7: "visualisations", 8: "interpretation",
  9: "limitations", 10: "conclusions", 11: "references",
};

/** Split a "a | b | c" row, tolerating the double-space form used by the xlsx route. */
function splitRow(line) {
  return line.split(/\s*\|\s*/).map((c) => c.trim());
}

/**
 * @param {string} text
 * @returns {{recognised:boolean, toolCode:string|null, toolName:string|null,
 *            docRef:string|null, project:string|null, sections:Object,
 *            findings:Array, tables:Array, conclusions:Array, text:string}}
 */
export function parseSuiteReport(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/);

  const out = {
    recognised: false, toolCode: null, toolName: null, docRef: null, project: null,
    sections: {}, findings: [], tables: [], conclusions: [], text: raw,
  };
  if (!raw.trim()) return out;

  // Document reference looks like AS2P-SCX-001-P01; the middle group is the tool.
  const refMatch = raw.match(/\b([A-Z0-9]{2,8})-(SCX|SOL|SUR|WND|VEG|CPT|BDG|CMB)-(\d{3})-([A-Z]\d{2}|preview)\b/);
  if (refMatch) {
    out.docRef = refMatch[0];
    out.toolCode = refMatch[2];
    out.toolName = TOOL_NAMES[refMatch[2]] || null;
  } else {
    // xlsx/pdf routes may lose the reference; fall back to the report title.
    const hit = Object.entries(TOOL_NAMES).find(([, name]) =>
      raw.toLowerCase().includes(name.toLowerCase()));
    if (hit) { out.toolCode = hit[0]; out.toolName = hit[1]; }
  }

  const proj = raw.match(/Project:\s*(.+)/);
  if (proj) out.project = proj[1].trim();

  // Walk the numbered sections. Headings appear as "[6] FINDINGS" in the text and
  // rtf/pdf routes, and as "## 6.1 Adjacent land use" sheet names in the xlsx route.
  let currentSection = null, currentFinding = null;
  const pushFinding = () => {
    if (currentFinding && (currentFinding.rows.length || currentFinding.lines.length)) {
      out.findings.push(currentFinding);
      if (currentFinding.rows.length) {
        out.tables.push({ title: currentFinding.title, headers: currentFinding.headers, rows: currentFinding.rows });
      }
    }
    currentFinding = null;
  };

  lines.forEach((line) => {
    const t = line.trim();
    if (!t) return;

    const sec = t.match(/^\[(\d{1,2})\]\s*(.*)$/);
    if (sec) {
      pushFinding();
      const n = Number(sec[1]);
      currentSection = SECTION_TITLES[n] || `section${n}`;
      out.sections[currentSection] = out.sections[currentSection] || [];
      out.recognised = true;
      return;
    }

    // Finding heading: "6.1  ADJACENT LAND USE" (text route) or "## 6.1 ..." (xlsx)
    const find = t.match(/^(?:##\s*)?(\d{1,2})\.(\d{1,2})\s+(.*)$/);
    if (find && (currentSection === "findings" || find[1] === "6")) {
      pushFinding();
      currentSection = "findings";
      currentFinding = { title: find[3].trim(), headers: [], rows: [], lines: [] };
      out.recognised = true;
      return;
    }

    // xlsx sheet headings for non-finding sections
    const sheet = t.match(/^##\s*(\d{1,2})[\s-]*(.*)$/);
    if (sheet) {
      pushFinding();
      const n = Number(sheet[1]);
      currentSection = SECTION_TITLES[n] || `section${n}`;
      out.sections[currentSection] = out.sections[currentSection] || [];
      out.recognised = true;
      return;
    }

    if (currentFinding) {
      if (t.includes("|")) {
        const cells = splitRow(t);
        if (!currentFinding.headers.length) currentFinding.headers = cells;
        else currentFinding.rows.push(cells);
      } else {
        currentFinding.lines.push(t.replace(/^-\s*/, ""));
      }
      return;
    }

    if (currentSection) {
      out.sections[currentSection] = out.sections[currentSection] || [];
      out.sections[currentSection].push(t.replace(/^-\s*/, ""));
    }
  });
  pushFinding();

  const concl = out.sections.conclusions || [];
  out.conclusions = concl.filter((c) => c && !/^\(not generated\)$/i.test(c));

  return out;
}

/**
 * Condense one or more parsed reports into a brief for the consumer tools.
 * Drops the boilerplate sections (purpose, methodology, document control) that are
 * identical on every report and would otherwise crowd out the actual findings.
 */
export function digestForConsumer(parsed) {
  if (!parsed?.recognised) return parsed?.text || "";
  const L = [];
  L.push(`=== ${parsed.toolName || "Analysis report"}${parsed.docRef ? ` (${parsed.docRef})` : ""} ===`);
  if (parsed.project) L.push(`Project: ${parsed.project}`);

  const inputs = parsed.sections.inputRecord || [];
  if (inputs.length) {
    L.push("", "INPUTS RECORDED:");
    inputs.slice(0, 25).forEach((i) => L.push("  " + i));
  }

  if (parsed.findings.length) {
    L.push("", "FINDINGS:");
    parsed.findings.forEach((f) => {
      L.push(`  ${f.title}`);
      if (f.headers.length) L.push("    " + f.headers.join(" | "));
      f.rows.forEach((r) => L.push("    " + r.join(" | ")));
      f.lines.forEach((x) => L.push("    - " + x));
    });
  }

  const interp = (parsed.sections.interpretation || []).filter((x) => !/^\(not generated\)$/i.test(x));
  if (interp.length) { L.push("", "INTERPRETATION:"); interp.forEach((x) => L.push("  " + x)); }
  if (parsed.conclusions.length) { L.push("", "CONCLUSIONS:"); parsed.conclusions.forEach((c) => L.push("  - " + c)); }

  const lim = parsed.sections.limitations || [];
  if (lim.length) { L.push("", "STATED LIMITATIONS (carry these forward, do not discard them):"); lim.slice(0, 10).forEach((x) => L.push("  - " + x)); }

  return L.join("\n");
}

/** One-line summary for the UI, so the user can see the upload was understood. */
export function describeParsed(parsed) {
  if (!parsed?.recognised) return "Read as plain text (not recognised as a report from this suite).";
  const bits = [];
  bits.push(parsed.toolName || "Analysis report");
  if (parsed.findings.length) bits.push(`${parsed.findings.length} finding section${parsed.findings.length === 1 ? "" : "s"}`);
  const rows = parsed.tables.reduce((a, t) => a + t.rows.length, 0);
  if (rows) bits.push(`${rows} data row${rows === 1 ? "" : "s"}`);
  if (parsed.conclusions.length) bits.push(`${parsed.conclusions.length} conclusion${parsed.conclusions.length === 1 ? "" : "s"}`);
  return "Recognised: " + bits.join(", ") + ".";
}
