import { Component, type ReactNode } from "react";
import { color, font } from "../theme/tokens.js";
import { HoverButton } from "./primitives.js";
import { reportError } from "../lib/report.js";

interface Props {
  children: ReactNode;
  /** When this changes (e.g. a navigation), a prior crash is cleared so the user
   *  isn't stuck on the error card after moving away from the broken view. */
  resetKey?: string | number;
}
interface State {
  error: Error | null;
  key: string | number | undefined;
}

/** Catches render/runtime errors in its subtree and shows a recoverable card instead
 *  of letting an exception unmount the whole app (the dreaded black screen). Scoped
 *  around the main content so the ActionBar/StatusBar stay live and the user can
 *  navigate away or reload. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Durable capture so the crash is diagnosable after the fact, not just logged.
    reportError("react", error, { componentStack: info?.componentStack ?? null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <div style={{ maxWidth: 560, width: "100%", background: color.panelBg, border: `1px solid ${color.borderRow}`, borderRadius: 12, padding: "22px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: color.text, marginBottom: 8 }}>This view hit an error</div>
          <div style={{ fontSize: 12.5, color: color.textFaint, lineHeight: 1.55, marginBottom: 14 }}>
            The rest of the app is still running — switch views or reload to recover.
          </div>
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              background: color.appBg,
              border: `1px solid ${color.borderRowFaint}`,
              borderRadius: 8,
              fontFamily: font.mono,
              fontSize: 11.5,
              color: "#ca9aa0",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {error.message || String(error)}
          </pre>
          <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
            <HoverButton
              onClick={() => this.setState({ error: null })}
              style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${color.borderChip2}`, borderRadius: 8, color: color.textSoft, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              hoverStyle={{ borderColor: "var(--lk-borderInput)" }}
            >
              Dismiss
            </HoverButton>
            <HoverButton
              onClick={() => window.location.reload()}
              style={{ padding: "8px 14px", background: color.violet, border: `1px solid ${color.violet}`, borderRadius: 8, color: "#fff", fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              hoverStyle={{ background: color.violetHover }}
            >
              Reload app
            </HoverButton>
          </div>
        </div>
      </div>
    );
  }
}
