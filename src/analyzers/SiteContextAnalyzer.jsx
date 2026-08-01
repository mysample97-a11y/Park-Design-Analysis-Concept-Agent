import React, { useState } from "react";
import { Sparkles, Plus, Trash2, MapPin, Info, CheckCircle2, AlertTriangle, XCircle, FileSpreadsheet, FileText, Printer, Search, Image as ImageIcon } from "lucide-react";
import * as XLSX from "xlsx";
import { callAI } from "../utils/ai";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import { exportStructuredWord, exportStructuredPDF, generateOverflow, nextDocRef } from "../utils/reportTemplate";

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

function friendlyError(rawMessage) {
  const msg = (rawMessage || "").toLowerCase();
  if (msg.includes("json") || msg.includes("expected") || msg.includes("unexpected token")) return "The AI's answer got cut off before it finished. Try again - it often succeeds on retry.";
  if (msg.includes("api returned") || msg.includes("status")) return "The AI service didn't respond successfully - likely a temporary connection hiccup. Wait a few seconds and try again.";
  if (msg.includes("empty response")) return "The AI didn't send back any content that time. Try again.";
  return "Something unexpected happened. Try again - if it keeps failing, note the technical detail below and flag it to Jarvis.";
}

function extractJSON(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) throw new Error("No JSON object found in the AI response.");
  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

