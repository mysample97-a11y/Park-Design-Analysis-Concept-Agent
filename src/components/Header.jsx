import { Settings } from "lucide-react";

export default function Header({ onToggleSettings, settingsOpen }) {
  return (
    <header className="bg-brand-dark px-6 py-5">
      <div className="w-full flex items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-brand-gold">
            Site Analysis Suite
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Site Analysis Suite
          </h1>
          <p className="text-sm mt-1 text-[#C9C6BE]">
            5 integrated tools for landscape architecture site analysis.
          </p>
        </div>
        <button
          onClick={onToggleSettings}
          className="text-xs font-medium px-3 py-2 rounded-md flex items-center gap-1 shrink-0 bg-white/10 text-white hover:bg-white/20 transition"
        >
          <Settings size={13} /> {settingsOpen ? "Hide" : "Settings"}
        </button>
      </div>
    </header>
  );
}
