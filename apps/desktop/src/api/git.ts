import { invoke } from "@tauri-apps/api/core";
import type {
  ChangedFile,
  Commit,
  FileNode,
  Hunk,
  Loop,
  LoopItemState,
  LoopMode,
  LoopPlanMeta,
  ManifestEntry,
  ResolverSpec,
  PullRecord,
  Review,
} from "@locke/core";

/** The builder's serialized draft, persisted so an unfinished loop survives. */
export interface LoopDraft {
  title: string;
  branch: string;
  base: string;
  prompt: string;
  mode: LoopMode;
  resolver: ResolverSpec;
  targetSel: Record<string, boolean>;
  /** Open a review when the loop finishes (opt-out). Absent on legacy drafts. */
  reviewOnDone?: boolean;
  /** Review granularity: "loop" (one review for the whole run) | "wave" (one per
   *  wave, opened as each wave finishes). Absent on legacy drafts → "loop". */
  reviewScope?: "loop" | "wave";
}

// Typed wrappers over the Rust git commands. `isTauri` lets the app run under
// plain Vite (mock mode) without throwing when the bridge is absent.
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Append a UI error record (JSON line) to the durable on-disk error log for later
 *  diagnosis. Resolves to the log path (empty outside Tauri). */
export const logUiError = (entry: string): Promise<string> =>
  isTauri ? invoke<string>("log_ui_error", { entry }) : Promise.resolve("");

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
  /** Selected UI theme id (v1.4). Persisted alongside agent prefs in the freeform
   *  agents.json, so it round-trips without a Rust change. */
  theme?: string;
}

