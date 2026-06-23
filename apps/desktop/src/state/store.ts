import { create } from "zustand";
import type {
  Approval,
  ChangedFile,
  DiffMode,
  HistoryEntry,
  Review,
  ReviewDetail,
  RunEvent,
  RunRow,
  Thread,
  Verdict,
  View,
  WorkspaceTab,
} from "@locke/core";
import {
  reviewSummary,
  listBranches,
  detectBase,
  getReview,
  getDiff,
  pushBranch,
  deleteBranch,
  detectChecks,
  runChecks,
  readConfig,
  getLockeTracking,
  setLockeTracking,
  toReview,
  toChangedFile,
  detectAgents,
  readAgentSettings,
  writeAgentSettings,
  runAgent as runAgentApi,
  startRun as startRunApi,
  respondPermission,
  cancelRun as cancelRunApi,
  readRuns,
  isTauri,
  type CheckSpec,
  type LockeConfig,
  type AgentInfo,
  type RunEventPayload,
  type RunPermissionPayload,
  type RunDonePayload,
  type RunRecord,
} from "../api/git.js";
import {
  MOCK_REVIEWS,
  MOCK_PENDING,
  MOCK_RUN_ROWS,
  MOCK_AGENTS,
  MOCK_DISABLED,
  MOCK_CHECKS,
  MOCK_FILES_BY_ID,
  MOCK_THREADS_BY_ID,
  MOCK_HISTORY_BY_ID,
  MOCK_RUN_EVENTS_BY_ID,
} from "../lib/mockFleet.js";
import { buildAgentPrompt } from "../lib/agentPrompt.js";
import { readPulls, createPull, updatePull, deletePull } from "../api/pulls.js";
import {
  loadComments,
  saveComments,
  loadCheckOverrides,
  saveCheckOverrides,
  clearCheckOverrides,
} from "../api/reviewStore.js";
import type { Check, PullRecord, ReviewStatus } from "@locke/core";

const EMPTY_DETAIL: ReviewDetail = { prompt: "", summary: "", bullets: [], note: "", commits: [] };

// Human-relative time from an epoch-seconds stamp (best-effort, coarse buckets).
function relTime(epochSecs: number): string {
  if (!epochSecs) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSecs);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

// Map a persisted run record to a History timeline entry.
function runToHistory(r: RunRecord): HistoryEntry {
  const state = r.state === "done" ? "done" : "failed";
  return {
    runId: r.runId,
    title: r.result ? r.result.split("\n")[0].slice(0, 80) : "Agent run",
    time: relTime(r.endedAt),
    duration: r.duration || "—",
    state,
    artifacts: ["log.txt"],
  };
}

// Persist the current PR's comment threads + viewed flags to
// `.locke/comments/<id>.json`, keyed by the numeric id. No-op in mock mode.
function persistComments(get: () => LockeState): void {
  const s = get();
  if (!s.repoPath || !s.selectedPR) return;
  void saveComments(s.repoPath, Number(s.selectedPR), {
    threads: s.threads,
    nextThreadId: s.nextThreadId,
    viewed: s.viewed,
  });
}

// Persist the current PR's lifecycle (status/verdict) back to the registry,
// preserving the rest of the record. No-op in mock mode.
function persistPull(get: () => LockeState): void {
  const s = get();
  if (!s.repoPath) return;
  const pull = s.pulls[s.selectedPR];
  if (!pull) return;
  const status = s.reviews.find((r) => r.id === s.selectedPR)?.status ?? pull.status;
  const updated: PullRecord = { ...pull, status, verdict: s.verdict };
  s.pulls[s.selectedPR] = updated;
  void updatePull(s.repoPath, updated);
}

// Persist the current check list as a per-repo override.
function persistChecks(get: () => LockeState): void {
  const s = get();
  if (!s.repoPath) return;
  void saveCheckOverrides(s.repoPath, s.checkSpecs);
}

// Mirrors the design's single-component state, plus the data arrays it embedded.
// Data fields are seeded from mocks and will be replaced by git/store loaders in
// later phases; UI fields drive view/selection/compose interactions.
interface LockeState {
  // ---- data (swap-in target for real git/store) ----
  reviews: Review[];
  /** Registry records backing the queue, keyed by id (preserves fields the
   *  display-only Review drops, e.g. body/createdAt, for round-tripping). */
  pulls: Record<string, PullRecord>;
  files: ChangedFile[];
  detail: ReviewDetail;
  threads: Thread[];

