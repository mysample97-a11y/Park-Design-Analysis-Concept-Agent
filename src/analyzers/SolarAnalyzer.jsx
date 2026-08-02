import { useState } from "react";
import { Sparkles, Plus, Trash2, Sun, Info, AlertTriangle, Search } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import ReportPreview from "../components/ReportPreview";
import { callAI } from "../utils/ai";
import { uid, friendlyError, extractJSON } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, generateOverflow, nextDocRef, buildStructuredReport, barChartSVG, tableHTML } from "../utils/reportTemplate";
import * as XLSX from "xlsx";

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const DATE_PRESETS = [
  { id: "summer", label: "Summer Solstice (Jun 21)", month: 5, day: 21 },
  { id: "winter", label: "Winter Solstice (Dec 21)", month: 11, day: 21 },
  { id: "equinox", label: "Equinox (Mar 21)", month: 2, day: 21 },
];

function toRad(d) { return (d * Math.PI) / 180; }
function toDeg(r) { return (r * 180) / Math.PI; }

function solarPosition(dateObj, hourDecimal, lat, lon, utcOffset) {
  const start = new Date(dateObj.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((dateObj - start) / (1000 * 60 * 60 * 24));
  const utcHour = hourDecimal - utcOffset;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHour - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const timeOffset = eqTime + 4 * lon - 60 * utcOffset;
  const trueSolarTime = hourDecimal * 60 + timeOffset;
  let hourAngleDeg = trueSolarTime / 4 - 180;
  const hourAngle = toRad(hourAngleDeg);
  const latRad = toRad(lat);
  const cosZenith = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const elevation = 90 - toDeg(zenith);
  let cosAz = (Math.sin(decl) - Math.sin(latRad) * Math.cos(zenith)) / (Math.cos(latRad) * Math.sin(zenith));
  cosAz = Math.min(1, Math.max(-1, cosAz));
  let azimuth = toDeg(Math.acos(cosAz));
  if (hourAngleDeg > 0) azimuth = 360 - azimuth;
  return { elevation, azimuth };
}

function azimuthToCompass(az) { return DIRECTIONS[Math.round(az / 45) % 8]; }
function heatTier(elevation) {
  if (elevation >= 55) return { label: "High", color: "#B84C3D" };
  if (elevation >= 25) return { label: "Medium", color: "#B8863B" };
  return { label: "Low", color: "#3D7A5C" };
}

function buildDayData(month, day, lat, lon, utcOffset) {
  const year = new Date().getFullYear();
  const date = new Date(year, month, day);
  const rows = [];
  for (let h = 5; h <= 19.5; h += 0.5) {
    const { elevation, azimuth } = solarPosition(date, h, lat, lon, utcOffset);
    if (elevation > 0) {
      const hh = Math.floor(h); const mm = h % 1 === 0 ? "00" : "30";
      rows.push({ hourLabel: `${String(hh).padStart(2, "0")}:${mm}`, elevation: Math.round(elevation * 10) / 10, azimuth: Math.round(azimuth * 10) / 10, compass: azimuthToCompass(azimuth), tier: heatTier(elevation) });
    }
  }
  return rows;
}

export default function SolarAnalyzer() {
  const { provider, apiKey, meta } = useAppContext();
  const [location, setLocation] = useState("");
  const [siteInfo, setSiteInfo] = useState(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteError, setSiteError] = useState("");
  const [preset, setPreset] = useState("summer");
  const [zones, setZones] = useState([{ id: uid(), name: "", shaded: [] }]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");

  const activePreset = DATE_PRESETS.find((p) => p.id === preset);
  const dayData = siteInfo ? buildDayData(activePreset.month, activePreset.day, siteInfo.lat, siteInfo.lon, siteInfo.utc_offset) : [];

  async function resolveLocation() {
    if (!location.trim()) { setSiteError("Enter a project location first."); return; }
    setSiteLoading(true); setSiteError(""); setSiteInfo(null);
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 500, useWebSearch: provider === "claude",
        content: `Find the approximate latitude, longitude, and UTC timezone offset (as a number, e.g. 4 for UTC+4) for this location: "${location}". Respond with ONLY valid JSON, no markdown fences: {"lat": 0, "lon": 0, "utc_offset": 0, "resolved_name": "", "source": "how you determined this"}`,
      });
      setSiteInfo(extractJSON(text));
    } catch (e) { setSiteError(e.message || "Could not resolve this location."); }
    finally { setSiteLoading(false); }
  }

  function addZone() { setZones([...zones, { id: uid(), name: "", shaded: [] }]); }
  function updateZone(id, patch) { setZones(zones.map((z) => (z.id === id ? { ...z, ...patch } : z))); }
  function removeZone(id) { setZones(zones.filter((z) => z.id !== id)); }
  function toggleShaded(id, dir) {
    const z = zones.find((zz) => zz.id === id);
    const has = z.shaded.includes(dir);
    updateZone(id, { shaded: has ? z.shaded.filter((d) => d !== dir) : [...z.shaded, dir] });
  }
  function exposedHours(zone) { return dayData.filter((row) => row.tier.label !== "Low" && !zone.shaded.includes(row.compass)); }

  async function generateInsight() {
    if (!siteInfo) { setInsightError("Resolve a project location above first."); return; }
    setInsightLoading(true); setInsight(null); setInsightError("");
    const summary = {
      date_analyzed: activePreset.label,
      site: siteInfo.resolved_name || location,
      zones: zones.filter((z) => z.name.trim()).map((z) => {
        const exposed = exposedHours(z);
        return { zone: z.name, currently_shaded_directions: z.shaded, high_medium_exposure_hours: Number((exposed.length*0.5).toFixed(1)), exposure_hour_list: exposed.map((r) => `${r.hourLabel} (${r.tier.label}, sun from ${r.compass})`) };
      }),
    };
    try {
      const text = await callAI({
        provider, apiKey, maxTokens: 2500, useWebSearch: false,
        content: "You are a landscape architecture assistant analyzing real computed solar-exposure data for zones in a park redesign project. For each zone, give a one-line shade-strategy recommendation citing the actual exposure hour count and which compass direction(s) most need shade coverage, based only on the data given. Then write a 'conclusion' field: 2-3 sentences naming the single highest-priority zone for shade intervention and why. Do not invent temperature or UV figures not present in the data. Respond with ONLY valid JSON, no markdown fences: {\"zone_recommendations\": [{\"zone\": \"\", \"recommendation\": \"\"}], \"conclusion\": \"\"}\n\nDATA:\n" + JSON.stringify(summary, null, 2),
      });
      setInsight(extractJSON(text));
    } catch (e) { setInsightError(e.message || "Something went wrong. Try again."); }
    finally { setInsightLoading(false); }
  }

  function buildReportText() {
    let lines = [`SOLAR EXPOSURE ANALYSIS`, `Site: ${siteInfo?.resolved_name || location}`, `Date analyzed: ${activePreset.label}`, ""];
    if (siteInfo) lines.push(`Coordinates: ${siteInfo.lat}, ${siteInfo.lon} (UTC${siteInfo.utc_offset >= 0 ? "+" : ""}${siteInfo.utc_offset}) - source: ${siteInfo.source}`, "");
    lines.push("HOURLY SUN POSITION");
    dayData.forEach((r) => lines.push(`  ${r.hourLabel}: ${r.elevation} deg elevation, ${r.azimuth} deg azimuth (${r.compass}), ${r.tier.label} heat tier`));
    lines.push("", "ZONE EXPOSURE SUMMARY");
    zones.filter((z) => z.name.trim()).forEach((z) => { const exposed = exposedHours(z); lines.push(`  ${z.name} - shaded: ${z.shaded.join(", ") || "none"} - exposed hours: ${(exposed.length*0.5).toFixed(1)}`); });
    if (insight) {
      lines.push("", "AI RECOMMENDATIONS");
      (insight.zone_recommendations || []).forEach((r) => lines.push(`  ${r.zone}: ${r.recommendation}`));
      lines.push("", "CONCLUSION", insight.conclusion || "");
    }
    return lines.join("\n");
  }


  // --- Structured 11-section report export (see utils/reportTemplate.js) ---
  const [overflowText, setOverflowText] = useState("");
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "SOL",
      meta,
      inputRecord: [{label:"Location",value:location||"(not stated)"}],
      findings: [{ title: "Analysis output", text: buildReportText() }],
      chartNote: dayData.length ? "Sun elevation profile and per-zone exposure chart are reproduced in the PDF export." : "No computed data yet.",
      chartsHtml: dayData.length
        ? barChartSVG(dayData.map((r) => ({ label: `${r.hourLabel}  (${r.compass})`, value: r.elevation, display: r.elevation + " deg" })),
            { title: `Sun elevation - ${activePreset.label}` })
          + barChartSVG(zones.filter((z) => z.name.trim()).map((z) => ({ label: z.name, value: exposedHours(z).length*0.5, display: (exposedHours(z).length*0.5).toFixed(1) + " h" })),
            { title: "Unshaded medium/high exposure by zone", color: "#B84C3D" })
        : "",
      interpretation: insight?.conclusion || "",
      conclusions: (insight?.zone_recommendations || []).map((r)=>`${r.zone}: ${r.recommendation}`),
      runLimitations: [],
      extraRefs: [],
      overflow: overflowText,
    };
  }
  async function withOverflow(run) {
    if (includeOverflow && !overflowText && apiKey) {
      const o = await generateOverflow({ provider, apiKey, toolCode: "SOL",
        reportText: buildReportText() });
      setOverflowText(o);
      run({ ...structuredOpts(), overflow: o });
    } else run(structuredOpts());
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Time", "Elevation", "Azimuth", "Direction", "Heat Tier"], ...dayData.map((r) => [r.hourLabel, r.elevation, r.azimuth, r.compass, r.tier.label])]), "Hourly Sun Position");
    const zoneRows = [["Zone", "Shaded Directions", "Exposure Hours"]];
    zones.filter((z) => z.name.trim()).forEach((z) => zoneRows.push([z.name, z.shaded.join(", ") || "none", (exposedHours(z).length*0.5)]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zoneRows), "Zone Summary");
    if (insight) {
      const rows = [["Zone", "Recommendation"]];
      (insight.zone_recommendations || []).forEach((r) => rows.push([r.zone, r.recommendation]));
      rows.push([]); rows.push(["Conclusion", insight.conclusion]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "AI Insight");
    }
    const blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "solar-exposure-analysis.xlsx";
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
      <ToolIntro toolCode="SOL" />

      <div className="bg-[#FBF1E1] border border-[#E8D5B0] rounded-lg p-4 flex gap-3">
        <Info size={18} className="text-brand-warning shrink-0 mt-0.5" />
        <p className="text-sm text-brand-text">Solar position uses the standard NOAA solar calculation method — real astronomical math. For reliable AI insight results, keep to around 10-12 zones per analysis run.</p>
      </div>

      <div className="card">
        <div className="card-header">Step 1 — Project Location</div>
        <div className="p-4 space-y-3">
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Al Safa 2 Park, Jumeirah, Dubai" className="input" />
          <button onClick={resolveLocation} disabled={siteLoading || !apiKey} className="btn-gold w-full">
            <Search size={18} /> {siteLoading ? "Finding coordinates..." : "Set Location & Compute Sun Path"}
          </button>
          {siteError && (<div className="space-y-1"><p className="text-xs text-[#3A362C] flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(siteError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-4">Technical: {siteError}</p></div>)}
          {siteInfo && <p className="text-xs text-brand-success">Resolved: {siteInfo.resolved_name} ({siteInfo.lat}, {siteInfo.lon}, UTC{siteInfo.utc_offset >= 0 ? "+" : ""}{siteInfo.utc_offset}) - {siteInfo.source}</p>}
        </div>
      </div>

      {siteInfo && (
        <>
          <div className="flex gap-2 flex-wrap">
            {DATE_PRESETS.map((p) => (<button key={p.id} onClick={() => setPreset(p.id)} className={`px-3 py-2 rounded-md text-sm font-medium border-2 transition ${preset === p.id ? "bg-brand-dark text-white border-brand-dark" : "bg-white text-brand-dark border-[#DDD6C9]"}`}>{p.label}</button>))}
          </div>

          <div className="bg-white rounded-lg border border-brand-border p-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Sun Elevation Through the Day</h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={dayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E2D5" />
                <XAxis dataKey="hourLabel" tick={{ fontSize: 11 }} interval={1} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: "Elevation deg", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <ReferenceArea y1={55} y2={90} fill="#B84C3D" fillOpacity={0.06} />
                <ReferenceArea y1={25} y2={55} fill="#B8863B" fillOpacity={0.06} />
                <Tooltip formatter={(v, n, p) => [`${v} deg (sun from ${p.payload.compass})`, "Elevation"]} />
                <Line type="monotone" dataKey="elevation" stroke="#1C2333" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-header flex items-center justify-between">
              <span>Zone Shade Advisor</span>
              <button onClick={addZone} className="btn-gold text-xs px-3 py-1.5"><Plus size={13} /> Add zone</button>
            </div>
            <div className="p-4 space-y-4">
              {zones.map((z) => {
                const exposed = exposedHours(z);
                return (
                  <div key={z.id} className="border border-brand-border rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={z.name} onChange={(e) => updateZone(z.id, { name: e.target.value })} placeholder="Zone name" className="flex-1 text-sm bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 focus:border-brand-gold outline-none" />
                      <button onClick={() => removeZone(z.id)} className="text-[#B8A98F] hover:text-brand-danger"><Trash2 size={14} /></button>
                    </div>
                    <div>
                      <p className="text-[10px] text-brand-text/60 mb-1 uppercase tracking-wide">Directions already shaded</p>
                      <div className="flex flex-wrap gap-1.5">{DIRECTIONS.map((d) => (<button key={d} onClick={() => toggleShaded(z.id, d)} className={`w-9 h-8 rounded text-xs font-medium border transition ${z.shaded.includes(d) ? "bg-brand-success text-white border-brand-success" : "bg-white text-brand-dark border-[#DDD6C9]"}`}>{d}</button>))}</div>
                    </div>
                    <p className="text-xs"><span className="font-semibold" style={{ color: exposed.length > 6 ? "#B84C3D" : exposed.length > 2 ? "#B8863B" : "#3D7A5C" }}>{(exposed.length*0.5).toFixed(1)} hours</span> of Medium/High sun exposure, unshaded.</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card border-2">
            <div className="p-4">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">AI Insight & Recommendation</h2>
                <button onClick={generateInsight} disabled={insightLoading || zones.filter((z) => z.name.trim()).length === 0 || !apiKey} className="btn-dark">
                  <Sparkles size={15} /> {insightLoading ? "Analyzing..." : "Generate AI Insight"}
                </button>
              </div>
              {insightLoading && <p className="text-sm text-brand-text/60">Reading zone data and generating shade guidance...</p>}
              {insightError && (<div className="space-y-1"><p className="text-sm text-[#3A362C] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(insightError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {insightError}</p></div>)}
              {insight && (<div className="space-y-1.5">{(insight.zone_recommendations || []).map((r, i) => (<p key={i} className="text-sm text-[#3A362C]"><span className="font-semibold">{r.zone}</span>: {r.recommendation}</p>))}</div>)}
              {!insight && !insightLoading && !insightError && <p className="text-sm text-brand-text/60">Name your zones above, mark what's already shaded, then generate zone-specific shade recommendations.</p>}
            </div>
          </div>

          {insight?.conclusion && (<div className="rounded-lg border-2 p-4" style={{ borderColor: "#C9A46A", backgroundColor: "#FBF1E1" }}><h2 className="font-bold text-sm uppercase tracking-wide text-[#8A6A3A] mb-2">Conclusion</h2><p className="text-sm text-[#3A362C] leading-relaxed font-medium">{insight.conclusion}</p></div>)}

          <div className="card">
            <div className="p-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h2>
              <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
