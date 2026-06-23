import { getCurrentWindow } from "@tauri-apps/api/window";
import type { View } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";
import {
  BrandMark,
  SidebarIcon,
  ActivityIcon,
  ReviewsIcon,
  RunsIcon,
  AgentsIcon,
  SearchIcon,
  ShieldIcon,
  GearIcon,
} from "./icons.js";
import { HoverButton } from "./primitives.js";
import { ApprovalsTray } from "./ApprovalsTray.js";
import { SettingsPopover } from "./SettingsPopover.js";

// Window controls are no-ops outside a Tauri shell (plain `vite`), so the bar
// never throws in a browser.
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const win = () => (inTauri ? getCurrentWindow() : null);

const TrafficLight = ({ bg, title, onClick }: { bg: string; title: string; onClick: () => void }) => (
  <button
    title={title}
    onClick={onClick}
    style={{ width: 12, height: 12, borderRadius: "50%", background: bg, border: "none", padding: 0, cursor: "pointer" }}
  />
);

function NavButton({
  active,
  title,
  onClick,
  children,
  dot,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <HoverButton
      onClick={onClick}
      title={title}
      style={{
        position: "relative",
        width: 32,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 7,
        cursor: "pointer",
        background: active ? "#181d27" : "transparent",
        color: active ? color.text : "#7b8494",
      }}
      hoverStyle={active ? undefined : { background: "#14181f" }}
    >
      {children}
      {dot && (
        <span
          style={{ position: "absolute", top: 4, right: 5, width: 6, height: 6, borderRadius: "50%", background: color.teal }}
        />
      )}
    </HoverButton>
  );
}

export function ActionBar() {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const agentMode = useStore((s) => s.agentMode);
  const panelOpen = useStore((s) => s.panelOpen);
  const togglePanel = useStore((s) => s.togglePanel);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const approvalsOpen = useStore((s) => s.approvalsOpen);
  const toggleApprovals = useStore((s) => s.toggleApprovals);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const pending = useStore((s) => s.pending);

  const hasApprovals = agentMode && pending.length > 0;
  // The fleet nav highlights the matching destination; the workspace counts as
  // "reviews" so the nav still reads sensibly while drilled in.
  const navActive = (v: View) => view === v || (v === "reviews" && view === "workspace");

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 44,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 13px",
        background: color.titlebarBg,
        borderBottom: `1px solid ${color.borderSubtle}`,
        position: "relative",
        zIndex: 40,
      }}
    >
      {/* left cluster — traffic lights + panel toggle + brand */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <TrafficLight bg="#ff5f57" title="close" onClick={() => win()?.close()} />
        <TrafficLight bg="#febc2e" title="minimize" onClick={() => win()?.minimize()} />
        <TrafficLight bg="#28c840" title="zoom" onClick={() => win()?.toggleMaximize()} />
      </div>

      <HoverButton
        onClick={togglePanel}
        title="Toggle reviews panel"
        style={{
          width: 30,
          height: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
          marginLeft: 4,
          background: panelOpen ? "#161b24" : "transparent",
          color: panelOpen ? color.textSoft : "#7b8494",
        }}
        hoverStyle={{ background: "#14181f" }}
      >
        <SidebarIcon size={16} stroke={1.4} />
      </HoverButton>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 2 }}>
        <BrandMark size={18} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.2px" }}>Locke</span>
      </div>

      {/* view nav — compact icon segmented control */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: 3,
          background: color.navPillBg,
          border: `1px solid ${color.borderRow2}`,
          borderRadius: 10,
          marginLeft: 8,
        }}
      >
        <NavButton active={navActive("activity")} title="Activity" onClick={() => go("activity")}>
          <ActivityIcon size={16} stroke={1.5} />
        </NavButton>
        <NavButton active={navActive("reviews")} title="Reviews" onClick={() => go("reviews")}>
          <ReviewsIcon size={16} stroke={1.5} />
        </NavButton>
        <NavButton active={navActive("runs")} title="Runs" onClick={() => go("runs")}>
          <RunsIcon size={16} stroke={1.5} />
        </NavButton>
        {agentMode && (
          <NavButton active={navActive("agents")} title="Agents" onClick={() => go("agents")} dot>
            <AgentsIcon size={16} stroke={1.5} />
          </NavButton>
        )}
      </div>

      {/* center search */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 14px", minWidth: 0 }}>
        <div style={{ position: "relative", width: "100%", maxWidth: 520 }}>
          <SearchIcon
            size={14}
            color={color.textGhost}
            stroke={1.4}
            style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reviews, runs, agents…"
            style={{
              width: "100%",
              height: 32,
              padding: "0 12px 0 33px",
              background: color.popoverBg,
              border: `1px solid ${color.borderRow}`,
              borderRadius: 9,
              color: color.textSoft,
              fontFamily: font.sans,
              fontSize: 12.5,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* right cluster */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
        {agentMode && (
          <HoverButton
            onClick={toggleApprovals}
            title="Approvals"
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: approvalsOpen ? "#161b24" : "transparent",
              border: `1px solid ${approvalsOpen ? "#2e3645" : color.borderChip2}`,
              color: approvalsOpen ? color.text : color.textDim,
            }}
            hoverStyle={approvalsOpen ? undefined : { borderColor: "#2e3645" }}
          >
            <ShieldIcon size={13} stroke={1.5} />
            {hasApprovals && (
              <span
                style={{
                  minWidth: 16,
                  height: 16,
                  padding: "0 4px",
                  borderRadius: 9,
                  background: color.amber,
                  color: "#1c1206",
                  fontSize: 10,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {pending.length}
              </span>
            )}
          </HoverButton>
        )}

        <HoverButton
          onClick={toggleSettings}
          title="Settings"
          style={{
            width: 30,
            height: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `1px solid ${settingsOpen ? "#2e3645" : color.borderChip2}`,
            borderRadius: 8,
            cursor: "pointer",
            background: settingsOpen ? "#161b24" : "transparent",
          }}
          hoverStyle={{ borderColor: "#2e3645" }}
        >
          <GearIcon size={15} color={color.textFaint} stroke={1.4} />
        </HoverButton>

        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#7b6cff,#3fd0c0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            color: color.appBg,
          }}
        >
          G
        </span>
      </div>

      {agentMode && approvalsOpen && <ApprovalsTray />}
      {settingsOpen && <SettingsPopover />}
    </div>
  );
}
