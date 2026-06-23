// Domain types for Locke. These mirror the design's data shapes so the ported
// view logic and the real git/store backends speak the same language.

/** Review lifecycle state. Not derivable from git — lives in the local store. */
export type ReviewStatus = "ready" | "draft" | "changes" | "merged" | "closed";

/** Aggregate CI/local-check state for a review. */
export type CheckState = "pass" | "running" | "fail";

/** Per-file change type from a diff. */
export type FileStatus = "A" | "M" | "D";

/** Per-line role within a diff hunk. */
export type LineKind = "ctx" | "add" | "del";

/** The reviewer's decision on a review. */
export type Verdict = "approve" | "changes";

/** The diff layout the review pane is showing. */
export type DiffMode = "unified" | "split";

/**
 * Which top-level screen is active. The Mission Control IA: the fleet
 * destinations plus the per-review `workspace`, the repo-wide `files`
 * explorer and the `extensions` (language plugins) screen. (Replaces the
 * old list/overview/review trio.)
 */
export type View =
  | "activity"
  | "reviews"
  | "runs"
  | "agents"
  | "files"
  | "extensions"
  | "workspace";

/** A configurable navigation destination (excludes `workspace`/`extensions`,
 *  which are reached contextually, not from the nav). */
export type NavKey = "activity" | "reviews" | "runs" | "files" | "agents";

/** Where a nav destination is surfaced: the top action bar, the bottom
 *  action bar, or hidden. Configured per destination in Settings. */
export type NavPlacement = "top" | "bottom" | "off";

/** The tab shown inside the Review Workspace. */
export type WorkspaceTab = "diff" | "run" | "checks" | "history";

/** Agent-run lifecycle, shared across the fleet surfaces (design state model). */
export type RunState = "idle" | "running" | "awaiting" | "done" | "failed";

/** One line in a live agent-run event stream (Run tab). */
export interface RunEvent {
  /** Stable key for list rendering. */
  key: string;
  kind: "msg" | "read" | "edit" | "result" | "done" | "denied";
  text: string;
  /** Optional monospace sub-block (e.g. a command or output snippet). */
  sub?: string;
  time: string;
}

/** A pending permission request an agent is blocked on (approvals tray). */
export interface Approval {
  id: string;
  /** Review the run belongs to (so the tray can open it). */
  reviewId: string;
  runId: string;
  agent: string;
  initials: string;
  branch: string;
  /** The command the agent wants to run, e.g. `npm test -- webhooks`. */
  cmd: string;
  /** Tool family for "Always allow {tool}", e.g. "npm", "git". */
  tool: string;
  /** Human explanation of why the agent wants this. */
  why: string;
  /** Scope note, e.g. "sandboxed · repo dir only". */
  scope: string;
}

/** A row in the global Runs table. */
export interface RunRow {
  runId: string;
  agent: string;
  initials: string;
  branch: string;
  state: RunState;
  duration: string;
  /** The review id this run belongs to. */
  rev: string;
}

/** A saved run in a review's History timeline. */
export interface HistoryEntry {
  runId: string;
  title: string;
  time: string;
  duration: string;
  state: RunState;
  /** Saved artifacts, e.g. ["log.txt", "diff.patch", "test-output"]. */
  artifacts: string[];
}

/**
 * A persisted pull request — the explicit, on-disk record in `.locke/pulls.json`.
 * Pull requests are opt-in: a branch only becomes a PR when one is created. The
 * numeric `id` is stable across branch renames so future agents can reference a
 * PR durably. Authorship and lifecycle (status/verdict) are captured here; live
 * git stats are derived separately at load time and merged into `Review`.
 */
export interface PullRecord {
  id: number;
  /** Head branch name, e.g. "agent/webhook-idempotency". */
  branch: string;
  /** Base branch the head is reviewed against, e.g. "develop". */
  base: string;
  title: string;
  body: string;
  /** Display name of the author, captured at create time. */
  author: string;
  /** True when authored by an agent (the `agent/` branch convention). */
  isAgent: boolean;
  status: ReviewStatus;
  verdict: Verdict | null;
  /** RFC3339 timestamps, for record-keeping and agent reasoning. */
  createdAt: string;
  updatedAt: string;
}

