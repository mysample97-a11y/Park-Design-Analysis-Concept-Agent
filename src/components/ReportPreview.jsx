import { useState, useEffect } from "react";
import { FileText, ChevronDown, ChevronRight, RefreshCw, Info } from "lucide-react";

/**
 * In-UI preview of the structured report, shown before export.
 * Lets the user read exactly what will be exported, and regenerate insight first.
 */
export default function ReportPreview({ reportText, chartsHtml, docRef, onRegenerate, regenerating, includeOverflow, setIncludeOverflow, sourceNote, sourceCount }) {
  // "has content" = the report carries generated findings, not just the static scaffold
  const hasContent =
    !!reportText &&
    !reportText.includes("(no findings generated") &&
    // section 8 AND 10 both empty means no AI insight has been generated yet
    !(reportText.includes("[8] INTERPRETATION\n  (not generated)") &&
      reportText.includes("[10] CONCLUSIONS AND RECOMMENDATIONS\n  (not generated)"));
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // Open automatically the first time a report actually has content, so the user
  // sees what will be exported instead of having to discover a collapsed panel.
  useEffect(() => {
    if (!touched && hasContent) setOpen(true);
  }, [hasContent, touched]);

  // Only show the panel once the analysis has actually produced findings.
  // Previously it rendered as soon as any state changed, so clicking a research
  // button appeared to "generate the report" before the insight had been run.
  if (!reportText || !hasContent) return null;

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
          {(sourceNote || sourceCount > 0) && (
            <div className="flex items-start gap-2 rounded p-2.5 border"
                 style={{ borderColor: sourceCount > 0 ? "#3D7A5C55" : "#B8863B55",
                          background: sourceCount > 0 ? "#F1F7F3" : "#FBF6EC" }}>
              <Info size={14} className="shrink-0 mt-0.5" style={{ color: sourceCount > 0 ? "#3D7A5C" : "#B8863B" }} />
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
