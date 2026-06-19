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

/** Which top-level screen is active. */
export type View = "list" | "overview" | "review";

/**
 * A "review" — Locke's unit of work. Maps to a local head branch compared
 * against a base branch. Git-derived fields (branch/base/files/add/del/commits)
 * and store-derived fields (status/agent/comments) are merged into one object
 * for the UI, exactly as the design consumes it.
 */
export interface Review {
  /** Stable id. For real branches this is the branch name; mocks use a number. */
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
  items: CommentItem[];
}
