import { create } from "zustand";
import type {
  Approval,
  ChangedFile,
  DiffMode,
  FileNode,
  HistoryEntry,
  Loop,
  LoopItem,
  LoopMode,
  LoopPlanMeta,
  LoopState,
  LoopStreamEvent,
  LoopView,
  ManifestEntry,
  ResolverSpec,
  NavKey,
  NavPlacement,
  Review,
  ReviewDetail,
  RunEvent,
  RunRow,
  SpecStatus,
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
  listFileTree,
  readRepoFile,
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
  mcpServerStatus,
  installMcpServer,
  uninstallMcpServer,
  mcpCallLog,
  clearMcpCallLog,
  cliCommandStatus,
  installCliCommand,
  uninstallCliCommand,
  type McpStatus,
  type McpCallLogEntry,
  type CliStatus,
  runAgent as runAgentApi,
  startRun as startRunApi,
  respondPermission,
  cancelRun as cancelRunApi,
  setPermissionMode,
  watchLocke,
  readRuns,
  startLoop as startLoopApi,
  startPlan as startPlanApi,
  readLoopPlanMeta as readLoopPlanMetaApi,
  setLoopMode as setLoopModeApi,
  pauseLoop as pauseLoopApi,
  stopLoop as stopLoopApi,
  resolveLoopItem as resolveLoopItemApi,
  readLoops as readLoopsApi,
  readLoopItems as readLoopItemsApi,
  readLoopManifest as readLoopManifestApi,
  resolveTargets as resolveTargetsApi,
  writeLoopManifest as writeLoopManifestApi,
  saveLoopDraft as saveLoopDraftApi,
  readLoopDraft as readLoopDraftApi,
  deleteLoop as deleteLoopApi,
  listBranches as listBranchesApi,
  type LoopItemEvent,
  type LoopProgress,
  type LoopEventPayload,
  type LoopDonePayload,
  type LoopItemRecord,
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
  MOCK_FILE_TREE,
  MOCK_FILE_CONTENTS,
  MOCK_LOOPS,
  MOCK_LOOP_DRAFT,
  MOCK_LOOP_TARGETS,
  MOCK_LOOP_MATCHED,
  MOCK_LOOP_AUTO_INCLUDED,
} from "../lib/mockFleet.js";
import { buildAgentPrompt } from "../lib/agentPrompt.js";
import { lockeLang } from "../lib/lockeLang.js";
import { resolverSummary } from "../lib/loops.js";
import { applyTheme, isThemeId, DEFAULT_THEME, type ThemeId } from "../theme/themes.js";
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

/**
 * One review's live agent-run surface. Held per-review (keyed by reviewId) so a
 * run's event stream, pending plan, and lifecycle survive navigating away — and
 * several reviews can have runs in flight at once, each checked on independently.
 */
interface RunSurface {
  /** Streamed run events, oldest first. */
  events: RunEvent[];
  /** The run finished cleanly. */
  done: boolean;
  /** The run stopped or failed before finishing. */
  paused: boolean;
  /** Plan→Build phase while a run is live; null when idle/finished. */
  phase: "plan" | "build" | null;
  /** The live run's id, or null when no run is in flight for this review. */
  runId: string | null;
  /** A plan blocked on the Plan→Build approval gate (reviewId is the map key), else null. */
  planReview: { runId: string; requestId: string; plan: string } | null;
}

const EMPTY_SURFACE: RunSurface = { events: [], done: false, paused: false, phase: null, runId: null, planReview: null };

/** Immutably patch one review's run surface within the `runs` map. */
const mergeRun = (
  runs: Record<string, RunSurface>,
  reviewId: string,
  patch: Partial<RunSurface>,
): Record<string, RunSurface> => ({
  ...runs,
  [reviewId]: { ...(runs[reviewId] ?? EMPTY_SURFACE), ...patch },
});

// Human-relative time from an epoch-seconds stamp (best-effort, coarse buckets).
function relTime(epochSecs: number): string {
  if (!epochSecs) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - epochSecs);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

