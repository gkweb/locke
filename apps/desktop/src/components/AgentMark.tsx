import { font } from "../theme/tokens.js";

// Per-agent identity badge, ported from the design's `AgentMark` component.
// Color comes from the caller (currentColor): wrap in a span with `color` set to
// the agent's accent. `claude` = a 12-spoke sparkle, `codex` = a 6-ellipse
// flower, `human` = the author's initials.

interface AgentMarkProps {
  kind: "claude" | "codex" | "human";
  /** Initials shown for the `human` kind, e.g. "MA". */
  label?: string;
  px?: number;
}

// The claude sparkle is 12 lines radiating from center (24×24 viewBox).
const CLAUDE_LINES: [number, number, number, number][] = [
  [14.4, 12.0, 21.2, 12.0],
  [14.08, 13.2, 19.97, 16.6],
  [13.2, 14.08, 16.6, 19.97],
  [12.0, 14.4, 12.0, 21.2],
  [10.8, 14.08, 7.4, 19.97],
  [9.92, 13.2, 4.03, 16.6],
  [9.6, 12.0, 2.8, 12.0],
  [9.92, 10.8, 4.03, 7.4],
  [10.8, 9.92, 7.4, 4.03],
  [12.0, 9.6, 12.0, 2.8],
  [13.2, 9.92, 16.6, 4.03],
  [14.08, 10.8, 19.97, 7.4],
];

export function AgentMark({ kind, label = "", px = 12 }: AgentMarkProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 0 }}>
      {kind === "claude" && (
        <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round">
          {CLAUDE_LINES.map(([x1, y1, x2, y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </svg>
      )}
      {kind === "codex" && (
        <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <ellipse key={deg} cx="12" cy="7.4" rx="2.05" ry="4.6" transform={`rotate(${deg} 12 12)`} />
          ))}
        </svg>
      )}
      {kind === "human" && (
        <span style={{ fontWeight: 700, fontFamily: font.sans, lineHeight: 1, fontSize: Math.max(7, Math.round(px * 0.62)) }}>
          {label}
        </span>
      )}
    </span>
  );
}
