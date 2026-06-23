import { useEffect } from "react";
import { useStore } from "./state/store.js";
import { color, font } from "./theme/tokens.js";
import { Titlebar } from "./components/Titlebar.js";
import { SettingsModal } from "./components/SettingsModal.js";
import type { View } from "@locke/core";

// Phase 1 scaffolding: the Mission Control shell is three stacked regions —
// top action bar · middle [side panel + main router] · bottom status bar. The
// ActionBar / SidePanel / StatusBar components (Phase 2) and the real fleet
// screens (Phase 3–4) replace the placeholders below; for now the main area
// renders a stub per `view` so the new nav model compiles and runs end-to-end.

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
  const detectAgents = useStore((s) => s.detectAgents);
  const loadAgentSettings = useStore((s) => s.loadAgentSettings);
  const settingsOpen = useStore((s) => s.settingsOpen);

  // Probe installed agent CLIs and load app-global opt-outs + mode once on launch
  // (repo-independent — Settings is reachable with no repo open).
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
      {/* Top region — ActionBar lands in Phase 2; Titlebar is the placeholder. */}
      <Titlebar />

      {/* Middle region — SidePanel + main router. SidePanel lands in Phase 2. */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <StubScreen view={view} />
      </div>

      {/* Bottom region — StatusBar lands in Phase 2. */}
      <div
        style={{
          height: 30,
          flex: "none",
          display: "flex",
          alignItems: "center",
          padding: "0 13px",
          background: color.titlebarBg,
          borderTop: `1px solid ${color.borderSubtle}`,
          fontSize: 11,
          color: color.textGhost,
          fontFamily: font.mono,
        }}
      >
        Locke · local
      </div>

      {settingsOpen && <SettingsModal />}
    </div>
  );
}