// First file in a tree (depth-first), so the explorer can open with something
// shown rather than a blank viewer.
function firstFilePath(nodes: FileNode[]): string | null {
  for (const n of nodes) {
    if (n.t === "file") return n.path;
    if (n.children) {
      const found = firstFilePath(n.children);
      if (found) return found;
    }
  }
  return null;
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
  /** "Files changed" rail (diff tab) visibility + width (clamped 240–560). */
  filesRailOpen: boolean;
  filesRailWidth: number;
  /** Action-bar approvals tray open. */
  approvalsOpen: boolean;
  /** Global search query (action bar + side panel). */
  query: string;
  /** "Agent control" (true) vs "Reviews only" (false). Persisted app-global. */
  agentMode: boolean;
  /** Active UI theme. Persisted app-global (alongside agent prefs). */
  theme: ThemeId;
  /** Where each nav destination is surfaced: top bar / bottom bar / hidden. */
  navPlace: Record<NavKey, NavPlacement>;

  // ---- loops (v2.0.0; front-end + mock — a real loop-runner is a later phase) ----
  /** All loops in the repo (mock-seeded; empty until a real runner exists). */
  loops: Loop[];
  /** Which Loops sub-screen is showing (the Loops view's internal router). */
  loopView: LoopView;
  /** The loop the builder/plan/monitor/review act on. */
  selectedLoop: string | null;
  /** Monitor layout: kanban board / live stream / tile grid. */
  monitorLayout: "board" | "stream" | "grid" | "waves";
  /** Plan-mode tab: scope interview vs per-item specs. */
  planTab: "scope" | "specs";
  /** Selected per-item spec in the plan Item-specs tab. */
  selectedSpec: string;
  /** The item open in the loop-item review, or null. */
  loopReviewItem: string | null;
  /** Whether the monitored loop is paused. */
  loopPaused: boolean;
  /** Builder per-target include override (path → included), layered over `LoopTarget.inc`. */
  targetSel: Record<string, boolean>;
  /** Builder audit rows — resolved manifest entries (real in Tauri, mock in plain Vite). */
  loopTargets: ManifestEntry[];
  /** Total files the draft's pattern matched. */
  loopMatched: number;
  /** Files auto-included off the audit list (mock aggregate; 0 in Tauri). */
  loopAutoIncluded: number;
  /** Plan-spec overrides: per-spec approach id, per-step on/off, status. */
  specApproach: Record<string, string>;
  specSteps: Record<string, Record<string, boolean>>;
  specStatus: Record<string, SpecStatus>;
  /** The open plan loop's manifest rows — the strategist's per-item specs (real in
   *  Tauri; the Plan view derives its spec list from this). */
  loopManifest: ManifestEntry[];
  /** The open plan loop's scope metadata (summary + assumptions) for the Scope tab. */
  loopPlanMeta: LoopPlanMeta | null;
  /** Feedback the user added in the item review this session (re-queue composer). */
  loopFeedback: string[];
  /** Live per-item state, keyed by loopId (driven by `loop:item` events / reads). */
  loopItems: Record<string, LoopItem[]>;
  /** Live stream log, keyed by loopId (newest first; driven by `loop:event`). */
  loopStream: Record<string, LoopStreamEvent[]>;
  /** Raw per-item records (incl. captured review diffs), keyed by loopId. */
  loopItemRecords: Record<string, LoopItemRecord[]>;
  /** New-loop draft (seeded; mode + target selection are the interactive parts). */
  draftTitle: string;
  draftBranch: string;
  draftBase: string;
  /** How the draft's targets are resolved (glob / globs / list / command / custom). */
  draftResolver: ResolverSpec;
  /** Id of the persisted draft loop (set once the draft is first saved), else null. */
  draftLoopId: string | null;
  draftPrompt: string;
  draftMode: LoopMode;
  /** The open repo's local branches, for the builder's base-branch picker. */
  repoBranches: string[];

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

  // ---- files explorer + language extensions ----
  /** The repo's working-tree file tree (live in Tauri mode, mock otherwise). */
  fileTree: FileNode[];
  /** Cache of full file contents by repo-relative path (lazy-loaded). */
  fileContents: Record<string, string>;
  /** Repo-relative path of the file open in the Files screen's code viewer. */
  filePath: string;
  /** When the Files screen was opened from a review's diff ("see full file"),
   *  the originating review so a back-pill can return to it. */
  fileFromReview: { id: string; branch: string } | null;
  /** Which explorer directories are expanded, keyed by path. */
  expandedDirs: Record<string, boolean>;
  /** Extensions screen: id of the expanded language card (snippet shown). */
  langExpanded: string | null;
  /** Extensions screen: the "Add a language" example is open. */
  addLangOpen: boolean;
  /** Bottom-bar language chip popover open (Files screen). */
  langMenuOpen: boolean;
  /** Where the Extensions screen returns to when dismissed. */
  extReturn: View;
  /** Per-language enabled flags, mirrored into `lockeLang` so highlighting and
   *  the Extensions list stay in sync (seeded from the host's defaults). */
  langEnabled: Record<string, boolean>;

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
  /** Status of the Locke MCP server registration (Settings → Integrations). */
  mcpStatus: McpStatus | null;
  /** True while an MCP install/uninstall is in flight. */
  mcpBusy: boolean;
  /** Last MCP install/uninstall error to surface in Settings ("" when none). */
  mcpError: string;
  /** Recent MCP tool calls (newest first) for the Integrations debug log. */
  mcpLog: McpCallLogEntry[];
  /** Status of the `locke` CLI shim (Settings → Integrations). */
  cliStatus: CliStatus | null;
  /** True while a CLI install/uninstall is in flight. */
  cliBusy: boolean;
  /** Last CLI install/uninstall error to surface in Settings ("" when none). */
  cliError: string;
  /** The view to return to when leaving the Integrations page. */
  intReturn: View;
  /** View to return to when leaving the full Settings screen. */
  settingsReturn: View;
  /** Whether the app-global Settings modal is open. */
  settingsOpen: boolean;
  /** Whether the New-review modal (branch pickers) is open. */
  newReviewOpen: boolean;
  /** Id of the pull request pending a typed-DELETE confirmation; "" when none. */
  deletePullPending: string;
  /** True while a headless agent run is in flight (Phase 6). */
  agentRunning: boolean;
  /** Combined output (or error) of the last agent run, for display. */
  agentOutput: string | null;

  // ---- run surface (real streaming via the Claude stream-json protocol; the
  //      design hero-flow is kept only in mock mode) ----
  /** Pending permission approvals across the fleet (drives the tray + counts). */
  pending: Approval[];
  /** Per-review live run surface, keyed by reviewId: event stream, plan, phase,
   *  and lifecycle. Held per-review so runs survive navigation and several can be
   *  in flight and checked on independently. */
  runs: Record<string, RunSurface>;
  /** Global runs table rows. */
  runRows: RunRow[];
  /** Saved runs for the open review (History tab). */
  history: HistoryEntry[];
  /** runId → reviewId, so streamed events can be routed to their review. */
  runReviewMap: Record<string, string>;
  /** Whether a streaming run executes in an isolated worktree (true, committed
   *  onto the branch) or directly in the repo's working tree (false). */
  runUseWorktree: boolean;
  /** Pre-run approval modal: open flag, the agent the user picked to do the work
   *  (null = auto-derive), and whether the run uses Auto mode (Claude's own
   *  permission classifier via `--permission-mode auto`). */
  runApprovalOpen: boolean;
  runSelectedAgentId: string | null;
  runAutoMode: boolean;
  /** "Plan first" (v1.5): start the run in `--permission-mode plan` so the agent
   *  investigates and presents a plan before editing. Claude-only. */
  runPlanFirst: boolean;

  // ---- navigation ----
  go: (view: View) => void;
  /** Open a review in the workspace on the given tab (default "diff"). */
  openReview: (id: string, tab?: WorkspaceTab) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  togglePanel: () => void;
  flipPanel: () => void;
  setPanelWidth: (w: number) => void;
  toggleFilesRail: () => void;
  setFilesRailWidth: (w: number) => void;
  toggleApprovals: () => void;
  setQuery: (q: string) => void;
  /** Set where a nav destination is surfaced (top / bottom / off). */
  setNavPlace: (key: NavKey, place: NavPlacement) => void;

  // ---- loops (v2.0.0) ----
  /** Open a loop, routing to builder/plan/monitor by its state. */
  openLoop: (id: string) => void;
  /** Start a new loop in the builder. */
  newLoop: () => void;
  /** Return to the loops list. */
  loopToList: () => void;
  setLoopView: (v: LoopView) => void;
  setMonitorLayout: (l: "board" | "stream" | "grid" | "waves") => void;
  setPlanTab: (t: "scope" | "specs") => void;
  selectSpec: (id: string) => void;
  setDraftMode: (m: LoopMode) => void;
  setDraftTitle: (v: string) => void;
  setDraftBranch: (v: string) => void;
  setDraftBase: (v: string) => void;
  setDraftResolver: (r: ResolverSpec) => void;
  /** Persist the draft loop (creates it on first save once it has a title). */
  saveDraft: () => void;
  /** Delete a loop (registry + .locke tree; git untouched). */
  deleteLoop: (id: string) => void;
  setDraftPrompt: (v: string) => void;
  /** Load the open repo's branches for the base picker (Tauri; no-op in mock). */
  loadRepoBranches: () => Promise<void>;
  /** Builder: include/exclude a matched target. */
  toggleTarget: (path: string, on: boolean) => void;
  /** Builder Start: Build → monitor, Plan → scope interview. */
  startLoop: () => void;
  /** Plan: approve and begin building (→ monitor). */
  approveLoopPlan: () => void;
  /** Return a loop to Plan mode (halts any run; → plan view) to review/re-run specs. */
  reopenPlan: (id?: string) => void;
  /** Stop/cancel the loop (→ list). */
  stopLoop: () => void;
  /** Pause/resume the monitored loop. */
  togglePause: () => void;
  /** Open one item's review. */
  openLoopReview: (itemId: string) => void;
  /** Back from the item review to the monitor. */
  loopReviewBack: () => void;
  /** Resolve the item review (approve or re-queue) → back to the monitor. */
  resolveLoopReview: (decision: "approve" | "request") => void;
  setSpecApproach: (id: string, approach: string) => void;
  toggleSpecStep: (id: string, k: string) => void;
  acceptSpec: (id: string) => void;
  excludeSpec: (id: string) => void;
  /** Load real loops from the backend (Tauri mode; no-op in mock). */
  loadLoops: () => Promise<void>;
  /** Load a loop's per-item records from the backend into `loopItems`. */
  loadLoopItems: (loopId: string) => Promise<void>;
  /** Load a planning loop's manifest + scope metadata into `loopManifest`/`loopPlanMeta`. */
  loadLoopPlan: (loopId: string) => Promise<void>;
  /** Match the draft pattern into real audit rows (Tauri mode; no-op in mock). */
  loadLoopTargets: () => Promise<void>;
  /** Backend `loop:*` stream handlers (routed from App.tsx listeners). */
  onLoopItem: (e: LoopItemEvent) => void;
  onLoopProgress: (e: LoopProgress) => void;
  onLoopEvent: (e: LoopEventPayload) => void;
  onLoopDone: (e: LoopDonePayload) => void;

  // ---- files explorer + extensions navigation ----
  /** Open the Files screen on a full file, optionally from a review's diff. */
  openFullFile: (path: string, review?: { id: string; branch: string }) => void;
  /** Return from a full-file view to the originating review (or Activity). */
  backToReview: () => void;
  /** Open the Extensions screen, remembering where to return. */
  goExtensions: () => void;
  /** Dismiss the Extensions screen back to its origin. */
  backFromExt: () => void;
  /** Load the repo's working-tree file tree (Tauri mode; no-op in mock). */
  loadFileTree: () => Promise<void>;
  /** Lazily fetch + cache a file's full contents (Tauri mode; no-op in mock). */
  loadFileContent: (path: string) => Promise<void>;
  /** Expand / collapse an explorer directory. */
  toggleDir: (path: string) => void;
  /** Select a file in the explorer's code viewer. */
  selectFilePath: (path: string) => void;
  /** Toggle the bottom-bar language chip popover. */
  toggleLangMenu: () => void;
  /** Toggle the Extensions "Add a language" example. */
  toggleAddLang: () => void;
  /** Expand / collapse a language card on the Extensions screen. */
  setLangExpanded: (id: string | null) => void;
  /** Enable / disable a language plugin (mirrored into `lockeLang`). */
  setLangEnabled: (id: string, on: boolean) => void;

  // ---- agents + settings (app-global) ----
  detectAgents: () => Promise<void>;
  loadAgentSettings: () => Promise<void>;
  /** Refresh the Locke MCP server registration status. */
  loadMcpStatus: () => Promise<void>;
  /** Register the Locke MCP server in Claude Code, then refresh status. */
  installMcp: () => Promise<void>;
  /** Remove the Locke MCP server registration, then refresh status. */
  uninstallMcp: () => Promise<void>;
  /** Open the Integrations page (remembers the view to return to). */
  goIntegrations: () => void;
  /** Leave the Integrations page, back to where it was opened from. */
  backFromInt: () => void;
  /** Open the full Settings screen (remembers the view to return to). */
  goSettings: () => void;
  /** Leave the Settings screen, back to where it was opened from. */
  backFromSettings: () => void;
  /** Reload the MCP debug call log. */
  loadMcpLog: () => Promise<void>;
  /** Clear the MCP debug call log, then reload it. */
  clearMcpLog: () => Promise<void>;
  /** Refresh the `locke` CLI shim status. */
  loadCliStatus: () => Promise<void>;
  /** Install the `locke` CLI shim, then refresh status. */
  installCli: () => Promise<void>;
  /** Remove the `locke` CLI shim, then refresh status. */
  uninstallCli: () => Promise<void>;
  toggleAgentEnabled: (id: string) => void;
  /** Set the global "Agent control" vs "Reviews only" mode and persist it. */
  setAgentMode: (on: boolean) => void;
  /** Switch the active theme: apply it live and persist app-global. */
  setTheme: (id: ThemeId) => void;
  setSettingsOpen: (open: boolean) => void;
  /** Toggle the action-bar settings popover (closes the approvals tray). */
  toggleSettings: () => void;
  setNewReviewOpen: (open: boolean) => void;
  /** Open/close the delete-pull confirmation for a given review id ("" closes). */
  requestDeletePull: (id: string) => void;
  /** Permanently delete the pull record currently pending confirmation. */
  deletePullRequest: () => Promise<void>;
  /** Run the first enabled agent against the current review's open change
   *  requests, then refresh the diff to show its commit (Phase 6, headless). */
  runAgent: () => Promise<void>;
  clearAgentOutput: () => void;

  // ---- live streaming run (Phase 7) ----
  /** Start a streaming run for the open review with the first enabled agent.
   *  Claude streams live with in-app permissions; other agents fall back to a
   *  one-shot headless run surfaced as a single event. */
  startRun: () => Promise<void>;
  /** Open the pre-run approval modal (seeds the selected agent). The actual run
   *  only starts once the user confirms via `confirmRun`. */
  requestRun: () => void;
  setRunSelectedAgent: (id: string) => void;
  setRunAutoMode: (on: boolean) => void;
  setRunPlanFirst: (on: boolean) => void;
  cancelRunApproval: () => void;
  confirmRun: () => void;
  /** Approve the plan under review: transition the live run from plan→build (the
   *  same process continues editing). When `auto`, the build phase is switched to
   *  Auto mode first, so it runs unattended. No-op outside a real plan-review. */
  approvePlan: (auto?: boolean) => void;
  /** Send the agent back to revise its plan with the given feedback (deny the
   *  ExitPlanMode permission with a message); it re-presents a plan. */
  requestPlanChanges: (feedback: string) => void;
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
  /** Manually re-pull the open review's diff + comments (Refresh button + the
   *  `.locke` file-watcher), picking up agent edits and MCP comment replies. */
  refreshWorkspace: () => Promise<void>;

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

// A memorable, collision-resistant id: a random adjective-noun pair (the human
// handle people use to refer to a loop) plus a short random suffix. The id keys
// the loop's `.locke/loops/<id>/` tree and its seed worktree folder, so the
// suffix — not the words — is what guarantees two created in the same instant
// never share a folder. e.g. `loop-amber-otter-k3f`.
const SLUG_ADJECTIVES = [
  "amber", "brave", "calm", "crisp", "deft", "dusky", "fleet", "gentle",
  "keen", "lucid", "lunar", "mossy", "nimble", "noble", "plucky", "quiet",
  "rapid", "sage", "snappy", "solar", "steady", "sunny", "swift", "teal",
  "vivid", "warm", "bold", "bright", "jolly", "merry", "royal", "zesty",
] as const;
const SLUG_NOUNS = [
  "otter", "finch", "cedar", "heron", "maple", "falcon", "willow", "badger",
  "marten", "comet", "harbor", "meadow", "ridge", "ember", "brook", "sparrow",
  "lynx", "walrus", "ferret", "beacon", "cypress", "juniper", "lantern", "summit",
  "thistle", "quartz", "basalt", "drift", "fjord", "pippin", "cobra", "raven",
] as const;
const pick = (xs: readonly string[]): string => xs[Math.floor(Math.random() * xs.length)];
const slugId = (prefix: string): string =>
  `${prefix}-${pick(SLUG_ADJECTIVES)}-${pick(SLUG_NOUNS)}-${Math.random().toString(36).slice(2, 5)}`;

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
  filesRailOpen: true,
  filesRailWidth: 240,
  approvalsOpen: false,
  query: "",
  agentMode: true,
  theme: DEFAULT_THEME,
  navPlace: { activity: "top", loops: "top", reviews: "top", runs: "bottom", files: "bottom", agents: "bottom" },

  loops: MOCK ? MOCK_LOOPS : [],
  loopView: "list",
  selectedLoop: MOCK ? "vue3" : null,
  monitorLayout: "board",
  planTab: "scope",
  selectedSpec: "s1",
  loopReviewItem: null,
  loopPaused: false,
  targetSel: {},
  loopTargets: MOCK ? MOCK_LOOP_TARGETS : [],
  loopMatched: MOCK ? MOCK_LOOP_MATCHED : 0,
  loopAutoIncluded: MOCK ? MOCK_LOOP_AUTO_INCLUDED : 0,
  specApproach: {},
  specSteps: {},
  specStatus: {},
  loopManifest: [],
  loopPlanMeta: null,
  loopFeedback: [],
  loopItems: {},
  loopStream: {},
  loopItemRecords: {},
  // The seeded example draft is mock-only (the design preview); a real session
  // opens a blank builder the user fills in.
  draftTitle: MOCK ? MOCK_LOOP_DRAFT.title : "",
  draftBranch: MOCK ? MOCK_LOOP_DRAFT.branch : "",
  draftBase: MOCK ? MOCK_LOOP_DRAFT.base : "main",
  draftResolver: { kind: "glob", pattern: MOCK ? MOCK_LOOP_DRAFT.pattern : "" },
  draftLoopId: null,
  draftPrompt: MOCK ? MOCK_LOOP_DRAFT.prompt : "",
  draftMode: "plan",
  repoBranches: MOCK ? ["main", "develop", "release/2.4"] : [],

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

  fileTree: MOCK ? MOCK_FILE_TREE : [],
  fileContents: MOCK ? MOCK_FILE_CONTENTS : {},
  // Empty until a repo loads (`loadFileTree` seeds the first file). The mock
  // fleet keeps its seeded explorer so the plain-`vite` demo isn't blank.
  filePath: MOCK ? "payments-service/src/webhooks/retryHandler.ts" : "",
  fileFromReview: null,
  expandedDirs: (MOCK
    ? {
        "payments-service": true,
        "payments-service/src": true,
        "payments-service/src/webhooks": true,
        "payments-service/src/components": true,
      }
    : {}) as Record<string, boolean>,
  langExpanded: null,
  addLangOpen: false,
  langMenuOpen: false,
  extReturn: "activity",
  langEnabled: Object.fromEntries(lockeLang.list().map((p) => [p.id, p.enabled])),

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
  mcpStatus: null,
  mcpBusy: false,
  mcpError: "",
  mcpLog: [],
  cliStatus: null,
  cliBusy: false,
  cliError: "",
  intReturn: "activity",
  settingsReturn: "activity",
  settingsOpen: false,
  newReviewOpen: false,
  deletePullPending: "",
  agentRunning: false,
  agentOutput: null,

  pending: MOCK ? MOCK_PENDING : [],
  runs: {},
  runRows: MOCK ? MOCK_RUN_ROWS : [],
  history: [],
  runReviewMap: {},
  runUseWorktree: true,
  runApprovalOpen: false,
  runSelectedAgentId: null,
  runAutoMode: false,
  runPlanFirst: false,

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
      const theme = isThemeId(s.theme) ? s.theme : DEFAULT_THEME;
      set({ disabledAgents: s.disabled, agentMode: s.enabled, theme });
      applyTheme(theme);
    } catch {
      // Missing/unreadable settings just means defaults (nothing disabled, agents on).
    }
  },

  loadMcpStatus: async () => {
    if (MOCK) return; // no Tauri bridge in mock mode; leave status null
    try {
      const status = await mcpServerStatus();
      set({ mcpStatus: status });
    } catch {
      // A failed probe just leaves the panel in its prior/empty state.
    }
  },

  installMcp: async () => {
    if (MOCK || get().mcpBusy) return;
    set({ mcpBusy: true, mcpError: "" });
    try {
      await installMcpServer();
    } catch (e) {
      set({ mcpError: String(e) });
    } finally {
      // Always refresh real status from Claude so the toggle reflects ground truth.
      await get().loadMcpStatus();
      set({ mcpBusy: false });
    }
  },

  uninstallMcp: async () => {
    if (MOCK || get().mcpBusy) return;
    set({ mcpBusy: true, mcpError: "" });
    try {
      await uninstallMcpServer();
    } catch (e) {
      set({ mcpError: String(e) });
    } finally {
      await get().loadMcpStatus();
      set({ mcpBusy: false });
    }
  },

  goIntegrations: () =>
    set((s) => ({
      intReturn: s.view === "integrations" ? s.intReturn : s.view,
      view: "integrations",
      settingsOpen: false,
      approvalsOpen: false,
    })),

  backFromInt: () => {
    const { intReturn, selectedPR } = get();
    if (intReturn === "workspace" && selectedPR) {
      get().openReview(selectedPR, get().workspaceTab);
    } else {
      get().go(intReturn === "workspace" ? "activity" : intReturn);
    }
  },

  goSettings: () =>
    set((s) => ({
      settingsReturn: s.view === "settings" ? s.settingsReturn : s.view,
      view: "settings",
      settingsOpen: false,
      approvalsOpen: false,
    })),

  backFromSettings: () => {
    const { settingsReturn, selectedPR } = get();
    if (settingsReturn === "workspace" && selectedPR) {
      get().openReview(selectedPR, get().workspaceTab);
    } else {
      get().go(settingsReturn === "workspace" ? "activity" : settingsReturn);
    }
  },

  loadMcpLog: async () => {
    if (MOCK) return;
    try {
      set({ mcpLog: await mcpCallLog() });
    } catch {
      // A failed read just leaves the prior log in place.
    }
  },

  clearMcpLog: async () => {
    if (MOCK) return;
    try {
      await clearMcpCallLog();
    } finally {
      await get().loadMcpLog();
    }
  },

  loadCliStatus: async () => {
    if (MOCK) return;
    try {
      set({ cliStatus: await cliCommandStatus() });
    } catch {
      // A failed probe leaves the panel in its prior/empty state.
    }
  },

  installCli: async () => {
    if (MOCK || get().cliBusy) return;
    set({ cliBusy: true, cliError: "" });
    try {
      await installCliCommand();
    } catch (e) {
      set({ cliError: String(e) });
    } finally {
      await get().loadCliStatus();
      set({ cliBusy: false });
    }
  },

  uninstallCli: async () => {
    if (MOCK || get().cliBusy) return;
    set({ cliBusy: true, cliError: "" });
    try {
      await uninstallCliCommand();
    } catch (e) {
      set({ cliError: String(e) });
    } finally {
      await get().loadCliStatus();
      set({ cliBusy: false });
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
    void writeAgentSettings({ disabled: next, enabled: agentMode, theme: get().theme });
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
    void writeAgentSettings({ disabled: disabledAgents, enabled: on, theme: get().theme });
  },

  setTheme: (id) => {
    const { disabledAgents, agentMode } = get();
    set({ theme: id });
    applyTheme(id);
    void writeAgentSettings({ disabled: disabledAgents, enabled: agentMode, theme: id });
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  toggleSettings: () => set({ settingsOpen: !get().settingsOpen, approvalsOpen: false }),

  setNewReviewOpen: (open) => {
    set({ newReviewOpen: open });
    // Refresh the branch list when opening the picker so branches created outside
    // Locke since the repo was opened show up without reopening the folder/app.
    const { repoPath } = get();
    if (open && repoPath && !MOCK) {
      listBranches(repoPath)
        .then((branches) => set({ branches }))
        .catch(() => {
          // Best-effort refresh; the picker still works with the cached list.
        });
    }
  },
  requestDeletePull: (id) => set({ deletePullPending: id }),

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

  requestRun: () => {
    // Seed the picker with the agent that would run by default (first detected,
    // enabled CLI) so the modal can show — and let the user change — who acts.
    const { agents, disabledAgents, runSelectedAgentId } = get();
    const derived = agents.find((a) => a.detected && !disabledAgents.includes(a.id));
    const stillValid =
      runSelectedAgentId && agents.some((a) => a.id === runSelectedAgentId && a.detected && !disabledAgents.includes(a.id));
    set({ runApprovalOpen: true, runSelectedAgentId: stillValid ? runSelectedAgentId : derived?.id ?? null });
  },
  setRunSelectedAgent: (id) => set({ runSelectedAgentId: id }),
  setRunAutoMode: (on) => set({ runAutoMode: on }),
  setRunPlanFirst: (on) => set({ runPlanFirst: on }),
  cancelRunApproval: () => set({ runApprovalOpen: false }),
  confirmRun: () => {
    set({ runApprovalOpen: false });
    void get().startRun();
  },

  startRun: async () => {
    const { repoPath, selectedPR, reviews, files, threads, agents, disabledAgents, runUseWorktree, runSelectedAgentId, runAutoMode, runPlanFirst } = get();
    const review = reviews.find((r) => r.id === selectedPR);
    // Honor the user's pick from the approval modal; fall back to the first
    // detected, enabled agent if the selection is stale or unset.
    const enabled = (a: AgentInfo) => a.detected && !disabledAgents.includes(a.id);
    const agent = agents.find((a) => a.id === runSelectedAgentId && enabled(a)) ?? agents.find(enabled);
    // Always switch to the Run tab so the user sees what happens.
    set({ workspaceTab: "run" });
    if (!repoPath || !review || !agent) {
      set((s) => ({ runs: mergeRun(s.runs, selectedPR, { events: [{ key: "x", kind: "denied", text: "No enabled agent detected to run.", time: "" }], done: false, paused: true, runId: null, phase: null }) }));
      return;
    }
    // The agent acts on open change requests; with none there's nothing to do.
    const openCRs = threads.filter((t) => !t.resolved && t.kind === "change_request").length;
    if (openCRs === 0) {
      set((s) => ({ runs: mergeRun(s.runs, review.id, { events: [{ key: "x", kind: "msg", text: "No open change requests to action on this review.", time: "" }], done: false, paused: false, runId: null, phase: null, planReview: null }) }));
      return;
    }
    // "Plan first" is Claude-only (it's the `--permission-mode plan` flow); other
    // agents don't take the flag, so they always run directly.
    const planFirst = runPlanFirst && agent.id === "claude";
    const prompt = buildAgentPrompt({ repoPath, selectedPR, reviews, files, threads, planFirst });
    const runId = slugId("run");
    set((s) => ({
      runs: mergeRun(s.runs, review.id, { events: [], done: false, paused: false, planReview: null, phase: planFirst ? "plan" : "build", runId }),
      runReviewMap: { ...s.runReviewMap, [runId]: review.id },
      reviews: s.reviews.map((r) => (r.id === review.id ? { ...r, runId, runState: "running" } : r)),
    }));
    try {
      if (agent.id === "claude") {
        // Live streaming with in-app permissions; events arrive via listeners.
        // Plan first starts in `--permission-mode plan` (the agent investigates,
        // then blocks on ExitPlanMode for the Plan→Build gate). Otherwise Auto mode
        // hands permission decisions to Claude's own classifier (`auto`); off keeps
        // the in-app Allow/Deny prompts (`default`).
        const permissionMode = planFirst ? "plan" : runAutoMode ? "auto" : "default";
        await startRunApi(runId, repoPath, review.branch, agent.cmd, prompt, runUseWorktree, permissionMode);
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
    const { runs, selectedPR } = get();
    const runId = runs[selectedPR]?.runId;
    if (!runId || MOCK) return;
    try {
      await cancelRunApi(runId);
    } catch {
      // Best-effort; the run:done handler settles UI state regardless.
    }
  },

  onRunEvent: (e) => {
    const { runReviewMap } = get();
    const reviewId = runReviewMap[e.runId];
    // Route the event to its review's surface (keyed by reviewId) — it accumulates
    // there whether or not that review is currently open, so navigating away never
    // loses the stream.
    if (!reviewId) return;
    set((s) => ({
      runs: mergeRun(s.runs, reviewId, {
        events: [...(s.runs[reviewId]?.events ?? []), { key: e.key, kind: e.kind, text: e.text, sub: e.sub, time: e.time }],
      }),
    }));
  },

  onRunPermission: (e) => {
    const { runReviewMap, reviews, pending } = get();
    const reviewId = runReviewMap[e.runId];
    if (!reviewId) return;
    // ExitPlanMode is the Plan→Build gate, not a tool prompt: the agent has
    // finished planning and is blocked until the user approves. Route it to the
    // review's dedicated plan-review surface (carrying the plan markdown in `cmd`)
    // instead of the generic permission tray.
    if (e.tool === "ExitPlanMode") {
      set((s) => ({ runs: mergeRun(s.runs, reviewId, { planReview: { runId: e.runId, requestId: e.requestId, plan: e.cmd } }) }));
      return;
    }
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
    if (!reviewId) return;
    const finalState = e.state === "done" ? "done" : "failed";
    set((s) => ({
      reviews: s.reviews.map((r) => (r.id === reviewId ? { ...r, runState: finalState } : r)),
      // Clear any stale permission cards for this run.
      pending: s.pending.filter((p) => p.runId !== e.runId),
      // Settle this review's surface (works whether or not it's the open review).
      runs: mergeRun(s.runs, reviewId, {
        runId: null,
        phase: null,
        done: e.state === "done",
        paused: e.state !== "done",
        planReview: null,
      }),
    }));
    // Reloading mutates the global diff slice, so only do it for the open review;
    // a background run's diff refreshes lazily when the user next opens it.
    if (reviewId === selectedPR) void get().reloadAfterRun(reviewId);
  },

  reloadAfterRun: async (reviewId) => {
    const { repoPath, reviews, selectedFile } = get();
    if (!repoPath || MOCK) return;
    const review = reviews.find((r) => r.id === reviewId);
    if (!review) return;
    try {
      // Also reload comments so agent replies written via the MCP server
      // (reply_to_comment → .locke/comments) show up, not just the diff.
      const [detail, saved, runs] = await Promise.all([
        getReview(repoPath, review.branch, review.base),
        loadComments(repoPath, Number(reviewId)),
        readRuns(repoPath),
      ]);
      const files = detail.fileSummary.map(toChangedFile);
      // Keep the user on the same file across a refresh when it still exists;
      // rebuilt files carry empty hunks, so loadDiff re-fetches the live diff.
      const keep = files[selectedFile] ? selectedFile : 0;
      set({
        detail: { ...EMPTY_DETAIL, commits: detail.commits },
        files,
        selectedFile: keep,
        threads: saved?.threads ?? get().threads,
        viewed: saved?.viewed ?? get().viewed,
        nextThreadId: saved?.nextThreadId ?? get().nextThreadId,
        history: runs.filter((r) => r.branch === review.branch).map(runToHistory),
      });
      if (files.length) await get().loadDiff(keep);
    } catch (e) {
      set({ error: String(e) });
    }
  },

  refreshWorkspace: async () => {
    const { selectedPR } = get();
    if (selectedPR) await get().reloadAfterRun(selectedPR);
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
    const { pending, runs } = get();
    const p = pending.find((x) => x.id === id);
    if (!p) return;
    const surface = runs[p.reviewId] ?? EMPTY_SURFACE;
    let nextPending = pending.filter((x) => x.id !== id);
    const events = surface.events.slice();
    let done = surface.done;
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
    set((s) => ({ pending: nextPending, runs: mergeRun(s.runs, p.reviewId, { events, done }) }));
  },
  denyApproval: (id) => {
    if (!MOCK) {
      const p = get().pending.find((x) => x.id === id);
      if (p) void respondPermission(p.runId, id, false);
      set((s) => ({ pending: s.pending.filter((x) => x.id !== id) }));
      return;
    }
    const { pending, runs } = get();
    const p = pending.find((x) => x.id === id);
    if (!p) return;
    const surface = runs[p.reviewId] ?? EMPTY_SURFACE;
    const events = surface.events.slice();
    let paused = surface.paused;
    if (p.reviewId === "142") {
      events.push({ key: "ed", kind: "denied", text: "Denied `" + p.cmd + "` — run paused.", time: "—" });
      paused = true;
    }
    set((s) => ({ pending: s.pending.filter((x) => x.id !== id), runs: mergeRun(s.runs, p.reviewId, { events, paused }) }));
  },

  // Approve the plan → allow the ExitPlanMode permission. The same Claude process
  // exits plan mode and continues into the build phase, streaming its edits; later
  // tool prompts arrive as normal permission cards.
  approvePlan: (auto = false) => {
    const reviewId = get().selectedPR;
    const p = get().runs[reviewId]?.planReview;
    if (!p) return;
    set((s) => ({ runs: mergeRun(s.runs, reviewId, { planReview: null, phase: "build" }), runAutoMode: auto }));
    if (MOCK) return;
    // Order matters: the mode switch must reach the CLI (its stdin write flushed)
    // BEFORE the plan is allowed, or the build exits plan mode in default and the
    // first tool prompts before Auto takes. Await sequentially so the two control
    // messages can't be reordered across separate Tauri IPC calls.
    void (async () => {
      try {
        if (auto) await setPermissionMode(p.runId, "auto");
        await respondPermission(p.runId, p.requestId, true);
      } catch {
        // The run:done handler settles UI state if the round-trip fails.
      }
    })();
  },
  // Request changes → deny the ExitPlanMode permission with the user's feedback as
  // the message. Claude revises and re-presents a plan (a fresh ExitPlanMode
  // permission routes back into the surface's planReview), so the run stays in the
  // plan phase.
  requestPlanChanges: (feedback) => {
    const reviewId = get().selectedPR;
    const p = get().runs[reviewId]?.planReview;
    if (!p) return;
    const msg = feedback.trim() || "Please revise the plan.";
    if (!MOCK) void respondPermission(p.runId, p.requestId, false, undefined, msg);
    set((s) => ({ runs: mergeRun(s.runs, reviewId, { planReview: null }) }));
  },

  go: (view) => {
    set({
      view,
      approvalsOpen: false,
      settingsOpen: false,
      fileFromReview: null,
      langMenuOpen: false,
      // Entering Loops from the nav always lands on the list (its own router
      // resets), so a stale sub-view never shows.
      ...(view === "loops" ? { loopView: "list" as LoopView, loopReviewItem: null } : {}),
    });
    // Pull the real loop registry when opening Loops in a live session.
    if (view === "loops" && !MOCK) void get().loadLoops();
  },
  openReview: (id, tab = "diff") => {
    const { repoPath, reviews, pulls } = get();
    // The run surface is per-review (`runs[id]`), so it persists across navigation
    // automatically — opening a review just selects it; nothing to reset or restore.
    // Verdict is registry-backed; seed it from the pull so the workspace reflects
    // any prior decision.
    set({
      view: "workspace",
      workspaceTab: tab,
      selectedPR: id,
      verdict: pulls[id]?.verdict ?? null,
      approvalsOpen: false,
    });
    if (MOCK) {
      // Seed the design's workspace data for the opened review (only #142 is
      // detailed; others open with an empty diff). Seed its run surface from the
      // mock events only if it has none yet, so a scripted run-in-progress survives.
      set((s) => ({
        files: MOCK_FILES_BY_ID[id] ?? [],
        threads: MOCK_THREADS_BY_ID[id] ?? [],
        history: MOCK_HISTORY_BY_ID[id] ?? [],
        runs: s.runs[id] ? s.runs : mergeRun(s.runs, id, { events: MOCK_RUN_EVENTS_BY_ID[id] ?? [] }),
        liveChecks: MOCK_CHECKS,
        selectedFile: 0,
      }));
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
  toggleFilesRail: () => set({ filesRailOpen: !get().filesRailOpen }),
  setFilesRailWidth: (w) => set({ filesRailWidth: Math.max(240, Math.min(560, Math.round(w))) }),
  toggleApprovals: () => set({ approvalsOpen: !get().approvalsOpen, settingsOpen: false }),
  setQuery: (q) => set({ query: q }),
  setNavPlace: (key, place) => set((s) => ({ navPlace: { ...s.navPlace, [key]: place } })),

  // ---- loops (v2.0.0; mock-driven in front-end-only phase) ----
  openLoop: (id) => {
    const loop = get().loops.find((l) => l.id === id);
    // Route by lifecycle: a draft resumes its builder, a planning loop opens its
    // scope interview, anything live/done goes straight to the monitor.
    const v: LoopView = loop?.state === "draft" ? "builder" : loop?.state === "planning" ? "plan" : "monitor";
    set({ selectedLoop: id, loopView: v, loopReviewItem: null });
    if (MOCK) return;
    if (v === "builder") {
      // Restore the saved draft into the builder, then re-resolve its targets.
      void (async () => {
        const { repoPath } = get();
        if (!repoPath) return;
        const d = await readLoopDraftApi(repoPath, id).catch(() => null);
        if (d) {
          set({
            draftTitle: d.title ?? "",
            draftBranch: d.branch ?? "",
            draftBase: d.base ?? get().base,
            draftPrompt: d.prompt ?? "",
            draftMode: d.mode ?? "plan",
            draftResolver: d.resolver ?? { kind: "glob", pattern: "" },
            targetSel: d.targetSel ?? {},
            draftLoopId: id,
          });
        }
        void get().loadLoopTargets();
        void get().loadRepoBranches();
      })();
    } else if (v === "plan") {
      // Resume a planning loop: restore its draft (for the prompt approve→build
      // needs) and load the strategist's specs + scope metadata.
      void (async () => {
        const { repoPath } = get();
        if (!repoPath) return;
        const d = await readLoopDraftApi(repoPath, id).catch(() => null);
        if (d) set({ draftPrompt: d.prompt ?? "", draftBranch: d.branch ?? "", draftBase: d.base ?? get().base });
      })();
      set({ planTab: "scope" });
      void get().loadLoopPlan(id);
    } else {
      void get().loadLoopItems(id);
    }
  },
  newLoop: () =>
    set({
      loopView: "builder",
      loopReviewItem: null,
      targetSel: {},
      draftMode: "plan",
      // Real sessions start from a blank draft (the seeded example is mock-only);
      // the builder's inputs fill these in and re-match the pattern as it's typed.
      ...(MOCK
        ? {}
        : {
            draftTitle: "",
            draftBranch: "",
            draftBase: get().base,
            draftResolver: { kind: "glob" as const, pattern: "" },
            draftPrompt: "",
            draftLoopId: null,
            loopTargets: [],
            loopMatched: 0,
            loopAutoIncluded: 0,
          }),
    }),
  loopToList: () => set({ loopView: "list", loopReviewItem: null }),
  deleteLoop: (id) => {
    const s = get();
    const loop = s.loops.find((l) => l.id === id);
    set((st) => ({
      loops: st.loops.filter((l) => l.id !== id),
      ...(st.selectedLoop === id ? { selectedLoop: null } : {}),
      ...(st.draftLoopId === id ? { draftLoopId: null } : {}),
    }));
    if (MOCK || !s.repoPath) return;
    // Stop it first if it's live, then remove its persisted state.
    if (loop && (loop.state === "building" || loop.state === "paused")) void stopLoopApi(id);
    void deleteLoopApi(s.repoPath, id);
  },
  setLoopView: (v) => set({ loopView: v }),
  setMonitorLayout: (l) => set({ monitorLayout: l }),
  setPlanTab: (t) => set({ planTab: t }),
  selectSpec: (id) => set({ selectedSpec: id }),
  setDraftMode: (m) => set({ draftMode: m }),
  setDraftTitle: (v) => set({ draftTitle: v }),
  setDraftBranch: (v) => set({ draftBranch: v }),
  setDraftBase: (v) => set({ draftBase: v }),
  setDraftResolver: (r) => set({ draftResolver: r }),
  // Autosave the draft loop. Creates it (and a registry row) the moment it has a
  // title, then keeps it current; the full builder state lives in draft.json so it
  // reopens exactly. No-op in mock / without a repo / before it's named.
  saveDraft: () => {
    const s = get();
    if (MOCK || !s.repoPath || s.draftTitle.trim() === "") return;
    const id = s.draftLoopId ?? slugId("loop");
    if (!s.draftLoopId) set({ draftLoopId: id });
    const loop: Loop = {
      id,
      title: s.draftTitle,
      branch: s.draftBranch,
      base: s.draftBase,
      mode: s.draftMode,
      state: "draft",
      pattern: resolverSummary(s.draftResolver),
      total: 0,
      done: 0,
      running: 0,
      review: 0,
      failed: 0,
      queued: 0,
      blocked: 0,
      rate: "—",
      elapsed: "draft",
    };
    set((st) => ({
      loops: st.loops.some((l) => l.id === id) ? st.loops.map((l) => (l.id === id ? loop : l)) : [loop, ...st.loops],
    }));
    void saveLoopDraftApi(s.repoPath, loop, {
      title: s.draftTitle,
      branch: s.draftBranch,
      base: s.draftBase,
      prompt: s.draftPrompt,
      mode: s.draftMode,
      resolver: s.draftResolver,
      targetSel: s.targetSel,
    });
  },
  setDraftPrompt: (v) => set({ draftPrompt: v }),
  loadRepoBranches: async () => {
    const { repoPath } = get();
    if (MOCK || !repoPath) return;
    try {
      set({ repoBranches: await listBranchesApi(repoPath) });
    } catch {
      // A failed read just leaves the prior branch list in place.
    }
  },
  toggleTarget: (path, on) => set((s) => ({ targetSel: { ...s.targetSel, [path]: on } })),
  // Mock: drives the scripted "vue3" loop. Tauri: creates a real loop from the
  // draft and kicks off the backend runner — Build mode → monitor, Plan mode →
  // the strategist (scope pass + per-item specs) then the Plan view.
  startLoop: () => {
    const s = get();
    const plan = s.draftMode !== "build";
    if (MOCK || !s.repoPath) {
      set(
        plan
          ? { loopView: "plan", selectedLoop: "vue3", planTab: "scope" }
          : { loopView: "monitor", selectedLoop: "vue3", loopPaused: false },
      );
      return;
    }
    // Reuse the saved draft's id so the draft becomes the running loop (no dupe).
    const loopId = s.draftLoopId ?? slugId("loop");
    // Fold the user's audit (`targetSel` over each row's `inc`) into the resolved
    // entries, persist that as the loop's manifest, and run the included set.
    const entries: ManifestEntry[] = s.loopTargets.map((t) => ({
      ...t,
      inc: Object.prototype.hasOwnProperty.call(s.targetSel, t.path) ? s.targetSel[t.path] : t.inc,
    }));
    const targets = entries.filter((t) => t.inc).map((t) => t.path);
    const pattern = resolverSummary(s.draftResolver);
    const placeholder: Loop = {
      id: loopId,
      title: s.draftTitle,
      branch: s.draftBranch,
      base: s.draftBase,
      mode: plan ? "plan" : "build",
      state: plan ? "planning" : "building",
      pattern,
      total: 0,
      done: 0,
      running: 0,
      review: 0,
      failed: 0,
      queued: 0,
      blocked: 0,
      rate: "—",
      elapsed: plan ? "planning" : "0m 0s",
    };
    set((st) => ({
      loops: [placeholder, ...st.loops.filter((l) => l.id !== loopId)],
      loopView: plan ? "plan" : "monitor",
      selectedLoop: loopId,
      planTab: plan ? "scope" : st.planTab,
      loopPaused: false,
      draftLoopId: null,
      // Seed the Plan view with the included rows (queued) so items show at once;
      // the strategist fills in approach/steps/status as it specs each.
      loopManifest: plan ? entries.filter((t) => t.inc).map((t) => ({ ...t, status: "queued" })) : st.loopManifest,
      loopPlanMeta: plan ? null : st.loopPlanMeta,
      loopItems: { ...st.loopItems, [loopId]: [] },
      loopStream: { ...st.loopStream, [loopId]: [] },
    }));
    void writeLoopManifestApi(s.repoPath, loopId, entries);
    const args = {
      loopId,
      repo: s.repoPath,
      branch: s.draftBranch,
      base: s.draftBase,
      pattern,
      template: s.draftPrompt,
      targets,
      // DEV: dialed right down while we finesse the flows + stop controls, so a
      // run burns minimal tokens and is easy to halt. Raise (plan ~4, build ~6)
      // once the controls are settled.
      concurrency: plan ? 1 : 2,
      checks: s.checkSpecs,
    };
    void (plan ? startPlanApi(args) : startLoopApi(args));
  },
  // Approve the strategist's plan and start the build over the same loop. The
  // (enriched, audited) manifest is already persisted, so start_loop consumes it
  // unchanged; the loop flips plan → build in place.
  approveLoopPlan: () => {
    const s = get();
    const loopId = s.selectedLoop;
    const loop = s.loops.find((l) => l.id === loopId);
    if (MOCK || !s.repoPath || !loopId || !loop) {
      set({ loopView: "monitor", selectedLoop: MOCK ? "vue3" : loopId, loopPaused: false });
      return;
    }
    set((st) => ({
      loops: st.loops.map((l) => (l.id === loopId ? { ...l, mode: "build", state: "building", elapsed: "0m 0s" } : l)),
      loopView: "monitor",
      loopPaused: false,
      loopItems: { ...st.loopItems, [loopId]: [] },
      loopStream: { ...st.loopStream, [loopId]: [] },
    }));
    void startLoopApi({
      loopId,
      repo: s.repoPath,
      branch: loop.branch,
      base: loop.base,
      pattern: loop.pattern,
      // Empty: the runner reads the loop's persisted template + enriched manifest.
      template: s.draftPrompt,
      targets: [],
      concurrency: 2, // DEV: see startLoop note
      checks: s.checkSpecs,
    });
  },
  // Return a (possibly already-approved/building) loop to Plan mode: halt any run,
  // flip the record back to plan/planning on disk, and reopen the Plan view on the
  // strategist's existing specs. Lets you re-review or re-run after an accidental
  // approve — no re-spec happens until you choose to.
  reopenPlan: (id) => {
    const s = get();
    const loopId = id ?? s.selectedLoop;
    if (!loopId) return;
    if (MOCK) {
      set({ loopView: "plan", selectedLoop: loopId, planTab: "scope", loopPaused: false });
      return;
    }
    if (s.repoPath) {
      void stopLoopApi(loopId);
      void setLoopModeApi(s.repoPath, loopId, "plan", "planning");
    }
    set((st) => ({
      loops: st.loops.map((l) => (l.id === loopId ? { ...l, mode: "plan", state: "planning" } : l)),
      selectedLoop: loopId,
      loopView: "plan",
      planTab: "scope",
      loopPaused: false,
    }));
    void get().loadLoopPlan(loopId);
  },
  stopLoop: () => {
    const s = get();
    if (!MOCK && s.selectedLoop) void stopLoopApi(s.selectedLoop);
    set({ loopView: "list", loopReviewItem: null });
  },
  togglePause: () => {
    const next = !get().loopPaused;
    set({ loopPaused: next });
    const s = get();
    if (!MOCK && s.selectedLoop) void pauseLoopApi(s.selectedLoop, next);
  },
  openLoopReview: (itemId) => set({ loopView: "review", loopReviewItem: itemId }),
  loopReviewBack: () => set({ loopView: "monitor", loopReviewItem: null }),
  resolveLoopReview: (decision) => {
    const s = get();
    if (!MOCK && s.selectedLoop && s.repoPath) {
      const file = (s.loopItems[s.selectedLoop] ?? []).find((i) => i.id === s.loopReviewItem)?.path;
      if (file) {
        void resolveLoopItemApi(s.repoPath, s.selectedLoop, file, decision === "approve" ? "approve" : "request", s.loopFeedback.join("\n"));
      }
    }
    set({ loopView: "monitor", loopReviewItem: null, loopFeedback: [] });
  },
  setSpecApproach: (id, approach) => set((s) => ({ specApproach: { ...s.specApproach, [id]: approach } })),
  toggleSpecStep: (id, k) =>
    set((s) => {
      // Steps default to on; the override map flips them off (and back).
      const cur = { ...(s.specSteps[id] ?? {}) };
      const eff = cur[k] === undefined ? true : cur[k];
      cur[k] = !eff;
      return { specSteps: { ...s.specSteps, [id]: cur } };
    }),
  // Accept/exclude mutate the persisted manifest (the build's source of truth) so
  // the creator's calls carry into the build: an excluded item drops out (inc=false).
  acceptSpec: (id) => {
    const s = get();
    const loopManifest = s.loopManifest.map((e) => ((e.id ?? e.path) === id ? { ...e, status: "specced", inc: true } : e));
    set({ loopManifest, specStatus: { ...s.specStatus, [id]: "specced" } });
    if (!MOCK && s.repoPath && s.selectedLoop) void writeLoopManifestApi(s.repoPath, s.selectedLoop, loopManifest);
  },
  excludeSpec: (id) => {
    const s = get();
    const cur = s.loopManifest.find((e) => (e.id ?? e.path) === id);
    const nowExcluded = cur?.status !== "excluded";
    const loopManifest = s.loopManifest.map((e) =>
      (e.id ?? e.path) === id ? { ...e, status: nowExcluded ? "excluded" : "review", inc: !nowExcluded } : e,
    );
    set({ loopManifest, specStatus: { ...s.specStatus, [id]: nowExcluded ? "excluded" : "review" } });
    if (!MOCK && s.repoPath && s.selectedLoop) void writeLoopManifestApi(s.repoPath, s.selectedLoop, loopManifest);
  },

  loadLoops: async () => {
    const { repoPath } = get();
    if (MOCK || !repoPath) return;
    try {
      set({ loops: await readLoopsApi(repoPath) });
    } catch {
      // A failed read just leaves the prior list in place.
    }
  },
  loadLoopItems: async (loopId) => {
    const { repoPath } = get();
    if (MOCK || !repoPath) return;
    try {
      const recs = await readLoopItemsApi(repoPath, loopId);
      const items: LoopItem[] = recs.map((r) => ({
        id: r.id ?? r.path,
        path: r.path,
        status: r.status ?? "queued",
        agent: r.agent ?? "CL",
        action: r.line,
        note: r.reason,
        wave: r.wave,
        priority: r.priority,
        blockedBy: r.blockedBy,
      }));
      set((s) => ({
        loopItems: { ...s.loopItems, [loopId]: items },
        loopItemRecords: { ...s.loopItemRecords, [loopId]: recs },
      }));
    } catch {
      // Leave prior items in place on a failed read.
    }
  },
  loadLoopPlan: async (loopId) => {
    const { repoPath } = get();
    if (MOCK || !repoPath) return;
    try {
      const [manifest, meta] = await Promise.all([
        readLoopManifestApi(repoPath, loopId),
        readLoopPlanMetaApi(repoPath, loopId),
      ]);
      const inc = manifest.filter((e) => e.inc);
      set((s) => ({
        loopManifest: inc,
        loopPlanMeta: meta,
        selectedSpec: inc[0]?.id ?? inc[0]?.path ?? s.selectedSpec,
      }));
    } catch {
      // Leave any prior plan data in place on a failed read.
    }
  },
  loadLoopTargets: async () => {
    const { repoPath, draftResolver } = get();
    if (MOCK || !repoPath) return;
    try {
      const list = await resolveTargetsApi(repoPath, draftResolver);
      // A real resolve surfaces every file in the audit list, so nothing is
      // auto-included off-list (that aggregate is a mock-only nicety).
      set({ loopTargets: list, loopMatched: list.length, loopAutoIncluded: 0 });
    } catch {
      // A failed resolve just leaves the prior audit list in place.
    }
  },
  // Upsert one item (by id, else path) into the loop's live item list.
  onLoopItem: (e) =>
    set((s) => {
      const items = [...(s.loopItems[e.loopId] ?? [])];
      const idx = items.findIndex((it) => it.id === e.itemId || it.path === e.path);
      const next: LoopItem = {
        id: e.itemId,
        path: e.path,
        status: e.status,
        agent: e.agent,
        action: e.line,
        pct: e.pct,
        t: e.t,
        wave: e.wave,
        priority: e.priority,
        blockedBy: e.blockedBy,
      };
      if (idx >= 0) items[idx] = { ...items[idx], ...next };
      else items.push(next);
      // While the Plan view is open on this loop, mirror the item's status onto its
      // manifest row so spec dots go speccing → specced/review live.
      const loopManifest =
        s.loopView === "plan" && s.selectedLoop === e.loopId
          ? s.loopManifest.map((m) => ((m.id ?? m.path) === e.itemId || m.path === e.path ? { ...m, status: e.status } : m))
          : s.loopManifest;
      return { loopItems: { ...s.loopItems, [e.loopId]: items }, loopManifest };
    }),
  onLoopProgress: (e) =>
    set((s) => ({
      loops: s.loops.map((l) =>
        l.id === e.loopId
          ? { ...l, total: e.total, done: e.done, running: e.running, review: e.review, failed: e.failed, queued: e.queued, blocked: e.blocked, rate: e.rate, elapsed: e.elapsed }
          : l,
      ),
    })),
  onLoopEvent: (e) =>
    set((s) => {
      const arr = [{ st: e.st, path: e.path, text: e.text, t: e.t }, ...(s.loopStream[e.loopId] ?? [])].slice(0, 200);
      return { loopStream: { ...s.loopStream, [e.loopId]: arr } };
    }),
  onLoopDone: (e) => {
    const state: LoopState =
      e.state === "done" ? "done" : e.state === "stopped" ? "paused" : e.state === "planning" ? "planning" : "building";
    set((s) => ({ loops: s.loops.map((l) => (l.id === e.loopId ? { ...l, state } : l)) }));
    // A finished planning pass: reload the manifest + scope metadata so the Plan
    // view shows the strategist's full specs (approach/steps/tests), not just dots.
    if (e.state === "planning" && get().selectedLoop === e.loopId && get().loopView === "plan") {
      void get().loadLoopPlan(e.loopId);
    }
  },

  openFullFile: (path, review) => {
    set({
      view: "files",
      filePath: path,
      fileFromReview: review ?? null,
      langMenuOpen: false,
      settingsOpen: false,
      approvalsOpen: false,
    });
    void get().loadFileContent(path);
  },
  backToReview: () => {
    const f = get().fileFromReview;
    if (f) {
      set({ fileFromReview: null });
      get().openReview(f.id, "diff");
    } else {
      get().go("activity");
    }
  },
  goExtensions: () =>
    set((s) => ({
      extReturn: s.view === "extensions" ? s.extReturn : s.view,
      view: "extensions",
      settingsOpen: false,
      langMenuOpen: false,
      approvalsOpen: false,
    })),
  backFromExt: () => {
    const { extReturn, selectedPR } = get();
    if (extReturn === "workspace" && selectedPR) {
      get().openReview(selectedPR, get().workspaceTab);
    } else {
      get().go(extReturn === "workspace" ? "activity" : extReturn);
    }
  },
  loadFileTree: async () => {
    const { repoPath } = get();
    if (MOCK || !repoPath) return;
    try {
      const tree = await listFileTree(repoPath);
      set({ fileTree: tree });
      // Open the explorer on the first file so the viewer isn't blank (the
      // default filePath is a mock path that won't exist in a real repo).
      const first = firstFilePath(tree);
      if (first) {
        set({ filePath: first });
        void get().loadFileContent(first);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },
  loadFileContent: async (path) => {
    const { repoPath, fileContents } = get();
    if (MOCK || !repoPath || !path) return;
    if (fileContents[path] !== undefined) return; // cached
    try {
      const text = await readRepoFile(repoPath, path);
      set((s) => ({ fileContents: { ...s.fileContents, [path]: text } }));
    } catch (e) {
      // Show a readable placeholder rather than blanking the viewer.
      set((s) => ({ fileContents: { ...s.fileContents, [path]: `// Could not read ${path}\n// ${String(e)}` } }));
    }
  },
  toggleDir: (path) => set((s) => ({ expandedDirs: { ...s.expandedDirs, [path]: !s.expandedDirs[path] } })),
  selectFilePath: (path) => {
    set({ filePath: path, langMenuOpen: false });
    void get().loadFileContent(path);
  },
  toggleLangMenu: () => set((s) => ({ langMenuOpen: !s.langMenuOpen })),
  toggleAddLang: () => set((s) => ({ addLangOpen: !s.addLangOpen })),
  setLangExpanded: (id) => set((s) => ({ langExpanded: s.langExpanded === id ? null : id })),
  setLangEnabled: (id, on) => {
    lockeLang.setEnabled(id, on);
    set((s) => ({ langEnabled: { ...s.langEnabled, [id]: on } }));
  },

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
        // The explorer reloads for the newly-opened repo.
        fileTree: [],
        fileContents: {},
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
      // Populate the Files explorer for the opened repo (best-effort).
      void get().loadFileTree();
      // Watch this repo's .locke/ so out-of-process MCP edits (agent comment
      // replies, run records) refresh the open review without a manual reload.
      void watchLocke(path);
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

  deletePullRequest: async () => {
    const { repoPath, deletePullPending } = get();
    if (!repoPath || !deletePullPending) return;
    const id = deletePullPending;
    set({ loading: true, error: null });
    try {
      // Deletes the PR record + comments file; the git branch is left intact,
      // matching GitHub's "delete pull request" (which never removes the branch).
      await deletePull(repoPath, Number(id));
      set((s) => {
        const pulls = { ...s.pulls };
        delete pulls[id];
        const closingActive = s.selectedPR === id;
        return {
          reviews: s.reviews.filter((r) => r.id !== id),
          pulls,
          deletePullPending: "",
          // Only navigate away if we were viewing the PR we just deleted.
          ...(closingActive ? { view: "activity" as const, selectedPR: "" } : {}),
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
