import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "./state/store.js";
import { isTauri, type RunDonePayload, type RunEventPayload, type RunPermissionPayload } from "./api/git.js";
import { color, font } from "./theme/tokens.js";
import { ActionBar } from "./components/ActionBar.js";
import { SidePanel } from "./components/SidePanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { ActivityView } from "./views/ActivityView.js";
import { ReviewsView } from "./views/ReviewsView.js";
import { RunsView } from "./views/RunsView.js";
import { AgentsView } from "./views/AgentsView.js";
import { WorkspaceView } from "./views/WorkspaceView.js";
import { NewReviewModal } from "./components/NewReviewModal.js";
import { OpenRepoEmpty } from "./components/OpenRepoEmpty.js";

// The Mission Control shell: three stacked regions — top ActionBar · middle
// [SidePanel + main router] · bottom StatusBar.

function Main() {
  const view = useStore((s) => s.view);
  const reviews = useStore((s) => s.reviews);

  // The fleet home/list hand off to the empty state when there are no reviews —
  // prompting to open a repository (none open) or start one (repo open, no
  // reviews yet). Runs/Agents/Workspace keep their own states.
  if (reviews.length === 0 && (view === "activity" || view === "reviews")) {
    return <OpenRepoEmpty />;
  }

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
  const panelOpen = useStore((s) => s.panelOpen);
  const panelSide = useStore((s) => s.panelSide);
  const newReviewOpen = useStore((s) => s.newReviewOpen);
  const detectAgents = useStore((s) => s.detectAgents);
  const loadAgentSettings = useStore((s) => s.loadAgentSettings);

  // Probe installed agent CLIs and load app-global opt-outs + mode once on launch
  // (repo-independent — the agents directory is reachable with no repo open).
  useEffect(() => {
    void detectAgents();
    void loadAgentSettings();
  }, [detectAgents, loadAgentSettings]);

  // Route the backend's live run stream (Tauri events) into the store. Set up
  // once; handlers resolve the target review by runId internally.
  useEffect(() => {
    if (!isTauri) return;
    const s = useStore.getState();
    const unlisten = Promise.all([
      listen<RunEventPayload>("run:event", (e) => s.onRunEvent(e.payload)),
      listen<RunPermissionPayload>("run:permission", (e) => s.onRunPermission(e.payload)),
      listen<RunDonePayload>("run:done", (e) => s.onRunDone(e.payload)),
    ]);
    return () => {
      void unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

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
        <Main />
      </div>

      <StatusBar />
      {newReviewOpen && <NewReviewModal />}
    </div>
  );
}
