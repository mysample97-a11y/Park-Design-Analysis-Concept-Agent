import { useState } from "react";
import { Sparkles, AlertTriangle, Layers } from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { useAppContext } from "../App";
import { extractJSON, friendlyError, buildRTF, downloadFile, printHTML } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";

const POSITIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "Center"];
const GRID_ORDER = ["NW", "N", "NE", "W", "Center", "E", "SW", "S", "SE"];
const SCORE_CRITERIA = [
  { id: "innovation", label: "Innovation & Creativity" },
  { id: "human_centered", label: "Human-Centered & Sustainability" },
  { id: "design_ux", label: "Design Quality & UX" },
  { id: "feasibility", label: "Feasibility & Implementation" },
];
const COLORS = ["#1C2333", "#C9A46A", "#3D7A5C", "#B8863B", "#8A6A3A"];

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
  const { provider, apiKey } = useAppContext();
  const [brief, setBrief] = useState("");
  const [numConcepts, setNumConcepts] = useState(3);
  const [concepts, setConcepts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recommendation, setRecommendation] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState("");

  async function generateConcepts() {
    if (!brief.trim()) { setError("Paste your site analysis findings and program requirements above first."); return; }
    setLoading(true); setError(""); setConcepts(null); setRecommendation(null);
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 4000,
        content:
          `You are a landscape architecture concept-design assistant. Given the site analysis findings and program brief below, generate ${numConcepts} DISTINCT zoning concept variants for a park redesign. Each concept should meaningfully differ in spatial organization, not just wording. ` +
          "For each concept output: 'name' (short, evocative), 'vision' (1-2 sentence design narrative), 'zones' (array of {name, category, area_pct (number, all zones sum to ~100), position (one of exactly: N, NE, E, SE, S, SW, W, NW, Center), rationale (1 sentence tying placement to a SPECIFIC finding from the brief - cite the actual data point)}), and 'scores' (object with keys innovation, human_centered, design_ux, feasibility, each 1-10 as your honest judgment). " +
          "Every zone rationale MUST reference something specific from the brief - no generic rationale. " +
          `Respond with ONLY a valid JSON array of ${numConcepts} concept objects, no markdown fences.\n\nSITE ANALYSIS & PROGRAM BRIEF:\n${brief}`,
      });
      const parsed = extractJSON(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a list of concepts but got something else. Try again.");
      setConcepts(parsed);
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
      const summary = concepts.map((c) => ({ name: c.name, vision: c.vision, scores: c.scores, overall: overallScore(c) }));
      const text = await callAI({
        provider, apiKey, maxTokens: 800,
        content: "Given these scored park design concepts, write a 'recommendation' field (2-3 sentences, cite specific scores) on which to move forward with, and a 'tradeoffs' field (1 sentence) on what's given up by not choosing a runner-up. Respond with ONLY valid JSON, no markdown fences: {\"recommendation\": \"\", \"tradeoffs\": \"\"}\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });
      setRecommendation(extractJSON(text));
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
    });
    if (recommendation) lines.push("RECOMMENDATION", recommendation.recommendation || "", "", "TRADEOFFS", recommendation.tradeoffs || "");
    return lines.join("\n");
  }

  function exportExcel() {
    if (!concepts) return;
    const wb = XLSX.utils.book_new();
    const summaryRows = [["Concept", ...SCORE_CRITERIA.map((s) => s.label), "Overall"]];
    concepts.forEach((c) => summaryRows.push([c.name, ...SCORE_CRITERIA.map((s) => c.scores?.[s.id] ?? ""), overallScore(c)]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Comparison");
    concepts.forEach((c, i) => {
      const rows = [["Zone", "Category", "Area %", "Position", "Rationale"]];
      (c.zones || []).forEach((z) => rows.push([z.name, z.category, z.area_pct, z.position, z.rationale]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Concept ${i + 1}`.slice(0, 28));
    });
    if (recommendation) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Recommendation", recommendation.recommendation], ["Tradeoffs", recommendation.tradeoffs]]), "Recommendation");
    downloadFile(XLSX.write(wb, { bookType: "xlsx", type: "array" }), "concept-generator-output.xlsx", "application/octet-stream");
  }
  function exportWord() { downloadFile(buildRTF(buildReportText()), "concept-generator-output.rtf", "application/rtf"); }
  function exportPDF() {
    if (!concepts) return;
    const html = `<html><head><title>Concept Generator Output</title><style>body{font-family:Arial;padding:30px;color:#1C2333;}h1{color:#1C2333;}h2{color:#5A5445;border-bottom:1px solid #E8E2D5;}table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:16px;}td,th{border:1px solid #ddd;padding:4px;}.note{background:#FBEAE7;border:1px solid #F0C8C0;padding:10px;border-radius:6px;font-size:12px;margin-bottom:20px;}.rec{background:#FBF1E1;border:1px solid #E8D5B0;padding:14px;border-radius:6px;margin-top:16px;}</style></head><body>
    <h1>Concept Generator Output - MVP/Prototype</h1>
    <div class="note"><b>Note:</b> AI-generated MVP prototype output, not a construction-grade deliverable. Zone placement is schematically reasoned by AI from the brief, not from precise survey geometry.</div>
    <h2>Concept Comparison</h2><table><tr><th>Concept</th>${SCORE_CRITERIA.map((s) => `<th>${s.label}</th>`).join("")}<th>Overall</th></tr>${(concepts || []).map((c) => `<tr><td>${c.name}</td>${SCORE_CRITERIA.map((s) => `<td>${c.scores?.[s.id] ?? ""}</td>`).join("")}<td><b>${overallScore(c)}</b></td></tr>`).join("")}</table>
    ${(concepts || []).map((c) => `<h2>${c.name}</h2><p><i>${c.vision}</i></p><table><tr><th>Zone</th><th>Position</th><th>Area %</th><th>Rationale</th></tr>${(c.zones || []).map((z) => `<tr><td>${z.name}</td><td>${z.position}</td><td>${z.area_pct}%</td><td>${z.rationale}</td></tr>`).join("")}</table>`).join("")}
    ${recommendation ? `<div class="rec"><b>Recommendation:</b> ${recommendation.recommendation}<br/><b>Tradeoffs:</b> ${recommendation.tradeoffs}</div>` : ""}
    </body></html>`;
    printHTML(html, () => setError("Your browser blocked the new tab needed for PDF export. Allow pop-ups and try again."));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-brand-dark flex items-center gap-2"><Layers size={20} className="text-brand-gold" /> Concept Generator</h2>
        <p className="text-sm text-brand-text mt-1">Paste your site findings and program brief - get 3-4 distinct, scored zoning concepts with schematic bubble diagrams.</p>
      </div>

      <div className="bg-brand-warm border border-brand-border rounded-lg p-4 flex gap-3">
        <AlertTriangle size={18} className="text-brand-danger shrink-0 mt-0.5" />
        <p className="text-sm text-brand-text"><span className="font-semibold">MVP/Prototype tool.</span> Bubble diagrams are AI-reasoned schematic placements from your text brief, not precise survey geometry - the level architects use at concept stage, built here to demonstrate AI-integrated workflow.</p>
      </div>

      <div className="card">
        <div className="card-header">Step 1 - Site Findings & Program Brief</div>
        <div className="p-4 space-y-3">
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Paste your key site analysis findings (adjacencies, sun/wind exposure, survey themes, accessibility constraints) and the required program/facility list here..." rows={9} className="textarea" />
          <div className="flex items-center gap-3">
            <label className="text-sm text-brand-text">Number of concepts:</label>
            <select value={numConcepts} onChange={(e) => setNumConcepts(Number(e.target.value))} className="text-sm bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5"><option value={3}>3</option><option value={4}>4</option></select>
          </div>
          <button onClick={generateConcepts} disabled={loading || !apiKey} className="btn-gold w-full"><Sparkles size={18} /> {loading ? "Generating concepts..." : "Generate Concepts"}</button>
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
              <BubbleDiagram zones={c.zones || []} />
              <div className="space-y-1">{(c.zones || []).map((z, zi) => (<p key={zi} className="text-xs text-brand-dark"><span className="font-semibold">{z.name}</span> ({z.position}, ~{z.area_pct}%): {z.rationale}</p>))}</div>
            </div>
          ))}

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text">Recommendation</h3>
              <button onClick={generateRecommendation} disabled={recLoading || !apiKey} className="btn-dark"><Sparkles size={15} /> {recLoading ? "Analyzing..." : "Recommend Best Concept"}</button>
            </div>
            {recLoading && <p className="text-sm text-brand-text">Comparing concept scores...</p>}
            {recError && (<div className="space-y-1"><p className="text-sm text-brand-dark flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(recError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {recError}</p></div>)}
            {recommendation && (<div className="space-y-2 text-sm text-brand-dark"><p><span className="font-semibold">Recommendation:</span> {recommendation.recommendation}</p><p><span className="font-semibold">Tradeoffs:</span> {recommendation.tradeoffs}</p></div>)}
            {!recommendation && !recLoading && !recError && <p className="text-sm text-brand-text">Once concepts are generated, get an AI recommendation on which to move forward with.</p>}
          </div>

          <div className="card p-4">
            <h3 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h3>
            <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
          </div>
        </>
      )}
    </div>
  );
}
