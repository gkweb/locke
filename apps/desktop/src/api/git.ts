import { invoke } from "@tauri-apps/api/core";
import type { ChangedFile, Commit, Hunk, Review, ReviewStatus } from "@locke/core";

// Typed wrappers over the Rust git commands. `isTauri` lets the app run under
// plain Vite (mock mode) without throwing when the bridge is absent.
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface GitReview {
  id: string;
  branch: string;
  base: string;
  title: string;
  author: string;
  files: number;
  add: number;
  del: number;
  commits: number;
  time: string;
}

export interface GitFileSummary {
  path: string;
  dir: string;
  name: string;
  st: string;
  add: number;
  del: number;
}

export interface GitReviewDetail {
  head: string;
  base: string;
  commits: Commit[];
  fileSummary: GitFileSummary[];
}

export interface GitDiff {
  hunks: Hunk[];
}

export const listReviews = (repo: string, base: string) =>
  invoke<GitReview[]>("list_reviews", { repo, base });

export const getReview = (repo: string, branch: string, base: string) =>
  invoke<GitReviewDetail>("get_review", { repo, branch, base });

export const getDiff = (repo: string, branch: string, base: string, file: string) =>
  invoke<GitDiff>("get_diff", { repo, branch, base, file });

export const pushBranch = (repo: string, branch: string, remote?: string) =>
  invoke<string>("push_branch", { repo, branch, remote });

export interface CheckSpec {
  label: string;
  command: string;
}
export interface CheckResult {
  label: string;
  status: "pass" | "fail";
  detail: string;
}

export interface LockeConfig {
  base?: string;
  remote?: string;
  checks?: CheckSpec[];
}

/** Read repo-specific config from locke.config.json (empty object if absent). */
export const readConfig = (repo: string) => invoke<LockeConfig>("read_config", { repo });

/** Whether `.locke/` review history is tracked in git (vs ignored via .gitignore). */
export const getLockeTracking = (repo: string) => invoke<boolean>("get_locke_tracking", { repo });
export const setLockeTracking = (repo: string, tracked: boolean) =>
  invoke("set_locke_tracking", { repo, tracked });

export const detectChecks = (repo: string) => invoke<CheckSpec[]>("detect_checks", { repo });

export const runChecks = (repo: string, branch: string, checks: CheckSpec[]) =>
  invoke<CheckResult[]>("run_checks", { repo, branch, checks });

const initials = (name: string): string => {
  const parts = name.trim().split(/[\s/_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || "??").toUpperCase();
};

/**
 * Map git facts onto the UI's Review. Fields git can't know (status, model,
 * checks) get sensible defaults here and are overridden by stored metadata in
 * the persistence layer. `agent-authored` branches use the `agent/` convention.
 */
export function toReview(g: GitReview, comments: number, status: ReviewStatus = "ready"): Review {
  const isAgent = g.branch.startsWith("agent/");
  return {
    id: g.id,
    title: g.title,
    branch: g.branch,
    base: g.base,
    agent: g.author || "unknown",
    model: null,
    isAgent,
    initials: initials(g.author || g.branch),
    status,
    files: g.files,
    add: g.add,
    del: g.del,
    comments,
    checks: "pass",
    time: g.time,
  };
}

/** Display name for a repo path (its final path segment). */
export const repoBasename = (path: string | null, fallback = "payments-service"): string =>
  path ? path.split("/").filter(Boolean).pop() || fallback : fallback;

/** Build a ChangedFile shell from a summary; hunks are loaded lazily. */
export function toChangedFile(s: GitFileSummary): ChangedFile {
  return {
    path: s.path,
    dir: s.dir,
    name: s.name,
    st: (s.st === "A" || s.st === "M" || s.st === "D" ? s.st : "M") as ChangedFile["st"],
    add: s.add,
    del: s.del,
    hunks: [],
  };
}
