import { useState } from "react";
import { Sparkles, BarChart3, AlertTriangle, Info, Upload, Image as ImageIcon, ChevronDown, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { checklistPrompt } from "../utils/methodology";
import { friendlyError, extractJSON, fileToBase64 , fileToBase64Raw } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, tableHTML, barChartSVG, missingFields, missingFieldsNote} from "../utils/reportTemplate";

const COLORS = ["#1C2333", "#C9A46A", "#3D7A5C", "#B8863B", "#8A6A3A", "#5A5445", "#7FBF9E", "#E08A6A"];

function detectDelimiter(line) {
  const commaCount = (line.match(/,/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function parseTable(raw) {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return null;
  const delim = detectDelimiter(text.split("\n")[0] || "");
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      row.push(cur.trim()); cur = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(cur.trim()); rows.push(row); row = []; cur = "";
    } else { cur += ch; }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur.trim()); rows.push(row); }
  const nonEmptyRows = rows.filter((r) => r.some((c) => c.length > 0));
  if (nonEmptyRows.length < 2) return null;
  return { headers: nonEmptyRows[0], rows: nonEmptyRows.slice(1) };
}

function classifyColumn(values) {
  const nonEmpty = values.filter((v) => v && v.trim().length > 0);
  const distinct = [...new Set(nonEmpty)];
  const isNumericRating = nonEmpty.every((v) => /^[1-5]$/.test(v.trim()));
  if (isNumericRating) return "rating";
  if (distinct.length > 0 && distinct.length <= 8 && distinct.length < nonEmpty.length * 0.6) return "choice";
  return "text";
}

function tabulateColumn(type, values) {
  const nonEmpty = values.filter((v) => v && v.trim().length > 0);
  if (type === "rating") {
    const counts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    nonEmpty.forEach((v) => { if (counts[v] !== undefined) counts[v] += 1; });
    return Object.entries(counts).map(([name, value]) => ({ name: `${name} star`, value }));
  }
  if (type === "choice") {
    const counts = {};
    nonEmpty.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }
  return nonEmpty;
}

