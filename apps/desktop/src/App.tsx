import { useEffect } from "react";
import { useStore } from "./state/store.js";
import { color, font } from "./theme/tokens.js";
import { ActionBar } from "./components/ActionBar.js";
import { SidePanel } from "./components/SidePanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { ActivityView } from "./views/ActivityView.js";
import { ReviewsView } from "./views/ReviewsView.js";
import { RunsView } from "./views/RunsView.js";
import { AgentsView } from "./views/AgentsView.js";
import { WorkspaceView } from "./views/WorkspaceView.js";
import type { View } from "@locke/core";

// The Mission Control shell: three stacked regions — top ActionBar · middle
// [SidePanel + main router] · bottom StatusBar.

function Main({ view }: { view: View }) {
  switch (view) {
    case "activity":
      return <ActivityView />;
    case "reviews":
      return <ReviewsView />;
    case "runs":
      return <RunsView />;
    case "agents":
      return <AgentsView />;
    case "workspace":
      return <WorkspaceView />;
  }
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
        <Main view={view} />
      </div>

      <StatusBar />
    </div>
  );
}
