// src/components/TokenRails.jsx
// ---------------------------------------------------------------------------
// STICKY TOKEN RAILS  (F31)
//
// Two fixed panels flanking the tool interface, in the dark space either side:
//
//   LEFT   BUDGET   - declared limits, requests used, and the pre-flight
//                     estimate for the run about to be made. Answers
//                     "can I afford this?" BEFORE spending.
//   RIGHT  USAGE    - live consumption, updating as each call completes.
//                     Answers "what has this cost me?" DURING and after.
//
// Why sticky rather than inline
// -----------------------------
// The meter used to sit beside one button, which meant it was invisible from
// everywhere else in a long tool page - including while an analysis was
// running, which is exactly when a user needs to see the counter move.
//
// Scope
// -----
// Mounted ONLY by the tool shell. The landing pages, video sections and
// navigation are untouched - they make no API calls and have nothing to report.
//
// Colour
// ------
// Deliberately darker than the cream tool surface so the rails read as chrome
// rather than content, but kept well clear of the page background so they do
// not disappear into it. Text is checked for contrast against the panel, not
// against the page.
// ---------------------------------------------------------------------------

import React from "react";
import {
  formatTokens, requestWindows, getLimits, saveLimits, capacityCheck,
  getLiveLimits, resetRequests, PUBLISHED_LIMITS,
} from "../utils/tokenMeter";

const PANEL = {
  // Frosted blue, deliberately darker than the tool surface so the rails read
  // as instrumentation rather than content, while staying clearly lighter than
  // the page background so they never disappear into it.
  background: "rgba(28, 45, 66, 0.94)",
  border: "1px solid #3A5878",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  color: "#D8E4F2",
  borderRadius: 10,
  padding: "12px 13px",
  fontSize: 12,
  lineHeight: 1.5,
};
const LABEL = {
  fontSize: 9.5, letterSpacing: 0.8, textTransform: "uppercase",
  color: "#93AFCC", marginBottom: 2,
};
const BIG = { fontSize: 19, fontWeight: 700, color: "#FFFFFF" };
const LEVEL_FG = { low: "#8FD3B0", medium: "#F0CE8E", high: "#F5A493", unknown: "#A9BDD3" };

function Bar({ used, limit }) {
  if (!limit) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const fg = pct >= 90 ? "#F0A48C" : pct >= 70 ? "#E8C98A" : "#6FC49A";
  return (
    <div style={{ height: 5, background: "#26405C", borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: fg }} />
    </div>
  );
}

/** LEFT RAIL - what you may spend. */
export function BudgetRail({ provider = "claude", estimate = null, onCalculate = null, calculating = false }) {
  // Limits are declared HERE, not in Settings. They were in both places, which
  // meant two sources for one number - and the rail is where they are actually
  // consulted, so this is where they belong.
  const [tick, setTick] = React.useState(0);
  const [draft, setDraft] = React.useState({});
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);
  const lim = getLimits(provider);
  const win = requestWindows(provider);
  const pKey = String(provider).toLowerCase().includes("gemini") ? "gemini" : "claude";
  const published = PUBLISHED_LIMITS[pKey];
  const apply = (patch) => { saveLimits(pKey, { ...lim, ...patch }); setTick((t) => t + 1); };
  const cap = capacityCheck(provider, estimate);
  const live = getLiveLimits();
  const est = estimate ? estimate.total : 0;

  return (
    <div style={PANEL}>
      <div style={{ ...LABEL, color: "#BBD2EA", fontSize: 10.5, marginBottom: 8 }}>Budget</div>

      <div style={LABEL}>Requests this minute</div>
      <div style={BIG}>
        {win.lastMinute}
        {lim.rpm ? <span style={{ fontSize: 12, fontWeight: 400, color: "#93AFCC" }}> / {lim.rpm}</span> : null}
      </div>
      <Bar used={win.lastMinute} limit={lim.rpm} />
      {win.nextMinuteSlotIn > 0 && (
        <div style={{ fontSize: 10.5, color: "#93AFCC", marginTop: 3 }}>
          capacity returns in ~{win.nextMinuteSlotIn}s
        </div>
      )}

      {lim.rpd ? (
        <div style={{ marginTop: 10 }}>
          <div style={LABEL}>Requests today</div>
          <div style={{ ...BIG, fontSize: 15 }}>
            {win.lastDay}
            <span style={{ fontSize: 11, fontWeight: 400, color: "#93AFCC" }}> / {lim.rpd}</span>
          </div>
          <Bar used={win.lastDay} limit={lim.rpd} />
        </div>
      ) : null}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #3A5878" }}>
        <div style={LABEL}>Estimated next run</div>
        <div style={{ ...BIG, fontSize: 16, color: LEVEL_FG[cap.level] || "#FFF" }}>
          {est ? "~" + formatTokens(est) : "—"}
        </div>
        {onCalculate && (
          <button
            type="button"
            onClick={onCalculate}
            disabled={calculating}
            style={{
              marginTop: 7, width: "100%", padding: "6px 8px", fontSize: 11,
              background: calculating ? "#26405C" : "#2E4C6E", color: "#DCE6E0",
              border: "1px solid #4A6E96", borderRadius: 6,
              cursor: calculating ? "default" : "pointer",
            }}
          >
            {calculating ? "Counting…" : "Calculate tokens for my inputs"}
          </button>
        )}
        <div style={{ fontSize: 10.5, color: LEVEL_FG[cap.level] || "#A9BDD3", marginTop: 7 }}>
          {cap.message}
        </div>
      </div>

      <div style={{ marginTop: 11, paddingTop: 9, borderTop: "1px solid #3A5878" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{ width: "100%", background: "transparent", border: "none",
            color: "#93AFCC", fontSize: 10.5, textAlign: "left", cursor: "pointer", padding: 0 }}
        >
          {open ? "▾" : "▸"} {lim.tier === "free" ? "Free tier" : "Paid tier"} · edit limits
        </button>
        {open && (
          <div style={{ marginTop: 7 }}>
            <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
              {["free", "paid"].map((t) => (
                <button key={t} type="button"
                  onClick={() => { apply({ tier: t, rpm: null, rpd: null, tpm: null }); setDraft({}); }}
                  style={{ flex: 1, fontSize: 10, padding: "3px 4px", borderRadius: 5,
                    border: "1px solid #3A5878", cursor: "pointer",
                    background: lim.tier === t ? "#3A5878" : "transparent",
                    color: lim.tier === t ? "#FFFFFF" : "#93AFCC" }}>
                  {t === "free" ? "Free" : "Paid"}
                </button>
              ))}
            </div>
            {[["rpm", "Req/min"], ["rpd", "Req/day"], ["tpm", "Tok/min"]].map(([k, lbl]) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "#93AFCC", width: 52 }}>{lbl}</span>
                <input
                  type="number" min="0"
                  value={draft[k] ?? (lim[k] == null ? "" : String(lim[k]))}
                  placeholder={published[lim.tier][k] == null ? "none" : String(published[lim.tier][k])}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  onBlur={() => {
                    const raw = draft[k];
                    if (raw === undefined) return;
                    apply({ [k]: raw === "" ? null : raw });
                    setDraft((d) => { const n = { ...d }; delete n[k]; return n; });
                  }}
                  style={{ flex: 1, minWidth: 0, fontSize: 10.5, padding: "3px 5px",
                    background: "#16273A", color: "#E4EEFA",
                    border: "1px solid #3A5878", borderRadius: 4 }}
                />
              </label>
            ))}
            <button type="button" onClick={() => { resetRequests(provider); setTick((t) => t + 1); }}
              style={{ marginTop: 4, width: "100%", fontSize: 10, padding: "3px 5px",
                background: "transparent", color: "#93AFCC",
                border: "1px solid #3A5878", borderRadius: 5, cursor: "pointer" }}>
              Reset request counter
            </button>
            {lim.caution ? (
              <div style={{ fontSize: 9.5, color: "#8AA3BE", marginTop: 6, lineHeight: 1.4 }}>{lim.caution}</div>
            ) : null}
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: "#8AA3BE" }}>
        {live && live.requestsRemaining != null
          ? `Live from provider: ${live.requestsRemaining} requests left.`
          : lim.isDefault
            ? "Using published defaults — set your tier in Settings."
            : "Using your declared limits."}
      </div>
    </div>
  );
}

