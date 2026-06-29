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
  | "loops"
  | "reviews"
  | "runs"
  | "agents"
  | "files"
  | "extensions"
  | "integrations"
  | "settings"
  | "workspace";

/** A configurable navigation destination (excludes `workspace`/`extensions`,
 *  which are reached contextually, not from the nav). */
export type NavKey = "activity" | "loops" | "reviews" | "runs" | "files" | "agents";

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

// ---- Loops (v2.0.0) -------------------------------------------------------
// A "loop" runs one task across many files: Locke plans the change, you audit
// which targets are in scope, then it iterates — committing what passes and
// pausing for review wherever it's unsure. These shapes mirror the design's
// Loops state model so the ported views and a future loop-runner backend agree.

/** Which Loops sub-screen is showing (the Loops view's internal router). */
export type LoopView = "list" | "builder" | "plan" | "monitor" | "review";

/** A loop's lifecycle state. `building` = actively iterating. */
export type LoopState = "draft" | "planning" | "building" | "paused" | "done";

/** How a loop starts: full Plan-mode (interview + dry-run spec) or straight Build. */
export type LoopMode = "plan" | "build";

/** Per-item lifecycle within a loop (board columns, grid tiles, stream rows). */
export type LoopItemState = "queued" | "running" | "review" | "done" | "failed" | "excluded" | "blocked";

/** Per-target risk band, driving the audit pills. */
export type LoopRisk = "low" | "med" | "high";

/** Plan-mode per-item spec status. */
export type SpecStatus = "specced" | "review" | "speccing" | "queued" | "excluded";

/** One loop — a task applied across a matched set of files. Counts are carried
 *  explicitly (cheaper than recomputing for a 1,000-item set on every render). */
export interface Loop {
  id: string;
  title: string;
  branch: string;
  base: string;
  mode: LoopMode;
  state: LoopState;
  /** Glob the targets were matched from, e.g. "src/**\/*.vue". */
  pattern: string;
  total: number;
  done: number;
  running: number;
  review: number;
  failed: number;
  queued: number;
  /** Items whose dependencies can no longer complete (runner-set; 0 if absent). */
  blocked?: number;
  /** Throughput readout, e.g. "5.8 / min" (or "—" when idle). */
  rate: string;
  /** Elapsed/heading time, e.g. "1h 12m" / "planning". */
  elapsed: string;
}

/** One file a loop iterates over (board cards, stream rows, grid focus). */
export interface LoopItem {
  id: string;
  path: string;
  status: LoopItemState;
  /** Author initials (drives the AgentMark). */
  agent: string;
  /** Live action line (running items). */
  action?: string;
  /** Pause/fail note (review/failed items). */
  note?: string;
  /** Build progress 0–100 (running items). */
  pct?: number;
  /** Relative time, e.g. "2m" / "just now" / "—". */
  t?: string;
  /** Topological tier (drives the Waves view). */
  wave?: number;
  /** Scheduling priority within a wave. */
  priority?: number;
  /** Unmet dependency ids (blocked items) — drives the "blocked by …" readout. */
  blockedBy?: string[];
}

/** A builder audit row — a matched file the user includes/excludes. */
export interface LoopTarget {
  path: string;
  loc: number;
  risk: LoopRisk;
  /** Detected concerns, e.g. ["mixins", "filters", "$children"]. */
  flags: string[];
  /** Default inclusion (false when Locke auto-excludes, with a `reason`). */
  inc: boolean;
  reason?: string;
}

/** How a loop's target set is produced. Every kind yields a path list that
 *  materializes into the checked-in `manifest.json`. `list` is the universal
 *  sink — a custom resolver (Rust or a TS function) just produces paths. */
export type ResolverSpec =
  | { kind: "glob"; pattern: string }
  | { kind: "globs"; include: string[]; exclude: string[] }
  | { kind: "list"; paths: string[] }
  | { kind: "command"; command: string }
  | { kind: "custom"; id: string; args: string[] };

/** One row of a loop's `manifest.json`: a work-graph node — a target plus its
 *  dependency edges and (once Plan mode runs) its spec. A superset of `LoopTarget`. */