export default function SurveyAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();

  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  function handleParse() {
    setParseError(""); setAnalysis(null);
    const table = parseTable(raw);
    if (!table) {
      setParseError("Couldn't find at least one header row and one response row. Paste or upload the exported table with headers on the first line.");
      setParsed(null);
      return;
    }
    const columns = table.headers.map((h, i) => {
      const values = table.rows.map((r) => r[i] || "");
      const type = classifyColumn(values);
      return { header: h, type, values, data: tabulateColumn(type, values) };
    });
    setParsed({ responseCount: table.rows.length, columns, rawHeaders: table.headers, rawRows: table.rows });
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setParseError("");
    const name = (file.name || "").toLowerCase();
    try {
      if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsm")) {
        // Spreadsheets are compressed binary - they MUST be parsed, never read as text.
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error("This workbook has no sheets.");
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        if (!csv.trim()) throw new Error("The first sheet appears to be empty.");
        setRaw(csv);
        if (wb.SheetNames.length > 1) {
          setParseError(`Note: this workbook has ${wb.SheetNames.length} sheets - only the first ("${sheetName}") was read.`);
        }
      } else if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
        setRaw(await file.text());
      } else {
        throw new Error("Unsupported file type. Use .xlsx, .xls, .csv, .tsv or .txt - other formats cannot be read as survey data.");
      }
    } catch (err) {
      setParseError(err.message || "Could not read this file.");
    } finally {
      e.target.value = "";
    }
  }

  async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageLoading(true); setParseError("");
    try {
      const base64 = await fileToBase64Raw(file);
      const text = await callAI({
        provider, apiKey, maxTokens: 3500,
        content: [
          { type: "image", source: { type: "base64", media_type: file.type || "image/png", data: base64 } },
          { type: "text", text: "This image shows survey results. Extract it into clean CSV format: first row = question headers, each following row = one respondent's answers. Respond with ONLY the CSV text, no markdown code fences, no explanation." },
        ],
      });
      let cleaned = text.replace(/^```csv\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      setRaw(cleaned);
    } catch (err) {
      setParseError(friendlyError(err.message) + " (Technical: " + err.message + ")");
    } finally {
      setImageLoading(false); e.target.value = "";
    }
  }

  async function generateAnalysis() {
    if (!parsed) return;
    setAnalysisLoading(true); setAnalysis(null); setAnalysisError("");
    const textColumns = parsed.columns.filter((c) => c.type === "text");
    const structuredColumns = parsed.columns.filter((c) => c.type !== "text");
    const payload = {
      total_responses: parsed.responseCount,
      structured_questions: structuredColumns.map((c) => ({ question: c.header, type: c.type, tabulated: c.data })),
      free_text_questions: textColumns.map((c) => ({ question: c.header, responses: c.values.filter((v) => v.trim()) })),
    };
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 3500,
        content: "You are a community engagement analyst. Analyse the survey responses below and produce a genuinely useful synthesis - not a restatement of the data. " +
          "Return ONLY valid JSON, no markdown fences: {" +
          "\"themes\":[{\"theme\":\"a theme DERIVED FROM WHAT RESPONDENTS ACTUALLY SAID - do not force responses into an expected set; if they raised something unusual or site-specific, report that\",\"actionable_by\":\"design|management|outside project control\",\"count\":0,\"representative_quote\":\"a short verbatim phrase from an actual response\",\"design_response\":\"the specific spatial intervention this calls for\"}]," +
          "\"priority_ranking\":[{\"priority\":\"\",\"mentions\":0,\"why_it_matters\":\"\"}]," +
          "\"demographic_patterns\":[{\"group\":\"e.g. older residents, parents, students\",\"distinct_need\":\"what this group asks for that others do not\"}]," +
          "\"conflicts\":[{\"tension\":\"where user groups want incompatible things\",\"resolution\":\"how the design can serve both\"}]," +
          "\"red_flags\":[\"data quality issues that limit interpretation\"]," +
          "\"overall_summary\":\"4-6 sentences of real analysis - what the responses collectively reveal about how this place fails its users today\"," +
          "\"conclusion\":\"the single clearest design action and why the evidence supports it\"}. " +
          "CRITICAL RULES: derive themes from the responses themselves. Do NOT default to shade, accessibility and safety unless the data actually shows them. Report anything unusual or site-specific that respondents raised, and say whether each theme is actionable by design, by management, or outside the project's control. Never use groupings like 'Respondents 1-10'. Count how many responses genuinely support each theme. Quote real phrases from the data. Never invent a finding the responses do not support. Do not assume any particular country, city or project - analyse only what is in the data." + checklistPrompt("SUR") + "\n\nSURVEY RESPONSES:\n" + raw,
      });
      const parsedAnalysis = extractJSON(text);
      setAnalysis(parsedAnalysis);
      // Field-contract guard: say so plainly when the model omits expected keys,
      // rather than letting sections 8 and 10 print "(not generated)" silently.
      const gaps = missingFields(parsedAnalysis, ["themes", "overall_summary", "conclusion"]);
      setAnalysisError(gaps.length ? missingFieldsNote(gaps) : "");
    } catch (e) {
      setAnalysisError(e.message || "Unknown error while generating insight.");
    } finally {
      setAnalysisLoading(false);
    }
  }

  function buildPlainText() {
    let lines = [`COMMUNITY SURVEY REPORT`, `Project: ${meta?.projectName || "(not stated)"}`, `Generated: ${new Date().toLocaleString()}`, `Total responses: ${parsed.responseCount}`, ""];
    parsed.columns.filter((c) => c.type !== "text").forEach((c) => {
      lines.push(c.header.toUpperCase());
      c.data.forEach((d) => lines.push(`  ${d.name}: ${d.value}`));
      lines.push("");
    });
    if (analysis) {
      (analysis.themes || []).forEach((t) => {
        lines.push(`  ${t.theme} (${t.count} responses): ${t.design_response || ""}`);
        if (t.representative_quote) lines.push(`     "${t.representative_quote}"`);
      });
      if (analysis.red_flags?.length) { lines.push("RED FLAGS"); analysis.red_flags.forEach((f) => lines.push(`  - ${f}`)); lines.push(""); }
      lines.push("OVERALL SUMMARY", analysis.overall_summary || "", "");
      lines.push("CONCLUSION", analysis.conclusion || "");
    }
    lines.push("", "RAW RESPONSE DATA");
    lines.push(parsed.rawHeaders.join(" | "));
    parsed.rawRows.forEach((r) => lines.push(r.join(" | ")));
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "SUR",
      meta,
      inputRecord: [{label:"Responses supplied",value:"see Findings"}],
      findings: [{ title: "Analysis output", text: buildPlainText() }],
      chartNote: (analysis?.themes || []).length ? "Theme frequency chart and priority ranking are reproduced in the PDF export." : "Run the analysis to generate charts.",
      chartsHtml:
        ((analysis?.themes || []).length
          ? barChartSVG(analysis.themes.map((t) => ({ label: t.theme, value: Number(t.count) || 0, display: `${t.count} responses` })),
              { title: "Responses by design theme" })
            + tableHTML(["Theme", "Count", "Representative response", "Design response"],
                analysis.themes.map((t) => [t.theme, t.count, t.representative_quote || "", t.design_response || ""]),
                "Theme analysis")
          : "") +
        ((analysis?.priority_ranking || []).length
          ? tableHTML(["Priority", "Mentions", "Why it matters"],
              analysis.priority_ranking.map((r) => [r.priority, r.mentions, r.why_it_matters]), "Priority ranking")
          : "") +
        ((analysis?.demographic_patterns || []).length
          ? tableHTML(["User group", "Distinct need"],
              analysis.demographic_patterns.map((d) => [d.group, d.distinct_need]), "Demographic patterns")
          : "") +
        ((analysis?.conflicts || []).length
          ? tableHTML(["Tension between user groups", "Design resolution"],
              analysis.conflicts.map((c) => [c.tension, c.resolution]), "Conflicting needs")
          : ""),
      interpretation: analysis?.overall_summary || "",
      conclusions: [analysis?.conclusion].filter(Boolean),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (includeOverflow && !overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "SUR",
        reportText: buildPlainText() });
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
      <ToolIntro toolCode="SUR" />

      <div className="bg-[#FBF1E1] border border-[#E8D5B0] rounded-lg p-4 flex gap-3">
        <Info size={18} className="text-brand-warning shrink-0 mt-0.5" />
        <div className="text-sm text-brand-text">
          <p className="font-medium mb-1">How to use this</p>
          <p>Collect responses with Microsoft Forms or Google Forms ("anyone with the link" - no sign-in required). Then paste the data, upload the file directly, or upload a screenshot of the results below.</p>
          <p className="mt-2 text-brand-warning font-medium">For reliable results: keep batches to around 50 responses per analysis run.</p>
          <p className="mt-2 text-[10px] text-brand-text/60">Upload buttons may not work inside the Claude mobile app (a platform restriction). Try your phone's regular browser instead, or use paste, which always works.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Step 1 — Provide Your Survey Data</div>
        <div className="p-4 space-y-4">
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"Visit Frequency,Who With,Shade Importance,Priority Activity,What's Missing\nWeekly,Family with young children,5,Children's play,More shade"} rows={7} className="textarea font-mono text-xs" />
          <button onClick={handleParse} disabled={!raw.trim()} className="btn-gold w-full">
            <BarChart3 size={18} /> Tabulate Responses
          </button>
          {parseError && <p className="text-xs text-brand-danger flex items-center gap-1"><AlertTriangle size={12} /> {parseError}</p>}

          <p className="text-xs text-brand-text/60 text-center pt-2 border-t border-[#F0EBDF]">- or, on desktop/browser -</p>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm font-semibold border-2 px-4 py-2.5 rounded-md flex items-center gap-2 cursor-pointer" style={{ borderColor: "#1C2333", color: "#1C2333", backgroundColor: "#fff" }}>
              <Upload size={15} /> Upload CSV / Excel File
              <input type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt" onChange={handleFileUpload} className="sr-only" />
            </label>
            <label className="text-sm font-semibold border-2 px-4 py-2.5 rounded-md flex items-center gap-2 cursor-pointer" style={{ borderColor: "#1C2333", color: "#1C2333", backgroundColor: "#fff", opacity: imageLoading ? 0.4 : 1, pointerEvents: imageLoading ? "none" : "auto" }}>
              <ImageIcon size={15} /> {imageLoading ? "Reading image..." : "Upload Image / Screenshot"}
              <input type="file" accept="image/*" onChange={handleImageUpload} className="sr-only" />
            </label>
          </div>
        </div>
      </div>

      {parsed && (
        <>
          <div className="bg-white rounded-lg border-2 border-brand-border p-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-brand-text">
              <span className="font-semibold">{parsed.responseCount}</span> response{parsed.responseCount !== 1 ? "s" : ""} parsed
              {parsed.responseCount < 20 && <span className="text-brand-warning"> - small sample, treat patterns as indicative</span>}
            </p>
            <button onClick={generateAnalysis} disabled={analysisLoading || !apiKey} className="btn-dark">
              <Sparkles size={15} /> {analysisLoading ? "Analyzing..." : "Generate AI Insight"}
            </button>
          </div>

          {parsed.columns.filter((c) => c.type !== "text").map((c, i) => (
            <div key={i} className="bg-white rounded-lg border border-brand-border p-4">
              <h3 className="text-sm font-semibold mb-3">{c.header} <span className="text-[10px] font-normal text-brand-text/60 uppercase">({c.type})</span></h3>
              <ResponsiveContainer width="100%" height={Math.max(120, c.data.length * 32)}>
                <BarChart data={c.data} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D5" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>{c.data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}

          {analysis && (analysis.themes || []).length > 0 && (
            <div className="bg-white rounded-lg border border-brand-border p-4">
              <h3 className="text-sm font-semibold mb-3">Design themes <span className="text-[10px] font-normal text-brand-text/60 uppercase">(AI-clustered from responses)</span></h3>
              <ResponsiveContainer width="100%" height={Math.max(140, analysis.themes.length * 34)}>
                <BarChart data={analysis.themes} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D5" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="theme" tick={{ fontSize: 11 }} width={150} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {analysis.themes.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-2">
                {analysis.themes.map((t, idx) => (
                  <div key={idx} className="text-xs text-[#3A362C]">
                    <p><span className="font-semibold">{t.theme}</span> ({t.count} responses): {t.design_response}</p>
                    {t.representative_quote && <p className="text-[11px] italic text-brand-text/70 pl-3">"{t.representative_quote}"</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis && (analysis.demographic_patterns || []).length > 0 && (
            <div className="bg-white rounded-lg border border-brand-border p-4">
              <h3 className="text-sm font-semibold mb-2">Demographic patterns</h3>
              {analysis.demographic_patterns.map((d, i) => (
                <p key={i} className="text-xs text-[#3A362C]"><span className="font-semibold">{d.group}:</span> {d.distinct_need}</p>
              ))}
            </div>
          )}

          {analysis && (analysis.conflicts || []).length > 0 && (
            <div className="bg-white rounded-lg border border-brand-border p-4">
              <h3 className="text-sm font-semibold mb-2">Conflicting needs</h3>
              {analysis.conflicts.map((c, i) => (
                <p key={i} className="text-xs text-[#3A362C]"><span className="font-semibold text-brand-danger">{c.tension}</span> - <span className="text-brand-success">{c.resolution}</span></p>
              ))}
            </div>
          )}

          <div className="bg-white rounded-lg border border-brand-border p-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-2">Overall Summary & Red Flags</h2>
            {analysisLoading && <p className="text-sm text-brand-text/60">Reading responses and clustering themes...</p>}
            {analysisError && (
              <div className="space-y-1.5">
                <p className="text-sm text-[#3A362C] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(analysisError)}</p>
                <p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical detail: {analysisError}</p>
              </div>
            )}
            {analysis && (
              <>
                <p className="text-sm text-[#3A362C] leading-relaxed">{analysis.overall_summary}</p>
                {analysis.red_flags?.length > 0 && (
                  <div className="mt-3 space-y-1">{analysis.red_flags.map((f, i) => (<p key={i} className="text-xs text-brand-danger flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {f}</p>))}</div>
                )}
              </>
            )}
            {!analysis && !analysisLoading && !analysisError && <p className="text-sm text-brand-text/60">Click "Generate AI Insight" above for theme charts, per-theme recommendations, and any red flags.</p>}
          </div>

          {analysis?.conclusion && (
            <div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}>
              <h2 className="font-bold text-sm uppercase tracking-wide text-[#8A6A3A] mb-2">Conclusion</h2>
              <p className="text-sm text-[#3A362C] leading-relaxed font-medium">{analysis.conclusion}</p>
            </div>
          )}

          <div className="bg-white rounded-lg border border-brand-border">
            <button onClick={() => setShowRaw((s) => !s)} className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-brand-text">
              <span>Raw Response Data ({parsed.responseCount} rows)</span>
              {showRaw ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {showRaw && (
              <div className="px-4 pb-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-brand-text/60 border-b border-brand-border">{parsed.rawHeaders.map((h, i) => <th key={i} className="py-2 pr-3">{h}</th>)}</tr></thead>
                  <tbody>{parsed.rawRows.map((r, i) => (<tr key={i} className="border-b border-[#F0EBDF]">{r.map((c, j) => <td key={j} className="py-2 pr-3">{c}</td>)}</tr>))}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <ReportPreview
              reportText={buildStructuredReport({ ...structuredOpts(), docRef: "preview" })}
              chartsHtml={structuredOpts().chartsHtml}
              includeOverflow={includeOverflow}
              setIncludeOverflow={setIncludeOverflow}
            />

            <div className="p-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h2>
              <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
              <p className="text-[10px] text-brand-text/60 mt-2">Word includes all data as tables (opens natively in Microsoft Word). PDF includes visual charts — your browser's print dialog opens; choose "Save as PDF."</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