/** RIGHT RAIL - what you have spent. */
export function UsageRail({ usage, provider = "claude", partial = null, onReset = null }) {
  const u = usage || { total: 0, input: 0, output: 0, calls: 0, estimated: false };
  return (
    <div style={PANEL}>
      <div style={{ ...LABEL, color: "#BBD2EA", fontSize: 10.5, marginBottom: 8 }}>Usage — this tool</div>

      <div style={LABEL}>Tokens</div>
      <div style={BIG}>{formatTokens(u.total)}</div>
      <div style={{ fontSize: 10.5, color: "#93AFCC", marginTop: 2 }}>
        {formatTokens(u.input)} in · {formatTokens(u.output)} out
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={LABEL}>API calls</div>
        <div style={{ ...BIG, fontSize: 15 }}>{u.calls}</div>
      </div>

      {u.estimated && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: "#E8C98A" }}>
          Includes estimated figures — the provider did not report usage for at
          least one call.
        </div>
      )}

      {partial && Array.isArray(partial.remaining) && partial.remaining.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid #3A5878", color: "#F5A493", fontSize: 11 }}>
          <strong>Report incomplete.</strong>
          <div style={{ color: "#A9BDD3", marginTop: 3 }}>
            Still to generate: {partial.remaining.join(", ")}. You can switch API
            key first — work already done is kept.
          </div>
        </div>
      )}

      {onReset && u.total > 0 && (
        <button
          type="button"
          onClick={onReset}
          style={{
            marginTop: 11, width: "100%", padding: "5px 8px", fontSize: 10.5,
            background: "transparent", color: "#93AFCC",
            border: "1px solid #3A5878", borderRadius: 6, cursor: "pointer",
          }}
        >
          Reset counter
        </button>
      )}
    </div>
  );
}

/**
 * Layout wrapper. Rails are sticky and only the centre column scrolls.
 * Below 1280px the rails are hidden rather than squeezed - a cramped rail is
 * worse than none, and every tool still carries its own inline meter.
 */
export default function TokenRails({ provider, usage, estimate, partial, onReset, onCalculate, calculating, children }) {
  // The rails are position:fixed in the page gutters, so they take NO width
  // from the centre column. An earlier revision used a 3-column grid and shrank
  // every tool - do not reintroduce that.
  return (
    <>
      <aside className="as2p-rail as2p-rail-left">
        <BudgetRail
          provider={provider}
          estimate={estimate}
          onCalculate={onCalculate}
          calculating={calculating}
        />
      </aside>

      <div className="as2p-rail-main">{children}</div>

      <aside className="as2p-rail as2p-rail-right">
        <UsageRail usage={usage} provider={provider} partial={partial} onReset={onReset} />
      </aside>
    </>
  );
}
