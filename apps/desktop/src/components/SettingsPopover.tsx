import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { AgentsIcon, ReviewsIcon, CheckIcon } from "./icons.js";

// The action-bar settings popover. Its one job today is the global MODE switch:
// "Agent control" (runs, live permissions, approvals, agents directory) vs
// "Reviews only" (branches, diffs, checks, history — the agent surface hidden).
// Replaces the old full-screen SettingsModal; per-agent enablement lives on the
// Agents screen.

function ModeRow({
  active,
  accent,
  accentBg,
  accentBorder,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  accent: string;
  accentBg: string;
  accentBorder: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        width: "100%",
        textAlign: "left",
        padding: "11px 12px",
        borderRadius: 10,
        cursor: "pointer",
        fontFamily: font.sans,
        marginBottom: 8,
        background: active ? "#141a24" : color.panelBg,
        border: `1px solid ${active ? "#2a3344" : "#1c212b"}`,
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          flex: "none",
          borderRadius: 8,
          background: accentBg,
          border: `1px solid ${accentBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: accent,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: color.text }}>{title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: color.textFaint, lineHeight: 1.45, marginTop: 2 }}>
          {desc}
        </span>
      </span>
      <CheckIcon size={15} color={accent} stroke={1.9} style={{ flex: "none", marginTop: 2, opacity: active ? 1 : 0 }} />
    </button>
  );
}

export function SettingsPopover() {
  const agentMode = useStore((s) => s.agentMode);
  const setAgentMode = useStore((s) => s.setAgentMode);

  return (
    <div
      style={{
        position: "absolute",
        top: 50,
        right: 13,
        width: 300,
        background: color.popoverBg,
        border: `1px solid ${color.borderPopover}`,
        borderRadius: 13,
        boxShadow: "0 20px 60px -16px rgba(0,0,0,.7)",
        overflow: "hidden",
        zIndex: 60,
      }}
    >
      <div style={{ padding: "13px 15px 11px", borderBottom: `1px solid ${color.borderRail}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: color.text }}>Settings</div>
      </div>
      <div style={{ padding: "13px 14px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".7px", color: color.textGhost, marginBottom: 10 }}>
          MODE
        </div>
        <ModeRow
          active={agentMode}
          accent={color.teal}
          accentBg={alpha.teal(0.12)}
          accentBorder={alpha.teal(0.3)}
          icon={<AgentsIcon size={16} stroke={1.5} />}
          title="Agent control"
          desc="Runs, live permissions, approvals and the agents directory."
          onClick={() => setAgentMode(true)}
        />
        <ModeRow
          active={!agentMode}
          accent={color.violetLight}
          accentBg={alpha.violet(0.12)}
          accentBorder={alpha.violet(0.3)}
          icon={<ReviewsIcon size={16} stroke={1.5} />}
          title="Reviews only"
          desc="Just branches, diffs, checks and history. Agent features hidden."
          onClick={() => setAgentMode(false)}
        />
      </div>
    </div>
  );
}
