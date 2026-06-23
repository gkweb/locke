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
  type CheckSpec,
  type LockeConfig,
  type AgentInfo,
} from "../api/git.js";
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
  /** True while a headless agent run is in flight (Phase 6). */
  agentRunning: boolean;
  /** Combined output (or error) of the last agent run, for display. */
  agentOutput: string | null;

  // ---- prototype run surface (design hero-flow; real streaming is a later phase) ----
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
  /** Run the first enabled agent against the current review's open change
   *  requests, then refresh the diff to show its commit (Phase 6). */
  runAgent: () => Promise<void>;
  clearAgentOutput: () => void;

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

export const useStore = create<LockeState>((set, get) => ({
  reviews: [],
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
  agents: [],
  disabledAgents: [],
  settingsOpen: false,
  agentRunning: false,
  agentOutput: null,

  pending: [],
  runEvents: [],
  runRows: [],
  history: [],
  showPermission: false,
  runDone: false,
  runPaused: false,

  detectAgents: async () => {
    try {
      set({ agents: await detectAgents() });
    } catch {
      // Detection is best-effort status; never block the app on a failed probe.
    }
  },

  loadAgentSettings: async () => {
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
    // Leaving agent control closes any agent-only surface that's open.
    set({ agentMode: on, approvalsOpen: on ? get().approvalsOpen : false });
    void writeAgentSettings({ disabled: get().disabledAgents, enabled: on });
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

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
    });
    if (!repoPath) return;
    // Each review carries its own head branch + base (the PR id is not the branch).
    const review = reviews.find((r) => r.id === id);
    const branch = review?.branch ?? id;
    const base = review?.base ?? get().base;
    // Live mode: load this branch's detail + file shells, then its first diff.
    set({ loading: true, error: null });
    Promise.all([getReview(repoPath, branch, base), loadComments(repoPath, Number(id))])
      .then(async ([detail, saved]) => {
        const files = detail.fileSummary.map(toChangedFile);
        set({
          detail: { ...EMPTY_DETAIL, commits: detail.commits },
          files,
          selectedFile: 0,
          threads: saved?.threads ?? [],
          viewed: saved?.viewed ?? {},
          nextThreadId: saved?.nextThreadId ?? 100,
          liveChecks: [],
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
