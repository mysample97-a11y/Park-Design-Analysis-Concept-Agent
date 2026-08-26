import { useState } from "react";
import { Info, ChevronDown, ChevronRight } from "lucide-react";
import { TOOL_SPECS } from "../utils/reportTemplate";
import { CHECKLISTS } from "../utils/methodology";

/**
 * Standard explanation block shown at the top of every tool.
 * Content comes from TOOL_SPECS so the tool's description, its inputs and its
 * scope limits stay identical between the on-screen intro and the exported report.
 */
export default function ToolIntro({ toolCode }) {
  const [open, setOpen] = useState(true);
  const [showList, setShowList] = useState(false);
  const spec = TOOL_SPECS[toolCode];
  const checklist = CHECKLISTS[toolCode];
  if (!spec) return null;
  return (
    <div className="bg-brand-warm border border-brand-border rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-dark">
          <Info size={15} className="text-brand-warning" /> About this tool
        </span>
        {open ? <ChevronDown size={15} className="text-brand-text" /> : <ChevronRight size={15} className="text-brand-text" />}
      </button>
      {open && (
        <div className="px-4 pt-3 pb-4 space-y-2 text-xs text-brand-text">
          <p><span className="font-semibold text-brand-dark">What it does:</span> {spec.covers}</p>
          <p><span className="font-semibold text-brand-dark">What to give it:</span> {spec.inputs}</p>
          {spec.needs && (
            <p><span className="font-semibold text-brand-dark">Required to get a useful result:</span> {spec.needs}</p>
          )}
          <p><span className="font-semibold text-brand-dark">What it does not cover:</span> {spec.excludes}</p>

          {spec.needsImages && (
            <p className="text-brand-warning">
              <span className="font-semibold">Images matter here.</span> Web search returns text only - it can find
              published descriptions of what surrounds a site, but it cannot see a map. Uploading a site plan,
              GIS extract or satellite screenshot is the only way this tool gets real spatial context. Without one,
              expect a thinner result.
            </p>
          )}

          {spec.needsWebSearch && (
            <div className="border-t border-brand-border/60 pt-2 mt-1">
              <p className="font-semibold text-brand-dark">Live web research</p>
              <p className="mt-0.5">
                This tool can research your location from live sources rather than relying on the model's training
                knowledge, and lists the sources it used in the report's References section.
              </p>
              <p className="mt-1">
                <strong>On Claude</strong> this is always on. <strong>On Gemini</strong> it must be enabled in
                Settings - it is off by default because a grounded request consumes a very small free-tier
                allowance and will exhaust a free key quickly.
              </p>
              <p className="mt-1 text-brand-warning">
                If no source list appears in the report, the answer came from training knowledge. Treat it as
                indicative and verify anything load-bearing.
              </p>
            </div>
          )}

          {checklist && (
            <div className="border-t border-brand-border/60 pt-2 mt-1">
              <p className="font-semibold text-brand-dark">Methodology coverage</p>
              <p className="mt-0.5">
                Every run is checked against a {checklist.items.length}-point coverage checklist distilled from published
                professional guidance, so standard items are not missed. The checklist supplies <em>scope only</em> -
                the standards, figures and authorities reported are the ones that actually govern at your location.
              </p>
              <button onClick={() => setShowList((v) => !v)} className="text-brand-gold hover:underline mt-1">
                {showList ? "Hide" : "Show"} the {checklist.items.length} coverage points
              </button>
              {showList && (
                <ul className="mt-1.5 space-y-0.5">
                  {checklist.items.map((it, i) => (
                    <li key={i} className="text-[10px] text-brand-text/80">
                      - {it.c} <span className="text-brand-text/50">[{it.src}]</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="text-[10px] pt-1 border-t border-brand-border/60">
            <span className="font-semibold">MVP / prototype tool.</span> Some results are computed
            deterministically and some are AI-inferred - the exported report states which is which
            for every section, along with its assumptions and limitations.
          </p>
        </div>
      )}
    </div>
  );
}
