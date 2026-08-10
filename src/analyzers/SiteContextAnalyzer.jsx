import React, { useState } from "react";
import { Sparkles, Plus, Trash2, MapPin, Info, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, FileText, Printer, Search, Image as ImageIcon } from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { checklistPrompt } from "../utils/methodology";
import { friendlyError , fileToBase64Raw } from "../utils/helpers";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, tableHTML, barChartSVG } from "../utils/reportTemplate";

const BTN_DARK = { backgroundColor: "#1C2333", color: "#FFFFFF" };
const BTN_GOLD = { backgroundColor: "#C9A46A", color: "#1C2333" };

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



function extractJSON(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON object found in the AI response.");
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

const SITE_PROMPT =
  "You are a site analyst preparing a professional site context and accessibility analysis. Use only the location, description and any images supplied. " +
  "Return ONLY valid JSON, no markdown fences, with these keys: " +
  "{\"adjacencies\":[{\"direction\":\"N|NE|E|SE|S|SW|W|NW\",\"land_use\":\"\",\"demand_implication\":\"what this generates at that edge\",\"design_response\":\"the specific spatial move it calls for\"}]," +
  "\"accessibility_standards\":[{\"requirement\":\"\",\"value\":\"\",\"source\":\"the actual code/standard for THIS jurisdiction\"}]," +
  "\"hazard_screening\":[{\"hazard\":\"flood|seismic|subsidence|contamination|high water table|coastal|storm|other\",\"likelihood\":\"Documented|Possible|Unlikely|Unknown\",\"basis\":\"why - cite what is publicly documented for this region\",\"design_implication\":\"\"}]," +
  "\"quiet_and_active_zoning\":[{\"edge\":\"\",\"suggested_character\":\"quiet/green buffer OR active/high-throughput\",\"reason\":\"tie to the adjacency - e.g. a school edge needs buffering, a transit edge needs capacity\"}]," +
  "\"key_findings\":[\"\"],\"constraints\":[\"\"],\"conclusion\":\"2-3 sentences naming the single highest-priority action\"}. " +
  "For hazard_screening: this is a PRELIMINARY DESK SCREENING prompting professional assessment, not a hazard assessment - only report what is genuinely documented for the region and mark anything else Unknown. " +
  "For accessibility_standards: cite the standards that actually apply in the country/city given, never a default jurisdiction.";

export default function SiteContextAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();
  const [imageNotes, setImageNotes] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [location, setLocation] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");

  const [zones, setZones] = useState([{ id: uid(), name: "", area: "" }]);
  const [paths, setPaths] = useState([{ id: uid(), name: "", type: "path", width: "", levelChange: "" }]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");

  async function handleImageUpload(e) {
    const files = Array.from(e.target.files || []).slice(0, 4);
    if (!files.length) return;
    setImageLoading(true);
    setContextError("");
    try {
      const blocks = [];
      for (const f of files) {
        const b64 = await fileToBase64Raw(f);
        blocks.push({ type: "image", source: { type: "base64", media_type: f.type || "image/png", data: b64 } });
      }
      blocks.push({ type: "text", text: "These are site/GIS/map images for a park design project. Describe what surrounds the site on each edge - adjacent land uses, roads, buildings, transit, open space. Note anything relevant to arrival, access or noise. Write plain factual observations, no speculation." });
      const text = await callAI({ provider, apiKey, maxTokens: 2500, content: blocks });
      if (!text) throw new Error("The AI returned no description for these images.");
      setImageNotes((prev) => (prev ? prev + "\n\n" : "") + text);
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
        provider, apiKey, maxTokens: 4000, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content: SITE_PROMPT + checklistPrompt("SCX") +
          "\n\nLOCATION: " + (location || "(not stated)") +
          "\nDESCRIPTION: " + (siteDescription || "(none)") +
          (imageNotes ? "\n\nIMAGE INTERPRETATION:\n" + imageNotes : ""),
      });
      if (!resText) throw new Error("The AI returned an empty response.");
      const parsed = extractJSON(resText);
      if (!parsed) throw new Error("The AI's reply could not be read as structured data. Try again.");
      setContext(parsed);
      // Do NOT populate the insight here. Research and insight are two separate,
      // separately-consented AI steps: this call establishes the standards and
      // adjacencies, and "Generate AI Insight" interprets them. Setting both from
      // one run made the research button appear to trigger insight generation.
      // Clearing it also prevents a previous location's insight persisting.
      setInsight(null);
      setInsightError("");
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

  async function generateInsight() {
    if (!context) { setInsightError("Run 'Analyze Site Context' above first - this insight builds on that analysis."); return; }
    setInsightLoading(true); setInsight(null); setInsightError("");
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
        provider,
        apiKey: apiKey,
        maxTokens: 4000,
        prompt: prompt,
        systemInstruction: "You are an architectural strategy expert. Output valid JSON only.",
      });

      if (!resText) throw new Error("The AI returned an empty response.");
      setInsight(extractJSON(resText));
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
      (context.adjacencies || []).forEach((a) => lines.push(`  ${a.direction}: ${a.use} - ${a.implication}`));
      lines.push("", "ACCESSIBILITY STANDARDS");
      (context.accessibility_standards || []).forEach((s) => lines.push(`  ${s.label}: ${s.value} (source: ${s.source})`));
    }
    lines.push("", "ZONE CAPACITY");
    zones.filter((z) => z.name.trim()).forEach((z) => { const c = capacityRange(z.area); lines.push(`  ${z.name} (${z.area}m2): ${c.low}-${c.high} peak visitors`); });
    lines.push("", "PATH & RAMP ACCESSIBILITY CHECK");
    paths.filter((p) => p.name.trim()).forEach((p) => lines.push(`  ${p.name} (${p.type}, ${p.width}m): ${checkPath(p).label}`));
    if (insight) {
      lines.push("", "KEY FINDINGS");
      (insight.key_findings || []).forEach((f) => lines.push(`  - ${f}`));
      lines.push("", "CONSTRAINTS FOR CONCEPT GENERATOR");
      (insight.constraints || []).forEach((f) => lines.push(`  - ${f}`));
      lines.push("", "CONCLUSION", insight.conclusion || "");
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
      findings: [{ title: "Analysis output", text: buildReportText() }],
      chartNote: (zones.filter((z) => z.name.trim()).length || (insight?.adjacencies || []).length)
        ? "Adjacency map, zone capacity chart and accessibility check table are reproduced in the PDF export."
        : "No charts - add zones or run the analysis first.",
      chartsHtml:
        ((insight?.adjacencies || []).length
          ? tableHTML(["Direction", "Adjacent land use", "Demand implication", "Design response"],
              insight.adjacencies.map((a) => [a.direction, a.land_use, a.demand_implication, a.design_response]),
              "Adjacent land use by edge")
          : "") +
        ((insight?.hazard_screening || []).length
          ? tableHTML(["Hazard", "Likelihood", "Basis", "Design implication"],
              insight.hazard_screening.map((hz) => [hz.hazard, hz.likelihood, hz.basis, hz.design_implication]),
              "Preliminary hazard screening (desk study - prompts professional assessment)")
          : "") +
        ((insight?.quiet_and_active_zoning || []).length
          ? tableHTML(["Edge", "Suggested character", "Reason"],
              insight.quiet_and_active_zoning.map((q) => [q.edge, q.suggested_character, q.reason]),
              "Suggested edge character")
          : "") +
        (zones.filter((z) => z.name.trim()).length
          ? barChartSVG(zones.filter((z) => z.name.trim()).map((z) => {
              const c = capacityRange(z.area);
              return { label: z.name, value: c.high, display: `${c.low}-${c.high} people` };
            }), { title: "Indicative peak capacity by zone" })
          : ""),
      interpretation: insight?.conclusion || "",
      conclusions: [...(insight?.key_findings || []), ...(insight?.constraints || [])].filter(Boolean),
      runLimitations: [],
      extraRefs: webSources,
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

  function exportPDF() {
    withOverflow((o) => exportStructuredPDF(o, () => {
      if (typeof setError === "function") setError("Your browser blocked the new tab needed for PDF export. Allow pop-ups and try again.");
    }));
  }

  const STATUS_ICON = { pass: <CheckCircle2 size={14} className="text-[#3D7A5C]" />, review: <AlertTriangle size={14} className="text-[#B8863B]" />, pending: <XCircle size={14} className="text-[#8A8474]" /> };

  return (
    <div className="min-h-screen bg-[#F7F5F1] text-[#1C2333] font-sans">
      <ToolIntro toolCode="SCX" />

      <header style={BTN_DARK} className="px-6 py-5">
        <p className="text-xs tracking-[0.2em] uppercase" style={{ color: "#C9A46A" }}>Site Analysis Tool</p>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><MapPin size={20} style={{ color: "#C9A46A" }} /> Site Context, Urban Fabric & Accessibility</h1>
        <p className="text-sm mt-1" style={{ color: "#C9C6BE" }}>Give it your site's location, a description, or an image - it researches real adjacency and accessibility standards, then checks your zones/paths against them.</p>
      </header>

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-lg border-2 border-[#E8E2D5] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E8E2D5] bg-[#FBF7EE]"><h2 className="font-bold text-sm uppercase tracking-wide">Step 1 - Describe Your Site</h2></div>
          <div className="p-4 space-y-3">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Project location (e.g. Riverside Park, Chicago, USA)" className="w-full text-sm bg-[#F7F5F1] border-2 border-[#E8E2D5] rounded-md p-2.5 focus:border-[#C9A46A] outline-none" />
            <textarea value={siteDescription} onChange={(e) => setSiteDescription(e.target.value)} placeholder="Describe what's around the site (adjacent buildings, roads, land uses) - or upload a GIS/map image below instead" rows={4} className="w-full text-sm bg-[#F7F5F1] border-2 border-[#E8E2D5] rounded-md p-3 focus:border-[#C9A46A] outline-none resize-y" />
            <label className="text-sm font-semibold border-2 px-4 py-2.5 rounded-md flex items-center gap-2 cursor-pointer w-fit" style={{ borderColor: "#1C2333", color: "#1C2333", backgroundColor: "#fff" }}>
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
            <p className="text-[10px] text-[#8A8474]">Up to 4 images. Image upload may not work inside the Claude mobile app (platform restriction) - try your phone's regular browser, or use the text fields above.</p>
            <button onClick={analyzeSiteContext} disabled={contextLoading} style={BTN_GOLD} className="w-full text-base font-bold px-4 py-3 rounded-md flex items-center justify-center gap-2 disabled:opacity-40 shadow-md">
              <Search size={18} /> {contextLoading ? "Researching site context..." : "Analyze Site Context"}
            </button>
            {contextLoading && <p className="text-xs text-[#8A8474]">Reading your input and, if needed, searching for real local accessibility standards - this can take a moment.</p>}
            {contextError && (<div className="space-y-1"><p className="text-xs text-[#3A362C] flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-[#B84C3D]" /> {friendlyError(contextError)}</p><p className="text-[10px] text-[#8A8474] font-mono pl-4">Technical: {contextError}</p></div>)}
            {context?.note && <p className="text-xs text-[#B8863B] flex items-center gap-1"><Info size={12} /> {context.note}</p>}
          </div>
        </div>

        {context && (
          <>
            <div className="bg-white rounded-lg border border-[#E8E2D5] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E8E2D5]"><h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Adjacent Land-Use & Urban Fabric</h2></div>
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-[#8A8474] text-xs uppercase tracking-wide border-b border-[#E8E2D5]"><th className="px-4 py-2">Direction</th><th className="px-4 py-2">Adjacent Use</th><th className="px-4 py-2">Design Implication</th></tr></thead><tbody>{(context.adjacencies || []).map((a, i) => (<tr key={i} className="border-b border-[#F0EBDF]"><td className="px-4 py-2 font-medium">{a.direction}</td><td className="px-4 py-2">{a.use}</td><td className="px-4 py-2 text-[#5A5445] text-xs">{a.implication}</td></tr>))}</tbody></table></div>
            </div>

            <div className="bg-white rounded-lg border border-[#E8E2D5] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E8E2D5]"><h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Accessibility Standards (researched for this location)</h2></div>
              <div className="p-4 space-y-2">{(context.accessibility_standards || []).map((s, i) => (<div key={i} className="flex items-center justify-between text-xs border border-[#F0EBDF] rounded px-3 py-2"><span className="text-[#5A5445]">{s.label}</span><span className="font-mono font-semibold">{s.value}</span><span className="text-[9px] text-[#8A8474] italic">{s.source}</span></div>))}</div>
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
          <div className="p-4 space-y-2">
            {zones.map((z) => { const c = capacityRange(z.area); return (<div key={z.id} className="flex items-center gap-2 text-sm"><input value={z.name} onChange={(e) => updateZone(z.id, { name: e.target.value })} placeholder="Zone name" className="flex-1 bg-[#F7F5F1] border border-[#E8E2D5] rounded px-2 py-1.5 focus:border-[#C9A46A] outline-none" /><input type="number" value={z.area} onChange={(e) => updateZone(z.id, { area: e.target.value })} placeholder="Area m2" className="w-24 bg-[#F7F5F1] border border-[#E8E2D5] rounded px-2 py-1.5 font-mono focus:border-[#C9A46A] outline-none" /><span className="w-32 text-xs font-mono text-[#8A6A3A] text-right">{z.area ? `${c.low}-${c.high} visitors` : "--"}</span><button onClick={() => removeZone(z.id)} className="text-[#B8A98F] hover:text-[#B84C3D]"><Trash2 size={14} /></button></div>); })}
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
                    <span className="flex items-center gap-1 ml-auto" style={{ color: c.status === "pass" ? "#3D7A5C" : c.status === "review" ? "#B8863B" : "#8A8474" }}>{STATUS_ICON[c.status]} {c.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-lg border-2 border-[#E8E2D5] p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-[#5A5445]">Step 2 - AI Insight & Recommendation</h2>
            <button onClick={generateInsight} disabled={insightLoading} style={BTN_DARK} className="text-sm font-bold px-4 py-2.5 rounded-md flex items-center gap-2 disabled:opacity-40 shadow-md">
              <Sparkles size={15} /> {insightLoading ? "Analyzing..." : "Generate AI Insight"}
            </button>
          </div>
          {insightLoading && <p className="text-sm text-[#8A8474]">Reviewing adjacency, capacity, and accessibility data...</p>}
          {insightError && (<div className="space-y-1"><p className="text-sm text-[#3A362C] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-[#B84C3D]" /> {friendlyError(insightError)}</p><p className="text-[10px] text-[#8A8474] font-mono pl-5">Technical: {insightError}</p></div>)}
          {insight && (
            <div className="space-y-3">
              <div className="space-y-1">{(insight.key_findings || []).map((f, i) => (<p key={i} className="text-sm text-[#3A362C]">- {f}</p>))}</div>

              {insight.adjacencies?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#8A6A3A] uppercase tracking-wide mb-1">Adjacent land use by edge</p>
                  {insight.adjacencies.map((a, i) => (
                    <p key={i} className="text-xs text-[#5A5445] mb-1">
                      <span className="font-semibold">{a.direction}:</span> {a.land_use} - {a.demand_implication} <span className="text-brand-success">{a.design_response}</span>
                    </p>
                  ))}
                </div>
              )}

              {insight.quiet_and_active_zoning?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#8A6A3A] uppercase tracking-wide mb-1">Suggested edge character</p>
                  {insight.quiet_and_active_zoning.map((q, i) => (
                    <p key={i} className="text-xs text-[#5A5445]"><span className="font-semibold">{q.edge}:</span> {q.suggested_character} - {q.reason}</p>
                  ))}
                </div>
              )}

              {insight.hazard_screening?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#B84C3D] uppercase tracking-wide mb-1">Preliminary hazard screening</p>
                  <p className="text-[10px] text-[#8A8474] mb-1">Desk screening only - prompts professional assessment, it is not a hazard assessment.</p>
                  {insight.hazard_screening.map((hz, i) => (
                    <p key={i} className="text-xs text-[#5A5445]">
                      <span className="font-semibold">{hz.hazard}</span> ({hz.likelihood}): {hz.basis} - {hz.design_implication}
                    </p>
                  ))}
                </div>
              )}

              {insight.accessibility_standards?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="text-xs font-semibold text-[#8A6A3A] uppercase tracking-wide mb-1">Accessibility standards applied</p>
                  {insight.accessibility_standards.map((a, i) => (
                    <p key={i} className="text-xs text-[#5A5445]"><span className="font-semibold">{a.requirement}:</span> {a.value} <span className="text-[10px]">({a.source})</span></p>
                  ))}
                </div>
              )}

              {insight.constraints?.length > 0 && (<div className="border-t border-[#F0EBDF] pt-2"><p className="text-xs font-semibold text-[#8A6A3A] uppercase tracking-wide mb-1">Constraints to carry into Concept Generator</p>{insight.constraints.map((f, i) => (<p key={i} className="text-xs text-[#5A5445]">- {f}</p>))}</div>)}
            </div>
          )}
          {!insight && !insightLoading && !insightError && <p className="text-sm text-[#8A8474]">Analyze site context above (Step 1), fill in zones/paths, then generate a synthesis.</p>}
        </div>

        {insight?.conclusion && (<div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}><h2 className="font-bold text-sm uppercase tracking-wide text-[#8A6A3A] mb-2">Conclusion</h2><p className="text-sm text-[#3A362C] leading-relaxed font-medium">{insight.conclusion}</p></div>)}

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
