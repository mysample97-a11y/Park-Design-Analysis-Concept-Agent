import { useState } from "react";
import { Info, ChevronDown, ChevronRight } from "lucide-react";
import { TOOL_SPECS } from "../utils/reportTemplate";

/**
 * Standard explanation block shown at the top of every tool.
 * Content comes from TOOL_SPECS so the tool's description, its inputs and its
 * scope limits stay identical between the on-screen intro and the exported report.
 */
export default function ToolIntro({ toolCode }) {
  const [open, setOpen] = useState(true);
  const spec = TOOL_SPECS[toolCode];
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
        <div className="px-4 pb-3 space-y-2 text-xs text-brand-text">
          <p><span className="font-semibold text-brand-dark">What it does:</span> {spec.covers}</p>
          <p><span className="font-semibold text-brand-dark">What to give it:</span> {spec.inputs}</p>
          <p><span className="font-semibold text-brand-dark">What it does not cover:</span> {spec.excludes}</p>
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
