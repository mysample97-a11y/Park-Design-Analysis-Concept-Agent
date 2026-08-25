import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

/*
 * TOP-LEVEL CRASH SCREEN
 *
 * A React error above the per-tool boundary unmounts the whole tree and leaves a
 * BLANK WHITE PAGE with nothing on screen to say what happened. Diagnosing that
 * means opening DevTools and reading a minified stack - a bad thing to ask of
 * anyone.
 *
 * This sits at the root and catches what the per-tool boundaries do not. It also
 * listens for errors thrown OUTSIDE React's render cycle - event handlers, async
 * callbacks, module evaluation - which React boundaries cannot see at all. Those
 * are exactly the ones that blanked the page when a component was used without
 * being imported.
 *
 * The page can still fail. It can no longer fail SILENTLY.
 */
class RootBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, source: "render" };
  }

  static getDerivedStateFromError(error) {
    return { error, source: "render" };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("[root] render error:", error, info);
  }

  componentDidMount() {
    this.onError = (e) => {
      if (this.state.error) return;
      this.setState({ error: e.error || new Error(e.message || "Unknown error"), source: "runtime" });
    };
    this.onRejection = (e) => {
      if (this.state.error) return;
      const r = e.reason;
      this.setState({ error: r instanceof Error ? r : new Error(String(r)), source: "promise" });
    };
    window.addEventListener("error", this.onError);
    window.addEventListener("unhandledrejection", this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.onError);
    window.removeEventListener("unhandledrejection", this.onRejection);
  }

  render() {
    const { error, info, source } = this.state;
    if (!error) return this.props.children;
    const msg = String(error && error.message ? error.message : error);
    const stack = (error && error.stack ? error.stack : "").split("\n").slice(0, 12).join("\n");

    return (
      <div style={{ background: "#0A0E14", minHeight: "100vh", padding: 16 }}>
        <div style={{ maxWidth: 780, margin: "56px auto", padding: "22px 24px",
          background: "#121924", border: "1px solid #7A3B33", borderRadius: 12,
          color: "#E8EFF7", fontFamily: "Inter, Segoe UI, system-ui, sans-serif",
          fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#FFB2A2", marginBottom: 8 }}>
            The app hit an error and stopped
          </div>
          <p style={{ marginTop: 0 }}>
            This screen exists so the page never just goes blank. The message below
            is the actual fault - copy it and it can be fixed directly.
          </p>
          <div style={{ background: "#0B121C", border: "1px solid #22304A", borderRadius: 8,
            padding: "10px 12px", margin: "12px 0", fontFamily: "monospace",
            fontSize: 12.5, color: "#FFC79A", wordBreak: "break-word" }}>
            {msg}
            <div style={{ color: "#7E90A6", fontSize: 11, marginTop: 6 }}>caught at: {source}</div>
          </div>
          <p style={{ color: "#93A6BC", fontSize: 13 }}>
            <strong>Try a hard refresh first</strong> - Ctrl+Shift+R (Cmd+Shift+R on a Mac).
            A cached copy of an older build is the most common cause of an error that
            has already been fixed.
          </p>
          <p style={{ color: "#93A6BC", fontSize: 13 }}>
            Your saved work is unaffected. API keys, token counters and any AI output
            already generated are stored separately and survive this.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button type="button" onClick={() => window.location.reload()}
              style={{ padding: "7px 14px", fontSize: 13, borderRadius: 7, cursor: "pointer",
                background: "#21456F", border: "1px solid #4DA3FF", color: "#EAF3FF" }}>
              Reload
            </button>
            <button type="button"
              onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(msg + "\n\n" + stack); }}
              style={{ padding: "7px 14px", fontSize: 13, borderRadius: 7, cursor: "pointer",
                background: "#101825", border: "1px solid #33517A", color: "#D7E5F7" }}>
              Copy error detail
            </button>
          </div>
          <details style={{ marginTop: 14, fontSize: 12, color: "#93A6BC" }}>
            <summary style={{ cursor: "pointer" }}>Stack trace</summary>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, padding: 10, borderRadius: 8,
              background: "#0B121C", color: "#D7E5F7", fontSize: 11, maxHeight: 260, overflow: "auto" }}>
{stack}
{info && info.componentStack ? "\n--- component stack ---" + info.componentStack : ""}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootBoundary>
      <App />
    </RootBoundary>
  </React.StrictMode>
);
