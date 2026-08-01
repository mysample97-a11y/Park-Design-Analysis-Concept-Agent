import { useState } from "react";
import { Sparkles, Leaf, Info, Mountain, AlertTriangle, ImageIcon, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import { callAI } from "../utils/ai";
import { friendlyError, extractJSON, fileToBase64 } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, generateOverflow, nextDocRef, tableHTML } from "../utils/reportTemplate";
import * as XLSX from "xlsx";

const MAX_IMAGES = 5;

const DEFAULT_PALETTE = [
  { id: "ghaf", name: "Ghaf (Prosopis cineraria)", type: "Canopy Tree", water: "Low", shade: "Full Sun", origin: "Native - UAE national tree" },
  { id: "sidr", name: "Sidr (Ziziphus spina-christi)", type: "Canopy Tree", water: "Low", shade: "Full Sun", origin: "Native" },
  { id: "samar", name: "Samar (Acacia tortilis)", type: "Canopy Tree", water: "Low", shade: "Full Sun", origin: "Native" },
  { id: "neem", name: "Neem (Azadirachta indica)", type: "Canopy Tree", water: "Medium", shade: "Full Sun", origin: "Naturalized/Ornamental" },
  { id: "datepalm", name: "Date Palm (Phoenix dactylifera)", type: "Palm", water: "Low", shade: "Full Sun", origin: "Native/Cultural" },
  { id: "dwarfpalm", name: "Dwarf Palm (Nannorrhops ritchieana)", type: "Palm", water: "Low", shade: "Full Sun", origin: "Native" },
  { id: "bougainvillea", name: "Bougainvillea", type: "Shrub/Accent", water: "Low", shade: "Full Sun", origin: "Regionally-adapted" },
  { id: "lantana", name: "Lantana", type: "Shrub", water: "Low", shade: "Full Sun", origin: "Regionally-adapted" },
  { id: "sodomsapple", name: "Sodom's Apple (Calotropis procera)", type: "Shrub", water: "Low", shade: "Full Sun", origin: "Native" },
  { id: "agave", name: "Agave / Aloe Vera", type: "Groundcover/Succulent", water: "Low", shade: "Full Sun", origin: "Regionally-adapted" },
  { id: "frangipani", name: "Frangipani", type: "Accent (use sparingly)", water: "High", shade: "Part Shade", origin: "Tropical-Ornamental" },
  { id: "strelitzia", name: "Strelitzia (Bird of Paradise)", type: "Accent (use sparingly)", water: "High", shade: "Part Shade", origin: "Tropical-Ornamental" },
];

