import { useState, useEffect } from "react";
import { FileText, ChevronDown, ChevronRight, RefreshCw, Info } from "lucide-react";

/**
 * In-UI preview of the structured report, shown before export.
 * Lets the user read exactly what will be exported, and regenerate insight first.
 */
export default function ReportPreview({ reportText, chartsHtml, docRef, onRegenerate, regenerating, includeOverflow, setIncludeOverflow, sourceNote, sourceCount }) {
  // "has findings" = the analysis produced actual content in section 6.
  // NOTE: this deliberately does NOT require sections 8 and 10 to be populated.
  // It used to. That meant when the model omitted overall_summary/conclusion, both
  // sections read "(not generated)", hasContent went false, and the ENTIRE preview
  // panel returned null - so the user lost the ability to read or re-run the report
  // at exactly the moment something had gone wrong with it.
  const hasFindings = !!reportText && !reportText.includes("(no findings generated");
  const missingInsight =
    !!reportText &&
    reportText.includes("[8] INTERPRETATION\n  (not generated)") &&
    reportText.includes("[10] CONCLUSIONS AND RECOMMENDATIONS\n  (not generated)");
  const hasContent = hasFindings;
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // Open automatically the first time a report actually has content, so the user
  // sees what will be exported instead of having to discover a collapsed panel.
  useEffect(() => {
    if (!touched && hasContent) setOpen(true);
  }, [hasContent, touched]);

  // Only hide the panel when there is genuinely nothing to read.
  if (!reportText || !hasFindings) return null;

  return (
    <div className="card">
      <button onClick={() => { setOpen((o) => !o); setTouched(true); }} className="card-header w-full flex items-center justify-between text-left">
        <span className="flex items-center gap-2">
          <FileText size={15} /> Generated Report {docRef ? `- ${docRef}` : ""}
          {hasContent && !open && (
            <span className="text-[10px] font-normal normal-case text-brand-success ml-1">ready</span>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs font-normal text-brand-text">
          {open ? "Hide" : "Show"} {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {missingInsight && (
            <div className="rounded-md border-2 p-3 flex gap-2" style={{ borderColor: "rgba(255,180,84,0.55)", backgroundColor: "rgba(255,180,84,0.13)", color: "#FFC79A" }}>
              <Info size={14} style={{ color: "#FFB454", flexShrink: 0, marginTop: 2 }} />
              <p className="text-[11px] text-brand-text">
                <strong>Sections 8 and 10 are empty.</strong> The findings below are complete, but the
                model did not return an interpretation or conclusions - usually a truncated reply
                rather than a problem with your input. Re-run the insight before exporting.
              </p>
            </div>
          )}
          {(sourceNote || sourceCount > 0) && (
            <div className={"flex items-start gap-2 rounded p-2.5 border " +
                 (sourceCount > 0 ? "bg-[#EAF3EC] border-brand-success" : "bg-[#FBF3E4] border-brand-warning")}>
              <Info size={14} className="shrink-0 mt-0.5" style={{ color: sourceCount > 0 ? "#4DD091" : "#FFB454", flexShrink: 0 }} />
              <p className="text-[10px] text-brand-text">
                {sourceCount > 0
                  ? <><strong>{sourceCount} live source{sourceCount === 1 ? "" : "s"} used.</strong> They are listed in section 11 of this report, so every researched claim can be traced.</>
                  : <><strong>No live sources.</strong> {sourceNote || "This ran on the model's training knowledge rather than retrieved pages - treat researched figures as indicative and verify anything load-bearing."}</>}
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 bg-brand-warm border border-brand-border rounded p-2.5">
            <Info size={14} className="text-brand-warning shrink-0 mt-0.5" />
            <p className="text-[10px] text-brand-text">
              This is exactly what the export contains. Review it before exporting - if something is
              wrong or missing, correct your inputs and regenerate the AI insight.
              <strong> Charts appear in the PDF export only; Word and Excel are text.</strong>
            </p>
          </div>

          {setIncludeOverflow && (
            <label className="flex items-center gap-2 text-[11px] text-brand-text cursor-pointer">
              <input type="checkbox" checked={!!includeOverflow} onChange={(e) => setIncludeOverflow(e.target.checked)} />
              Include "Additional Analytical Observations" appendix (makes one extra AI call - uses more of your quota)
            </label>
          )}

          {chartsHtml && (
            <div className="border border-brand-border rounded p-3 overflow-x-auto bg-white"
                 dangerouslySetInnerHTML={{ __html: chartsHtml }} />
          )}

          <pre className="text-[10.5px] leading-relaxed whitespace-pre-wrap font-mono bg-[#F7F5F1] border border-brand-border rounded p-3 max-h-[460px] overflow-y-auto text-brand-dark">
{reportText}
          </pre>

          {onRegenerate && (
            <button onClick={onRegenerate} disabled={regenerating} className="btn-outline text-xs">
              <RefreshCw size={12} /> {regenerating ? "Regenerating..." : "Regenerate AI insight"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
