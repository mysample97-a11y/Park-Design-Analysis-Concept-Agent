// src/components/TokenMeter.jsx
// ---------------------------------------------------------------------------
// One per tool. Sits directly beside the button that spends tokens, because a
// budget readout on a different screen is a readout nobody looks at.
//
// It shows three things and distinguishes them clearly:
//   USED       what this tool has actually consumed (provider-reported where
//              available, estimated and labelled as such where not)
//   ESTIMATE   what the next run is likely to need, from the current inputs
//   OUTLOOK    a plain-language verdict on whether that will complete
//
// Deliberately NOT shown: a percentage of quota. Providers publish rate limits
// rather than a lifetime budget, so any percentage would be invented precision.
// ---------------------------------------------------------------------------

import React from "react";
import { formatTokens, runOutlook, TIER_REFERENCE, requestWindows, getLimits, capacityCheck } from "../utils/tokenMeter";

const LEVEL_STYLE = {
  low:     { bg: "#EAF3EC", bd: "#BBD6C2", fg: "#2F5D3F" },
  medium:  { bg: "#FBF3E4", bd: "#E4D2A8", fg: "#7A5B18" },
  high:    { bg: "#FBECE8", bd: "#E8C2B6", fg: "#8A3B22" },
  unknown: { bg: "#F2F2F0", bd: "#DADAD6", fg: "#5A5A5A" },
};

export default function TokenMeter({
  usage,                 // {input, output, total, calls, estimated}
  estimate,              // {input, output, total, calls} | null
  provider = "claude",
  partial = null,        // {done:[], remaining:[]} when a run stopped early
  onReset = null,
  onCalculate = null,
  calculating = false,
  compact = false,
}) {
  const u = usage || { total: 0, calls: 0, estimated: false };
  const estTotal = estimate ? estimate.total : 0;
  // Requests are checked first: RPM/RPD is the dimension that actually stops a
  // run on a free key, and a token-only verdict would show false headroom.
  const win = requestWindows(provider);
  const lim = getLimits(provider);
  const capacity = capacityCheck(provider, estimate);
  const outlook = capacity.level === "low" ? runOutlook(estTotal, u) : capacity;
  const st = LEVEL_STYLE[outlook.level] || LEVEL_STYLE.unknown;
  const tier = TIER_REFERENCE[provider] || null;

  return (
    <div
      className="token-meter"
      style={{
        border: `1px solid ${st.bd}`,
        background: st.bg,
        borderRadius: 8,
        padding: compact ? "8px 10px" : "10px 12px",
        fontSize: 12.5,
        color: "#1C2333",
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 10.5, letterSpacing: 0.6, color: "#5A5A5A", textTransform: "uppercase" }}>
            Used by this tool
          </div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>
            {formatTokens(u.total)}
            <span style={{ fontSize: 11, fontWeight: 400, color: "#5A5A5A" }}>
              {" "}tokens{u.calls ? ` · ${u.calls} call${u.calls === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          {u.estimated && (
            <div style={{ fontSize: 10.5, color: "#7A5B18" }}>
              includes estimated figures — provider did not report usage
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 10.5, letterSpacing: 0.6, color: "#5A5A5A", textTransform: "uppercase" }}>
            Estimated for next run
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: st.fg }}>
            {estTotal ? "~" + formatTokens(estTotal) : "—"}
            {estimate && estimate.calls > 1 && (
              <span style={{ fontSize: 11, fontWeight: 400, color: "#5A5A5A" }}>
                {" "}over {estimate.calls} calls
              </span>
            )}
          </div>
          {estimate && (
            <div style={{ fontSize: 10.5, color: "#5A5A5A" }}>
              {estimate.exact ? "exact " : "~"}{formatTokens(estimate.input)} in · ~{formatTokens(estimate.output)} out
              {estimate.exact ? " (counted by the provider)" : ""}
            </div>
          )}
          {onCalculate && (
            <button type="button" onClick={onCalculate} disabled={calculating}
              style={{ marginTop: 5, fontSize: 10.5, padding: "3px 8px", borderRadius: 5,
                border: `1px solid ${st.bd}`, background: "#131C29", color: "#3C3C3C",
                cursor: calculating ? "default" : "pointer" }}>
              {calculating ? "Counting…" : "Calculate exact tokens"}
            </button>
          )}
        </div>

        {onReset && u.total > 0 && (
          <button
            type="button"
            onClick={onReset}
            style={{
              marginLeft: "auto", alignSelf: "center", background: "transparent",
              border: `1px solid ${st.bd}`, borderRadius: 6, padding: "4px 9px",
              fontSize: 11, color: "#5A5A5A", cursor: "pointer",
            }}
          >
            Reset counter
          </button>
        )}
      </div>

      <div style={{ marginTop: 7, color: st.fg, fontWeight: 500 }}>{outlook.message}</div>

      <div style={{ marginTop: 5, fontSize: 11, color: "#5A5A5A" }}>
        Requests: <strong>{win.lastMinute}</strong>
        {lim.rpm ? ` / ${lim.rpm}` : ""} this minute
        {lim.rpd ? <> · <strong>{win.lastDay}</strong> / {lim.rpd} today</> : null}
        {lim.isDefault && " (published defaults — set your tier in Settings)"}
      </div>

      {partial && Array.isArray(partial.remaining) && partial.remaining.length > 0 && (
        <div
          style={{
            marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${st.bd}`,
            fontSize: 12, color: "#8A3B22",
          }}
        >
          <strong>This report is incomplete.</strong>{" "}
          {Array.isArray(partial.done) && partial.done.length > 0 && (
            <>Generated: {partial.done.join(", ")}. </>
          )}
          Still to generate: {partial.remaining.join(", ")}.
          <div style={{ color: "#5A5A5A", marginTop: 3 }}>
            Use “Continue insight generation” to resume. You may switch to a different
            API key first — the work already done is kept.
          </div>
        </div>
      )}

      <div style={{ marginTop: 7, fontSize: 10.5, color: "#6B6B6B" }}>
        Estimates are approximate (±10–15%) — exact tokenisation is model-specific.
        {tier ? ` ${tier.note}` : ""}
      </div>
    </div>
  );
}
