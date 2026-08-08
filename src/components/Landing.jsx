import { useEffect } from "react";
import { Settings, HelpCircle, FolderCog } from "lucide-react";
import "../landing.css";

/**
 * LANDING PAGE
 *
 * Scroll-driven portal sequence, then a split "nexus" view: an orbiting instrument ring
 * on the left over a hologram, a construction timelapse on the right, and a description
 * panel that follows the cursor across the ring.
 *
 * Clicking any instrument hands off to the workspace via onOpen(tabId).
 *
 * Videos live in public/videos/ — portal.mp4, hologram.mp4, timelapse.mp4.
 * If they are absent the page still works; the panels simply render dark.
 */
export default function Landing({ onOpen, onNav }) {
  useEffect(() => {
    const cleanups = [];
    try {
    setTimeout(() => document.getElementById("load").classList.add("gone"), 800);

    let progress = 0;
    const nexusTitle = document.getElementById("nexus-title");
    const nexusDesc = document.getElementById("nexus-desc");
    const boxes = document.querySelectorAll('.pane .box');

    const toolDescriptions = {
      "Site Context": "Adjacencies per edge, arrival and access, indicative capacity, accessibility checked against the standards that govern here, and a preliminary hazard screening for flood, water table, contamination and seismic exposure.",
      "Solar Exposure": "Sun position computed via the published NOAA algorithm and clear-sky irradiance in kWh per square metre. Shade coverage assessed against published targets, with derived thermal comfort and PV generation potential.",
      "Wind Exposure": "Prevailing direction and seasonal speeds researched for your location, assessed against pedestrian comfort thresholds for sitting, standing, strolling and walking - plus extreme events, coastal exposure and high-rise effects where they apply.",
      "Vegetation & Soil": "Existing planting identified from photographs or notes with a retain, relocate or remove position for each - and a climate-appropriate palette researched for your region, with water demand and rootable soil volume.",
      "Community Survey": "Responses clustered into themes derived from what people actually said, ranked by weight of evidence, with conflicts between user groups surfaced and each theme marked actionable by design, by management, or outside the project.",
      "Consolidator": "Every supplied analysis cross-referenced into a constraints and opportunities matrix, conflicts surfaced rather than resolved silently, and a concept brief written ready to paste into the next instrument.",
      "Concept Generator": "Distinct spatial concepts generated against the evidence - every zone tied to a specific finding, every facility scheduled for costing, each option scored against stated criteria. Selection stays with the designer.",
      "Cost & Feasibility": "An order-of-cost estimate built on the RICS NRM1 cascade and tested against your budget. Every rate carries its basis and a confidence band; anything without a published benchmark is flagged, not hidden."
    };
    const defaultTitle = "THE INSTRUMENT SET";
    const defaultDesc = "Eight analysis instruments that feed one another - site context into climate, climate into synthesis, synthesis into concept, concept into cost. Hover an instrument to see what it does. Click any one to open the workspace.";

    document.querySelectorAll('.tool-node').forEach(node => {
        node.addEventListener('mouseenter', () => {
            const name = node.getAttribute('data-name');
            nexusTitle.innerText = name; nexusDesc.innerText = toolDescriptions[name];
        });
        node.addEventListener('mouseleave', () => {
            nexusTitle.innerText = defaultTitle; nexusDesc.innerText = defaultDesc;
        });
    });

    const clamp01 = v => Math.max(0, Math.min(1, v));
    const STAGES = ["Read the ground","Site context","Climate","Synthesis","Concept","Feasibility"];

    function onScroll() {
      const max = document.body.scrollHeight - innerHeight;
      progress = max > 0 ? clamp01(scrollY / max) : 0;
      document.getElementById("bar").style.width = (progress * 100) + "%";
  
      const i = Math.min(5, Math.floor(progress * 6.5));
      document.getElementById("hP").textContent = String(i + 1).padStart(2, "0");
      document.getElementById("hN").textContent = STAGES[i];
      document.getElementById("hW").textContent = "Cycle " + String(Math.round(progress * 999)).padStart(3, "0"); 
      document.getElementById("hPct").textContent = Math.round(progress * 100) + "%";

      if(progress > 0.85) {
          document.body.classList.add("nexus-active");
          document.getElementById("clock").textContent = "NEXUS · INITIALIZED";
      } else {
          document.body.classList.remove("nexus-active");
          document.getElementById("clock").textContent = "CYCLE 0" + (i + 1) + " · ONLINE";
      }
    }
    window.addEventListener("scroll", onScroll, {passive: true});
    onScroll();

    // Cinematic Block Fade & Scale Animation
    function frame(){
      const center = window.innerHeight / 2;
      boxes.forEach(box => {
          const rect = box.parentElement.getBoundingClientRect();
          const dist = Math.abs(rect.top + rect.height / 2 - center);
          const opacity = Math.max(0, 1 - (dist / (window.innerHeight * 0.5)));
          const scale = Math.max(0.9, 1 - (dist / (window.innerHeight * 4)));
          box.style.opacity = opacity;
          box.style.transform = `scale(${scale}) translateY(${dist * 0.05}px)`;
      });
      rafId = requestAnimationFrame(frame);
    }
    let rafId = requestAnimationFrame(frame);
    cleanups.push(() => cancelAnimationFrame(rafId));
    } catch (e) {
      // A landing-page animation must never take the app down.
      console.warn("Landing effects failed to initialise:", e);
    }
    cleanups.push(() => document.body.classList.remove("nexus-active"));
    return () => cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  }, []);

  return (
    <div className="landing-root">
      {/* Control bar - only appears once the instrument ring is active */}
      <div className="lp-controls">
        <button className="lp-btn" onClick={() => onNav("project")} title="Project details">
          <FolderCog size={14} /> Project details
        </button>
        <button className="lp-btn" onClick={() => onNav("help")} title="How you can run this tool">
          <HelpCircle size={14} /> Help
        </button>
        <button className="lp-btn lp-btn-icon" onClick={() => onNav("settings")} title="API keys and settings" aria-label="Settings">
          <Settings size={15} />
        </button>
      </div>
      <div id="load">Initialising instruments</div>
      <div id="bar"></div>

      {/* LAYER 1: Fullscreen Portal Video (Continuous Loop) */}
      <div id="layer-scroll">
          <video id="portal-video" src="videos/portal.mp4" autoPlay loop muted playsInline preload="auto"></video>
          <div className="scroll-overlay"></div>
      </div>

      {/* LAYER 2: Split Screen Nexus */}
      <div id="layer-nexus">
          <div className="nexus-left">
              <div id="globe-ui">
                  <div className="video-crop">
                      <video src="videos/hologram.mp4" autoPlay loop muted playsInline></video>
                  </div>
                  <div className="orbit-ring">
                      <div className="spoke" style={{ "--angle": "0deg" }}><div className="tool-node" data-name="Site Context" data-tab="site" onClick={() => onOpen("site")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg></div></div>
                      <div className="spoke" style={{ "--angle": "45deg" }}><div className="tool-node" data-name="Solar Exposure" data-tab="solar" onClick={() => onOpen("solar")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></div></div>
                      <div className="spoke" style={{ "--angle": "90deg" }}><div className="tool-node" data-name="Wind Exposure" data-tab="wind" onClick={() => onOpen("wind")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2"/></svg></div></div>
                      <div className="spoke" style={{ "--angle": "135deg" }}><div className="tool-node" data-name="Vegetation & Soil" data-tab="veg" onClick={() => onOpen("veg")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/></svg></div></div>
                      <div className="spoke" style={{ "--angle": "180deg" }}><div className="tool-node" data-name="Community Survey" data-tab="survey" onClick={() => onOpen("survey")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="5" width="3" height="13"/></svg></div></div>
                      <div className="spoke" style={{ "--angle": "225deg" }}><div className="tool-node" data-name="Consolidator" data-tab="combined" onClick={() => onOpen("combined")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h10l2 2h4v12H4z"/><path d="M4 10h16"/></svg></div></div>
                      <div className="spoke" style={{ "--angle": "270deg" }}><div className="tool-node" data-name="Concept Generator" data-tab="concept" onClick={() => onOpen("concept")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></svg></div></div>
                      <div className="spoke" style={{ "--angle": "315deg" }}><div className="tool-node" data-name="Cost & Feasibility" data-tab="budget" onClick={() => onOpen("budget")} role="button" tabIndex={0}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M12 10h4M8 14h2M12 14h4M8 18h8"/></svg></div></div>
                  </div>
              </div>
              {/* Bridging Description Box */}
              <div id="nexus-details">
                  <h3 id="nexus-title">THE INSTRUMENT SET</h3>
                  <p id="nexus-desc">Eight analysis instruments that feed one another - site context into climate, climate into synthesis, synthesis into concept, concept into cost. Hover an instrument to see what it does. Click any one to open the workspace.</p>
              </div>
          </div>
    
          <div className="nexus-right">
              <video id="timelapse-video" src="videos/timelapse.mp4" autoPlay loop muted playsInline></video>
          </div>
      </div>

      {/* Static HUD Elements */}
      <div className="hud tl"><b>SITE ANALYSIS SUITE</b><br/>Eight instruments</div>
      <div className="hud tr">Stage <b id="hP">01</b>/06<br /><span id="hN">Urban Survey</span></div>
      <div className="hud bl"><span id="hud-state">READY</span></div>
      <div className="hud br"><span className="o" id="hW">Cycle 000</span> · <span className="g" id="hPct">0%</span></div>

      {/* LAYER 3: Scrollable Blocks */}
      <div className="flow" id="content-flow">
          <section className="pane">
            <div className="box">
              <p className="ph"><i></i>Stage 01 — Read the ground</p>
              <h1>The site is data<br/><em>before it is design.</em></h1>
              <p className="l">Eight instruments that compute what can be computed, research what can be researched, and state plainly which is which - on every page they produce. Sun geometry from the published NOAA algorithm. Cost structured to RICS NRM1. Not estimated by a language model.</p>
            </div>
          </section>
          <section className="pane">
            <div className="box">
              <p className="ph"><i></i>Stage 02 — Site context</p>
              <h2>Everything around it, accounted for.</h2>
              <p className="l">Adjacent land uses, arrival points, transit, capacity. Accessibility checked against the standards that actually govern at your location - not a default jurisdiction. Flood risk, water table, contamination and seismic exposure screened as a prompt for professional assessment.</p>
            </div>
          </section>
          <section className="pane">
            <div className="box">
              <p className="ph"><i></i>Stage 03 — Climate</p>
              <h2>The sun decides the plan.</h2>
              <p className="l">Sun position computed every half hour, clear-sky irradiance integrated to kWh per square metre, shadow geometry derived from the peak angle. Wind assessed against pedestrian comfort thresholds for sitting, standing, strolling and walking - with extreme events, coastal exposure and high-rise effects addressed where they apply.</p>
            </div>
          </section>
          <section className="pane">
            <div className="box">
              <p className="ph"><i></i>Stage 04 — Synthesis</p>
              <h2>Where the analysis disagrees with itself.</h2>
              <p className="l">Findings cross-referenced into a constraints and opportunities matrix. Conflicts surfaced rather than smoothed over. Gaps identified against what a competent study at this location would cover - kept in their own section, so your findings stay distinguishable from the model's commentary.</p>
            </div>
          </section>
          <section className="pane">
            <div className="box">
              <p className="ph"><i></i>Stage 05 — Concept</p>
              <h2>Options, scored and traceable.</h2>
              <p className="l">Multiple spatial concepts generated against the evidence, every zone tied to a specific finding, every facility scheduled for costing. Scores order the options for deliberation; they are not evidence of quality. The selection stays with the designer.</p>
            </div>
          </section>
          <section className="pane">
            <div className="box">
              <p className="ph"><i></i>Stage 06 — Feasibility</p>
              <h2>Costed before it is committed.</h2>
              <p className="l">Measured works, preliminaries, overheads and profit, contingency and inflation - the RICS NRM1 cascade, tested against your budget. Every rate carries its basis and a confidence band. Rates without a published benchmark are flagged, not hidden.</p>
            </div>
          </section>
          <section className="pane nexus-trigger"></section>
      </div>
    </div>
  );
}
