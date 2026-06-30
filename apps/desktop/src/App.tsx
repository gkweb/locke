import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "./state/store.js";
import {
  isTauri,
  takeInitialRepo,
  type RunDonePayload,
  type RunEventPayload,
  type RunPermissionPayload,
  type LoopItemEvent,
  type LoopProgress,
  type LoopEventPayload,
  type LoopTrailEvent,
  type LoopBlockEvent,
  type LoopDonePayload,
  type LoopReviewEvent,
  type LoopInterviewEvent,
} from "./api/git.js";
import { color, font } from "./theme/tokens.js";
import { ActionBar } from "./components/ActionBar.js";
import { SidePanel } from "./components/SidePanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { ActivityView } from "./views/ActivityView.js";
import { LoopsView } from "./views/loops/LoopsView.js";
import { ReviewsView } from "./views/ReviewsView.js";
import { RunsView } from "./views/RunsView.js";
import { AgentsView } from "./views/AgentsView.js";
import { FilesView } from "./views/FilesView.js";
import { ExtensionsView } from "./views/ExtensionsView.js";
import { IntegrationsView } from "./views/IntegrationsView.js";
import { SettingsView } from "./views/SettingsView.js";
import { WorkspaceView } from "./views/WorkspaceView.js";
import { NewReviewModal } from "./components/NewReviewModal.js";
import { DeletePullModal } from "./components/DeletePullModal.js";
import { RunApprovalModal } from "./components/RunApprovalModal.js";
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
    case "loops":
      return <LoopsView />;
    case "reviews":
      return <ReviewsView />;
    case "runs":
      return <RunsView />;
    case "agents":
      return <AgentsView />;
    case "files":
      return <FilesView />;
    case "extensions":
      return <ExtensionsView />;
    case "integrations":
      return <IntegrationsView />;
    case "settings":
      return <SettingsView />;
    case "workspace":
      return <WorkspaceView />;
  }
}

export function App() {
  const panelOpen = useStore((s) => s.panelOpen);
  const panelSide = useStore((s) => s.panelSide);
  const view = useStore((s) => s.view);
  const newReviewOpen = useStore((s) => s.newReviewOpen);
  const deletePullPending = useStore((s) => s.deletePullPending);
  const runApprovalOpen = useStore((s) => s.runApprovalOpen);
  const detectAgents = useStore((s) => s.detectAgents);
  const loadAgentSettings = useStore((s) => s.loadAgentSettings);
  const loadMcpStatus = useStore((s) => s.loadMcpStatus);
  const loadCliStatus = useStore((s) => s.loadCliStatus);

  // Probe installed agent CLIs and load app-global opt-outs + mode once on launch
  // (repo-independent — the agents directory is reachable with no repo open). Also
  // probe the Locke MCP server + `locke` CLI status for the Integrations panel, and
  // open the repo passed by a cold `locke <path>` launch.
  useEffect(() => {
    void detectAgents();
    void loadAgentSettings();
    void loadMcpStatus();
    void loadCliStatus();
    void takeInitialRepo().then((path) => {
      if (path) void useStore.getState().openRepo(path);
    });
  }, [detectAgents, loadAgentSettings, loadMcpStatus, loadCliStatus]);

  // Route the backend's live run stream (Tauri events) into the store. Set up
  // once; handlers resolve the target review by runId internally.
  useEffect(() => {
    if (!isTauri) return;
    const s = useStore.getState();
    // Coalesce bursts of `.locke` change events into a single refresh.
    let fsTimer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = Promise.all([
      listen<RunEventPayload>("run:event", (e) => s.onRunEvent(e.payload)),
      listen<RunPermissionPayload>("run:permission", (e) => s.onRunPermission(e.payload)),
      listen<RunDonePayload>("run:done", (e) => s.onRunDone(e.payload)),
      // The loop runner's fan-out stream (parallel to run:*).
      listen<LoopItemEvent>("loop:item", (e) => s.onLoopItem(e.payload)),
      listen<LoopProgress>("loop:progress", (e) => s.onLoopProgress(e.payload)),
      listen<LoopEventPayload>("loop:event", (e) => s.onLoopEvent(e.payload)),
      listen<LoopTrailEvent>("loop:trail", (e) => s.onLoopTrail(e.payload)),
      listen<LoopBlockEvent>("loop:block", (e) => s.onLoopBlock(e.payload)),
      listen<LoopDonePayload>("loop:done", (e) => s.onLoopDone(e.payload)),
      listen<LoopReviewEvent>("loop:review", (e) => s.onLoopReview(e.payload)),
      listen<LoopInterviewEvent>("loop:interview", (e) => s.onLoopInterview(e.payload)),
      // A second `locke <path>` launch is forwarded here by the single-instance
      // plugin — switch the open window to that repo.
      listen<string>("cli:open-repo", (e) => void useStore.getState().openRepo(e.payload)),
      // The repo's `.locke/` changed out of process (MCP edits, agent comment
      // replies). Debounce, then refresh the open review — but not mid-run, where
      // the run:done handler already reloads and live churn would just thrash.
      listen("locke:fs-change", () => {
        if (fsTimer) clearTimeout(fsTimer);
        fsTimer = setTimeout(() => {
          const st = useStore.getState();
          // Don't refresh mid-run on the open review — run:done already reloads,
          // and live churn would thrash.
          if (st.runs[st.selectedPR]?.runId) return;
          if (st.view === "workspace" && st.selectedPR) void st.refreshWorkspace();
        }, 400);
      }),
    ]);
    return () => {
      if (fsTimer) clearTimeout(fsTimer);
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
        {/* Files carries its own explorer and Loops its own rails/navigation, so
            the review quick-switch panel hides on both. */}
        {panelOpen && view !== "files" && view !== "loops" && <SidePanel />}
        <Main />
      </div>

      <StatusBar />
      {newReviewOpen && <NewReviewModal />}
      {deletePullPending && <DeletePullModal />}
      {runApprovalOpen && <RunApprovalModal />}
    </div>
  );
}
