import { FileSpreadsheet, FileText, Printer } from "lucide-react";

export default function ExportButtons({ onExcel, onWord, onPDF }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={onExcel} className="btn-outline">
        <FileSpreadsheet size={13} /> Excel (.xlsx)
      </button>
      <button onClick={onWord} className="btn-outline">
        <FileText size={13} /> Word (.rtf)
      </button>
      <button onClick={onPDF} className="btn-outline">
        <Printer size={13} /> PDF (print)
      </button>
    </div>
  );
}