export interface ManifestEntry extends LoopTarget {
  /** Stable node id (file items default to `path`; task items get a slug). */
  id?: string;
  /** "file" (edit a path) | "task" (a shared/prerequisite job). */
  kind?: string;
  /** Label for task nodes (file nodes use `path`). */
  title?: string;
  /** Ids that must reach `done` before this item is eligible (blocked-by edges). */
  requires?: string[];
  /** Human-pinned ordering within the ready set (higher first). */
  priority?: number;
  /** Topological tier, derived from `requires` (hand-overridable). */
  wave?: number;
  /** Strategy id once specced, e.g. "script-setup". */
  approach?: string;
  detected?: string[];
  steps?: string[];
  tests?: string[];
  note?: string;
  /** Repo-relative ref to the per-item markdown spec, once written. */
  spec?: string;
  /** Spec lifecycle: "" | speccing | specced | review | excluded. */
  status?: string;
  /** Provenance: "resolver" (matched by the glob/list) | "model" (strategist-
   *  suggested task) | "human" (user-added). Empty on legacy rows (= "resolver"). */
  origin?: string;
}

/** Who authored a work-graph node — the normalized `ManifestEntry.origin`. */
export type NodeOrigin = "resolver" | "model" | "human";

/** A work-graph node as the Plan-view graph editor renders it — derived from a
 *  `ManifestEntry` by `manifestToGraph()`. */
export interface WorkGraphNode {
  /** Stable id (file path or task slug) — the key edges reference. */
  id: string;
  kind: "file" | "task";
  /** Display label (task title, or the file path). */
  label: string;
  /** Ids this node depends on (must finish first). */
  requires: string[];
  priority: number;
  /** Topological tier (0 = no in-graph deps). */
  wave: number;
  origin: NodeOrigin;
  status: string;
}

/** One planned edit step within a per-item spec. */
export interface LoopSpecStep {
  /** Stable key for the per-spec on/off override map. */
  k: string;
  text: string;
}

/** Plan-mode per-item spec: what the loop will do to one file. */
export interface LoopSpec {
  id: string;
  path: string;
  risk: LoopRisk;
  status: SpecStatus;
  /** Strategy id, e.g. "script-setup" | "options-api" (labels live in the view). */
  approach: string;
  detected: string[];
  steps: LoopSpecStep[];
  tests: string[];
  note: string;
}

/** A message in the plan-mode scope interview. */
export interface InterviewMsg {
  role: "agent" | "you";
  text: string;
}

/** A dry-run spec summary line (plan scope rail). */
export interface SpecSummary {
  label: string;
  detail: string;
  /** True when this line is still awaiting the user's answer (amber). */
  pend?: boolean;
}

/** A loop's scope metadata, written by the strategist's scope pass (`plan.json`)
 *  and rendered on the Plan view's Scope tab. */
export interface LoopPlanMeta {
  summary: SpecSummary[];
  assumptions: string[];
}

/** A live stream event in the monitor's Stream layout. */
export interface LoopStreamEvent {
  st: LoopItemState;
  path: string;
  text: string;
  /** Clock timestamp, e.g. "12:41:08". */
  t: string;
}

/** One line of a loop-item review diff. Exactly one shape per line:
 *  a hunk header (`h`), a code line (`t`/`no`/`c`), or an inline thread marker. */
export interface LoopDiffLine {
  h?: string;
  t?: "add" | "del";
  no?: number;
  c?: string;
  thread?: boolean;
}

/** One line in a diff hunk: [kind, oldLineNo, newLineNo, text]. 0 means absent. */
export type DiffLine = [LineKind, number, number, string];

/** A contiguous block of changes within a file. */
export interface Hunk {
  /** The @@ header line. */
  hdr: string;
  lines: DiffLine[];
}

/** One node in the repo file-explorer tree (Files screen). Directories carry
 *  their `children`; files omit it. `path` is repo-relative, forward-slashed. */
export interface FileNode {
  t: "dir" | "file";
  name: string;
  path: string;
  /** Nesting depth from the tree root, driving the row indent. */
  depth: number;
  children?: FileNode[];
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