  // ---- UI state ----
  view: View;
  /** Active tab within the Review Workspace. */
  workspaceTab: WorkspaceTab;
  /** Side panel (review list) visibility, side, and width (clamped 240–560). */
  panelOpen: boolean;
  panelSide: "left" | "right";
  panelWidth: number;
  /** Action-bar approvals tray open. */
  approvalsOpen: boolean;
  /** Global search query (action bar + side panel). */
  query: string;
  /** "Agent control" (true) vs "Reviews only" (false). Persisted app-global. */
  agentMode: boolean;
  selectedPR: string;
  selectedFile: number;
  diffMode: DiffMode;
  filter: string;
  composerLine: string | null;
  draft: string;
  replyOpen: number | null;
  replyDraft: string;
  verdict: Verdict | null;
  pushed: boolean;
  testsRunning: boolean;
  testsRan: boolean;
  viewed: Record<number, boolean>;
  nextThreadId: number;

  // ---- repo (live git) ----
  repoPath: string | null;
  base: string;
  remote: string;
  loading: boolean;
  error: string | null;
  /** Whether .locke/ review history is committed to git (vs gitignored). */
  trackHistory: boolean;
  /** Local branch names, for the New-review pickers. */
  branches: string[];
  /** Live check results (auto-detected from the repo's tooling). */
  liveChecks: Check[];
  /** Effective check commands for the open repo (detected or user-overridden). */
  checkSpecs: CheckSpec[];
  /** True when checkSpecs are a saved per-repo override (vs auto-detected). */
  checksAreOverride: boolean;
  editingChecks: boolean;
  /** Known agent CLIs detected on PATH (app-global; probed once on launch). */
  agents: AgentInfo[];
  /** Agent ids the user has explicitly opted out of (app-global, persisted). */
  disabledAgents: string[];
  /** Whether the app-global Settings modal is open. */
  settingsOpen: boolean;
  /** Whether the New-review modal (branch pickers) is open. */
  newReviewOpen: boolean;
  /** True while a headless agent run is in flight (Phase 6). */
  agentRunning: boolean;
  /** Combined output (or error) of the last agent run, for display. */
  agentOutput: string | null;

  // ---- run surface (real streaming via the Claude stream-json protocol; the
  //      design hero-flow is kept only in mock mode) ----
  /** Pending permission approvals across the fleet (drives the tray + counts). */
  pending: Approval[];
  /** Live event stream for the open review's run (Run tab). */
  runEvents: RunEvent[];
  /** Global runs table rows. */
  runRows: RunRow[];
  /** Saved runs for the open review (History tab). */
  history: HistoryEntry[];
  /** Whether the inline permission card is showing in the Run tab. */
  showPermission: boolean;
  runDone: boolean;
  runPaused: boolean;
  /** The live run currently shown in the open review's Run tab (real mode). */
  currentRunId: string | null;
  /** runId → reviewId, so streamed events can be routed to their review. */
  runReviewMap: Record<string, string>;
  /** Whether a streaming run executes in an isolated worktree (true, committed
   *  onto the branch) or directly in the repo's working tree (false). */
  runUseWorktree: boolean;

  // ---- navigation ----
  go: (view: View) => void;
  /** Open a review in the workspace on the given tab (default "diff"). */
  openReview: (id: string, tab?: WorkspaceTab) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  togglePanel: () => void;
  flipPanel: () => void;
  setPanelWidth: (w: number) => void;
  toggleApprovals: () => void;
  setQuery: (q: string) => void;

