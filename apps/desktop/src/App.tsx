import { useEffect } from "react";
import { useStore } from "./state/store.js";
import { color, font } from "./theme/tokens.js";
import { ActionBar } from "./components/ActionBar.js";
import { SidePanel } from "./components/SidePanel.js";
import { StatusBar } from "./components/StatusBar.js";
import type { View } from "@locke/core";

// The Mission Control shell: three stacked regions — top ActionBar · middle
// [SidePanel + main router] · bottom StatusBar. The fleet screens (Activity /
// Reviews / Runs / Agents) and the Review Workspace land in Phase 3–4; for now
// the main area renders a stub per `view`.

const VIEW_LABEL: Record<View, string> = {
  activity: "Activity",
  reviews: "Reviews",
  runs: "Runs",
  agents: "Agents",
  workspace: "Review Workspace",
};

function StubScreen({ view }: { view: View }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: color.appBg,
        color: color.textFaint,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color: color.textBright, letterSpacing: "-.4px" }}>
        {VIEW_LABEL[view]}
      </div>
      <div style={{ fontSize: 12, color: color.textGhost }}>Mission Control — coming together, phase by phase.</div>
    </div>
  );
}

export function App() {
  const view = useStore((s) => s.view);
  const panelOpen = useStore((s) => s.panelOpen);
  const panelSide = useStore((s) => s.panelSide);
  const detectAgents = useStore((s) => s.detectAgents);
  const loadAgentSettings = useStore((s) => s.loadAgentSettings);

  // Probe installed agent CLIs and load app-global opt-outs + mode once on launch
  // (repo-independent — the agents directory is reachable with no repo open).
  useEffect(() => {
    void detectAgents();
    void loadAgentSettings();
  }, [detectAgents, loadAgentSettings]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: color.appBg,
        color: color.text,
        fontFamily: font.sans,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <ActionBar />

      <div
        style={{
          flex: 1,
          display: "flex",
          // Same DOM order renders mirrored when the panel is docked right.
          flexDirection: panelSide === "right" ? "row-reverse" : "row",
          minHeight: 0,
        }}
      >
        {panelOpen && <SidePanel />}
        <StubScreen view={view} />
      </div>

      <StatusBar />
    </div>
  );
}