export default function VegetationAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();
  const [location, setLocation] = useState("");
  const [PLANT_PALETTE, setPalette] = useState(DEFAULT_PALETTE);
  const [researching, setResearching] = useState(false);
  const [researchNote, setResearchNote] = useState("");
  const [researchError, setResearchError] = useState("");
  const [terrainNote, setTerrainNote] = useState("");

  async function researchPalette() {
    if (!location.trim()) { setResearchError("Enter a project location first."); return; }
    setResearching(true); setResearchError("");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 3000, useWebSearch: provider === "claude",
        content: `For the location "${location}", give a reference planting palette of 10-14 species suitable for public landscape there, prioritising native and climate-adapted species. Respond with ONLY a JSON array, no markdown fences: [{"id":"short_id","name":"Common name (Botanical name)","type":"Canopy Tree|Palm|Shrub|Groundcover|Accent","water":"Low|Medium|High","shade":"Full Sun|Part Shade|Shade","origin":"Native|Adaptive|Introduced - note"}]. Use real species that genuinely grow in that climate. Do not invent species.`,
      });
      const parsed = extractJSON(text);
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("Unexpected format");
      setPalette(parsed);
      setResearchNote(`Palette researched for: ${location}`);
    } catch (e) {
      setResearchError(e.message || "Could not research this location. The default palette remains in use.");
    } finally { setResearching(false); }
  }


  const [waterFilter, setWaterFilter] = useState("all");
  const [siteContext, setSiteContext] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState("");
  const [inventory, setInventory] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");

  const filteredPalette = PLANT_PALETTE.filter((p) => waterFilter === "all" || p.water === waterFilter);

  async function structureNotes() {
    if (!siteContext.trim()) return;
    setStructuring(true); setStructureError("");
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 1000,
        content: "Extract a structured inventory of EXISTING vegetation from these landscape architect site-visit notes/photo descriptions - only plants that are CURRENTLY on site right now, not suggestions for the future. For each distinct plant/tree mentioned, output: name, estimated_count (number or 'several'/'unclear'), condition (Healthy/Fair/Poor/Unclear), recommendation (Retain/Remove/Relocate/Assess further), notes (brief). If no existing vegetation is described (e.g. the text is only a general site description with no plants mentioned), return an empty array. Respond with ONLY a valid JSON array, no markdown, no prose.\n\nNOTES:\n" + siteContext,
      });
      const start = text.indexOf("["); const end = text.lastIndexOf("]");
      if (start === -1 || end === -1) throw new Error("Could not find a JSON list in the AI's response.");
      setInventory(JSON.parse(text.slice(start, end + 1)));
    } catch (e) {
      setStructureError(e.message || "Could not structure the notes. Try again.");
    } finally {
      setStructuring(false);
    }
  }

  async function handleImageUpload(e) {
    const files = Array.from(e.target.files || []).slice(0, MAX_IMAGES);
    if (files.length === 0) return;
    if (e.target.files.length > MAX_IMAGES) {
      setImageError(`Only the first ${MAX_IMAGES} images were used (limit is ${MAX_IMAGES} per upload, to keep this usable on a free Claude account).`);
    } else {
      setImageError("");
    }
    setImageLoading(true);
    try {
      const contentBlocks = [];
      for (const file of files) {
        const base64 = await fileToBase64(file);
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: file.type || "image/png", data: base64 } });
      }
      contentBlocks.push({ type: "text", text: "These are site-visit photos from a park redesign project. Describe what vegetation/trees/plants are visible across all photos - species if identifiable, apparent condition, approximate count per photo. Write this as plain field notes (a few sentences per photo), the way a landscape architect would jot down observations. Do not describe anything other than vegetation." });
      const text = await callAI({
        provider, apiKey, maxTokens: 3000,
        content: contentBlocks,
      });
      if (!text) throw new Error("empty description");
      setSiteContext((prev) => (prev ? prev + "\n\n" : "") + text);
    } catch (err) {
      setImageError((imageError ? imageError + " " : "") + friendlyError(err.message) + " (Technical: " + err.message + ")");
    } finally {
      setImageLoading(false);
      e.target.value = "";
    }
  }

  async function generateInsight() {
    setInsightLoading(true); setInsight(null); setInsightError("");
    const summary = {
      site: location || meta?.siteDescription || meta?.projectName || "(location not stated)",
      terrain_reference: terrainNote || "No survey-grade terrain data supplied. Terrain characteristics should be confirmed against site survey before reliance.",
      soil_reference: "No public dataset available for this site - unverified assumption until geotechnical data is sourced.",
      user_provided_site_context: siteContext || "None provided.",
      existing_vegetation_inventory: inventory || "Not structured yet.",
      general_reference_palette: PLANT_PALETTE.map((p) => ({ name: p.name, water: p.water, shade: p.shade, origin: p.origin })),
    };
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 1500,
        content: "You are a landscape architecture assistant giving planting and site-condition guidance for a park design at the stated location. The 'general_reference_palette' is a reference list of species appropriate to that region - it is NOT specific to this site yet; your job is to reason about which of these actually fit THIS site given the terrain/soil reference and any user-provided site context or existing inventory. Do not invent species outside the reference list, and do not invent terrain/soil facts beyond what's given. Provide: " +
          "(1) 'terrain_soil_note': 1-2 sentences on what the terrain/soil data means for planting choices and what to verify once real data arrives, " +
          "(2) 'inventory_guidance': 1-2 sentences on how any existing inventory should inform retain/remove decisions (or note if none was provided), " +
          "(3) 'suggested_species': an array of 3-5 objects {name, reason} - species FROM THE REFERENCE PALETTE ONLY, each with a one-line reason tied to this site's actual conditions, " +
          "(4) 'conclusion': 2-3 sentences giving the single clearest planting/terrain/soil action to take next. " +
          "Respond with ONLY valid JSON, no markdown fences: {\"terrain_soil_note\": \"\", \"inventory_guidance\": \"\", \"suggested_species\": [{\"name\": \"\", \"reason\": \"\"}], \"conclusion\": \"\"}\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });
      setInsight(extractJSON(text));
    } catch (e) {
      setInsightError(e.message || "Something went wrong generating the insight. Try again.");
    } finally {
      setInsightLoading(false);
    }
  }

  function buildReportText() {
    let lines = ["VEGETATION, TERRAIN & SOIL ANALYSIS", `Location: ${location || meta?.siteDescription || "(not stated)"}`, "", "TERRAIN: " + (terrainNote || "No survey data supplied - confirm against site survey."), "SOIL: No dataset supplied - unverified until geotechnical data is sourced.", "", "GENERAL REFERENCE PALETTE (regional, not yet site-specific)"];
    PLANT_PALETTE.forEach((p) => lines.push(`  ${p.name} - ${p.type}, water: ${p.water}, shade: ${p.shade}, origin: ${p.origin}`));
    if (inventory && inventory.length) { lines.push("", "EXISTING VEGETATION INVENTORY"); inventory.forEach((v) => lines.push(`  ${v.name} - count: ${v.estimated_count}, condition: ${v.condition} -> ${v.recommendation}. ${v.notes}`)); }
    if (insight) {
      lines.push("", "TERRAIN/SOIL NOTE", insight.terrain_soil_note || "");
      lines.push("", "INVENTORY GUIDANCE", insight.inventory_guidance || "");
      lines.push("", "SITE-SPECIFIC SUGGESTED SPECIES");
      (insight.suggested_species || []).forEach((s) => lines.push(`  ${s.name}: ${s.reason}`));
      lines.push("", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  function structuredOpts() {
    return {
      toolCode: "VEG",
      meta,
      inputRecord: [{label:"Location",value:(typeof location!=="undefined"&&location)||"(not stated)"}],
      findings: [{ title: "Analysis output", text: buildReportText() }],
      chartNote: "Reference planting palette is reproduced in the PDF export.",
      chartsHtml: tableHTML(["Species", "Type", "Water", "Shade", "Origin"],
          PLANT_PALETTE.map((p) => [p.name, p.type, p.water, p.shade, p.origin]), "Reference planting palette"),
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.recommendations || []).map((r)=>typeof r==="string"?r:(r.recommendation||"")),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (!overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "VEG",
        reportText: buildReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Species", "Type", "Water", "Shade", "Origin"], ...PLANT_PALETTE.map((p) => [p.name, p.type, p.water, p.shade, p.origin])]), "Reference Palette");
    if (inventory && inventory.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Species", "Count", "Condition", "Recommendation", "Notes"], ...inventory.map((v) => [v.name, v.estimated_count, v.condition, v.recommendation, v.notes])]), "Existing Inventory");
    if (insight) {
      const rows = [["Terrain/Soil Note", insight.terrain_soil_note], ["Inventory Guidance", insight.inventory_guidance], []];
      rows.push(["Suggested Species", "Reason"]);
      (insight.suggested_species || []).forEach((s) => rows.push([s.name, s.reason]));
      rows.push([]); rows.push(["Conclusion", insight.conclusion]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "AI Insight");
    }
    const blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "al-safa-2-vegetation-terrain-soil.xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportWord() { withOverflow((o) => exportStructuredWord(o)); }

  function exportPDF() {
    withOverflow((o) => exportStructuredPDF(o, () => {
      if (typeof setError === "function") setError("Your browser blocked the new tab needed for PDF export. Allow pop-ups and try again.");
    }));
  }

  return (
    <div className="space-y-6">
      <ToolIntro toolCode="VEG" />

      <div className="card">
        <div className="card-header">Project Location - Planting Palette</div>
        <div className="p-4 space-y-2">
          <input value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Al Safa 2 Park, Jumeirah, Dubai"
            className="input" />
          <button onClick={researchPalette} disabled={researching || !apiKey} className="btn-gold w-full">
            {researching ? "Researching..." : "Research Planting Palette for This Location"}
          </button>
          <p className="text-[10px] text-brand-text/60">
            Optional. Without this, the built-in reference data below is used - which was compiled for a hot-arid
            Gulf climate and may not suit other regions. Researching replaces it with data for your location.
          </p>
          {researchNote && <p className="text-xs text-brand-success">{researchNote}</p>}
          {researchError && <p className="text-xs text-brand-danger">{friendlyError(researchError)}</p>}
        </div>
      </div>
      <div className="card">
        <div className="card-header">
          <div>Step 1 — Give This Tool Site Context</div>
          <div className="text-[10px] text-brand-text/60 font-normal normal-case tracking-normal mt-0.5">Type field notes, paste a description, or upload site-visit photos directly - up to {MAX_IMAGES} at once.</div>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            value={siteContext}
            onChange={(e) => setSiteContext(e.target.value)}
            placeholder="e.g. Several mature date palms along west boundary, appear healthy. Ghaf tree near central plaza, large canopy, good condition. Site is exposed to full sun most of the day, no existing shade structures..."
            rows={6}
            className="textarea"
          />
          <label className="text-sm font-semibold border-2 px-4 py-2.5 rounded-md flex items-center gap-2 cursor-pointer w-fit" style={{ borderColor: "#1C2333", color: "#1C2333", backgroundColor: "#fff", opacity: imageLoading ? 0.4 : 1, pointerEvents: imageLoading ? "none" : "auto" }}>
            <ImageIcon size={15} /> {imageLoading ? "Reading photos..." : `Upload Site Photos (up to ${MAX_IMAGES})`}
            <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="sr-only" />
          </label>
          <p className="text-[10px] text-brand-text/60">Photo upload may not work inside the Claude mobile app (a platform restriction). Try your phone's regular browser instead, or type/paste notes above.</p>
          {imageError && <p className="text-xs text-brand-danger flex items-center gap-1"><AlertTriangle size={12} /> {imageError}</p>}

          <div className="pt-2 border-t border-[#F0EBDF]">
            <button onClick={structureNotes} disabled={!siteContext.trim() || structuring || !apiKey} className="btn-gold text-sm px-4 py-2.5">
              <Sparkles size={15} /> {structuring ? "Structuring..." : "Structure Existing Vegetation (optional)"}
            </button>
            <p className="text-[10px] text-brand-text/60 mt-1">Only needed if your notes describe plants already on site and you want a clean retain/remove table. Skip this if you're only giving general site context - the "Generate AI Insight" button below will still use your notes either way.</p>
          </div>
          {structureError && <p className="text-xs text-brand-danger flex items-center gap-1"><AlertTriangle size={12} /> {structureError}</p>}
          {inventory && inventory.length > 0 && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-brand-text/60 border-b border-brand-border"><th className="py-2 pr-3">Species</th><th className="py-2 pr-3">Count</th><th className="py-2 pr-3">Condition</th><th className="py-2 pr-3">Recommendation</th><th className="py-2">Notes</th></tr></thead>
                <tbody>{inventory.map((v, i) => (<tr key={i} className="border-b border-[#F0EBDF]"><td className="py-2 pr-3 font-medium">{v.name}</td><td className="py-2 pr-3">{v.estimated_count}</td><td className="py-2 pr-3">{v.condition}</td><td className="py-2 pr-3 font-medium">{v.recommendation}</td><td className="py-2 text-brand-text/60">{v.notes}</td></tr>))}</tbody>
              </table>
            </div>
          )}
          {inventory && inventory.length === 0 && <p className="text-xs text-brand-text/60">No existing vegetation was described in your notes - that's fine if this is general site context rather than a plant inventory.</p>}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-brand-border p-4 flex gap-3">
        <Mountain size={18} className="text-[#8A6A3A] shrink-0 mt-0.5" />
        <div className="text-sm text-brand-text">
          <p><span className="font-semibold">Terrain:</span> ~2m above sea level. Dubai coastal terrain is flat (0-10m citywide) - significant natural slope unlikely, pending real DWG confirmation.</p>
          <p className="mt-1"><span className="font-semibold">Soil:</span> No public dataset found - unverified assumption until geotechnical data is sourced.</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-brand-border overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">General Reference Palette</h2>
            <p className="text-[10px] text-brand-text/60 mt-0.5">A pre-compiled Dubai-appropriate species list, NOT yet matched to this specific site - that matching happens in the AI Insight below.</p>
          </div>
          <select value={waterFilter} onChange={(e) => setWaterFilter(e.target.value)} className="text-xs bg-[#F7F5F1] border border-brand-border rounded px-2 py-1"><option value="all">All water needs</option><option value="Low">Low water only</option><option value="Medium">Medium water</option><option value="High">High water (flagged)</option></select>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-brand-text/60 text-xs uppercase tracking-wide border-b border-brand-border"><th className="px-4 py-2">Species</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Water</th><th className="px-4 py-2">Shade</th><th className="px-4 py-2">Origin</th></tr></thead><tbody>{filteredPalette.map((p) => (<tr key={p.id} className="border-b border-[#F0EBDF]"><td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2 text-xs">{p.type}</td><td className="px-4 py-2 text-xs font-mono">{p.water}</td><td className="px-4 py-2 text-xs">{p.shade}</td><td className="px-4 py-2 text-xs">{p.origin}</td></tr>))}</tbody></table></div>
      </div>

      <div className="card border-2">
        <div className="p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div>
              <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">Step 2 — AI Insight & Recommendation</h2>
              <p className="text-[10px] text-brand-text/60">Uses your site context + terrain/soil data + reference palette to suggest what actually fits this site.</p>
            </div>
            <button onClick={generateInsight} disabled={insightLoading || !apiKey} className="btn-dark">
              <Sparkles size={15} /> {insightLoading ? "Analyzing..." : "Generate AI Insight"}
            </button>
          </div>
          {insightLoading && <p className="text-sm text-brand-text/60">Reviewing site context, inventory, and reference palette...</p>}
          {insightError && (<div className="space-y-1"><p className="text-sm text-[#3A362C] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(insightError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {insightError}</p></div>)}
          {insight && (
            <div className="space-y-3 text-sm text-[#3A362C]">
              {insight.terrain_soil_note && <p><span className="font-semibold">Terrain/Soil:</span> {insight.terrain_soil_note}</p>}
              {insight.inventory_guidance && <p><span className="font-semibold">Existing Vegetation:</span> {insight.inventory_guidance}</p>}
              {insight.suggested_species?.length > 0 && (
                <div className="border-t border-[#F0EBDF] pt-2">
                  <p className="font-semibold text-[#8A6A3A] uppercase text-xs tracking-wide mb-1">Site-Specific Suggested Species</p>
                  {insight.suggested_species.map((s, i) => (<p key={i} className="text-xs">- <span className="font-semibold">{s.name}</span>: {s.reason}</p>))}
                </div>
              )}
            </div>
          )}
          {!insight && !insightLoading && !insightError && <p className="text-sm text-brand-text/60">Give this tool site context above (Step 1), then generate a site-reasoned planting recommendation.</p>}
        </div>
      </div>

      {insight?.conclusion && (
        <div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}>
          <h2 className="font-bold text-sm uppercase tracking-wide text-[#8A6A3A] mb-2">Conclusion</h2>
          <p className="text-sm text-[#3A362C] leading-relaxed font-medium">{insight.conclusion}</p>
        </div>
      )}

      <div className="card">
        <div className="p-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h2>
          <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
        </div>
      </div>
    </div>
  );
}
