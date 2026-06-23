import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { FolderIcon, BranchIcon, ShieldIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// Bottom status bar — repo + branch context, live fleet counts (agent-mode
// only), and push state. Pill segments mirror the design.

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 9px",
  borderRadius: 7,
  background: color.popoverBg,
  border: `1px solid ${color.borderRow}`,
  fontFamily: font.mono,
};

// Abbreviate a home-dir path to ~ for display, matching the design.
function tildePath(p: string | null): string {
  if (!p) return "no repository";
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length).split("/").slice(1).join("/");
    return rest ? `~/${rest}` : "~";
  }
  return p;
}

export function StatusBar() {
  const repoPath = useStore((s) => s.repoPath);
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const base = useStore((s) => s.base);
  const agentMode = useStore((s) => s.agentMode);
  const pending = useStore((s) => s.pending);
  const toggleApprovals = useStore((s) => s.toggleApprovals);
  const pushed = useStore((s) => s.pushed);

  const selected = reviews.find((r) => r.id === selectedPR);
  const branch = selected?.branch ?? base;
  const working = reviews.filter((r) => r.runState === "running" || r.runState === "awaiting").length;
  const awaiting = pending.length;

  return (
    <div
      style={{
        height: 30,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 13px",
        background: color.titlebarBg,
        borderTop: `1px solid ${color.borderSubtle}`,
        fontSize: 11,
      }}
    >
      <span style={{ ...pill, color: color.textFaint }}>
        <FolderIcon size={11} color={color.textFainter} stroke={1.3} />
        {tildePath(repoPath)}
      </span>
      <span style={{ ...pill, color: color.greenText }}>
        <BranchIcon size={11} color="#7b8494" stroke={1.4} />
        {branch}
      </span>

      {agentMode && working > 0 && (
        <span style={{ ...pill, color: color.teal }}>
          <span
            style={{ width: 6, height: 6, borderRadius: "50%", background: color.teal, animation: "lkpulse 2s infinite" }}
          />
          {working} {working === 1 ? "agent" : "agents"} working
        </span>
      )}

      {agentMode && awaiting > 0 && (
        <HoverButton
          onClick={toggleApprovals}
          style={{
            ...pill,
            color: color.amber,
            background: alpha.amber(0.1),
            border: `1px solid ${alpha.amber(0.3)}`,
            cursor: "pointer",
          }}
          hoverStyle={{ background: alpha.amber(0.16) }}
        >
          <span
            style={{ width: 6, height: 6, borderRadius: "50%", background: color.amber, animation: "lkpulse 1.4s infinite" }}
          />
          {awaiting} awaiting you
        </HoverButton>
      )}

      <div style={{ flex: 1 }} />

      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", fontFamily: font.mono, color: color.textFainter }}>
        <ShieldIcon size={11} color={pushed ? color.green : color.green} stroke={1.3} />
        {pushed ? "pushed to origin" : "nothing pushed yet"}
      </span>
      <span style={{ fontFamily: font.mono, color: "#454d5b" }}>Locke · local</span>
    </div>
  );
}