export default function SiteContextAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();
  const [location, setLocation] = useState("");
  const [siteDescription, setSiteDescription] = useState("");
  const [siteImage, setSiteImage] = useState(null);
  const [imagePreviewName, setImagePreviewName] = useState("");
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState("");

  const [zones, setZones] = useState([{ id: uid(), name: "", area: "" }]);
  const [paths, setPaths] = useState([{ id: uid(), name: "", type: "path", width: "", levelChange: "" }]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");

  async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    setSiteImage({ base64, mediaType: file.type || "image/png" });
    setImagePreviewName(file.name);
    e.target.value = "";
  }

  async function analyzeSiteContext() {
    if (!location.trim() && !siteDescription.trim() && !siteImage) {
      setContextError("Give this tool at least a location, a description, or a site image to analyze.");
      return;
    }
    setContextLoading(true); setContextError(""); setContext(null);

    const systemPrompt = `You are a landscape architecture site-analysis assistant. Given the information about a park/public-space project site, produce:
(1) 'adjacencies': an array of {direction, use, implication} objects describing what's around the site and the design implication of each,
(2) 'accessibility_standards': an array of {label, value, min_width_m (number), source} objects giving the real, current accessibility standards that apply in this project's jurisdiction.
Only use information given or verifiable context. If jurisdiction is unclear, state it in a 'note' field and use widely-recognized international guidance as fallback.
Respond with ONLY valid JSON, no markdown fences: {"adjacencies": [{"direction":"","use":"","implication":""}], "accessibility_standards": [{"label":"","value":"","min_width_m":0,"source":""}], "note": ""}`;

    const userPrompt = `LOCATION: ${location || "Not specified"}\nSITE DESCRIPTION: ${siteDescription || "Not specified"}`;

    try {
      
      const resText = await callAI({
        provider,
        apiKey: apiKey,
        maxTokens: 4000,
        prompt: userPrompt,
        systemInstruction: systemPrompt,
        imageData: siteImage?.base64 ? `data:${siteImage.mediaType};base64,${siteImage.base64}` : null
      });

      if (!resText) throw new Error("The AI returned an empty response.");
      setContext(extractJSON(resText));
    } catch (e) {
      setContextError(e.message || "Something went wrong analyzing the site. Try again.");
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
      lines.push("", "AI FINDINGS");
      (insight.findings || []).forEach((f) => lines.push(`  - ${f}`));
      lines.push("", "CONSTRAINTS FOR CONCEPT GENERATOR");
      (insight.forward_constraints || []).forEach((f) => lines.push(`  - ${f}`));
      lines.push("", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  function structuredOpts() {
    return {
      toolCode: "SCX",
      meta,
      inputRecord: [{label:"Location",value:location||"(not stated)"},{label:"Description",value:(siteDescription||"(none)").slice(0,400)}],
      findings: [{ title: "Analysis output", text: buildReportText() }],
      chartNote: "Charts generated by this tool are included in the PDF export.",
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.recommendations || []).map((r)=>typeof r==="string"?r:(r.recommendation||"")),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (!overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "SCX",
        reportText: buildReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    if (context) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Direction", "Adjacent Use", "Implication"], ...(context.adjacencies || []).map((a) => [a.direction, a.use, a.implication])]), "Adjacency");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Standard", "Value", "Source"], ...(context.accessibility_standards || []).map((s) => [s.label, s.value, s.source])]), "Access Standards");
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Zone", "Area m2", "Low Capacity", "High Capacity"], ...zones.filter((z) => z.name.trim()).map((z) => { const c = capacityRange(z.area); return [z.name, z.area, c.low, c.high]; })]), "Zone Capacity");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Path", "Type", "Width m", "Level Change m", "Check"], ...paths.filter((p) => p.name.trim()).map((p) => [p.name, p.type, p.width, p.levelChange, checkPath(p).label])]), "Path Accessibility");
    if (insight) {
      const rows = [["Findings"]];
      (insight.findings || []).forEach((f) => rows.push([f]));
      rows.push([]); rows.push(["Forward Constraints"]);
      (insight.forward_constraints || []).forEach((f) => rows.push([f]));
      rows.push([]); rows.push(["Conclusion", insight.conclusion]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "AI Insight");
    }
    downloadBlob(XLSX.write(wb, { bookType: "xlsx", type: "array" }), "site-context-analysis.xlsx", "application/octet-stream");
  }

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
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Project location (e.g. Al Safa 2 Park, Jumeirah, Dubai)" className="w-full text-sm bg-[#F7F5F1] border-2 border-[#E8E2D5] rounded-md p-2.5 focus:border-[#C9A46A] outline-none" />
            <textarea value={siteDescription} onChange={(e) => setSiteDescription(e.target.value)} placeholder="Describe what's around the site (adjacent buildings, roads, land uses) - or upload a GIS/map image below instead" rows={4} className="w-full text-sm bg-[#F7F5F1] border-2 border-[#E8E2D5] rounded-md p-3 focus:border-[#C9A46A] outline-none resize-y" />
            <label className="text-sm font-semibold border-2 px-4 py-2.5 rounded-md flex items-center gap-2 cursor-pointer w-fit" style={{ borderColor: "#1C2333", color: "#1C2333", backgroundColor: "#fff" }}>
              <ImageIcon size={15} /> {imagePreviewName || "Upload Site/GIS Map Image (optional)"}
              <input type="file" accept="image/*" onChange={handleImageUpload} className="sr-only" />
            </label>
            <p className="text-[10px] text-[#8A8474]">Image upload may not work inside the Claude mobile app (platform restriction) - try your phone's regular browser, or use the text fields above.</p>
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
              <div className="space-y-1">{(insight.findings || []).map((f, i) => (<p key={i} className="text-sm text-[#3A362C]">- {f}</p>))}</div>
              {insight.forward_constraints?.length > 0 && (<div className="border-t border-[#F0EBDF] pt-2"><p className="text-xs font-semibold text-[#8A6A3A] uppercase tracking-wide mb-1">Constraints to carry into Concept Generator</p>{insight.forward_constraints.map((f, i) => (<p key={i} className="text-xs text-[#5A5445]">- {f}</p>))}</div>)}
            </div>
          )}
          {!insight && !insightLoading && !insightError && <p className="text-sm text-[#8A8474]">Analyze site context above (Step 1), fill in zones/paths, then generate a synthesis.</p>}
        </div>

        {insight?.conclusion && (<div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}><h2 className="font-bold text-sm uppercase tracking-wide text-[#8A6A3A] mb-2">Conclusion</h2><p className="text-sm text-[#3A362C] leading-relaxed font-medium">{insight.conclusion}</p></div>)}

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
