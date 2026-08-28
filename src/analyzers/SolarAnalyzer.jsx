import { useState, useEffect, useRef } from "react";
import { Sparkles, Plus, Trash2, Sun, Info, AlertTriangle, Search } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import { useAppContext } from "../App";
import ToolIntro from "../components/ToolIntro";
import SectionSelector from "../components/SectionSelector";
import ReportPreview from "../components/ReportPreview";
import { callAI } from "../utils/ai";
import {
  buildChunkedPrompt, emptyState, mergeChunk, assembleSections,
  isComplete, progressLabel, savePartial, loadPartial, clearPartial,
} from "../utils/chunkedGeneration";
import { getUsage, recordUsage, resetUsage, estimateRun, countTokensExact, getLimits } from "../utils/tokenMeter";
import { setActiveTool, setActiveEstimate, setActivePartial, clearActiveTool, setActiveBusy, registerToolState, unregisterToolState, takePendingState } from "../utils/toolBridge";
import { checklistPrompt } from "../utils/methodology";
import { uid, friendlyError, extractJSON } from "../utils/helpers";
import ExportButtons from "../components/ExportButtons";
import { exportStructuredWord, exportStructuredPDF, exportStructuredExcel, generateOverflow, nextDocRef, buildStructuredReport, barChartSVG, tableHTML, sunPathCompassSVG, missingFields, missingFieldsNote } from "../utils/reportTemplate";
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

/**
 * ASHRAE clear-sky irradiance model.
 * DNI = A * exp(-B / sin(elevation)), diffuse = C * DNI, GHI = DNI*sin(elev) + diffuse.
 * A, B, C are the published ASHRAE monthly clear-sky coefficients, interpolated by day of year.
 * This yields solar INSOLATION in W/m2 - the metric professional solar analysis reports
 * (Autodesk Insight and equivalent tools report cumulative kWh/m2 on this basis).
 * CLEAR-SKY ONLY: no cloud cover, aerosol or humidity attenuation. Treat as an upper bound.
 */
function clearSkyIrradiance(dayOfYear, elevationDeg) {
  if (elevationDeg <= 0) return { dni: 0, diffuse: 0, ghi: 0 };
  const A = 1160 + 75 * Math.sin((2 * Math.PI * (dayOfYear - 275)) / 365);
  const B = 0.174 + 0.035 * Math.sin((2 * Math.PI * (dayOfYear - 100)) / 365);
  const C = 0.095 + 0.04 * Math.sin((2 * Math.PI * (dayOfYear - 100)) / 365);
  const beta = (elevationDeg * Math.PI) / 180;
  const dni = A * Math.exp(-B / Math.sin(beta));
  const diffuse = C * dni;
  const ghi = dni * Math.sin(beta) + diffuse;
  return { dni: Math.round(dni), diffuse: Math.round(diffuse), ghi: Math.round(ghi) };
}

function azimuthToCompass(az) { return DIRECTIONS[Math.round(az / 45) % 8]; }
function heatTier(elevation) {
  if (elevation >= 55) return { label: "High", color: "#FF7A66" };
  if (elevation >= 25) return { label: "Medium", color: "#FFB454" };
  return { label: "Low", color: "#4DD091" };
}

function buildDayData(month, day, lat, lon, utcOffset) {
  const doyStart = new Date(new Date().getFullYear(), 0, 0);
  const year = new Date().getFullYear();
  const date = new Date(year, month, day);
  const dayOfYear = Math.floor((date - doyStart) / 86400000);
  const rows = [];
  for (let h = 5; h <= 19.5; h += 0.5) {
    const { elevation, azimuth } = solarPosition(date, h, lat, lon, utcOffset);
    if (elevation > 0) {
      const hh = Math.floor(h); const mm = h % 1 === 0 ? "00" : "30";
      const irr = clearSkyIrradiance(dayOfYear, elevation);
      rows.push({ ghi: irr.ghi, dni: irr.dni, hourLabel: `${String(hh).padStart(2, "0")}:${mm}`, elevation: Math.round(elevation * 10) / 10, azimuth: Math.round(azimuth * 10) / 10, compass: azimuthToCompass(azimuth), tier: heatTier(elevation) });
    }
  }
  return rows;
}

