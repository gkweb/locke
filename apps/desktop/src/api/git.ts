import { invoke } from "@tauri-apps/api/core";
import type { ChangedFile, Commit, FileNode, Hunk, PullRecord, Review } from "@locke/core";

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

export const reviewSummary = (repo: string, branch: string, base: string) =>
  invoke<GitReview | null>("review_summary", { repo, branch, base });

export const listBranches = (repo: string) => invoke<string[]>("list_branches", { repo });

/** Detect the repo's trunk branch (origin/HEAD → main/master/… → current). */
export const detectBase = (repo: string) => invoke<string>("detect_base", { repo });

export const deleteBranch = (repo: string, branch: string) =>
  invoke("delete_branch", { repo, branch });

export const getReview = (repo: string, branch: string, base: string) =>
  invoke<GitReviewDetail>("get_review", { repo, branch, base });

export const getDiff = (repo: string, branch: string, base: string, file: string) =>
  invoke<GitDiff>("get_diff", { repo, branch, base, file });

/** List the repo's working tree as a nested node list (`.gitignore`-respecting,
 *  `.git` excluded). Empty in mock mode (no Tauri bridge). */
export const listFileTree = (repo: string): Promise<FileNode[]> =>
  isTauri ? invoke<FileNode[]>("list_file_tree", { repo }) : Promise.resolve([]);

/** Read one working-tree file's full contents (path-confined to the repo).
 *  Tauri-only — callers gate on `isTauri`/mock. */
export const readRepoFile = (repo: string, file: string) =>
  invoke<string>("read_repo_file", { repo, file });

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

/** A known coding-agent CLI and whether it was found on PATH. */
export interface AgentInfo {
  id: string;
  name: string;
  cmd: string;
  detected: boolean;
  /** Resolved location on PATH when detected (presence-only; nothing is run). */
  path: string | null;
  version: string | null;
}

/**
 * Detect known agent CLIs by presence on PATH — a filesystem lookup, never an
 * execution (so it can't trip Gatekeeper or run an untrusted binary). Empty in
 * mock mode (no Tauri bridge).
 */
export const detectAgents = (): Promise<AgentInfo[]> =>
  isTauri ? invoke<AgentInfo[]>("detect_agents") : Promise.resolve([]);

/**
 * App-global agent preferences (not repo-keyed), persisted to
 * `<app_config_dir>/agents.json`. `disabled` is the per-agent opt-out set (a
 * newly-installed agent the user has never toggled is enabled by default).
 * `enabled` is the global "Agent control" vs "Reviews only" mode — when false the
 * whole agent surface is hidden. Defaults to true (agent control on).
 */
export interface AgentSettings {
  disabled: string[];
  enabled: boolean;
}

export const readAgentSettings = (): Promise<AgentSettings> =>
  isTauri
    ? invoke<{ disabled?: string[]; enabled?: boolean } | null>("read_agent_settings").then((s) => ({
        disabled: s?.disabled ?? [],
        enabled: s?.enabled ?? true,
      }))
    : Promise.resolve({ disabled: [], enabled: true });

export const writeAgentSettings = (settings: AgentSettings): Promise<void> =>
  isTauri ? invoke("write_agent_settings", { settings }) : Promise.resolve();

// ---- MCP integration (Settings → Integrations) ----

/** Status of the Locke MCP server registration, for the Settings panel. */
export interface McpStatus {
  /** Whether the `locke` server is registered in Claude Code (user scope). */
  installed: boolean;
  /** Whether the `locke-mcp` binary was found to install/point clients at. */
  binaryAvailable: boolean;
  /** Absolute path to the resolved `locke-mcp` binary ("" if not found). */
  binaryPath: string;
  /** Whether the Claude Code CLI (`claude`) is available to install with. */
  claudeAvailable: boolean;
  /** Copy-able config snippet for registering Locke in any other MCP client. */
  snippet: { mcpServers: { locke: { command: string } } };
}

const MOCK_MCP_STATUS: McpStatus = {
  installed: false,
  binaryAvailable: false,
  binaryPath: "",
  claudeAvailable: false,
  snippet: { mcpServers: { locke: { command: "locke-mcp" } } },
};

export const mcpServerStatus = (): Promise<McpStatus> =>
  isTauri ? invoke<McpStatus>("mcp_server_status") : Promise.resolve(MOCK_MCP_STATUS);

export const installMcpServer = (): Promise<void> => invoke("install_mcp_server");

export const uninstallMcpServer = (): Promise<void> => invoke("uninstall_mcp_server");

/** One logged MCP tool call (written by locke-mcp into ~/.locke/mcp-log.jsonl). */
export interface McpCallLogEntry {
  time: string;
  tool: string;
  agent: string;
  repo: string;
  args: unknown;
  ok: boolean;
  error: string | null;
}

