// src/components/ToolErrorBoundary.jsx
//
// A React render error unmounts the whole tree and leaves a BLANK WHITE PAGE
// with no message. That happened when continuation dropped array sections and
// the report renderer called .map() on undefined - the underlying bug is fixed,
// but the failure MODE was the worse problem: no error, no recovery, and every
// unsaved input in every mounted tool gone.
//
// This confines any future render error to the tool that threw. The rails, the
// other tools and their state all survive, and the user is told what happened
// and offered a recovery that does not cost them their work.
//
// Deliberately a class component: error boundaries have no hooks equivalent.

import React from "react";

export default class ToolErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Keep it in the console for diagnosis; the UI stays readable.
    // eslint-disable-next-line no-console
    console.error(`[${this.props.toolName || "tool"}] render error:`, error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const name = this.props.toolName || "This tool";
    return (
      <div
        style={{
          border: "1px solid #7A3B33",
          background: "rgba(255, 99, 71, 0.10)",
          borderRadius: 10,
          padding: "16px 18px",
          color: "#FFB2A2",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
          {name} hit a display error
        </div>

        <p style={{ margin: "0 0 8px" }}>
          Something in this tool failed while drawing the screen. The rest of the
          app is unaffected — your other tools, their inputs and your token
          counters are all intact.
        </p>

        <p style={{ margin: "0 0 10px" }}>
          <strong>Nothing generated has been lost.</strong> Partial AI output is
          saved as it arrives, so reloading the page brings it back.
        </p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => this.setState({ error: null, info: null })}
            style={{
              padding: "6px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
              background: "#21456F", border: "1px solid #4DA3FF", color: "#EAF3FF",
            }}
          >
            Try drawing it again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "6px 12px", fontSize: 12, borderRadius: 6, cursor: "pointer",
              background: "#101825", border: "1px solid #33517A", color: "#D7E5F7",
            }}
          >
            Reload the page
          </button>
        </div>

        <details style={{ fontSize: 11, color: "#C79A90" }}>
          <summary style={{ cursor: "pointer" }}>Technical detail</summary>
          <pre
            style={{
              whiteSpace: "pre-wrap", marginTop: 6, padding: 8, borderRadius: 6,
              background: "#0B121C", color: "#D7E5F7", fontSize: 10.5,
              maxHeight: 200, overflow: "auto",
            }}
          >
{String(error && error.message ? error.message : error)}
{info && info.componentStack ? "\n" + info.componentStack.split("\n").slice(0, 8).join("\n") : ""}
          </pre>
        </details>
      </div>
    );
  }
}
