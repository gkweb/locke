import type { NavPlacement } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { AgentsIcon, ReviewsIcon, CheckIcon, ExtensionsIcon, ChevronRightIcon } from "./icons.js";
import { NAV_ITEMS } from "../lib/nav.js";
import { HoverButton } from "./primitives.js";

// The action-bar settings popover. The global MODE switch — "Agent control"
// (runs, live permissions, approvals, agents directory) vs "Reviews only"
// (branches, diffs, checks, history) — plus per-destination NAVIGATION placement
// (top bar / bottom bar / off) and an entry into the Extensions screen. Replaces
// the old full-screen SettingsModal; per-agent enablement lives on the Agents
// screen.

const PLACEMENTS: { value: NavPlacement; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
  { value: "off", label: "Off" },
];

function NavConfigRow({
  label,
  glyph,
  place,
  onSet,
}: {
  label: string;
  glyph: string;
  place: NavPlacement;
  onSet: (p: NavPlacement) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px" }}>
      <span
        style={{
          width: 24,
          height: 24,
          flex: "none",
          borderRadius: 7,
          background: "#11151d",
          border: `1px solid ${color.borderRow2}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: color.textFaint,
        }}
      >
        <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d={glyph} />
        </svg>
      </span>
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: color.textSoft }}>{label}</span>
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: 2,
          background: "#0b0d12",
          border: `1px solid ${color.borderRow2}`,
          borderRadius: 8,
          flex: "none",
        }}
      >
        {PLACEMENTS.map((p) => {
          const on = place === p.value;
          return (
            <button
              key={p.value}
              onClick={() => onSet(p.value)}
              style={{
                padding: "3px 8px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: font.sans,
                fontSize: 10.5,
                fontWeight: 600,
                background: on ? "#222c3c" : "transparent",
                color: on ? color.text : color.textFainter,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const navPlace = useStore((s) => s.navPlace);
  const setNavPlace = useStore((s) => s.setNavPlace);
  const goExtensions = useStore((s) => s.goExtensions);

  const navItems = NAV_ITEMS.filter((item) => !item.agentOnly || agentMode);

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

        <div style={{ height: 1, background: color.borderRail, margin: "13px 0" }} />

        <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".7px", color: color.textGhost }}>
            NAVIGATION
          </span>
          <span style={{ fontSize: 10, color: "#4f5765" }}>where each destination lives</span>
        </div>
        {navItems.map((item) => (
          <NavConfigRow
            key={item.key}
            label={item.label}
            glyph={item.glyph}
            place={navPlace[item.key]}
            onSet={(p) => setNavPlace(item.key, p)}
          />
        ))}

        <div style={{ height: 1, background: color.borderRail, margin: "13px 0" }} />

        <HoverButton
          onClick={goExtensions}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            width: "100%",
            textAlign: "left",
            padding: "11px 12px",
            borderRadius: 10,
            cursor: "pointer",
            fontFamily: font.sans,
            background: "#0e1117",
            border: `1px solid ${color.borderRow2}`,
          }}
          hoverStyle={{ borderColor: color.borderPopover }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              flex: "none",
              borderRadius: 8,
              background: alpha.violet(0.12),
              border: `1px solid ${alpha.violet(0.3)}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: color.violetLight,
            }}
          >
            <ExtensionsIcon size={16} stroke={1.4} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: color.text }}>Extensions</span>
            <span style={{ display: "block", fontSize: 11.5, color: color.textFaint, lineHeight: 1.45, marginTop: 2 }}>
              Languages and tools Locke loads.
            </span>
          </span>
          <ChevronRightIcon size={14} color={color.textGhost} stroke={1.7} style={{ flex: "none" }} />
        </HoverButton>
      </div>
    </div>
  );
}
