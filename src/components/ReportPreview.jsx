import { useState } from "react";
import { FileText, ChevronDown, ChevronRight, RefreshCw, Info } from "lucide-react";

/**
 * In-UI preview of the structured report, shown before export.
 * Lets the user read exactly what will be exported, and regenerate insight first.
 */
export default function ReportPreview({ reportText, chartsHtml, docRef, onRegenerate, regenerating, includeOverflow, setIncludeOverflow }) {
  const [open, setOpen] = useState(false);
  if (!reportText) return null;

  return (
    <div className="card">
      <button onClick={() => setOpen((o) => !o)} className="card-header w-full flex items-center justify-between text-left">
        <span className="flex items-center gap-2">
          <FileText size={15} /> Report Preview {docRef ? `- ${docRef}` : ""}
        </span>
        <span className="flex items-center gap-2 text-xs font-normal text-brand-text">
          {open ? "Hide" : "Show"} {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div className="p-4 space-y-3">
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
