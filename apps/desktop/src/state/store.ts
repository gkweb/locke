import { create } from "zustand";
import type {
  ChangedFile,
  DiffMode,
  Review,
  ReviewDetail,
  Thread,
  Verdict,
  View,
} from "@locke/core";
import {
  listReviews,
  reviewSummary,
  listBranches,
  detectBase,
  getReview,
  getDiff,
  pushBranch,
  deleteBranch,
  readReviewIndex,
  addReviewIndex,
  removeReviewIndex,
  detectChecks,
  runChecks,
  readConfig,
  getLockeTracking,
  setLockeTracking,
  toReview,
  toChangedFile,
  type CheckSpec,
  type LockeConfig,
} from "../api/git.js";
import {
  loadPersistedReview,
  savePersistedReview,
  loadCheckOverrides,
  saveCheckOverrides,
  clearCheckOverrides,
} from "../api/reviewStore.js";
import type { Check, ReviewStatus } from "@locke/core";

const EMPTY_DETAIL: ReviewDetail = { prompt: "", summary: "", bullets: [], note: "", commits: [] };

// Persist the current review's local-only state (comments/verdict/status/viewed)
// when a real repo is open. No-op in mock mode.
function persistCurrent(get: () => LockeState): void {
  const s = get();
  if (!s.repoPath) return;
  const status = s.reviews.find((r) => r.id === s.selectedPR)?.status ?? "ready";
  void savePersistedReview(s.repoPath, s.selectedPR, {
    threads: s.threads,
    verdict: s.verdict,
    status,
    viewed: s.viewed,
    nextThreadId: s.nextThreadId,
  });
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
  files: ChangedFile[];
  detail: ReviewDetail;
  threads: Thread[];

  // ---- UI state ----
  view: View;
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

  // ---- navigation ----
  go: (view: View) => void;
  openPR: (id: string) => void;
  goOverview: () => void;
  goReview: () => void;

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
  files: [],
  detail: EMPTY_DETAIL,
  threads: [],

  view: "list",
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

  go: (view) => set({ view }),
  openPR: (id) => {
    const { repoPath, reviews } = get();
    set({ view: "overview", selectedPR: id, verdict: null });
    if (!repoPath) return;
    // Each review carries its own base (head→base pair).
    const base = reviews.find((r) => r.id === id)?.base ?? get().base;
    // Live mode: load this branch's detail + file shells, then its first diff.
    set({ loading: true, error: null });
    Promise.all([getReview(repoPath, id, base), loadPersistedReview(repoPath, id)])
      .then(async ([detail, saved]) => {
        const files = detail.fileSummary.map(toChangedFile);
        set({
          detail: { ...EMPTY_DETAIL, commits: detail.commits },
          files,
          selectedFile: 0,
          threads: saved?.threads ?? [],
          verdict: saved?.verdict ?? null,
          viewed: saved?.viewed ?? {},
          nextThreadId: saved?.nextThreadId ?? 100,
          liveChecks: [],
          loading: false,
        });
        if (saved?.status) {
          set((s) => ({ reviews: s.reviews.map((r) => (r.id === id ? { ...r, status: saved.status } : r)) }));
        }
        if (files.length) await get().loadDiff(0);
      })
      .catch((e) => set({ loading: false, error: String(e) }));
  },
  goOverview: () => set({ view: "overview" }),
  goReview: () => {
    set({ view: "review" });
    void get().loadDiff(get().selectedFile);
  },

  openRepo: async (path, baseArg = "main") => {
    set({ loading: true, error: null, repoPath: path });
    try {
      // Repo config (locke.config.json) sets base/remote and default checks.
      const config = await readConfig(path).catch((): LockeConfig => ({}));
      // Base: config override, else auto-detect the trunk (main/master/…), else fallback.
      const base = config.base ?? (await detectBase(path).catch(() => baseArg));

      // Load these independently so one failure doesn't blank the whole repo.
      const [overrides, tracked, branches, index] = await Promise.all([
        loadCheckOverrides(path).catch(() => null),
        getLockeTracking(path).catch(() => true),
        listBranches(path).catch(() => [] as string[]),
        readReviewIndex(path).catch(() => []),
      ]);

      // Auto-derived reviews (branches ahead of base), capturing any error so
      // the queue still shows branches/empty-state instead of silently blanking.
      const byBranch = new Map<string, Review>();
      let error: string | null = null;
      try {
        for (const g of await listReviews(path, base)) byBranch.set(g.branch, toReview(g, 0));
      } catch (e) {
        error = `Couldn't list reviews against "${base}": ${String(e)}`;
      }
      // …merged with explicitly-created reviews (their chosen base wins).
      for (const entry of index) {
        const g = await reviewSummary(path, entry.branch, entry.base).catch(() => null);
        if (g) byBranch.set(g.branch, toReview(g, 0));
      }
      const reviews: Review[] = [...byBranch.values()];

      set({
        base,
        remote: config.remote ?? "origin",
        reviews,
        threads: [],
        view: "list",
        selectedPR: reviews[0]?.id ?? "",
        liveChecks: [],
        // Check precedence: per-repo override (.locke/checks.json) > config > auto-detect.
        checkSpecs: overrides ?? config.checks ?? [],
        checksAreOverride: !!overrides,
        editingChecks: false,
        trackHistory: tracked,
        branches,
        loading: false,
        error,
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
      await addReviewIndex(repoPath, head, base);
      const review = toReview(g, 0);
      set((s) => ({ reviews: [review, ...s.reviews.filter((r) => r.id !== review.id)], loading: false }));
      get().openPR(review.id);
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  closeReview: () => {
    get().setStatus("closed");
    set({ view: "list" });
  },

  deleteReviewBranch: async () => {
    const { repoPath, selectedPR } = get();
    if (!repoPath || !selectedPR) return;
    set({ loading: true, error: null });
    try {
      await deleteBranch(repoPath, selectedPR);
      await removeReviewIndex(repoPath, selectedPR); // also drops .locke review state
      set((s) => ({
        reviews: s.reviews.filter((r) => r.id !== selectedPR),
        view: "list",
        loading: false,
      }));
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  loadDiff: async (i) => {
    const { repoPath, files, selectedPR, reviews } = get();
    if (!repoPath) return;
    const file = files[i];
    if (!file || file.hunks.length) return; // already loaded or out of range
    const base = reviews.find((r) => r.id === selectedPR)?.base ?? get().base;
    try {
      const diff = await getDiff(repoPath, selectedPR, base, file.path);
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
    persistCurrent(get);
  },

  toggleResolve: (id) => {
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, resolved: !t.resolved } : t)),
    }));
    persistCurrent(get);
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
    persistCurrent(get);
  },

  toggleViewed: (i) => {
    set((s) => ({ viewed: { ...s.viewed, [i]: !s.viewed[i] } }));
    persistCurrent(get);
  },
  setVerdict: (v) => {
    set({ verdict: v });
    if (v === "changes") get().setStatus("changes");
    else persistCurrent(get);
  },
  setStatus: (status) => {
    set((s) => ({ reviews: s.reviews.map((r) => (r.id === s.selectedPR ? { ...r, status } : r)) }));
    persistCurrent(get);
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
    const { repoPath, selectedPR, remote } = get();
    set({ verdict: "approve" });
    if (!repoPath) {
      set({ pushed: true });
      return;
    }
    set({ loading: true, error: null });
    try {
      await pushBranch(repoPath, selectedPR, remote);
      set({ pushed: true, loading: false });
      get().setStatus("merged");
    } catch (e) {
      set({ loading: false, error: String(e) });
      persistCurrent(get);
    }
  },
  runTests: () => {
    const { repoPath, selectedPR, testsRunning } = get();
    if (testsRunning || !repoPath) return;
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
        const results = await runChecks(repoPath, selectedPR, specs);
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
