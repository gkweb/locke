import { useEffect } from "react";
import { useStore } from "./state/store.js";
import { color } from "./theme/tokens.js";
import { Titlebar } from "./components/Titlebar.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { ListView } from "./views/ListView.js";
import { OverviewView } from "./views/OverviewView.js";
import { ReviewView } from "./views/ReviewView.js";

export function App() {
  const view = useStore((s) => s.view);
  const detectAgents = useStore((s) => s.detectAgents);
  const loadAgentSettings = useStore((s) => s.loadAgentSettings);
  const settingsOpen = useStore((s) => s.settingsOpen);

  // Probe installed agent CLIs and load app-global opt-outs once on launch
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
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Titlebar />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {view === "list" && <ListView />}
        {view === "overview" && <OverviewView />}
        {view === "review" && <ReviewView />}
      </div>
      {settingsOpen && <SettingsModal />}
    </div>
  );
}