  // ---- agents + settings (app-global) ----
  detectAgents: () => Promise<void>;
  loadAgentSettings: () => Promise<void>;
  toggleAgentEnabled: (id: string) => void;
  /** Set the global "Agent control" vs "Reviews only" mode and persist it. */
  setAgentMode: (on: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  /** Toggle the action-bar settings popover (closes the approvals tray). */
  toggleSettings: () => void;
  setNewReviewOpen: (open: boolean) => void;
  /** Run the first enabled agent against the current review's open change
   *  requests, then refresh the diff to show its commit (Phase 6, headless). */
  runAgent: () => Promise<void>;
  clearAgentOutput: () => void;

  // ---- live streaming run (Phase 7) ----
  /** Start a streaming run for the open review with the first enabled agent.
   *  Claude streams live with in-app permissions; other agents fall back to a
   *  one-shot headless run surfaced as a single event. */
  startRun: () => Promise<void>;
  /** Cancel the open review's in-flight run. */
  cancelRun: () => Promise<void>;
  setRunUseWorktree: (on: boolean) => void;
  /** Stream-event handlers, driven by the Tauri `run:*` event listeners. */
  onRunEvent: (e: RunEventPayload) => void;
  onRunPermission: (e: RunPermissionPayload) => void;
  onRunDone: (e: RunDonePayload) => void;
  /** After a run ends, refresh the diff + History for the review without
   *  clearing the completed run's event stream. */
  reloadAfterRun: (reviewId: string) => Promise<void>;

  // ---- run permission decisions ----
  /** Approve / deny a pending permission. Real round-trip in Tauri mode; the
   *  scripted hero-flow in mock mode. */
  allowApproval: (id: string) => void;
  denyApproval: (id: string) => void;

  // ---- live git loading ----
  openRepo: (path: string, base?: string) => Promise<void>;
  loadDiff: (i: number) => Promise<void>;
  setTrackHistory: (tracked: boolean) => void;
  createReview: (head: string, base: string) => Promise<void>;
  closeReview: () => void;
  deleteReviewBranch: () => Promise<void>;
  approveAndPush: () => Promise<void>;
  setStatus: (status: ReviewStatus) => void;

  // ---- editable checks ----
  toggleEditChecks: () => void;
  updateCheckSpec: (i: number, field: keyof CheckSpec, value: string) => void;
  addCheckSpec: () => void;
  removeCheckSpec: (i: number) => void;
  autoDetectChecks: () => Promise<void>;

  // ---- selection / mode / filter ----
  selectFile: (i: number) => void;
  setMode: (m: DiffMode) => void;
  setFilter: (f: string) => void;

  // ---- composer ----
  openComposer: (lineId: string) => void;
  cancelComposer: () => void;
  setDraft: (v: string) => void;
  submitComment: () => void;

  // ---- threads ----
  toggleResolve: (id: number) => void;
  toggleChangeRequest: (id: number) => void;
  setReplyOpen: (id: number | null) => void;
  setReplyDraft: (v: string) => void;
  submitReply: (id: number) => void;

  // ---- review actions ----
  toggleViewed: (i: number) => void;
  setVerdict: (v: Verdict) => void;
  runTests: () => void;
  push: () => void;
}

// Mock mode (plain `vite`, no Tauri bridge) seeds the design's fleet so the app
// matches the design with no repo open; a real Tauri session loads live git data.
const MOCK = !isTauri;

export const useStore = create<LockeState>((set, get) => ({
  reviews: MOCK ? MOCK_REVIEWS : [],
  pulls: {},
  files: [],
  detail: EMPTY_DETAIL,
  threads: [],

  view: "activity",
  workspaceTab: "diff",
  panelOpen: true,
  panelSide: "left",
  panelWidth: 300,
  approvalsOpen: false,
  query: "",
  agentMode: true,
  selectedPR: "",
  selectedFile: 0,
  diffMode: "unified",
  filter: "all",
  composerLine: null,
  draft: "",
  replyOpen: null,
  replyDraft: "",
  verdict: null,
  pushed: false,
  testsRunning: false,
  testsRan: false,
  viewed: {},
  nextThreadId: 100,

  repoPath: null,
  base: "main",
  remote: "origin",
  loading: false,
  error: null,
  trackHistory: true,
  branches: [],
  liveChecks: [],
  checkSpecs: [],
  checksAreOverride: false,
  editingChecks: false,
  agents: MOCK ? MOCK_AGENTS : [],
  disabledAgents: MOCK ? MOCK_DISABLED : [],
  settingsOpen: false,
  newReviewOpen: false,
  agentRunning: false,
  agentOutput: null,

  pending: MOCK ? MOCK_PENDING : [],
  runEvents: [],
  runRows: MOCK ? MOCK_RUN_ROWS : [],
  history: [],
  showPermission: false,
  runDone: false,
  runPaused: false,
  currentRunId: null,
  runReviewMap: {},
  runUseWorktree: true,

  detectAgents: async () => {
    if (MOCK) return; // keep the seeded mock fleet's agents
    try {
      set({ agents: await detectAgents() });
    } catch {
      // Detection is best-effort status; never block the app on a failed probe.
    }
  },

  loadAgentSettings: async () => {
    if (MOCK) return; // keep the seeded mock opt-outs + default agent mode
    try {
      const s = await readAgentSettings();
      set({ disabledAgents: s.disabled, agentMode: s.enabled });
    } catch {
      // Missing/unreadable settings just means defaults (nothing disabled, agents on).
    }
  },

  toggleAgentEnabled: (id) => {
    const { disabledAgents, agentMode } = get();
    // Opt-out model: flip membership in the disabled set, then persist app-wide
    // (preserving the global mode).
    const next = disabledAgents.includes(id)
      ? disabledAgents.filter((d) => d !== id)
      : [...disabledAgents, id];
    set({ disabledAgents: next });
    void writeAgentSettings({ disabled: next, enabled: agentMode });
  },

  setAgentMode: (on) => {
    // Leaving agent control closes any agent-only surface that's open and steps
    // off the Agents destination (its nav entry disappears).
    const { view, approvalsOpen, disabledAgents } = get();
    set({
      agentMode: on,
      approvalsOpen: on ? approvalsOpen : false,
      view: !on && view === "agents" ? "activity" : view,
    });
    void writeAgentSettings({ disabled: disabledAgents, enabled: on });
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  toggleSettings: () => set({ settingsOpen: !get().settingsOpen, approvalsOpen: false }),

  setNewReviewOpen: (open) => set({ newReviewOpen: open }),

  runAgent: async () => {
    const { repoPath, selectedPR, reviews, files, threads, agents, disabledAgents } = get();
    const review = reviews.find((r) => r.id === selectedPR);
    // Only ever run a detected, enabled (not opted-out) agent.
    const agent = agents.find((a) => a.detected && !disabledAgents.includes(a.id));
    if (!repoPath || !review || !agent) return;

    const prompt = buildAgentPrompt({ repoPath, selectedPR, reviews, files, threads });
    set({ agentRunning: true, agentOutput: null });
    try {
      const output = await runAgentApi(repoPath, review.branch, agent.cmd, prompt);
      set({ agentOutput: output || "Agent finished with no output." });
      // Refresh the review so the agent's commit + new diff show up.
      get().openReview(selectedPR, get().workspaceTab);
    } catch (e) {
      set({ agentOutput: `Agent run failed:\n${String(e)}` });
    } finally {
      set({ agentRunning: false });
    }
  },

  clearAgentOutput: () => set({ agentOutput: null }),

  setRunUseWorktree: (on) => set({ runUseWorktree: on }),

  startRun: async () => {
    const { repoPath, selectedPR, reviews, files, threads, agents, disabledAgents, runUseWorktree } = get();
    const review = reviews.find((r) => r.id === selectedPR);
    const agent = agents.find((a) => a.detected && !disabledAgents.includes(a.id));
    // Always switch to the Run tab so the user sees what happens.
    set({ workspaceTab: "run" });
    if (!repoPath || !review || !agent) {
      set({ runEvents: [{ key: "x", kind: "denied", text: "No enabled agent detected to run.", time: "" }], runDone: false, runPaused: true });
      return;
    }
    const prompt = buildAgentPrompt({ repoPath, selectedPR, reviews, files, threads });
    const runId = `run-${Date.now()}`;
    set((s) => ({
      runEvents: [],
      runDone: false,
      runPaused: false,
      currentRunId: runId,
      runReviewMap: { ...s.runReviewMap, [runId]: review.id },
      reviews: s.reviews.map((r) => (r.id === review.id ? { ...r, runId, runState: "running" } : r)),
    }));
    try {
      if (agent.id === "claude") {
        // Live streaming with in-app permissions; events arrive via listeners.
        await startRunApi(runId, repoPath, review.branch, agent.cmd, prompt, runUseWorktree);
      } else {
        // Fallback: one-shot headless run, surfaced as a single event pair.
        get().onRunEvent({ runId, key: "h0", kind: "msg", text: `Running ${agent.name} headlessly (no live stream)…`, time: "0:00" });
        const output = await runAgentApi(repoPath, review.branch, agent.cmd, prompt);
        get().onRunEvent({ runId, key: "h1", kind: "result", text: (output || "Agent finished.").split("\n")[0].slice(0, 120), sub: output || undefined, time: "" });
        get().onRunDone({ runId, state: "done", result: output, duration: "", branch: review.branch });
      }
    } catch (e) {
      get().onRunEvent({ runId, key: "err", kind: "denied", text: `Run failed: ${String(e)}`, time: "" });
      get().onRunDone({ runId, state: "failed", result: String(e), duration: "", branch: review.branch });
    }
  },

  cancelRun: async () => {
    const { currentRunId } = get();
    if (!currentRunId || MOCK) return;
    try {
      await cancelRunApi(currentRunId);
    } catch {
      // Best-effort; the run:done handler settles UI state regardless.
    }
  },

  onRunEvent: (e) => {
    const { runReviewMap, selectedPR, runEvents } = get();
    const reviewId = runReviewMap[e.runId];
    // Only the open review streams into the live view; background runs persist
    // to disk and surface later via History.
    if (reviewId !== selectedPR) return;
    set({ runEvents: [...runEvents, { key: e.key, kind: e.kind, text: e.text, sub: e.sub, time: e.time }] });
  },

  onRunPermission: (e) => {
    const { runReviewMap, reviews, pending } = get();
    const reviewId = runReviewMap[e.runId];
    if (!reviewId) return;
    const review = reviews.find((r) => r.id === reviewId);
    set({
      // id is the CLI request_id — the key for the control_response round-trip.
      pending: [
        ...pending.filter((p) => p.id !== e.requestId),
        {
          id: e.requestId,
          reviewId,
          runId: e.runId,
          agent: "Claude",
          initials: "CL",
          branch: review?.branch ?? "",
          cmd: e.cmd,
          tool: e.tool,
          why: e.why,
          scope: e.scope,
        },
      ],
    });
  },

  onRunDone: (e) => {
    const { runReviewMap, selectedPR } = get();
    const reviewId = runReviewMap[e.runId];
    const finalState = e.state === "done" ? "done" : "failed";
    set((s) => ({
      reviews: s.reviews.map((r) => (r.id === reviewId ? { ...r, runState: finalState } : r)),
      // Clear any stale permission cards for this run.
      pending: s.pending.filter((p) => p.runId !== e.runId),
    }));
    if (reviewId !== selectedPR) return;
    set({
      currentRunId: null,
      runDone: e.state === "done",
      runPaused: e.state !== "done",
    });
    // Reload the diff (the agent may have edited/committed) and the history list.
    void get().reloadAfterRun(reviewId);
  },

  reloadAfterRun: async (reviewId) => {
    const { repoPath, reviews } = get();
    if (!repoPath || MOCK) return;
    const review = reviews.find((r) => r.id === reviewId);
    if (!review) return;
    try {
      const [detail, runs] = await Promise.all([
        getReview(repoPath, review.branch, review.base),
        readRuns(repoPath),
      ]);
      const files = detail.fileSummary.map(toChangedFile);
      set({
        detail: { ...EMPTY_DETAIL, commits: detail.commits },
        files,
        selectedFile: 0,
        history: runs.filter((r) => r.branch === review.branch).map(runToHistory),
      });
      if (files.length) await get().loadDiff(0);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // Real mode: answer the live permission prompt via the stream-json control
  // protocol (Allow → control_response behavior:allow). Mock mode keeps the
  // design's scripted hero-flow on review #142 below.
  allowApproval: (id) => {
    if (!MOCK) {
      const p = get().pending.find((x) => x.id === id);
      if (p) void respondPermission(p.runId, id, true);
      set((s) => ({ pending: s.pending.filter((x) => x.id !== id) }));
      return;
    }
    const { pending, runEvents, runDone } = get();
    const p = pending.find((x) => x.id === id);
    if (!p) return;
    let nextPending = pending.filter((x) => x.id !== id);
    const events = runEvents.slice();
    let done = runDone;
    if (id === "a1") {
      events.push({
        key: "e4",
        kind: "result",
        text: "npm test — 142 passed in 3.1s",
        sub: "PASS  webhooks/retry.test.ts (concurrent delivery handled exactly once)",
        time: "0:34",
      });
      events.push({
        key: "e5",
        kind: "edit",
        text: "Edited tests/webhooks/retry.test.ts",
        sub: "+ fires two identical events in parallel, asserts store.save called once",
        time: "0:41",
      });
      nextPending = [
        ...nextPending,
        {
          id: "a3",
          reviewId: "142",
          runId: "run #R7",
          agent: "Claude",
          initials: "CL",
          branch: "agent/webhook-idempotency",
          cmd: 'git commit -am "Make webhook dedupe atomic; add concurrency test"',
          tool: "git",
          why: "Commit the atomic fix and the new test to the branch.",
          scope: "local repo · no push",
        },
      ];
    } else if (id === "a3") {
      events.push({ key: "e6", kind: "result", text: "Committed 9c1d77a · pushed to agent/webhook-idempotency", sub: "2 files changed, +10 −2", time: "0:48" });
      events.push({ key: "e7", kind: "done", text: "Done. Both change requests addressed — the diff is updated and ready to re-review.", time: "0:49" });
      done = true;
    }
    set({ pending: nextPending, runEvents: events, runDone: done });
  },
  denyApproval: (id) => {
    if (!MOCK) {
      const p = get().pending.find((x) => x.id === id);
      if (p) void respondPermission(p.runId, id, false);
      set((s) => ({ pending: s.pending.filter((x) => x.id !== id) }));
      return;
    }
    const { pending, runEvents, runPaused } = get();
    const p = pending.find((x) => x.id === id);
    if (!p) return;
    const events = runEvents.slice();
    let paused = runPaused;
    if (p.reviewId === "142") {
      events.push({ key: "ed", kind: "denied", text: "Denied `" + p.cmd + "` — run paused.", time: "—" });
      paused = true;
    }
    set({ pending: pending.filter((x) => x.id !== id), runEvents: events, runPaused: paused });
  },

  go: (view) => set({ view, approvalsOpen: false, settingsOpen: false }),
  openReview: (id, tab = "diff") => {
    const { repoPath, reviews, pulls } = get();
    // Verdict is registry-backed; seed it from the pull so the workspace reflects
    // any prior decision. Reset the (prototype) run surface for the new review.
    set({
      view: "workspace",
      workspaceTab: tab,
      selectedPR: id,
      verdict: pulls[id]?.verdict ?? null,
      approvalsOpen: false,
      runEvents: [],
      runDone: false,
      runPaused: false,
      showPermission: false,
      currentRunId: null,
    });
    if (MOCK) {
      // Seed the design's workspace data for the opened review (only #142 is
      // detailed; others open with an empty diff).
      set({
        files: MOCK_FILES_BY_ID[id] ?? [],
        threads: MOCK_THREADS_BY_ID[id] ?? [],
        history: MOCK_HISTORY_BY_ID[id] ?? [],
        runEvents: MOCK_RUN_EVENTS_BY_ID[id] ?? [],
        liveChecks: MOCK_CHECKS,
        selectedFile: 0,
      });
      return;
    }
    if (!repoPath) return;
    // Each review carries its own head branch + base (the PR id is not the branch).
    const review = reviews.find((r) => r.id === id);
    const branch = review?.branch ?? id;
    const base = review?.base ?? get().base;
    // Live mode: load this branch's detail + file shells + run history, then its
    // first diff.
    set({ loading: true, error: null });
    Promise.all([getReview(repoPath, branch, base), loadComments(repoPath, Number(id)), readRuns(repoPath)])
      .then(async ([detail, saved, runs]) => {
        const files = detail.fileSummary.map(toChangedFile);
        set({
          detail: { ...EMPTY_DETAIL, commits: detail.commits },
          files,
          selectedFile: 0,
          threads: saved?.threads ?? [],
          viewed: saved?.viewed ?? {},
          nextThreadId: saved?.nextThreadId ?? 100,
          liveChecks: [],
          history: runs.filter((r) => r.branch === branch).map(runToHistory),
          loading: false,
        });
        if (files.length) await get().loadDiff(0);
      })
      .catch((e) => set({ loading: false, error: String(e) }));
  },
  setWorkspaceTab: (tab) => {
    set({ workspaceTab: tab });
    // Entering the Diff tab lazily loads the selected file's hunks.
    if (tab === "diff") void get().loadDiff(get().selectedFile);
  },
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  flipPanel: () => set({ panelSide: get().panelSide === "left" ? "right" : "left" }),
  setPanelWidth: (w) => set({ panelWidth: Math.max(240, Math.min(560, Math.round(w))) }),
  toggleApprovals: () => set({ approvalsOpen: !get().approvalsOpen, settingsOpen: false }),
  setQuery: (q) => set({ query: q }),

  openRepo: async (path, baseArg = "main") => {
    set({ loading: true, error: null, repoPath: path });
    try {
      // Repo config (locke.config.json) sets base/remote and default checks.
      const config = await readConfig(path).catch((): LockeConfig => ({}));
      // Base: config override, else auto-detect the trunk (main/master/…), else fallback.
      const base = config.base ?? (await detectBase(path).catch(() => baseArg));

      // Load these independently so one failure doesn't blank the whole repo.
      const [overrides, tracked, branches, store] = await Promise.all([
        loadCheckOverrides(path).catch(() => null),
        getLockeTracking(path).catch(() => true),
        listBranches(path).catch(() => [] as string[]),
        readPulls(path).catch(() => ({ nextId: 1, pulls: [] as PullRecord[] })),
      ]);

      // The queue is exactly the explicit pull requests. For each, fetch live git
      // stats (null if the branch is gone) and its open-thread count, in parallel.
      const merged = await Promise.all(
        store.pulls.map(async (pull) => {
          const [g, comments] = await Promise.all([
            reviewSummary(path, pull.branch, pull.base).catch(() => null),
            loadComments(path, pull.id).catch(() => null),
          ]);
          const open = comments?.threads.filter((t) => !t.resolved).length ?? 0;
          return toReview(pull, g, open);
        }),
      );
      // Newest first (highest id), matching the create-prepends-to-top behavior.
      const reviews = merged.slice().reverse();
      const pulls: Record<string, PullRecord> = {};
      for (const pull of store.pulls) pulls[String(pull.id)] = pull;

      set({
        base,
        remote: config.remote ?? "origin",
        reviews,
        pulls,
        threads: [],
        view: "activity",
        selectedPR: reviews[0]?.id ?? "",
        liveChecks: [],
        // Check precedence: per-repo override (.locke/checks.json) > config > auto-detect.
        checkSpecs: overrides ?? config.checks ?? [],
        checksAreOverride: !!overrides,
        editingChecks: false,
        trackHistory: tracked,
        branches,
        loading: false,
        error: null,
      });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  setTrackHistory: (tracked) => {
    const { repoPath } = get();
    set({ trackHistory: tracked });
    if (repoPath) void setLockeTracking(repoPath, tracked).catch((e) => set({ error: String(e) }));
  },

  createReview: async (head, base) => {
    const { repoPath } = get();
    if (!repoPath || head === base) return;
    set({ loading: true, error: null });
    try {
      const g = await reviewSummary(repoPath, head, base);
      if (!g) {
        set({ loading: false, error: `${head} has no commits ahead of ${base}.` });
        return;
      }
      // Capture title/author from the head's latest commit at create time.
      const pull = await createPull(repoPath, {
        branch: head,
        base,
        title: g.title,
        author: g.author,
        isAgent: head.startsWith("agent/"),
      });
      const review = toReview(pull, g, 0);
      set((s) => ({
        reviews: [review, ...s.reviews.filter((r) => r.id !== review.id)],
        pulls: { ...s.pulls, [review.id]: pull },
        loading: false,
      }));
      get().openReview(review.id);
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  closeReview: () => {
    get().setStatus("closed");
    set({ view: "activity" });
  },

  deleteReviewBranch: async () => {
    const { repoPath, selectedPR, reviews } = get();
    if (!repoPath || !selectedPR) return;
    const branch = reviews.find((r) => r.id === selectedPR)?.branch ?? selectedPR;
    set({ loading: true, error: null });
    try {
      await deleteBranch(repoPath, branch);
      await deletePull(repoPath, Number(selectedPR)); // also drops the comments file
      set((s) => {
        const pulls = { ...s.pulls };
        delete pulls[selectedPR];
        return {
          reviews: s.reviews.filter((r) => r.id !== selectedPR),
          pulls,
          view: "activity",
          loading: false,
        };
      });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadDiff: async (i) => {
    const { repoPath, files, selectedPR, reviews } = get();
    if (!repoPath) return;
    const file = files[i];
    if (!file || file.hunks.length) return; // already loaded or out of range
    const review = reviews.find((r) => r.id === selectedPR);
    const branch = review?.branch ?? selectedPR;
    const base = review?.base ?? get().base;
    try {
      const diff = await getDiff(repoPath, branch, base, file.path);
      set((s) => ({
        files: s.files.map((f, idx) => (idx === i ? { ...f, hunks: diff.hunks } : f)),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectFile: (i) => {
    set({ selectedFile: i, composerLine: null });
    void get().loadDiff(i);
  },
  setMode: (m) => set({ diffMode: m }),
  setFilter: (f) => set({ filter: f }),

  openComposer: (lineId) => set({ composerLine: lineId, draft: "" }),
  cancelComposer: () => set({ composerLine: null, draft: "" }),
  setDraft: (v) => set({ draft: v }),
  submitComment: () => {
    const { composerLine, draft, files, selectedFile, threads, nextThreadId } = get();
    const body = draft.trim();
    if (!composerLine || !body) return;
    const file = files[selectedFile] ?? files[0];
    const thread: Thread = {
      id: nextThreadId,
      file: file.path,
      lineId: composerLine,
      resolved: false,
      kind: "comment",
      items: [
        { author: "You", initials: "YO", isAgent: false, roleLabel: "AUTHOR", time: "just now", body },
      ],
    };
    set({
      threads: [...threads, thread],
      nextThreadId: nextThreadId + 1,
      composerLine: null,
      draft: "",
    });
    persistComments(get);
  },

  toggleResolve: (id) => {
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, resolved: !t.resolved } : t)),
    }));
    persistComments(get);
  },
  toggleChangeRequest: (id) => {
    set((s) => ({
      threads: s.threads.map((t) =>
        t.id === id
          ? { ...t, kind: t.kind === "change_request" ? "comment" : "change_request" }
          : t,
      ),
    }));
    persistComments(get);
  },
  setReplyOpen: (id) => set({ replyOpen: id, replyDraft: "" }),
  setReplyDraft: (v) => set({ replyDraft: v }),
  submitReply: (id) => {
    const { replyDraft, threads } = get();
    const body = replyDraft.trim();
    if (!body) return;
    set({
      threads: threads.map((t) =>
        t.id === id
          ? {
              ...t,
              items: [
                ...t.items,
                { author: "You", initials: "YO", isAgent: false, roleLabel: "AUTHOR", time: "just now", body },
              ],
            }
          : t,
      ),
      replyOpen: null,
      replyDraft: "",
    });
    persistComments(get);
  },

  toggleViewed: (i) => {
    set((s) => ({ viewed: { ...s.viewed, [i]: !s.viewed[i] } }));
    persistComments(get);
  },
  setVerdict: (v) => {
    set({ verdict: v });
    if (v === "changes") get().setStatus("changes");
    else persistPull(get);
  },
  setStatus: (status) => {
    set((s) => ({ reviews: s.reviews.map((r) => (r.id === s.selectedPR ? { ...r, status } : r)) }));
    persistPull(get);
  },

  toggleEditChecks: () => {
    const opening = !get().editingChecks;
    set({ editingChecks: opening });
    // Populate from auto-detection so there's something to edit on first open.
    if (opening && !get().checkSpecs.length) void get().autoDetectChecks();
  },
  updateCheckSpec: (i, field, value) => {
    set((s) => ({
      checkSpecs: s.checkSpecs.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)),
      checksAreOverride: true,
    }));
    persistChecks(get);
  },
  addCheckSpec: () => {
    set((s) => ({ checkSpecs: [...s.checkSpecs, { label: "New check", command: "" }], checksAreOverride: true }));
    persistChecks(get);
  },
  removeCheckSpec: (i) => {
    set((s) => ({ checkSpecs: s.checkSpecs.filter((_, idx) => idx !== i), checksAreOverride: true }));
    persistChecks(get);
  },
  autoDetectChecks: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      const specs = await detectChecks(repoPath);
      set({ checkSpecs: specs, checksAreOverride: false });
      await clearCheckOverrides(repoPath);
    } catch (e) {
      set({ error: String(e) });
    }
  },
  approveAndPush: async () => {
    const { repoPath, selectedPR, remote, reviews } = get();
    set({ verdict: "approve" });
    if (!repoPath) {
      set({ pushed: true });
      return;
    }
    const branch = reviews.find((r) => r.id === selectedPR)?.branch ?? selectedPR;
    set({ loading: true, error: null });
    try {
      await pushBranch(repoPath, branch, remote);
      set({ pushed: true, loading: false });
      get().setStatus("merged");
    } catch (e) {
      set({ loading: false, error: String(e) });
      // Persist the approve verdict even though the push failed.
      persistPull(get);
    }
  },
  runTests: () => {
    const { repoPath, selectedPR, reviews, testsRunning } = get();
    if (testsRunning || !repoPath) return;
    const branch = reviews.find((r) => r.id === selectedPR)?.branch ?? selectedPR;
    // Use per-repo overrides if set, else auto-detect, then run.
    set({ testsRunning: true, testsRan: false });
    void (async () => {
      try {
        let specs = get().checkSpecs;
        if (!specs.length) {
          specs = await detectChecks(repoPath);
          set({ checkSpecs: specs }); // surface detected specs so they're editable
        }
        if (!specs.length) {
          set({ testsRunning: false, testsRan: true, liveChecks: [] });
          return;
        }
        set({
          liveChecks: specs.map((s) => ({ label: s.label, detail: "running…", status: "running" as const })),
        });
        const results = await runChecks(repoPath, branch, specs);
        set({ testsRunning: false, testsRan: true, liveChecks: results });
      } catch (e) {
        set({ testsRunning: false, error: String(e) });
      }
    })();
  },
  push: () => {
    if (get().verdict !== "approve") return;
    set({ pushed: true });
  },
}));