export default function SolarAnalyzer() {
  const { provider, apiKey, meta, grounding } = useAppContext();
  const [location, setLocation] = useState("");
  // Live handle on the current render's closures for the rails bridge.
  const bridgeRef = useRef({});
  // Token accounting for this tool. Request limits are global; token
  // usage is reported per tool so you can see which one is expensive.
  /*
    CANCELLATION.
    fetch() has no default timeout, so a provider that accepts the connection
    and never replies leaves the UI on "Researching..." forever - no error, no
    failure, no way out. Requests now time out, and this lets the user stop one
    immediately. Nothing already generated is discarded by cancelling.
  */
  const abortRef = useRef(null);
  const [busy, setBusy] = useState(false);
  function newAbort() {
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* already done */ } }
    abortRef.current = new AbortController();
    setBusy(true);
    return abortRef.current.signal;
  }
  function cancelRequest() {
    if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } }
    abortRef.current = null;
    setBusy(false);
  }
  /*
   * Clears the in-flight flag when a request finishes, however it finishes.
   *
   * It used to be cleared ONLY by cancelRequest(), so after a successful run
   * `busy` stayed true forever: the Cancel button never disappeared and the rail
   * reported a request permanently in flight.
   *
   * The controller identity is checked so a slow earlier request cannot clear
   * the flag belonging to a newer one that is still running.
   */
  function endBusy(ctrl) {
    if (ctrl && abortRef.current && ctrl !== abortRef.current) return;
    abortRef.current = null;
    setBusy(false);
  }
  useEffect(() => () => { if (abortRef.current) { try { abortRef.current.abort(); } catch { /* ignore */ } } }, []);

  const [tokenUsage, setTokenUsage] = useState(() => getUsage("SOL"));
  const noteUsage = (u) => setTokenUsage(recordUsage("SOL", u));
  // PDF export opens a new tab; browsers block that silently. This surfaces it -
  // the previous code called a setError() never declared in this file, so the typeof
  // guard swallowed the message and the click appeared to do nothing at all.
  const [pdfError, setPdfError] = useState("");
  const [siteInfo, setSiteInfo] = useState(null);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteError, setSiteError] = useState("");
  const [preset, setPreset] = useState("summer");
  const [zones, setZones] = useState([{ id: uid(), name: "", shaded: [] }]);
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");
  // Partial success is NOT failure. A dropped tail field means some sections
  // will be thin - the rest of the report is valid and must not be presented
  // as a failed run.
  const [insightWarning, setInsightWarning] = useState("");
  /*
    CHUNKED INSIGHT (F13b).
  
    The point is NOT to generate less. It is to stop losing everything when the
    budget runs out mid-reply. The model is given the full topic list and told
    to return only sections it can COMPLETE - four whole sections beat eight
    truncated ones - then declare what remains. Whatever came back is merged and
    kept; the next call continues from there, on a different API key if needed.
  
    Output length per call is unchanged (maxTokens is untouched). Depth per
    section is unchanged. Only the failure mode changes.
  */
  const INSIGHT_TOPICS = [
    { key: "site_wide_finding", label: "Site-wide solar finding" },
    { key: "shade_strategy", label: "Shade strategy against published targets" },
    { key: "thermal_comfort_note", label: "Thermal comfort (derived)" },
    { key: "zone_recommendations", label: "Per-zone recommendations" },
    // Was missing, so the PV section of the report was suppressed even though
    // the prompt asks for it and the report renders it.
    { key: "energy_potential", label: "Photovoltaic / energy potential" },
    { key: "conclusion", label: "Conclusions and recommendations" },
  ];
  // F27 - EXACT token count on demand.
  // Both providers expose a free counting endpoint, so the estimate can become
  // a measurement. It is on a BUTTON rather than automatic because the call
  // still costs one REQUEST against RPM/RPD, and requests are the scarce
  // resource on a free key - counting on every keystroke would be self-defeating.
  const [exactEstimate, setExactEstimate] = useState(null);
  const [counting, setCounting] = useState(false);
  async function calculateTokens() {
    setCounting(true);
    try {
      const named = zones.filter((z) => z.name.trim());
      const preview = JSON.stringify({ location, zones: named }, null, 2);
      const exact = await countTokensExact({
        provider, apiKey, model: undefined,
        systemText: "solar insight system instruction and methodology checklist",
        userText: preview,
      });
      if (exact && exact.exact) {
        setExactEstimate({ input: exact.input, output: Math.ceil(2500 * 0.7),
          total: exact.input + Math.ceil(2500 * 0.7), calls: 1, exact: true });
      } else {
        // Endpoint unavailable or refused - fall back and SAY it is a heuristic.
        setExactEstimate({ ...estimateRun({ userText: preview, maxTokens: 2500, calls: 1 }), exact: false });
      }
    } catch {
      setExactEstimate(null);
    } finally { endBusy(); setCounting(false); }
  }

  // Publish this tool's estimator and reset to the rails. Registered on mount
  // and refreshed whenever the estimate changes, so the Budget rail can offer
  // "Calculate tokens" and show the result for the tool actually on screen.
  // Session save/load. The snapshot is this tool's USER INPUT - not derived
  // values, not loading flags - so a restored session looks like the moment
  // it was saved. Registered on mount; pending state from a session loaded
  // before this tool was opened is collected here too.
  useEffect(() => {
    registerToolState("SOL", {
      snapshot: () => (bridgeRef.current.getState ? { ...bridgeRef.current.getState() } : {}),
      restore: (s) => {
        if (!s || typeof s !== "object") return;
      if (s.location !== undefined) setLocation(s.location);
      if (s.siteInfo !== undefined) setSiteInfo(s.siteInfo);
      if (s.preset !== undefined) setPreset(s.preset);
      if (s.zones !== undefined) setZones(s.zones);
      if (s.insight !== undefined) setInsight(s.insight);
      if (s.autoNote !== undefined) setAutoNote(s.autoNote);
      if (s.overflowText !== undefined) setOverflowText(s.overflowText);
      if (s.webSources !== undefined) setWebSources(s.webSources);
      if (s.groundingNote !== undefined) setGroundingNote(s.groundingNote);
      if (s.includeOverflow !== undefined) setIncludeOverflow(s.includeOverflow);
      },
    });
    const waiting = takePendingState("SOL");
    if (waiting) {
      if (waiting.location !== undefined) setLocation(waiting.location);
      if (waiting.siteInfo !== undefined) setSiteInfo(waiting.siteInfo);
      if (waiting.preset !== undefined) setPreset(waiting.preset);
      if (waiting.zones !== undefined) setZones(waiting.zones);
      if (waiting.insight !== undefined) setInsight(waiting.insight);
      if (waiting.autoNote !== undefined) setAutoNote(waiting.autoNote);
      if (waiting.overflowText !== undefined) setOverflowText(waiting.overflowText);
      if (waiting.webSources !== undefined) setWebSources(waiting.webSources);
      if (waiting.groundingNote !== undefined) setGroundingNote(waiting.groundingNote);
      if (waiting.includeOverflow !== undefined) setIncludeOverflow(waiting.includeOverflow);
    }
    return () => unregisterToolState("SOL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setActiveTool("SOL", {
      calculate: () => bridgeRef.current.calculate && bridgeRef.current.calculate(),
      cancel: () => bridgeRef.current.cancel && bridgeRef.current.cancel(),
    resetUsage: () => setTokenUsage(resetUsage("SOL")),
      estimate: exactEstimate,
    });
    return () => clearActiveTool("SOL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setActiveEstimate("SOL", exactEstimate); }, [exactEstimate]);
  useEffect(() => { setActiveBusy("SOL", busy); }, [busy]);
  // Publish progress so the Budget/Usage rail can show an unfinished report -
  // the rail is where a user is looking while a long run is in flight.

  const [chunkState, setChunkState] = useState(() => loadPartial("SOL", INSIGHT_TOPICS) || emptyState(INSIGHT_TOPICS));
  const chunkProgress = progressLabel(chunkState, INSIGHT_TOPICS);
  const insightComplete = isComplete(chunkState, INSIGHT_TOPICS);
  // Which sections the next run should produce. Defaults to everything not yet
  // generated; the user narrows it to keep each request small on a free key.
  const [selectedTopics, setSelectedTopics] = useState(() => INSIGHT_TOPICS.map((t) => t.key));
  const outstandingKeys = INSIGHT_TOPICS.filter((t) => !chunkState.done.includes(t.key)).map((t) => t.key);
  const activeSelection = selectedTopics.filter((k) => outstandingKeys.includes(k));
  useEffect(() => {
    setActivePartial("SOL", chunkProgress.complete ? null : {
      done: chunkProgress.doneLabels, remaining: chunkProgress.remainingLabels,
    });
  }, [chunkProgress.doneCount, chunkProgress.complete]);

  const activePreset = DATE_PRESETS.find((p) => p.id === preset);
  const dayData = siteInfo ? buildDayData(activePreset.month, activePreset.day, siteInfo.lat, siteInfo.lon, siteInfo.utc_offset) : [];

  async function resolveLocation() {
    if (!location.trim()) { setSiteError("Enter a project location first."); return; }
    setSiteLoading(true); setSiteError(""); setSiteInfo(null);
    try {
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 900, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content: `Find the approximate latitude, longitude, and UTC timezone offset (as a number, e.g. 4 for UTC+4) for this location: "${location}". Respond with ONLY valid JSON, no markdown fences: {"lat": 0, "lon": 0, "utc_offset": 0, "resolved_name": "", "source": "how you determined this"}`,
      });
      const parsed = extractJSON(text);
      if (!parsed || typeof parsed.lat !== "number" || typeof parsed.lon !== "number") {
        throw new Error("The AI did not return usable coordinates for this location. Try a more specific description, e.g. 'Nehru Stadium, Chennai, India'.");
      }
      setSiteInfo(parsed);
      autoSuggestZones(parsed);
    } catch (e) { setSiteError(e.message || "Could not resolve this location."); }
    finally { endBusy(); setSiteLoading(false); }
  }

  function addZone() { setZones([...zones, { id: uid(), name: "", shaded: [] }]); }
  function updateZone(id, patch) { setZones(zones.map((z) => (z.id === id ? { ...z, ...patch } : z))); }
  function removeZone(id) { setZones(zones.filter((z) => z.id !== id)); }
  function toggleShaded(id, dir) {
    const z = zones.find((zz) => zz.id === id);
    const has = z.shaded.includes(dir);
    updateZone(id, { shaded: has ? z.shaded.filter((d) => d !== dir) : [...z.shaded, dir] });
  }
  const [autoNote, setAutoNote] = useState("");
  const [autoLoading, setAutoLoading] = useState(false);

  // ARCH: the tool proposes its own zones and likely obstructions from the location,
  // so the user is not asked to invent zones at analysis stage.
  async function autoSuggestZones(site) {
    setAutoLoading(true);
    try {
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 1600, useWebSearch: true,
        onSources: (g) => { setWebSources(g.sources || []); setGroundingNote(g.grounded ? "" : (g.note || "")); },
        content:
          `For a public park / open space at "${site?.resolved_name || location}" (lat ${site?.lat}, lon ${site?.lon}), propose the typical functional zones such a space would contain, and for each, which compass directions are LIKELY already shaded by surrounding built form, existing tree canopy or topography. ` +
          "Base the shading on what is actually around that location - adjacent buildings, streets, mature planting - not on assumption. If you cannot tell, return an empty shaded array for that zone rather than guessing. " +
          "Respond with ONLY a JSON array, no markdown fences: " +
          '[{"name":"zone name","purpose":"what it is for","shaded":["N","NE"],"shading_basis":"what causes that shade, or \'unknown\'"}]. ' +
          "Give 5 to 7 zones covering the usual range: arrival, active recreation, children's play, passive/quiet, gathering/event, planting/biodiversity, service.",
      });
      const parsed = extractJSON(text);
      if (!parsed) throw new Error("The reply could not be read as structured data, even after recovery. "
        + "This is usually a truncated response - shorten the input or run it again.");
      if (Array.isArray(parsed) && parsed.length) {
        setZones(parsed.map((z) => ({
          id: uid(),
          name: z.name || "",
          shaded: Array.isArray(z.shaded) ? z.shaded.filter((d) => DIRECTIONS.includes(d)) : [],
          purpose: z.purpose || "",
          shadingBasis: z.shading_basis || "unknown",
          autoSuggested: true,
        })));
        setAutoNote("Zones and likely existing shade were proposed by the tool from the location. Review and edit them - they are a starting point, not a survey.");
      }
    } catch (e) {
      setAutoNote("Could not auto-propose zones for this location. You can add them manually below, or run the analysis without zones for a site-wide result.");
    } finally { endBusy(); setAutoLoading(false); }
  }

  // Daily clear-sky insolation, integrated from the half-hourly GHI values.
  function dailyInsolation() {
    if (!dayData.length) return 0;
    return dayData.reduce((sum, r) => sum + (r.ghi || 0) * 0.5, 0) / 1000; // kWh/m2/day
  }
  function peakIrradiance() {
    if (!dayData.length) return 0;
    return Math.max(...dayData.map((r) => r.ghi || 0));
  }

  function dayparts() {
    if (!dayData.length) return [];
    const bands = [
      ["Early morning", 5, 9], ["Late morning", 9, 12],
      ["Afternoon", 12, 16], ["Evening", 16, 20],
    ];
    return bands.map(([label, from, to]) => {
      const rows = dayData.filter((r) => {
        const h = parseInt(r.hourLabel.split(":")[0], 10);
        return h >= from && h < to;
      });
      if (!rows.length) return [label, "sun below horizon", "-", "-"];
      const peak = rows.reduce((a, b) => (b.elevation > a.elevation ? b : a));
      const dirs = {};
      rows.forEach((r) => { dirs[r.compass] = (dirs[r.compass] || 0) + 1; });
      const dominant = Object.entries(dirs).sort((a, b) => b[1] - a[1])[0][0];
      return [label, `${rows[0].hourLabel} - ${rows[rows.length - 1].hourLabel}`, `${peak.elevation} deg`, dominant];
    });
  }

  function shadeGeometryNote() {
    if (!dayData.length) return "Resolve a location first.";
    const peak = dayData.reduce((a, b) => (b.elevation > a.elevation ? b : a));
    const shadow = (1 / Math.tan((peak.elevation * Math.PI) / 180)).toFixed(2);
    const vertical = peak.elevation >= 60;
    return `Peak sun elevation on this reference day is ${peak.elevation} degrees at ${peak.hourLabel}. ` +
      `A 1 m tall element therefore casts ${shadow} m of shadow at peak. ` +
      (vertical
        ? "At this angle the sun is close to overhead, so vertical shading devices - screens, walls, side awnings - contribute almost nothing at midday. Only OVERHEAD cover (tree canopy, pergola, tensile structure) produces usable shade."
        : "At this angle the sun rakes in laterally, so low sun penetrates beneath overhead canopy. Sun ACCESS may be the amenity rather than the problem, and vertical or angled screening becomes effective where glare control is needed.") +
      " Thermal comfort commentary here is derived from computed sun geometry only - no UTCI, radiant temperature or CFD simulation has been performed.";
  }

  function exposedHours(zone) { return dayData.filter((row) => row.tier.label !== "Low" && !zone.shaded.includes(row.compass)); }

  // Generate = start over. Continue = add the sections still missing.

  // One button doing both meant there was no way to restart cleanly.

  function startFreshInsight() {

    clearPartial("SOL");

    setChunkState(emptyState(INSIGHT_TOPICS));

    generateInsight();

  }

  function continueInsight() { generateInsight(); }


  async function generateInsight() {
    if (!siteInfo) { setInsightError("Set a project location above first."); return; }
    setInsightLoading(true); setInsightWarning(""); setInsight(null); setInsightError("");
    const named = zones.filter((z) => z.name.trim());
    const summary = {
      date_analyzed: activePreset.label,
      site: siteInfo.resolved_name || location,
      latitude: siteInfo.lat,
      peak_sun_elevation_deg: dayData.length ? Math.max(...dayData.map((r) => r.elevation)) : null,
      shadow_per_metre_at_peak: dayData.length ? (1 / Math.tan((Math.max(...dayData.map((r) => r.elevation)) * Math.PI) / 180)).toFixed(2) : null,
      daylight_hours: dayData.length * 0.5,
      hours_above_high_tier: dayData.filter((r) => r.tier.label === "High").length * 0.5,
      clear_sky_insolation_kwh_m2_day: Number(dailyInsolation().toFixed(2)),
      peak_irradiance_w_m2: peakIrradiance(),
      hours_medium_tier: dayData.filter((r) => r.tier.label === "Medium").length * 0.5,
      dayparts: dayparts(),
      published_shade_targets: {
        primary_walkways_min_1_8m_wide: "80% continuous shade",
        secondary_walkways: "60% shade",
        play_structures: "100% shade coverage",
        gathering_areas: "80% shade",
        informal_play_and_parking: "40% shade",
        rest_areas: "one shaded rest area per 500 m of primary walkway",
        // Labelled for what it is: an external benchmark used because no local
        // figure has been established. Naming a foreign body as the source made
        // it read as governing at a Dubai site, which it is not.
        source: "external benchmark - governing local requirement not established",
      },
      zones: named.map((z) => {
        const exposed = exposedHours(z);
        return {
          zone: z.name,
          purpose: z.purpose || "",
          currently_shaded_directions: z.shaded,
          shading_basis: z.shadingBasis || "user-declared",
          unshaded_medium_high_hours: Number((exposed.length * 0.5).toFixed(1)),
          exposure_detail: exposed.map((r) => `${r.hourLabel} (${r.tier.label}, sun from ${r.compass})`),
        };
      }),
    };
    try {
      // Continuation-aware: tells the model what is already written so it does
      // not repeat it, and what still needs writing. On a first run `done` is
      // empty and this behaves exactly like a single-pass call.
      const chunkInstruction = buildChunkedPrompt({
        topics: INSIGHT_TOPICS,
        done: chunkState.done,
        continuationSummary: chunkState.continuationSummary,
        // Narrows the OUTPUT only. Every input and all prior section text still go.
        requested: activeSelection,
        sections: chunkState.sections,
      });
      const text = await callAI({
        onUsage: noteUsage,
      abortSignal: newAbort(),
        provider, apiKey, maxTokens: 2500,
        // Was hardcoded false, so turning grounding on in Settings changed the
        // research step but never the analysis - and the report then correctly
        // reported "training knowledge" because no sources came back.
        useWebSearch: grounding === true,
        content: "You are a landscape architect interpreting computed solar geometry for a site. Use ONLY the computed data supplied - never invent temperature, UV or radiation figures. " +
          "Assess the site against the published shade coverage targets provided, and state where the site will fail them. " +
          "Comment on thermal comfort qualitatively, derived from sun angle and exposure duration only - explicitly note that no UTCI or radiant simulation was performed. " +
          "Respond with ONLY valid JSON, no markdown fences: {" +
          "\"site_wide_finding\":\"2-3 sentences on the solar regime and what it demands of the design\"," +
          "\"shade_strategy\":[{\"element\":\"e.g. primary walkway, play area, gathering space\",\"target\":\"the published coverage target\",\"implication\":\"what must be provided here given the computed sun angle\"}]," +
          "\"thermal_comfort_note\":\"derived commentary - which hours are usable, which are not, and why\"," +
          "\"zone_recommendations\":[{\"zone\":\"\",\"recommendation\":\"cite the actual exposure hours and the directions needing cover\"}]," +
          "\"energy_potential\":{\"viable_surfaces\":\"which surfaces on this site suit PV, given the computed sun path\",\"indicative_yield_note\":\"what the computed clear-sky insolation implies for generation per square metre of array, stated as an upper bound\",\"dual_use\":\"where shade structures could also carry PV\",\"caveat\":\"what a real yield assessment would require\"}," +
          "\"conclusion\":\"2-3 sentences naming the single highest-priority shade intervention\"}" +
          checklistPrompt("SOL") + "\n\nCOMPUTED DATA:\n" + JSON.stringify(summary, null, 2) + chunkInstruction,
      });
      // extractJSON returns NULL on an unrecoverable reply - it does not throw.
      // Passing that null into state leaves the section silently empty.
      const parsedInsight = extractJSON(text);
      if (!parsedInsight) throw new Error("The reply could not be read as structured data, even after recovery. "
        + "This is usually a truncated response - shorten the input or run it again.");
      // Merge into accumulated state. mergeChunk enforces the invariants:
      // never overwrite longer content with shorter, ignore invented keys,
      // reject a false "completed" claim, preserve declared order.
      const merged = mergeChunk(chunkState, {
        sections: parsedInsight.sections || parsedInsight,
        completed: parsedInsight.completed,
        remaining: parsedInsight.remaining,
        continuation_summary: parsedInsight.continuation_summary,
      }, INSIGHT_TOPICS);
      setChunkState(merged);
      savePartial("SOL", merged);

      // The report reads the flat object, so hand it the accumulated sections -
      // a section generated on call 3 is indistinguishable from one on call 1.
      setInsight({ ...parsedInsight, ...merged.sections });
      // Field-completeness guard. When the output budget runs short the model
      // drops the TAIL fields of a schema; the report then prints
      // "(not generated)" into those sections with nothing on screen to say
      // why. Keys are taken from THIS tool's own prompt so the check cannot
      // drift away from the contract it is checking.
            // Judge the MERGED state against what was actually requested. Checking a
      // single reply flagged sections that were already generated and saved.
      const _requestedNow = (activeSelection && activeSelection.length)
        ? activeSelection
        : INSIGHT_TOPICS.map((t) => t.key);
      const gaps = _requestedNow.filter((k) => {
        const v = merged.sections[k];
        if (v == null) return true;
        if (typeof v === "string") return !v.trim();
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === "object") return Object.keys(v).length === 0;
        return false;
      });
      setInsightWarning(gaps.length ? missingFieldsNote(gaps) : "");
    } catch (e) { setInsightError(e.message || "Something went wrong. Try again."); }
    finally { endBusy(); setInsightLoading(false); }
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
  const [webSources, setWebSources] = useState([]);
  const [groundingNote, setGroundingNote] = useState("");

  /*
    Assigned in an effect with NO dependency array: it runs after EVERY render,
    and effects run after the component body completes. Assigning during render
    instead threw "Cannot access X before initialization" for whichever state
    happened to be declared below it.
  */
  useEffect(() => {
        bridgeRef.current = {
      // Lazy: evaluated when the bridge calls it, not during render, so it can
      // safely reference state declared further down the component body.
      getState: () => ({ location, siteInfo, preset, zones, insight, autoNote, overflowText, webSources, groundingNote, includeOverflow }),
      calculate: calculateTokens,
      cancel: typeof cancelRequest === "function" ? cancelRequest : null,
    };
  });
  const [includeOverflow, setIncludeOverflow] = useState(false);
  function structuredOpts() {
    return {
      toolCode: "SOL",
      meta,
      inputRecord: [{label:"Location",value:location||"(not stated)"}],
      findings: [
        { title: "Site and reference day", text: `Site: ${siteInfo?.resolved_name || location}\nCoordinates: ${siteInfo ? `${siteInfo.lat}, ${siteInfo.lon} (UTC${siteInfo.utc_offset >= 0 ? "+" : ""}${siteInfo.utc_offset})` : "not resolved"}\nReference day: ${activePreset.label}` },
        { title: "Computed sun position", note: "Astronomically computed via the NOAA algorithm - identical on every run.",
          headers: ["Time", "Elevation deg", "Azimuth deg", "From", "Clear-sky GHI W/m2", "Heat tier"],
          rows: dayData.map((r) => [r.hourLabel, r.elevation, r.azimuth, r.compass, r.ghi, r.tier.label]) },
        { title: "Solar insolation", note: "The metric professional solar analysis reports. Computed with the ASHRAE clear-sky model from the NOAA sun position - CLEAR-SKY ONLY, so treat as an upper bound with no cloud, aerosol or humidity attenuation.",
          headers: ["Measure", "Value", "Basis"],
          rows: [
            ["Daily clear-sky insolation", `${dailyInsolation().toFixed(2)} kWh/m2/day`, "Integrated global horizontal irradiance across daylight hours"],
            ["Peak irradiance", `${peakIrradiance()} W/m2`, "Global horizontal at solar noon"],
            ["Daylight duration", `${(dayData.length * 0.5).toFixed(1)} h`, "Sun above horizon"],
          ] },
        { title: "Daypart summary", headers: ["Daypart", "Window", "Peak elevation", "Dominant direction"], rows: dayparts() },
        { title: "Shade coverage requirement", note: "Indicative targets from published park design guidance. These are EXTERNAL benchmarks - the requirement that governs at this location has not been established and must be confirmed with the local authority.",
          items: ["Primary walkways (min 1.8 m wide): 80% continuous shade", "Secondary walkways: 60% shade", "Play structures: 100% shade coverage", "Gathering areas: 80% shade", "Informal play and surface parking: 40% shade", "One shaded rest area per 500 m of primary walkway"] },
        { title: "Shade geometry consequence", text: shadeGeometryNote() },
        ...(insight?.shade_strategy?.length ? [{
          title: "Shade strategy against published targets",
          note: "Assessed against indicative external benchmarks, not against a verified local requirement.",
          headers: ["Element", "Coverage target", "What this site requires"],
          rows: insight.shade_strategy.map((r) => [r.element, r.target, r.implication]),
        }] : []),
        ...(insight?.energy_potential ? [{
          title: "Solar energy generation potential",
          note: "Derived from the computed clear-sky insolation. An indicative upper bound only - it excludes panel efficiency, soiling, temperature derating, inverter losses and shading from surroundings.",
          items: [
            insight.energy_potential.viable_surfaces && `Viable surfaces: ${insight.energy_potential.viable_surfaces}`,
            insight.energy_potential.indicative_yield_note && `Indicative yield: ${insight.energy_potential.indicative_yield_note}`,
            insight.energy_potential.dual_use && `Dual use: ${insight.energy_potential.dual_use}`,
            insight.energy_potential.caveat && `Required for a real assessment: ${insight.energy_potential.caveat}`,
          ].filter(Boolean),
        }] : []),
        ...(insight?.thermal_comfort_note ? [{
          title: "Thermal comfort (derived)",
          note: "Derived from computed sun geometry only. No UTCI, radiant temperature or CFD simulation was performed.",
          text: insight.thermal_comfort_note,
        }] : []),
        { title: "Zone exposure", headers: ["Zone", "Already shaded from", "Unshaded medium/high exposure"],
          rows: zones.filter((z) => z.name.trim()).map((z) => [z.name, z.shaded.join(", ") || "none", `${(exposedHours(z).length * 0.5).toFixed(1)} h`]) },
      ],
      chartNote: dayData.length ? "Sun elevation profile and per-zone exposure chart are reproduced in the PDF export." : "No computed data yet.",
      chartsHtml: (dayData.length
        ? `<div style="margin:12px 0;">${sunPathCompassSVG(
            dayData.map((r) => ({ az: r.azimuth, elev: r.elevation, tier: r.tier.label, hourLabel: r.hourLabel })),
            [...new Set(zones.flatMap((z) => z.shaded || []))],
            `Sun path and existing shade - ${activePreset.label}`
          )}</div>`
        : "") + (dayData.length
        ? barChartSVG(dayData.map((r) => ({ label: r.hourLabel, value: r.ghi || 0, display: (r.ghi || 0) + " W/m2" })),
            { title: `Clear-sky solar irradiance - ${activePreset.label}  (total ${dailyInsolation().toFixed(2)} kWh/m2/day)`, color: "#FFB454" })
          + barChartSVG(dayData.map((r) => ({ label: `${r.hourLabel}  (${r.compass})`, value: r.elevation, display: r.elevation + " deg" })),
            { title: `Sun elevation - ${activePreset.label}` })
          + barChartSVG(zones.filter((z) => z.name.trim()).map((z) => ({ label: z.name, value: exposedHours(z).length*0.5, display: (exposedHours(z).length*0.5).toFixed(1) + " h" })),
            { title: "Unshaded medium/high exposure by zone", color: "#FF7A66" })
        : ""),
      interpretation: [insight?.site_wide_finding, insight?.thermal_comfort_note, insight?.conclusion]
        .filter(Boolean).join("\n\n"),
      conclusions: [
        ...(insight?.shade_strategy || []).map((r) => `${r.element} - target ${r.target}: ${r.implication}`),
        ...(insight?.zone_recommendations || []).map((r) => `${r.zone}: ${r.recommendation}`),
      ],
      runLimitations: [],
      extraRefs: webSources,
      // F3: report which research mode actually produced this run. Derived from
      // the sources the provider returned, not assumed - a report that claims
      // live research it did not do is worse than one that admits training data.
      // Live research may surface material the fixed checklist does not cover.
      // It is appended INSIDE section 6 as further numbered findings, so the
      // twelve-block structure every deliverable cross-references is untouched.
      extraFindings: (insight && Array.isArray(insight.extra_findings))
        ? insight.extra_findings : [],
      provenance: {
        mode: (webSources && webSources.length) ? "web" : "training",
        searchedAt: (webSources && webSources.length) ? new Date().toISOString().slice(0, 10) : null,
      },
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
  function exportExcel() { withOverflow((o) => exportStructuredExcel(o, XLSX)); }

  function exportWord() { withOverflow((o) => exportStructuredWord(o)); }

  function exportPDF() {
    setPdfError("");
    withOverflow((o) => exportStructuredPDF(o, () => {
      setPdfError("Your browser blocked the new tab needed for PDF export. Allow pop-ups for this site and try again.");
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
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Riverside Park, Chicago, USA" className="input" />
          <button onClick={resolveLocation} disabled={siteLoading || !apiKey} className="btn-gold w-full">
            <Search size={18} /> {siteLoading ? "Finding coordinates..." : "Set Location & Compute Sun Path"}
          </button>
          {siteError && (<div className="space-y-1"><p className="text-xs text-[#E8EFF7] flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(siteError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-4">Technical: {siteError}</p></div>)}
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
                <CartesianGrid strokeDasharray="3 3" stroke="#22304A" />
                <XAxis dataKey="hourLabel" tick={{ fontSize: 11 }} interval={1} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: "Elevation deg", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <ReferenceArea y1={55} y2={90} fill="#FF7A66" fillOpacity={0.06} />
                <ReferenceArea y1={25} y2={55} fill="#FFB454" fillOpacity={0.06} />
                <Tooltip formatter={(v, n, p) => [`${v} deg (sun from ${p.payload.compass})`, "Elevation"]} />
                <Line type="monotone" dataKey="elevation" stroke="#E8EFF7" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="card-header flex items-center justify-between">
              <span>Zone Shade Advisor</span>
              <button onClick={addZone} className="btn-gold text-xs px-3 py-1.5"><Plus size={13} /> Add zone</button>
            </div>
            <div className="p-4 space-y-4">
                {autoLoading && <p className="text-xs text-brand-text">Proposing zones and likely existing shade for this location...</p>}
                {autoNote && <p className="text-[11px] text-brand-warning">{autoNote}</p>}
              {zones.map((z) => {
                const exposed = exposedHours(z);
                return (
                  <div key={z.id} className="border border-brand-border rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={z.name} onChange={(e) => updateZone(z.id, { name: e.target.value })} placeholder="Zone name" className="flex-1 text-sm bg-[#F7F5F1] border border-brand-border rounded px-2 py-1.5 focus:border-brand-gold outline-none" />
                      <button onClick={() => removeZone(z.id)} className="text-[#B8A98F] hover:text-brand-danger"><Trash2 size={14} /></button>
                    </div>
                    <div>
                      {z.purpose && <p className="text-[10px] text-brand-text/70 mb-1">{z.purpose}</p>}
                        <p className="text-[10px] text-brand-text/60 mb-1 uppercase tracking-wide">
                          Directions already shaded {z.shadingBasis && z.shadingBasis !== "unknown" ? `- ${z.shadingBasis}` : ""}
                        </p>
                      <div className="flex flex-wrap gap-1.5">{DIRECTIONS.map((d) => (<button key={d} onClick={() => toggleShaded(z.id, d)} className={`w-9 h-8 rounded text-xs font-medium border transition ${z.shaded.includes(d) ? "bg-brand-success text-white border-brand-success" : "bg-white text-brand-dark border-[#DDD6C9]"}`}>{d}</button>))}</div>
                    </div>
                    <p className="text-xs"><span className="font-semibold" style={{ color: exposed.length > 6 ? "#FF7A66" : exposed.length > 2 ? "#FFB454" : "#4DD091" }}>{(exposed.length*0.5).toFixed(1)} hours</span> of Medium/High sun exposure, unshaded.</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card border-2">
            <div className="p-4">
              <div className="flex items-center mb-2 flex-wrap gap-4">
                <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text">AI Insight & Recommendation</h2>
                <SectionSelector
                  topics={INSIGHT_TOPICS}
                  selected={selectedTopics}
                  onChange={setSelectedTopics}
                  doneKeys={chunkState.done}
                  disabled={busy}
                  freeTier={(getLimits(provider) || {}).tier !== "paid"}
                />
                <button onClick={startFreshInsight} disabled={insightLoading || zones.filter((z) => z.name.trim()).length === 0 || !apiKey} className="btn-dark">
                  {insightLoading ? "Generating..."
                    : chunkState.done.length === 0 ? "Generate AI Insight"
                    : "Start over (regenerate all)"}
                </button>
                {busy && (
                  <button type="button" onClick={cancelRequest} className="btn-gold ml-2">
                    Cancel
                  </button>
                )}
                {busy && (
                  <button type="button" data-plain onClick={cancelRequest}
                    className="as2p-inline-cancel ml-2 text-xs px-3 py-2 rounded-md"
                    title="Stop the request now. Anything already generated is kept.">
                    Cancel request
                  </button>
                )}
                {chunkState.done.length > 0 && !insightComplete && (
                  <button type="button" onClick={continueInsight} disabled={insightLoading}
                    className="btn-gold ml-2">
                    {insightLoading ? "Continuing..." : `Continue insight (${chunkProgress.remainingLabels.length} left)`}
                  </button>
                )}
                {chunkState.done.length > 0 && !insightComplete && (
                  <div className="mt-2 text-xs bg-[#FBF3E4] border border-[#E4D2A8] text-[#7A5B18] rounded p-2">
                    <strong>{chunkProgress.text}</strong>{" "}
                    Generated: {chunkProgress.doneLabels.join(", ")}.{" "}
                    Still to generate: {chunkProgress.remainingLabels.join(", ")}.
                    <div className="text-brand-muted mt-1">
                      Nothing already generated is lost. You may switch to a different API key
                      in Settings before continuing - the work so far is kept.
                    </div>
                  </div>
                )}
                {chunkState.done.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { clearPartial("SOL"); setChunkState(emptyState(INSIGHT_TOPICS)); setInsight(null); }}
                    className="mt-2 text-xs underline text-brand-muted"
                  >
                    Discard partial insight and start over
                  </button>
                )}
              </div>
              {insightLoading && <p className="text-sm text-brand-text/60">Reading zone data and generating shade guidance...</p>}
              {insightWarning && !insightError && (
                <div className="mt-2 text-xs bg-[#FBF3E4] border border-[#E4D2A8] text-[#7A5B18] rounded p-2">
                  <strong>Partly generated.</strong> {insightWarning}
                </div>
              )}
              {insightError && (<div className="space-y-1"><p className="text-sm text-[#E8EFF7] flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-danger" /> {friendlyError(insightError)}</p><p className="text-[10px] text-brand-text/60 font-mono pl-5">Technical: {insightError}</p></div>)}
              {insight && (<div className="space-y-1.5">{(insight.zone_recommendations || []).map((r, i) => (<p key={i} className="text-sm text-[#E8EFF7]"><span className="font-semibold">{r.zone}</span>: {r.recommendation}</p>))}</div>)}
              {!insight && !insightLoading && !insightError && <p className="text-sm text-brand-text/60">Name your zones above, mark what's already shaded, then generate zone-specific shade recommendations.</p>}
            </div>
          </div>

          {insight?.conclusion && (<div className="rounded-lg border-2 p-4" style={{ borderColor: "#FF8A3D", backgroundColor: "rgba(255,255,255,0.03)" }}><h2 className="font-bold text-sm uppercase tracking-wide text-[#FF8A3D] mb-2">Conclusion</h2><p className="text-sm text-[#E8EFF7] leading-relaxed font-medium">{insight.conclusion}</p></div>)}

          <div className="card">
            <ReportPreview
              reportText={buildStructuredReport({ ...structuredOpts(), docRef: "preview" })}
              chartsHtml={structuredOpts().chartsHtml}
              includeOverflow={includeOverflow}
              setIncludeOverflow={setIncludeOverflow}
              sourceNote={groundingNote}
              sourceCount={webSources.length}
            />

            <div className="p-4">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-brand-text mb-3">Export Report</h2>
              {pdfError && <p className="text-[11px] text-brand-danger mb-2 flex items-center gap-1"><AlertTriangle size={11} /> {pdfError}</p>}
              <ExportButtons onExcel={exportExcel} onWord={exportWord} onPDF={exportPDF} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
