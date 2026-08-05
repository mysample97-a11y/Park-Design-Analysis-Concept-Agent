import { useEffect, useRef, useState } from "react";
import { MapPin, Sun, BarChart3, Wind, Leaf, Layers, Calculator, FileStack, ArrowDown } from "lucide-react";

/**
 * The Instrument Case.
 * Hero: a live sun arc tracking across a contoured site plan - the thing the suite computes.
 * Signature: a machined case whose lid opens on scroll, revealing the eight instruments
 * seated in milled recesses. Pure CSS 3D - no library, no bundle cost.
 */

const INSTRUMENTS = [
  { id: "site",     code: "SCX", name: "Site Context",      icon: MapPin,     reads: "Adjacencies, access, capacity, hazards" },
  { id: "solar",    code: "SOL", name: "Solar Exposure",    icon: Sun,        reads: "Sun position, insolation kWh/m²" },
  { id: "wind",     code: "WND", name: "Wind Exposure",     icon: Wind,       reads: "Prevailing direction, comfort thresholds" },
  { id: "veg",      code: "VEG", name: "Vegetation & Soil", icon: Leaf,       reads: "Existing planting, regional palette" },
  { id: "survey",   code: "SUR", name: "Community Survey",  icon: BarChart3,  reads: "Response themes, priorities, conflicts" },
  { id: "combined", code: "CMB", name: "Consolidator",      icon: FileStack,  reads: "Constraints matrix, concept brief" },
  { id: "concept",  code: "CPT", name: "Concept Generator", icon: Layers,     reads: "Scored options, zoning, facilities" },
  { id: "budget",   code: "BDG", name: "Cost & Feasibility",icon: Calculator, reads: "NRM1 build-up, budget test" },
];

export default function Landing({ onOpen }) {
  const [lid, setLid] = useState(0);          // 0 closed -> 1 open
  const [reduced, setReduced] = useState(false);
  const caseRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (reduced) { setLid(1); return; }
    function onScroll() {
      const el = caseRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      // opens as the case travels from the lower third up to the middle of the viewport
      const p = 1 - (r.top - vh * 0.35) / (vh * 0.5);
      setLid(Math.max(0, Math.min(1, p)));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [reduced]);

  return (
    <div className="landing">
      {/* ---------- HERO: sun arc over a contoured site ---------- */}
      <section className="lp-hero">
        <svg className="lp-scene" viewBox="0 0 1200 620" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#141A26" />
              <stop offset="100%" stopColor="#1C2333" />
            </linearGradient>
            <radialGradient id="glow">
              <stop offset="0%" stopColor="#C9A46A" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#C9A46A" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1200" height="620" fill="url(#sky)" />

          {/* survey grid */}
          <g className="lp-grid" stroke="#C9A46A" strokeOpacity="0.10">
            {Array.from({ length: 25 }, (_, i) => <line key={"v" + i} x1={i * 50} y1="0" x2={i * 50} y2="620" />)}
            {Array.from({ length: 13 }, (_, i) => <line key={"h" + i} x1="0" y1={i * 50} x2="1200" y2={i * 50} />)}
          </g>

          {/* contours */}
          <g fill="none" stroke="#3D7A5C" strokeOpacity="0.34">
            <path d="M-40 470 C 220 430, 380 512, 640 470 S 1020 420, 1240 462" />
            <path d="M-40 508 C 240 470, 400 548, 660 506 S 1030 462, 1240 500" />
            <path d="M-40 548 C 260 512, 420 586, 680 546 S 1040 506, 1240 540" />
          </g>

          {/* sun arc path */}
          <path id="arc" d="M 90 520 A 510 510 0 0 1 1110 520" fill="none"
                stroke="#C9A46A" strokeOpacity="0.28" strokeDasharray="3 9" />
          <g className="lp-sun">
            <circle r="46" fill="url(#glow)" />
            <circle r="9" fill="#E9CB92" />
            <animateMotion dur="26s" repeatCount="indefinite" rotate="0">
              <mpath href="#arc" />
            </animateMotion>
          </g>

          {/* wind streamlines */}
          <g className="lp-wind" stroke="#F7F5F1" strokeOpacity="0.16" fill="none">
            <path d="M-160 180 C 120 140, 300 220, 620 176 S 1080 138, 1360 182" />
            <path d="M-160 232 C 140 196, 320 268, 640 228 S 1100 190, 1360 234" />
            <path d="M-160 138 C 100 104, 280 172, 600 132 S 1060 96, 1360 140" />
          </g>
        </svg>

        <div className="lp-hero-inner">
          <p className="lp-eyebrow">Site analysis instruments</p>
          <h1 className="lp-title">Read the site<br />before drawing it.</h1>
          <p className="lp-lede">
            Eight instruments that compute what can be computed and reason about the rest —
            stating which is which, on every page they produce.
          </p>
          <div className="lp-readout">
            <span>NOAA solar position</span><i /><span>ASHRAE clear-sky</span><i /><span>RICS NRM1</span>
          </div>
          <button className="lp-scroll" onClick={() => caseRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" })}>
            Open the case <ArrowDown size={14} />
          </button>
        </div>
      </section>

      {/* ---------- THE CASE ---------- */}
      <section className="lp-case-wrap" ref={caseRef}>
        <header className="lp-case-head">
          <span className="lp-stamp">CASE 01</span>
          <h2>The instrument case</h2>
          <p>Each instrument works alone. Their outputs are designed to feed the next.</p>
        </header>

        <div className="lp-case" style={{ "--lid": lid }}>
          <div className="lp-lid">
            <div className="lp-lid-face">
              <div className="lp-lid-plate">
                <span className="lp-lid-mark">SITE ANALYSIS SUITE</span>
                <span className="lp-lid-sub">8 INSTRUMENTS · BRING YOUR OWN KEY</span>
              </div>
            </div>
          </div>

          <div className="lp-tray">
            {INSTRUMENTS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} className="lp-slot" onClick={() => onOpen(t.id)}>
                  <span className="lp-slot-inner">
                    <span className="lp-slot-top">
                      <Icon size={19} />
                      <em className="lp-code">{t.code}</em>
                    </span>
                    <strong>{t.name}</strong>
                    <span className="lp-reads">{t.reads}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="lp-foot">
          Pick an instrument, or use the tabs above at any time.
          <span> Outputs are prototype-grade and say so.</span>
        </p>
      </section>
    </div>
  );
}
