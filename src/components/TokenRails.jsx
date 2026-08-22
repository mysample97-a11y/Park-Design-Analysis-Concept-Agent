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
  formatTokens, requestWindows, getLimits, capacityCheck, getLiveLimits,
} from "../utils/tokenMeter";

const PANEL = {
  background: "#1E2A24",      // dark green-grey: distinct from the page, not black
  border: "1px solid #33453C",
  color: "#DCE6E0",
  borderRadius: 10,
  padding: "12px 13px",
  fontSize: 12,
  lineHeight: 1.5,
};
const LABEL = {
  fontSize: 9.5, letterSpacing: 0.8, textTransform: "uppercase",
  color: "#8FA89A", marginBottom: 2,
};
const BIG = { fontSize: 19, fontWeight: 700, color: "#FFFFFF" };
const LEVEL_FG = { low: "#9BD1AE", medium: "#E8C98A", high: "#F0A48C", unknown: "#A8B8B0" };

function Bar({ used, limit }) {
  if (!limit) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const fg = pct >= 90 ? "#F0A48C" : pct >= 70 ? "#E8C98A" : "#7FB894";
  return (
    <div style={{ height: 5, background: "#2C3B34", borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: fg }} />
    </div>
  );
}

/** LEFT RAIL - what you may spend. */
export function BudgetRail({ provider = "claude", estimate = null, onCalculate = null, calculating = false }) {
  const lim = getLimits(provider);
  const win = requestWindows(provider);
  const cap = capacityCheck(provider, estimate);
  const live = getLiveLimits();
  const est = estimate ? estimate.total : 0;

  return (
    <div style={PANEL}>
      <div style={{ ...LABEL, color: "#B9CFC3", fontSize: 10.5, marginBottom: 8 }}>Budget</div>

      <div style={LABEL}>Requests this minute</div>
      <div style={BIG}>
        {win.lastMinute}
        {lim.rpm ? <span style={{ fontSize: 12, fontWeight: 400, color: "#8FA89A" }}> / {lim.rpm}</span> : null}
      </div>
      <Bar used={win.lastMinute} limit={lim.rpm} />
      {win.nextMinuteSlotIn > 0 && (
        <div style={{ fontSize: 10.5, color: "#8FA89A", marginTop: 3 }}>
          capacity returns in ~{win.nextMinuteSlotIn}s
        </div>
      )}

      {lim.rpd ? (
        <div style={{ marginTop: 10 }}>
          <div style={LABEL}>Requests today</div>
          <div style={{ ...BIG, fontSize: 15 }}>
            {win.lastDay}
            <span style={{ fontSize: 11, fontWeight: 400, color: "#8FA89A" }}> / {lim.rpd}</span>
          </div>
          <Bar used={win.lastDay} limit={lim.rpd} />
        </div>
      ) : null}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #33453C" }}>
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
              background: calculating ? "#2C3B34" : "#33453C", color: "#DCE6E0",
              border: "1px solid #476054", borderRadius: 6,
              cursor: calculating ? "default" : "pointer",
            }}
          >
            {calculating ? "Counting…" : "Calculate tokens for my inputs"}
          </button>
        )}
        <div style={{ fontSize: 10.5, color: LEVEL_FG[cap.level] || "#A8B8B0", marginTop: 7 }}>
          {cap.message}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: "#7E968A" }}>
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
      <div style={{ ...LABEL, color: "#B9CFC3", fontSize: 10.5, marginBottom: 8 }}>Usage — this tool</div>

      <div style={LABEL}>Tokens</div>
      <div style={BIG}>{formatTokens(u.total)}</div>
      <div style={{ fontSize: 10.5, color: "#8FA89A", marginTop: 2 }}>
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
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid #33453C", color: "#F0A48C", fontSize: 11 }}>
          <strong>Report incomplete.</strong>
          <div style={{ color: "#A8B8B0", marginTop: 3 }}>
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
            background: "transparent", color: "#8FA89A",
            border: "1px solid #33453C", borderRadius: 6, cursor: "pointer",
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
  return (
    <div className="as2p-rails">
      <aside className="as2p-rail as2p-rail-left">
        <div style={{ position: "sticky", top: 16 }}>
          <BudgetRail
            provider={provider}
            estimate={estimate}
            onCalculate={onCalculate}
            calculating={calculating}
          />
        </div>
      </aside>

      <div className="as2p-rail-main">{children}</div>

      <aside className="as2p-rail as2p-rail-right">
        <div style={{ position: "sticky", top: 16 }}>
          <UsageRail usage={usage} provider={provider} partial={partial} onReset={onReset} />
        </div>
      </aside>
    </div>
  );
}