export const readAgentSettings = (): Promise<AgentSettings> =>
  isTauri
    ? invoke<{ disabled?: string[]; enabled?: boolean; theme?: string } | null>("read_agent_settings").then((s) => ({
        disabled: s?.disabled ?? [],
        enabled: s?.enabled ?? true,
        theme: s?.theme,
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
  snippet: { mcpServers: { locke: { command: string; env?: Record<string, string> } } };
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

// ---- `locke <path>` CLI launch ----

/** Status of the `locke` shell command shim (Settings → Integrations). */
export interface CliStatus {
  installed: boolean;
  /** Absolute path of the installed shim (~/.local/bin/locke). */
  path: string;
}

/** Consume the repo path from a cold `locke <path>` launch (one-shot). */
export const takeInitialRepo = (): Promise<string | null> =>
  isTauri ? invoke<string | null>("take_initial_repo") : Promise.resolve(null);

export const cliCommandStatus = (): Promise<CliStatus> =>
  isTauri ? invoke<CliStatus>("cli_command_status") : Promise.resolve({ installed: false, path: "" });

export const installCliCommand = (): Promise<void> => invoke("install_cli_command");

export const uninstallCliCommand = (): Promise<void> => invoke("uninstall_cli_command");

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
  permissionMode: string,
) => invoke<void>("start_run", { runId, repo, branch, agentCmd, prompt, useWorktree, permissionMode });

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

/**
 * Switch a live run's permission mode mid-stream (`set_permission_mode` control
 * request). Used at the Plan→Build gate to arm Auto mode (`"auto"`) for the build
 * phase before the plan is approved.
 */
export const setPermissionMode = (runId: string, mode: string) =>
  invoke<void>("set_permission_mode", { runId, mode });

/**
 * Watch a repo's `.locke/` directory for out-of-process changes (MCP edits) — the
 * backend emits `locke:fs-change` on any change. No-op outside Tauri.
 */
export const watchLocke = (repo: string): Promise<void> =>
  isTauri ? invoke<void>("watch_locke", { repo }) : Promise.resolve();

/** Read all persisted run records (newest first). Empty in mock mode. */
export const readRuns = (repo: string): Promise<RunRecord[]> =>
  isTauri ? invoke<RunRecord[]>("read_runs", { repo }) : Promise.resolve([]);

// ---- loops (the fan-out runner; loop:* events keyed by loopId) ----

/** One item's state change (`loop:item`). */
export interface LoopItemEvent {
  loopId: string;
  itemId: string;
  path: string;
  status: LoopItemState;
  line?: string;
  pct?: number;
  agent: string;
  wave: number;
  priority: number;
  blockedBy?: string[];
  /** Epoch ms the item first started running — drives the Inspect view's live elapsed. */
  startedAt?: number;
  t: string;
}

/** One step in an item's tool trail (`loop:trail`) — what the agent just did. */
export interface LoopTrailEvent {
  loopId: string;
  itemId: string;
  path: string;
  tool: string;
  target?: string;
  t: string;
}

/** A persisted tool-trail entry on the item record. */
export interface LoopTrailEntry {
  tool: string;
  target?: string;
  t: string;
}

/** Aggregate loop progress (`loop:progress`). */
export interface LoopProgress {
  loopId: string;
  total: number;
  done: number;
  running: number;
  review: number;
  failed: number;
  queued: number;
  blocked: number;
  rate: string;
  elapsed: string;
}

/** A live stream log line (`loop:event`). */
export interface LoopEventPayload {
  loopId: string;
  st: LoopItemState;
  path: string;
  text: string;
  t: string;
}

/** A build agent's discovered prerequisite (`loop:block`) — `loop_block_on_task`. In
 *  `approve` policy the agent is blocked until the human decides; `gated` says so. */
export interface LoopBlockEvent {
  loopId: string;
  taskId: string;
  fromItem: string;
  title: string;
  spec: string;
  gated: boolean;
  t: string;
}

/** A persisted pending block proposal (read on reload). */
export interface LoopBlockRequest {
  taskId: string;
  title: string;
  spec: string;
  requires?: string[];
  priority?: number;
  ts?: string;
}

/** A loop finishing (`loop:done`). */
export interface LoopDonePayload {
  loopId: string;
  state: string;
  /** The review opened for the loop's output on completion (0 = none). */
  pullId: number;
}

/** A per-wave review opened mid-run under the "wave" review scope (`loop:review`):
 *  one wave's stacked review is ready while later waves keep building. */
export interface LoopReviewEvent {
  loopId: string;
  wave: number;
  pullId: number;
  t: string;
}

/** A live plan-interview question the strategist raised via `loop_ask` (`loop:interview`).
 *  The agent is blocked awaiting the answer. `key` is the raw item key (file path or
 *  task id), or `__scope__` for a scope-level question. */
export interface LoopInterviewEvent {
  loopId: string;
  key: string;
  file?: string;
  question: string;
  choices?: string[];
  t: string;
}

/** The persisted interview for a loop (transcript + still-pending questions), read on
 *  (re)load so a reopened/stalled plan shows its open questions. */
export interface LoopInterviewState {
  transcript: { key: string; role: "agent" | "you"; text: string; file?: string; ts?: string }[];
  pending: Record<string, { question: string; choices?: string[]; file?: string; nonce?: string; ts?: string }>;
}

/** A persisted per-item record (`.locke/loops/<id>/items/<path>.json`). */
export interface LoopItemRecord {
  id?: string;
  path: string;
  status?: LoopItemState;
  declared?: "complete" | "needs_review";
  summary?: string;
  reason?: string;
  line?: string;
  agent?: string;
  wave?: number;
  priority?: number;
  blockedBy?: string[];
  diff?: unknown[];
  notes?: { note: string; time: string }[];
  /** Bounded ring of the agent's tool calls (newest last) — shown in Inspect. */
  trail?: LoopTrailEntry[];
}

/** Start a Build-mode loop. Returns immediately; it streams via the `loop:*`
 *  events keyed by `loopId`. `targets` is the selected file set ([] = glob the
 *  pattern). No-op (resolves) outside Tauri. */
export const startLoop = (args: {
  loopId: string;
  repo: string;
  branch: string;
  base: string;
  pattern: string;
  title: string;
  template: string;
  targets: string[];
  concurrency: number;
  checks: { label: string; command: string }[];
  reviewOnDone: boolean;
  /** "auto" | "approve" — how loop_block_on_task proposals are handled. "" → approve. */
  blockPolicy: string;
  /** "loop" | "wave" review granularity. "" → keep the value persisted on the record. */
  reviewScope: string;
}): Promise<void> => (isTauri ? invoke<void>("start_loop", args) : Promise.resolve());

/** Start a Plan-mode (strategist) run: a scope pass writes the loop's plan, then a
 *  read-only spec agent fans out per item, enriching the manifest. Same args/stream
 *  as {@link startLoop}; the loop settles to `planning`, awaiting approve→build. */
export const startPlan = (args: {
  loopId: string;
  repo: string;
  branch: string;
  base: string;
  pattern: string;
  title: string;
  template: string;
  targets: string[];
  concurrency: number;
  checks: { label: string; command: string }[];
  reviewOnDone: boolean;
  /** "loop" | "wave" review granularity, persisted on the plan record so approve→build inherits it. */
  reviewScope: string;
}): Promise<void> => (isTauri ? invoke<void>("start_plan", args) : Promise.resolve());

/** Get-or-create the review for a finished loop's branch and return its id (the
 *  backend dedups + stamps the loop's `pull_id`). 0 / no-op outside Tauri. */
export const openLoopReview = (repo: string, loopId: string): Promise<number> =>
  isTauri ? invoke<number>("open_loop_review", { repo, loopId }) : Promise.resolve(0);

/** Read a loop's scope metadata (`{ summary, assumptions }`) for the Plan view's
 *  Scope tab. Null in mock mode / before the scope pass runs. */
export const readLoopPlanMeta = (repo: string, loopId: string): Promise<LoopPlanMeta | null> =>
  isTauri ? invoke<LoopPlanMeta | null>("read_loop_plan_meta", { repo, loopId }) : Promise.resolve(null);

/** Flip a loop's mode/state on disk (e.g. build → plan to re-review the strategist
 *  specs). No-op in mock mode. */
export const setLoopMode = (repo: string, loopId: string, mode: LoopMode, state: string): Promise<void> =>
  isTauri ? invoke<void>("set_loop_mode", { repo, loopId, mode, state }) : Promise.resolve();

export const pauseLoop = (loopId: string, paused: boolean): Promise<void> =>
  isTauri ? invoke<void>("pause_loop", { loopId, paused }) : Promise.resolve();

export const stopLoop = (loopId: string): Promise<void> =>
  isTauri ? invoke<void>("stop_loop", { loopId }) : Promise.resolve();

/** Cancel a single item by key/path — kills just that agent, the run continues.
 *  The item is dropped from the run (excluded). No-op in mock mode. */
export const stopLoopItem = (loopId: string, key: string): Promise<void> =>
  isTauri ? invoke<void>("stop_loop_item", { loopId, key }) : Promise.resolve();

/** Cancel a single item's agent and re-queue it (retry from scratch) — the reliable
 *  escape for a stalled item. No-op in mock mode. */
export const requeueLoopItem = (loopId: string, key: string): Promise<void> =>
  isTauri ? invoke<void>("requeue_loop_item", { loopId, key }) : Promise.resolve();

/** Queue a nudge (follow-up user turn) for an item's live agent. Best-effort — only
 *  lands while the agent is mid-turn. No-op in mock mode. */
export const nudgeLoopItem = (loopId: string, key: string, text: string): Promise<void> =>
  isTauri ? invoke<void>("nudge_loop_item", { loopId, key, text }) : Promise.resolve();

/** Approve or reject a gated block-on-task proposal. No-op in mock mode. */
export const resolveLoopBlock = (loopId: string, taskId: string, approve: boolean): Promise<void> =>
  isTauri ? invoke<void>("resolve_loop_block", { loopId, taskId, approve }) : Promise.resolve();

/** Pending block-on-task proposals (read on (re)load). */
export const readLoopBlocks = (repo: string, loopId: string): Promise<LoopBlockRequest[]> =>
  isTauri ? invoke<LoopBlockRequest[]>("read_loop_blocks", { repo, loopId }) : Promise.resolve([]);

/** Set a loop's block-on-task policy ("auto" | "approve"). No-op in mock mode. */
export const setLoopBlockPolicy = (repo: string, loopId: string, policy: string): Promise<void> =>
  isTauri ? invoke<void>("set_loop_block_policy", { repo, loopId, policy }) : Promise.resolve();

/** Resolve a review item: `"approve"` commits its diff onto the loop branch;
 *  anything else re-queues it with `feedback` folded in as a note. */
export const resolveLoopItem = (
  repo: string,
  loopId: string,
  file: string,
  decision: "approve" | "request",
  feedback: string,
): Promise<unknown> =>
  isTauri ? invoke("resolve_loop_item", { repo, loopId, file, decision, feedback }) : Promise.resolve(null);

/** Read the loop registry. Empty in mock mode. */
export const readLoops = (repo: string): Promise<Loop[]> =>
  isTauri ? invoke<Loop[]>("read_loops", { repo }) : Promise.resolve([]);

/** Read a loop's per-item records. Empty in mock mode. */
export const readLoopItems = (repo: string, loopId: string): Promise<LoopItemRecord[]> =>
  isTauri ? invoke<LoopItemRecord[]>("read_loop_items", { repo, loopId }) : Promise.resolve([]);

/** Resolve a target spec against the repo into manifest rows. Empty in mock mode. */
export const resolveTargets = (repo: string, resolver: ResolverSpec): Promise<ManifestEntry[]> =>
  isTauri ? invoke<ManifestEntry[]>("resolve_targets", { repo, resolver }) : Promise.resolve([]);

/** Read a loop's checked-in target+spec manifest. Empty in mock mode. */
export const readLoopManifest = (repo: string, loopId: string): Promise<ManifestEntry[]> =>
  isTauri ? invoke<ManifestEntry[]>("read_loop_manifest", { repo, loopId }) : Promise.resolve([]);

/** Persist a loop's manifest (the resolved + audited set). No-op in mock mode. */
export const writeLoopManifest = (repo: string, loopId: string, entries: ManifestEntry[]): Promise<void> =>
  isTauri ? invoke<void>("write_loop_manifest", { repo, loopId, entries }) : Promise.resolve();

/** Add a human-authored task node to the loop's work graph. No-op in mock mode. */
export const addLoopTask = (
  repo: string,
  loopId: string,
  task: { id: string; title: string; spec?: string; requires?: string[]; priority?: number },
): Promise<void> =>
  isTauri
    ? invoke<void>("add_loop_task", {
        repo,
        loopId,
        id: task.id,
        title: task.title,
        spec: task.spec ?? "",
        requires: task.requires ?? [],
        priority: task.priority ?? 0,
      })
    : Promise.resolve();

/** Remove a work-graph node (file or task) by id-or-path. No-op in mock mode. */
export const removeLoopNode = (repo: string, loopId: string, node: string): Promise<void> =>
  isTauri ? invoke<void>("remove_loop_node", { repo, loopId, node }) : Promise.resolve();

/** Answer a live plan-interview question. `key` is the raw item key (file path / task
 *  id) the question was about, or `__scope__` for a scope-level one. The blocked
 *  strategist picks the answer up and continues. No-op in mock mode. */
export const answerLoopQuestion = (repo: string, loopId: string, key: string, text: string): Promise<void> =>
  isTauri ? invoke<void>("answer_loop_question", { repo, loopId, key, text }) : Promise.resolve();

/** Read a loop's interview (transcript + pending questions). Empty in mock mode. */
export const readLoopInterview = (repo: string, loopId: string): Promise<LoopInterviewState> =>
  isTauri
    ? invoke<LoopInterviewState>("read_loop_interview", { repo, loopId })
    : Promise.resolve({ transcript: [], pending: {} });

/** Persist the creator's per-spec edits (approach / steps / a per-item instruction) into
 *  a manifest row; an instruction is also appended to the per-item spec md. No-op in mock. */
export const mergeLoopSpecEdit = (
  repo: string,
  loopId: string,
  file: string,
  edit: { approach?: string; steps?: string[]; instruction?: string },
): Promise<void> =>
  isTauri
    ? invoke<void>("merge_loop_spec_edit", {
        repo,
        loopId,
        file,
        approach: edit.approach ?? null,
        steps: edit.steps ?? null,
        instruction: edit.instruction ?? null,
      })
    : Promise.resolve();

/** Set a node's dependency edges / ordering (id-or-path). No-op in mock mode. */
export const setLoopDeps = (
  repo: string,
  loopId: string,
  node: string,
  requires: string[],
  priority?: number,
  wave?: number,
): Promise<void> =>
  isTauri
    ? invoke<void>("set_loop_deps", { repo, loopId, node, requires, priority: priority ?? null, wave: wave ?? null })
    : Promise.resolve();

/** Persist a loop record + its builder draft (autosave). No-op in mock mode. */
export const saveLoopDraft = (repo: string, loop: Loop, draft: LoopDraft): Promise<void> =>
  isTauri ? invoke<void>("save_loop_draft", { repo, record: loop, draft }) : Promise.resolve();

/** Read a saved builder draft (to resume a loop). Null in mock mode / if absent. */
export const readLoopDraft = (repo: string, loopId: string): Promise<LoopDraft | null> =>
  isTauri ? invoke<LoopDraft | null>("read_loop_draft", { repo, loopId }) : Promise.resolve(null);

/** Delete a loop (registry row + .locke tree; git is untouched). No-op in mock. */
export const deleteLoop = (repo: string, loopId: string): Promise<void> =>
  isTauri ? invoke<void>("delete_loop", { repo, loopId }) : Promise.resolve();

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