export const mcpCallLog = (limit = 200): Promise<McpCallLogEntry[]> =>
  isTauri ? invoke<McpCallLogEntry[]>("mcp_call_log", { limit }) : Promise.resolve([]);

export const clearMcpCallLog = (): Promise<void> =>
  isTauri ? invoke("clear_mcp_call_log") : Promise.resolve();

export const runChecks = (repo: string, branch: string, checks: CheckSpec[]) =>
  invoke<CheckResult[]>("run_checks", { repo, branch, checks });

/**
 * Run an enabled agent headlessly against `branch` with `prompt`, committing its
 * work onto the branch (Phase 6). Returns the agent's combined output. Throws in
 * mock mode (no Tauri bridge) — callers gate on `isTauri`.
 */
export const runAgent = (repo: string, branch: string, agentCmd: string, prompt: string) =>
  invoke<string>("run_agent", { repo, branch, agentCmd, prompt });

// ---- live streaming agent runs (Claude stream-json control protocol) ----

/** A run-stream event emitted by the backend (`run:event`), already shaped like
 *  the UI's RunEvent plus the owning runId. */
export interface RunEventPayload {
  runId: string;
  key: string;
  kind: "msg" | "read" | "edit" | "result" | "done" | "denied";
  text: string;
  sub?: string;
  time: string;
}

/** A tool-permission prompt the agent is blocked on (`run:permission`). Answer it
 *  with `respondPermission(runId, requestId, allow)`. */
export interface RunPermissionPayload {
  runId: string;
  requestId: string;
  tool: string;
  cmd: string;
  why: string;
  scope: string;
  suggestions: unknown;
}

/** A run finishing (`run:done`). */
export interface RunDonePayload {
  runId: string;
  state: "done" | "failed" | "canceled";
  result: string;
  duration: string;
  branch: string;
}

/** A persisted run record (`.locke/runs/<runId>.json`), for the History tab. */
export interface RunRecord {
  runId: string;
  branch: string;
  agent: string;
  startedAt: number;
  endedAt: number;
  duration: string;
  state: "done" | "failed" | "canceled";
  permissions: number;
  result: string;
  events: RunEventPayload[];
}

/**
 * Start a live streaming Claude run. Returns immediately; the run streams via the
 * `run:event` / `run:permission` / `run:done` Tauri events keyed by `runId`. The
 * agent runs in an isolated worktree (committed onto the branch on success) when
 * `useWorktree`, else directly in the repo's working tree.
 */
export const startRun = (
  runId: string,
  repo: string,
  branch: string,
  agentCmd: string,
  prompt: string,
  useWorktree: boolean,
) => invoke<void>("start_run", { runId, repo, branch, agentCmd, prompt, useWorktree });

/** Answer a pending tool-permission prompt (Allow/Deny) for a live run. */
export const respondPermission = (
  runId: string,
  requestId: string,
  allow: boolean,
  updatedInput?: unknown,
  message?: string,
) => invoke<void>("respond_permission", { runId, requestId, allow, updatedInput, message });

/** Cancel an in-flight run (kills the agent process). */
export const cancelRun = (runId: string) => invoke<void>("cancel_run", { runId });

/** Read all persisted run records (newest first). Empty in mock mode. */
export const readRuns = (repo: string): Promise<RunRecord[]> =>
  isTauri ? invoke<RunRecord[]>("read_runs", { repo }) : Promise.resolve([]);

const initials = (name: string): string => {
  const parts = name.trim().split(/[\s/_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || "??").toUpperCase();
};

/**
 * Merge an explicit pull request (the persisted registry record) with live git
 * stats into the UI's Review. Identity and lifecycle (id/status/verdict/author)
 * come from the pull; size/recency (files/add/del/commits/time) come from git.
 * `git` is null when the branch is gone (e.g. merged/deleted) — the PR still
 * renders with zeroed stats so it can be seen and removed.
 */
export function toReview(pull: PullRecord, git: GitReview | null, comments: number): Review {
  return {
    id: String(pull.id),
    title: pull.title || git?.title || pull.branch,
    branch: pull.branch,
    base: pull.base,
    agent: pull.author || "unknown",
    model: null,
    isAgent: pull.isAgent,
    initials: initials(pull.author || pull.branch),
    status: pull.status,
    files: git?.files ?? 0,
    add: git?.add ?? 0,
    del: git?.del ?? 0,
    comments,
    checks: "pass",
    time: git?.time ?? "",
  };
}

/** Display name for a repo path (its final path segment). */
export const repoBasename = (path: string | null, fallback = "Open repository…"): string =>
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