/** The whole `.locke/pulls.json` document: registry plus a monotonic id counter. */
export interface PullStore {
  nextId: number;
  pulls: PullRecord[];
}

/**
 * A "review" — Locke's unit of work. Maps to an explicit pull request (a head
 * branch compared against a base branch). Git-derived fields
 * (files/add/del/commits/time) and registry fields (id/status/verdict/agent) are
 * merged into one object for the UI, exactly as the design consumes it.
 */
export interface Review {
  /** Stable id — the pull request's numeric id rendered as a string. */
  id: string;
  title: string;
  /** Head branch name, e.g. "agent/webhook-idempotency". */
  branch: string;
  /** Base branch the head is compared against, e.g. "main". */
  base: string;
  /** Display name of the author (agent or human). */
  agent: string;
  /** Model id when agent-authored, else null. */
  model: string | null;
  /** True when authored by an agent (drives teal vs violet accents). */
  isAgent: boolean;
  /** Two-letter avatar initials, e.g. "CL", "CX", "MA". */
  initials: string;
  status: ReviewStatus;
  /** Number of files changed. */
  files: number;
  /** Lines added. */
  add: number;
  /** Lines deleted. */
  del: number;
  /** Open comment count. */
  comments: number;
  checks: CheckState;
  /** Human-relative time, e.g. "8 min ago". */
  time: string;
  /** Id of the latest agent run on this review, when one exists (fleet surfaces). */
  runId?: string;
  /** Live agent-run state, when a run is active/recent (drives fleet grouping
   *  and the in-flight cards). Absent for reviews with no run. */
  runState?: RunState;
  /** One-line description of the agent's most recent action, e.g.
   *  "editing src/types/stripe.d.ts (+12)" (Activity in-flight card). */
  lastAction?: string;
  /** Elapsed time of the active run, e.g. "1:12" (in-flight card footer). */
  elapsed?: string;
}

/** One line in a diff hunk: [kind, oldLineNo, newLineNo, text]. 0 means absent. */
export type DiffLine = [LineKind, number, number, string];

/** A contiguous block of changes within a file. */
export interface Hunk {
  /** The @@ header line. */
  hdr: string;
  lines: DiffLine[];
}

/** A changed file with its parsed diff. */
export interface ChangedFile {
  /** Repo-relative path, e.g. "src/webhooks/retryHandler.ts". */
  path: string;
  /** Directory portion incl. trailing slash, e.g. "src/webhooks/". */
  dir: string;
  /** Base name, e.g. "retryHandler.ts". */
  name: string;
  st: FileStatus;
  add: number;
  del: number;
  hunks: Hunk[];
}

/** One commit in a review's branch range. */
export interface Commit {
  sha: string;
  msg: string;
  time: string;
}

/** Author-supplied (or agent-generated) narrative for a review. */
export interface ReviewDetail {
  /** The prompt that produced the work, when agent-authored. */
  prompt: string;
  summary: string;
  bullets: string[];
  /** Optional callout note shown under the description. */
  note: string;
  commits: Commit[];
}

/** A single result row in the Checks card. */
export interface Check {
  label: string;
  detail: string;
  status: CheckState;
}

/** One message within a comment thread. */
export interface CommentItem {
  author: string;
  initials: string;
  isAgent: boolean;
  /** Badge label for humans, e.g. "AUTHOR", "REVIEWER". */
  roleLabel?: string;
  time: string;
  body: string;
}

/**
 * A line-anchored conversation. `lineId` follows the design's scheme:
 * "n<newNo>" for context/added lines, "o<oldNo>" for deleted lines.
 */
export interface Thread {
  id: number;
  /** File path the thread is anchored to. */
  file: string;
  lineId: string;
  resolved: boolean;
  /**
   * Triage label. `"change_request"` marks the thread as an actionable amendment for
   * the agent; absent/`"comment"` is plain discussion. Optional for back-compat with
   * threads written before this field existed.
   */
  kind?: "comment" | "change_request";
  items: CommentItem[];
}
