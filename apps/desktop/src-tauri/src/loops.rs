// The loop runner: run one task across many files.
//
// A loop fans out a coding agent per matched file in its own isolated git
// worktree, runs the repo's checks, and — gated by an explicit completion
// contract (the agent declaring `loop_item_complete` via the locke MCP tools +
// checks passing) — commits passing items onto the loop's branch and routes the
// rest to human review. Progress streams to the UI (`loop:item`/`loop:progress`/
// `loop:event`/`loop:done`) and all state persists under `.locke/loops/<id>/`.
//
// Concurrency reuses the codebase's thread model (no tokio): a fixed pool of N
// worker threads drains a shared queue, with the seed branch advanced by a single
// serialized committer (cherry-pick) so concurrent items never race the ref.

use crate::actions::CheckSpec;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

type R<T> = Result<T, String>;

/// Which pass a runner is: Build edits files and commits; Plan (the strategist)
/// analyses each item read-only and writes a spec, committing nothing. The two
/// share the scheduler, worker pool and agent-streaming machinery and differ only
/// in the per-item prompt, the success contract, and whether they commit.
#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Build,
    Plan,
}

impl Phase {
    /// The status string emitted while an item is in flight.
    fn in_flight(self) -> &'static str {
        match self {
            Phase::Build => "running",
            Phase::Plan => "speccing",
        }
    }
    /// Status string + stream glyph for a successful terminal item.
    fn done_status(self) -> &'static str {
        match self {
            Phase::Build => "done",
            Phase::Plan => "specced",
        }
    }
}

// ---- event payloads (camelCase, keyed by loopId) ----

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemPayload {
    loop_id: String,
    item_id: String,
    path: String,
    /// queued | running | review | done | failed | blocked.
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pct: Option<u32>,
    agent: String,
    /// Topological tier (parallel within a wave, gated across).
    wave: u32,
    priority: i64,
    /// Ids of unmet (not-yet-done) dependencies — drives the "blocked by …" UI.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    blocked_by: Vec<String>,
    t: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    loop_id: String,
    total: u64,
    done: u64,
    running: u64,
    review: u64,
    failed: u64,
    queued: u64,
    blocked: u64,
    rate: String,
    elapsed: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StreamPayload {
    loop_id: String,
    /// item state for the glyph: done | review | running | failed.
    st: String,
    path: String,
    text: String,
    t: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    loop_id: String,
    state: String,
    /// The review opened for the loop's output on completion (0 = none).
    pull_id: u64,
}

/// A live plan-interview question the strategist raised via `loop_ask` (the agent is
/// now blocked in the MCP tool, waiting for the human's answer). Keyed by the raw
/// item key (file path or task id), or `__scope__` for a scope-level question, so the
/// Plan view routes it to the right spec / the Scope tab.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InterviewPayload {
    loop_id: String,
    key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<String>,
    question: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    choices: Vec<String>,
    t: String,
}

/// App-managed registry of in-flight loops, keyed by loopId.
#[derive(Default)]
pub struct LoopRegistry(pub Mutex<HashMap<String, LoopHandle>>);

pub struct LoopHandle {
    paused: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
    /// Item keys the user cancelled individually (kill just that agent, run continues).
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Default, Clone, Copy)]
struct Counts {
    done: u64,
    running: u64,
    review: u64,
    failed: u64,
    queued: u64,
    blocked: u64,
}

// ---- the work-graph scheduler ----

#[derive(Clone, Copy, PartialEq, Eq)]
enum St {
    Queued,
    Running,
    Done,
    Review,
    Failed,
    Blocked,
}

impl St {
    fn as_str(self) -> &'static str {
        match self {
            St::Queued => "queued",
            St::Running => "running",
            St::Done => "done",
            St::Review => "review",
            St::Failed => "failed",
            St::Blocked => "blocked",
        }
    }
}

/// One node of the loop's work graph.
struct Node {
    id: String,
    /// Item key used for the worktree / agent / item-record (path for files, id for tasks).
    key: String,
    /// What the prompt addresses: a repo-relative path (file) or a task title.
    target: String,
    is_task: bool,
    requires: Vec<String>,
    priority: i64,
    wave: u32,
    status: St,
}

/// A dependency-aware scheduler: hands out items whose `requires` are all `done`,
/// highest `priority` first; parks the rest. The build runs parallel within a
/// wave (the topological tier) and gated across waves — because a dependent only
/// becomes ready once its prerequisites have committed.
struct Scheduler {
    nodes: Vec<Node>,
    idx: HashMap<String, usize>,
}

/// What a worker needs to run an item, copied out so the scheduler lock is released
/// during the (long) agent run.
#[derive(Clone)]
struct Picked {
    i: usize,
    id: String,
    key: String,
    target: String,
    is_task: bool,
    wave: u32,
    priority: i64,
}

impl Scheduler {
    /// Build from the in-scope manifest entries, assigning waves topologically
    /// (pinned `wave > 0` is respected; otherwise derived from `requires`).
    fn new(entries: &[ManifestEntry]) -> Self {
        let waves = compute_waves(entries);
        let nodes: Vec<Node> = entries
            .iter()
            .map(|e| {
                let id = if e.id.is_empty() { e.path.clone() } else { e.id.clone() };
                let is_task = e.kind == "task";
                Node {
                    key: if is_task { id.clone() } else { e.path.clone() },
                    target: if is_task { e.title.clone().unwrap_or_else(|| id.clone()) } else { e.path.clone() },
                    is_task,
                    requires: e.requires.clone(),
                    priority: e.priority,
                    wave: if e.wave > 0 { e.wave } else { *waves.get(&id).unwrap_or(&0) },
                    status: St::Queued,
                    id,
                }
            })
            .collect();
        let idx = nodes.iter().enumerate().map(|(i, n)| (n.id.clone(), i)).collect();
        Scheduler { nodes, idx }
    }

    fn total(&self) -> u64 {
        self.nodes.len() as u64
    }

    /// A `requires` id is satisfied if it's unknown to this graph (excluded/typo —
    /// treated as already met so we never deadlock) or its node is `Done`.
    fn satisfied(&self, dep: &str) -> bool {
        match self.idx.get(dep) {
            Some(&i) => self.nodes[i].status == St::Done,
            None => true,
        }
    }

    /// Unmet (known, not-done) deps of a node — for the "blocked by" readout.
    fn unmet(&self, i: usize) -> Vec<String> {
        self.nodes[i].requires.iter().filter(|d| !self.satisfied(d)).cloned().collect()
    }

    /// Highest-priority queued item whose deps are all done; marks it Running.
    fn next_ready(&mut self) -> Option<Picked> {
        let pick = self
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.status == St::Queued && n.requires.iter().all(|d| self.satisfied(d)))
            .max_by_key(|(_, n)| (n.priority, -(n.wave as i64)))
            .map(|(i, _)| i)?;
        self.nodes[pick].status = St::Running;
        let n = &self.nodes[pick];
        Some(Picked {
            i: pick,
            id: n.id.clone(),
            key: n.key.clone(),
            target: n.target.clone(),
            is_task: n.is_task,
            wave: n.wave,
            priority: n.priority,
        })
    }

    fn mark(&mut self, i: usize, status: St) {
        self.nodes[i].status = status;
    }

    /// Nothing running and nothing currently runnable → the run can't advance.
    fn settled(&self) -> bool {
        let running = self.nodes.iter().any(|n| n.status == St::Running);
        let ready = self
            .nodes
            .iter()
            .any(|n| n.status == St::Queued && n.requires.iter().all(|d| self.satisfied(d)));
        !running && !ready
    }

    /// Mark every still-queued item Blocked (its deps can never complete now).
    fn finalize_blocked(&mut self) {
        for n in &mut self.nodes {
            if n.status == St::Queued {
                n.status = St::Blocked;
            }
        }
    }

    /// `(id, key, wave, priority, unmet-deps)` for each Blocked node — for emit.
    fn blocked_emissions(&self) -> Vec<(String, String, u32, i64, Vec<String>)> {
        let idxs: Vec<usize> =
            self.nodes.iter().enumerate().filter(|(_, n)| n.status == St::Blocked).map(|(i, _)| i).collect();
        idxs.into_iter()
            .map(|i| {
                let n = &self.nodes[i];
                (n.id.clone(), n.key.clone(), n.wave, n.priority, self.unmet(i))
            })
            .collect()
    }

    fn counts(&self) -> Counts {
        let mut c = Counts::default();
        for n in &self.nodes {
            match n.status {
                St::Queued => c.queued += 1,
                St::Running => c.running += 1,
                St::Done => c.done += 1,
                St::Review => c.review += 1,
                St::Failed => c.failed += 1,
                St::Blocked => c.blocked += 1,
            }
        }
        c
    }
}

/// Topological wave levels: 0 for items with no in-graph deps, else 1 + max(dep
/// waves). Cycles resolve to 0 (the scheduler still gates on `requires`, so a
/// cyclic edge just never becomes satisfiable → blocked).
fn compute_waves(entries: &[ManifestEntry]) -> HashMap<String, u32> {
    let id_of = |e: &ManifestEntry| if e.id.is_empty() { e.path.clone() } else { e.id.clone() };
    let known: HashMap<String, usize> = entries.iter().enumerate().map(|(i, e)| (id_of(e), i)).collect();
    let mut wave: HashMap<String, u32> = HashMap::new();
    // Iterative relaxation bounded by node count (handles any DAG; cycles stay 0).
    for _ in 0..entries.len() {
        let mut changed = false;
        for e in entries {
            let id = id_of(e);
            let w = e
                .requires
                .iter()
                .filter_map(|d| known.get(d).map(|_| wave.get(d).copied().unwrap_or(0) + 1))
                .max()
                .unwrap_or(0);
            if wave.get(&id).copied().unwrap_or(0) != w {
                wave.insert(id, w);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    for e in entries {
        wave.entry(id_of(e)).or_insert(0);
    }
    wave
}

/// Shared per-loop context handed to every worker thread.
struct Ctx {
    app: AppHandle,
    repo: String,
    loop_id: String,
    phase: Phase,
    base: String,
    seed: String,
    template: String,
    checks: Vec<CheckSpec>,
    total: u64,
    sched: Mutex<Scheduler>,
    cond: Condvar,
    commit_lock: Mutex<()>,
    paused: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
    /// Shared with this loop's `LoopHandle` — keys the user cancelled individually.
    cancelled: Arc<Mutex<HashSet<String>>>,
    start: Instant,
}

impl Ctx {
    /// Whether this item was individually cancelled by the user.
    fn is_cancelled(&self, key: &str) -> bool {
        self.cancelled.lock().unwrap().contains(key)
    }
}

// ---- git helpers (local, like run.rs/actions.rs each keep their own) ----

fn run_git(dir: &str, args: &[&str]) -> R<()> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().map_err(|e| format!("spawn git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn git_out(dir: &str, args: &[&str]) -> R<String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().map_err(|e| format!("spawn git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn branch_exists(repo: &str, branch: &str) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn now_clock() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let tod = secs % 86_400;
    format!("{:02}:{:02}:{:02}", tod / 3600, (tod % 3600) / 60, tod % 60)
}

// ---- glob matching (no deps) ----

/// Match a repo-relative path against a glob with `**` (any depth), `*` (within a
/// segment), and `{a,b}` brace alternation, e.g. `packages/**/*.{vue,ts}`.
pub fn glob_match(pat: &str, path: &str) -> bool {
    expand_braces(pat).iter().any(|p| glob_match_one(p, path))
}

fn glob_match_one(pat: &str, path: &str) -> bool {
    let p: Vec<&str> = pat.split('/').filter(|s| !s.is_empty()).collect();
    let s: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    seg_match(&p, &s)
}

/// Expand `{a,b,c}` alternations into concrete patterns (recursing for nesting and
/// multiple groups). An unbalanced `{` is left literal.
fn expand_braces(pat: &str) -> Vec<String> {
    let Some(open) = pat.find('{') else { return vec![pat.to_string()] };
    let mut depth = 0;
    let mut close = None;
    for (i, c) in pat.char_indices().skip_while(|(i, _)| *i < open) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    close = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let Some(close) = close else { return vec![pat.to_string()] };
    let (pre, post) = (&pat[..open], &pat[close + 1..]);
    let inner = &pat[open + 1..close];
    // Split the group on top-level commas only.
    let mut parts = Vec::new();
    let (mut d, mut start) = (0, 0);
    for (i, c) in inner.char_indices() {
        match c {
            '{' => d += 1,
            '}' => d -= 1,
            ',' if d == 0 => {
                parts.push(&inner[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&inner[start..]);
    parts.into_iter().flat_map(|part| expand_braces(&format!("{pre}{part}{post}"))).collect()
}

fn seg_match(p: &[&str], s: &[&str]) -> bool {
    if p.is_empty() {
        return s.is_empty();
    }
    if p[0] == "**" {
        (0..=s.len()).any(|i| seg_match(&p[1..], &s[i..]))
    } else if s.is_empty() {
        false
    } else if wild(&p[0].chars().collect::<Vec<_>>(), &s[0].chars().collect::<Vec<_>>()) {
        seg_match(&p[1..], &s[1..])
    } else {
        false
    }
}

fn wild(p: &[char], t: &[char]) -> bool {
    if p.is_empty() {
        return t.is_empty();
    }
    if p[0] == '*' {
        (0..=t.len()).any(|i| wild(&p[1..], &t[i..]))
    } else {
        !t.is_empty() && p[0] == t[0] && wild(&p[1..], &t[1..])
    }
}

/// Walk the repo working tree, returning all repo-relative file paths (sorted).
/// Skips dotfiles/dirs (incl. `.git`/`.locke`), `node_modules`, and `target`.
pub fn walk_files(repo: &str) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(repo), repo, &mut out);
    out.sort();
    out
}

/// Repo-relative paths matching a single `pattern` glob.
fn collect_targets(repo: &str, pattern: &str) -> Vec<String> {
    walk_files(repo).into_iter().filter(|rel| glob_match(pattern, rel)).collect()
}

fn walk(dir: &Path, repo: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        if path.is_dir() {
            walk(&path, repo, out);
        } else if let Ok(rel) = path.strip_prefix(repo) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

// ---- target resolvers (the builder's "audit & select" rows) ----

use locke_store::ManifestEntry;

/// How a loop's target set is produced. `List` is the universal sink: any custom
/// resolver (a Rust fn behind `Custom`, or a TS function in the app) ultimately
/// produces paths fed in as `List`. Serialized tagged by `kind`.
#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolverSpec {
    /// A single `**`/`*` glob, e.g. `src/**/*.vue`.
    Glob { pattern: String },
    /// Include globs minus exclude globs.
    Globs {
        #[serde(default)]
        include: Vec<String>,
        #[serde(default)]
        exclude: Vec<String>,
    },
    /// An explicit list of repo-relative paths (paste / CSV / a custom resolver).
    List {
        #[serde(default)]
        paths: Vec<String>,
    },
    /// A shell command whose stdout lines are repo-relative paths.
    Command { command: String },
    /// A named built-in resolver (the extension point), e.g. `changed-vs-base`.
    Custom {
        id: String,
        #[serde(default)]
        args: Vec<String>,
    },
}

/// Resolve a `ResolverSpec` against the repo into manifest rows (loc + coarse risk
/// per file, all included by default). Only existing repo files survive — `List`
/// and `Command` outputs are validated against the working tree.
pub fn resolve_targets(repo: &str, spec: &ResolverSpec) -> Vec<ManifestEntry> {
    let paths: Vec<String> = match spec {
        ResolverSpec::Glob { pattern } => collect_targets(repo, pattern),
        ResolverSpec::Globs { include, exclude } => walk_files(repo)
            .into_iter()
            .filter(|p| include.iter().any(|g| glob_match(g, p)) && !exclude.iter().any(|g| glob_match(g, p)))
            .collect(),
        ResolverSpec::List { paths } => keep_existing(repo, paths),
        ResolverSpec::Command { command } => keep_existing(repo, &run_resolver_command(repo, command)),
        ResolverSpec::Custom { id, args } => keep_existing(repo, &run_custom_resolver(repo, id, args)),
    };
    paths.into_iter().map(|rel| entry_for(repo, rel)).collect()
}

/// Build a default (unspecced, included) manifest row for a path.
fn entry_for(repo: &str, rel: String) -> ManifestEntry {
    let loc = count_loc(repo, &rel);
    ManifestEntry {
        path: rel,
        loc,
        risk: risk_band(loc).to_string(),
        inc: true,
        origin: "resolver".into(),
        ..Default::default()
    }
}

/// Keep only inputs that are real, in-repo files — normalized, de-duped, sorted.
/// Rejects absolute paths and `..` escapes (confinement, cf. `git.rs::read_repo_file`).
fn keep_existing(repo: &str, paths: &[String]) -> Vec<String> {
    let mut out: Vec<String> = paths
        .iter()
        .map(|p| p.trim().replace('\\', "/"))
        .filter(|p| !p.is_empty() && !p.starts_with('/') && !p.split('/').any(|c| c == ".."))
        .filter(|p| Path::new(repo).join(p).is_file())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Run a user-supplied shell command in the repo; its stdout lines are paths.
fn run_resolver_command(repo: &str, command: &str) -> Vec<String> {
    let out = Command::new("sh").arg("-c").arg(command).current_dir(repo).output();
    match out {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout).lines().map(|l| l.to_string()).collect()
        }
        _ => Vec::new(),
    }
}

/// The `Custom` resolver registry — the extension point. Add named resolvers here.
fn run_custom_resolver(repo: &str, id: &str, args: &[String]) -> Vec<String> {
    match id {
        // Files changed on the current branch vs a base (default `main`).
        "changed-vs-base" => {
            let base = args.first().map(String::as_str).unwrap_or("main");
            run_resolver_command(repo, &format!("git diff --name-only {base}...HEAD"))
        }
        _ => Vec::new(),
    }
}

/// Count lines in a matched file, capped so a huge/binary blob can't stall the
/// audit (mirrors `read_repo_file`'s 2 MiB ceiling). Unreadable → 0.
fn count_loc(repo: &str, rel: &str) -> u64 {
    const MAX_BYTES: u64 = 2 * 1024 * 1024;
    let full = Path::new(repo).join(rel);
    match std::fs::metadata(&full) {
        Ok(m) if m.len() > MAX_BYTES => return 0,
        Ok(_) => {}
        Err(_) => return 0,
    }
    std::fs::read_to_string(&full).map(|s| s.lines().count() as u64).unwrap_or(0)
}

/// Coarse size-driven risk band for the audit pill.
fn risk_band(loc: u64) -> &'static str {
    if loc >= 300 {
        "high"
    } else if loc >= 120 {
        "med"
    } else {
        "low"
    }
}

// ---- prompt rendering ----

/// Always-appended completion protocol so even a custom template carries the
/// exact tool-call parameters. This is the worker's objective/boundaries/output
/// contract (per Anthropic's subagent-spec guidance). Build mode asks for the edit
/// then `loop_item_complete`; Plan mode (strategist) asks for a read-only analysis
/// then `loop_write_spec`.
fn protocol_footer(phase: Phase, loop_id: &str, key: &str, target: &str, is_task: bool, tests: &str) -> String {
    if phase == Phase::Plan {
        let scope = if is_task {
            format!("- Plan this task: {target}. Analyse what it would require; do NOT make the change.")
        } else {
            format!("- Analyse ONLY this file: `{target}`, read-only. Do NOT edit any file — this is a planning pass.")
        };
        return format!(
            "\n\n---\nYou are the STRATEGIST for one item of a Locke loop, running UNATTENDED.\n\
             {scope}\n\
             - Read the file and decide exactly how the later build worker should change it to satisfy the task.\n\
             - The build worker must make these checks pass: {tests}.\n\
             - Write your plan by calling `loop_write_spec` with loop_id=\"{loop_id}\", file=\"{key}\", a markdown \
             `spec` (objective + concrete edits + how to verify), and optional `approach`/`detected`/`steps`/`tests`/`note`.\n\
             - If a human decision is needed before you can finish this spec, ASK: call `loop_ask` with loop_id=\"{loop_id}\", \
             file=\"{key}\", a single focused `question` (optional `choices`), and wait for the answer — then ask the next \
             question if needed and continue. Prefer asking over guessing. You may also call `loop_add_task` mid-conversation \
             to spin off a prerequisite the human confirms.\n\
             - Only if the human doesn't answer (you'll get a note saying so) should you fall back to \
             `loop_write_spec` with needs_review=true and a `note` explaining the open decision.\n\
             - Call `loop_write_spec` exactly once when the spec is complete; do not edit or commit anything."
        );
    }
    let scope = if is_task {
        format!("- Complete this task: {target}. Touch whatever files it strictly requires; leave everything else unchanged.")
    } else {
        format!("- Work ONLY on this file: `{target}`. Do not modify unrelated files.")
    };
    format!(
        "\n\n---\nYou are running UNATTENDED as one item of a Locke loop.\n\
         {scope}\n\
         - Success criteria: the change is complete AND these checks pass: {tests}.\n\
         - When done and checks pass, call the `loop_item_complete` tool with \
         loop_id=\"{loop_id}\" and file=\"{key}\".\n\
         - If you are uncertain, or a human decision is needed, call \
         `loop_item_needs_review` with loop_id=\"{loop_id}\", file=\"{key}\" and a \
         reason instead — do not guess.\n\
         - You can fetch any pre-written spec with `loop_read_spec`."
    )
}

fn render_prompt(ctx: &Ctx, key: &str, target: &str, is_task: bool) -> String {
    let tests = if ctx.checks.is_empty() {
        "(no checks configured)".to_string()
    } else {
        ctx.checks.iter().map(|c| c.label.clone()).collect::<Vec<_>>().join(", ")
    };
    let spec = locke_store::read_loop_spec(&ctx.repo, &ctx.loop_id, key).ok().flatten().unwrap_or_default();
    let conventions = locke_store::read_loop_plan(&ctx.repo, &ctx.loop_id).ok().flatten().unwrap_or_default();
    let body = ctx
        .template
        .replace("{{file}}", target)
        .replace("{{loop_id}}", &ctx.loop_id)
        .replace("{{tests}}", &tests)
        .replace("{{base}}", &ctx.base)
        .replace("{{spec}}", &spec)
        .replace("{{conventions}}", &conventions);
    format!("{body}{}", protocol_footer(ctx.phase, &ctx.loop_id, key, target, is_task, &tests))
}

// ---- checks (run in the item worktree, not a fresh one) ----

fn run_checks_in(dir: &str, checks: &[CheckSpec]) -> (bool, String) {
    for c in checks {
        let out = Command::new("sh").arg("-c").arg(&c.command).current_dir(dir).output();
        match out {
            Ok(o) if o.status.success() => {}
            Ok(o) => {
                let detail = String::from_utf8_lossy(&o.stderr);
                let last = detail.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
                return (false, format!("{} failed: {}", c.label, last.chars().take(80).collect::<String>()));
            }
            Err(e) => return (false, format!("{} could not run: {e}", c.label)),
        }
    }
    (true, String::new())
}

// ---- unified-diff → LoopDiffLine[] (for the review pane) ----

fn parse_patch(patch: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let (mut oldn, mut newn) = (0i64, 0i64);
    for line in patch.lines() {
        if line.starts_with("@@") {
            // @@ -a,b +c,d @@
            if let Some(plus) = line.split('+').nth(1) {
                newn = plus.split([',', ' ']).next().and_then(|s| s.parse().ok()).unwrap_or(0);
            }
            if let Some(minus) = line.split('-').nth(1) {
                oldn = minus.split([',', ' ']).next().and_then(|s| s.parse().ok()).unwrap_or(0);
            }
            out.push(json!({ "h": line }));
        } else if line.starts_with("+++") || line.starts_with("---") || line.starts_with("diff ") || line.starts_with("index ") {
            continue;
        } else if let Some(code) = line.strip_prefix('+') {
            out.push(json!({ "t": "add", "no": newn, "c": code }));
            newn += 1;
        } else if let Some(code) = line.strip_prefix('-') {
            out.push(json!({ "t": "del", "no": oldn, "c": code }));
            oldn += 1;
        } else if let Some(code) = line.strip_prefix(' ') {
            out.push(json!({ "no": newn, "c": code }));
            oldn += 1;
            newn += 1;
        }
    }
    out
}

// ---- progress emission ----

fn emit_progress(ctx: &Ctx) {
    let c = ctx.sched.lock().unwrap().counts();
    let mins = ctx.start.elapsed().as_secs_f64() / 60.0;
    let rate = if mins > 0.05 { format!("{:.1} / min", c.done as f64 / mins) } else { "—".into() };
    let elapsed = {
        let s = ctx.start.elapsed().as_secs();
        if s >= 3600 { format!("{}h {}m", s / 3600, (s % 3600) / 60) } else { format!("{}m {}s", s / 60, s % 60) }
    };
    let _ = locke_store::update_loop(&ctx.repo, &ctx.loop_id, |l| {
        l.done = c.done;
        l.running = c.running;
        l.review = c.review;
        l.failed = c.failed;
        l.queued = c.queued;
        l.blocked = c.blocked;
        l.rate = rate.clone();
        l.elapsed = elapsed.clone();
    });
    let _ = ctx.app.emit(
        "loop:progress",
        ProgressPayload {
            loop_id: ctx.loop_id.clone(),
            total: ctx.total,
            done: c.done,
            running: c.running,
            review: c.review,
            failed: c.failed,
            queued: c.queued,
            blocked: c.blocked,
            rate,
            elapsed,
        },
    );
}

#[allow(clippy::too_many_arguments)]
fn emit_item(
    ctx: &Ctx,
    item_id: &str,
    path: &str,
    status: &str,
    line: Option<String>,
    pct: Option<u32>,
    wave: u32,
    priority: i64,
    blocked_by: Vec<String>,
) {
    let _ = ctx.app.emit(
        "loop:item",
        ItemPayload {
            loop_id: ctx.loop_id.clone(),
            item_id: item_id.to_string(),
            path: path.to_string(),
            status: status.to_string(),
            line,
            pct,
            agent: "CL".into(),
            wave,
            priority,
            blocked_by,
            t: now_clock(),
        },
    );
}

fn emit_stream(ctx: &Ctx, st: &str, path: &str, text: &str) {
    let ev = json!({ "st": st, "path": path, "text": text, "t": now_clock() });
    let _ = locke_store::append_loop_event(&ctx.repo, &ctx.loop_id, &ev);
    let _ = ctx.app.emit(
        "loop:event",
        StreamPayload { loop_id: ctx.loop_id.clone(), st: st.into(), path: path.into(), text: text.into(), t: now_clock() },
    );
}

/// Per-item handshake between an agent thread and its pool worker: set true when the
/// agent enters a human interview, so the worker releases its slot (the agent then
/// finishes off-pool). The MCP `loop_ask` writes the durable `interview/` record; this
/// only drives the desktop's live event + slot release.
type InterviewSignal = Arc<(Mutex<bool>, Condvar)>;

/// Surface a `loop_ask` tool call as a live `loop:interview` event (the durable
/// question file is written by the MCP server). `default_key` is the item key for a
/// per-item agent (the question is about that item unless the agent overrode `file`).
fn surface_interview(ctx: &Ctx, default_key: Option<&str>, input: &Value) {
    let question = input.get("question").and_then(|v| v.as_str()).unwrap_or("");
    if question.is_empty() {
        return;
    }
    let choices: Vec<String> = input
        .get("choices")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let file = input
        .get("file")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| default_key.map(String::from));
    let key = file.clone().unwrap_or_else(|| "__scope__".to_string());
    let _ = ctx.app.emit(
        "loop:interview",
        InterviewPayload {
            loop_id: ctx.loop_id.clone(),
            key,
            file,
            question: question.to_string(),
            choices,
            t: now_clock(),
        },
    );
}

/// Flag the item as interviewing and wake its pool worker so it releases the slot.
fn signal_interviewing(sig: &InterviewSignal) {
    let (lock, cvar) = &**sig;
    *lock.lock().unwrap() = true;
    cvar.notify_all();
}

// ---- the per-item worker ----

enum Outcome {
    Done,
    Review(String),
    Failed(String),
    /// The user stopped speccing just this item (the rest of the run continues; the
    /// item stays in scope, left unspecced).
    Cancelled,
}

fn process_item(ctx: &Arc<Ctx>, p: &Picked) {
    // `next_ready` already marked the node Running; emit it. Plan mode shows this as
    // "speccing" rather than "running".
    let start_line = if ctx.phase == Phase::Plan { "analysing…" } else { "starting…" };
    emit_item(ctx, &p.id, &p.key, ctx.phase.in_flight(), Some(start_line.into()), Some(2), p.wave, p.priority, vec![]);
    emit_progress(ctx);

    // Run the item on its own thread. If its agent enters a human interview (blocks on
    // `loop_ask`), it sets `interviewing` and we release this pool worker so other
    // items keep speccing — the agent then runs to completion off-pool on this thread,
    // doing its own `finish_item`. Without an interview the worker just joins, so
    // throughput (and ordering) is unchanged from the no-question path.
    let interviewing: InterviewSignal = Arc::new((Mutex::new(false), Condvar::new()));
    let handle = {
        let ctx = ctx.clone();
        let p = p.clone();
        let sig = interviewing.clone();
        std::thread::spawn(move || {
            let outcome = run_one(&ctx, &p, &sig).unwrap_or_else(Outcome::Failed);
            finish_item(&ctx, &p, outcome);
            // Wake the worker if it's still waiting (item finished without interviewing).
            let (lock, cvar) = &*sig;
            let _g = lock.lock().unwrap();
            cvar.notify_all();
        })
    };

    // Hold the pool slot until the item finishes OR begins an interview.
    let (lock, cvar) = &*interviewing;
    let mut guard = lock.lock().unwrap();
    while !*guard && !handle.is_finished() {
        let (g, _) = cvar.wait_timeout(guard, Duration::from_millis(200)).unwrap();
        guard = g;
    }
    let detached = *guard;
    drop(guard);
    if !detached {
        let _ = handle.join();
    }
    // If detached, the spawned thread owns the rest of the item (and its finish_item).
}

/// Settle one item's terminal status: record it, mark the work-graph node, wake parked
/// workers (a `Done` may have unblocked dependents), and emit. Runs on the pool worker
/// for a normal item, or on the detached agent thread for one that interviewed.
fn finish_item(ctx: &Arc<Ctx>, p: &Picked, outcome: Outcome) {
    // The scheduler marks Done/Review/Failed identically in both phases (a specced
    // item satisfies a dependent just as a built one does); only the *emitted*
    // status string differs so the Plan view reads it as a SpecStatus.
    let done_line = if ctx.phase == Phase::Plan { "specced".to_string() } else { "migrated · checks pass".to_string() };
    // `st` is the work-graph status (Cancelled is terminal like Review so it doesn't
    // re-run this session); `st_glyph` is the stream-feed glyph.
    let (st, line, st_glyph) = match &outcome {
        Outcome::Done => (St::Done, done_line, ctx.phase.done_status()),
        Outcome::Review(r) => (St::Review, r.clone(), "review"),
        Outcome::Failed(e) => (St::Failed, e.clone(), "failed"),
        // Individually cancelled → just stop speccing it; it stays in scope, queued
        // (unspecced), so it can be re-planned later or built without a spec.
        Outcome::Cancelled => (St::Review, "speccing stopped".to_string(), "queued"),
    };
    // Status string emitted to the UI (a SpecStatus in Plan mode): Done → specced/
    // done, a cancel → back to queued (unspecced), otherwise the graph status.
    let emit_status = match &outcome {
        Outcome::Cancelled => "queued",
        _ if st == St::Done => ctx.phase.done_status(),
        _ => st.as_str(),
    };
    // Persist the final item record (merging any agent declaration already there).
    let _ = locke_store::merge_loop_item(
        &ctx.repo,
        &ctx.loop_id,
        &p.key,
        json!({ "id": p.id, "status": emit_status, "line": line, "agent": "CL", "wave": p.wave, "priority": p.priority }),
    );
    // Record the terminal status in the graph and wake any parked workers — a
    // `Done` may have unblocked dependents.
    {
        let mut g = ctx.sched.lock().unwrap();
        g.mark(p.i, st);
    }
    ctx.cond.notify_all();
    emit_item(ctx, &p.id, &p.key, emit_status, Some(line.clone()), Some(100), p.wave, p.priority, vec![]);
    emit_stream(ctx, st_glyph, &p.key, &line);
    emit_progress(ctx);
}

/// The heavy lifting for one item: worktree → agent → checks → commit/route.
fn run_one(ctx: &Arc<Ctx>, p: &Picked, interviewing: &InterviewSignal) -> R<Outcome> {
    let file = &p.key;
    let seed_tip = git_out(&ctx.seed, &["rev-parse", "HEAD"])?;
    let wt = std::env::temp_dir()
        .join(format!("locke-loop-{}", locke_store::sanitize_path(&ctx.loop_id)))
        .join(format!("item-{}", locke_store::sanitize_path(&p.id)))
        .to_string_lossy()
        .to_string();
    let _ = run_git(&ctx.repo, &["worktree", "remove", "--force", &wt]);
    let _ = std::fs::remove_dir_all(&wt);
    run_git(&ctx.repo, &["worktree", "add", "--detach", &wt, &seed_tip]).map_err(|e| format!("worktree: {e}"))?;
    #[cfg(unix)]
    {
        let nm = Path::new(&ctx.repo).join("node_modules");
        if nm.exists() {
            let _ = std::os::unix::fs::symlink(&nm, Path::new(&wt).join("node_modules"));
        }
    }

    let result = (|| -> R<Outcome> {
        // Run the agent (auto mode, unattended) in the item worktree.
        run_agent_stream(ctx, &p.id, p, &wt, interviewing)?;
        // An individual cancel takes precedence over a whole-loop stop in the message.
        if ctx.is_cancelled(file) {
            return Ok(Outcome::Cancelled);
        }
        if ctx.stopped.load(Ordering::Relaxed) {
            return Ok(Outcome::Failed("loop stopped".into()));
        }

        // Plan mode: the agent analyses read-only and writes its spec via
        // `loop_write_spec` (which sets `declared` to specced|review). Nothing is
        // checked or committed — the worktree is just a sandbox so a stray edit
        // can't touch the user's tree, and is discarded on teardown.
        if ctx.phase == Phase::Plan {
            let rec = locke_store::read_loop_item(&ctx.repo, &ctx.loop_id, file).ok().flatten();
            let declared = rec.as_ref().and_then(|v| v.get("declared").and_then(|d| d.as_str()));
            return Ok(match declared {
                Some("specced") => Outcome::Done,
                Some("review") => {
                    let reason = rec
                        .as_ref()
                        .and_then(|v| v.get("reason").and_then(|r| r.as_str()).map(String::from))
                        .unwrap_or_else(|| "strategist flagged for your call".into());
                    Outcome::Review(reason)
                }
                _ => Outcome::Review("strategist ended without writing a spec".into()),
            });
        }

        // Did the agent declare an outcome via the MCP tools?
        let declared = locke_store::read_loop_item(&ctx.repo, &ctx.loop_id, file)
            .ok()
            .flatten()
            .and_then(|v| v.get("declared").and_then(|d| d.as_str()).map(String::from));
        if declared.as_deref() == Some("needs_review") {
            let reason = locke_store::read_loop_item(&ctx.repo, &ctx.loop_id, file)
                .ok()
                .flatten()
                .and_then(|v| v.get("reason").and_then(|r| r.as_str()).map(String::from))
                .unwrap_or_else(|| "agent flagged for review".into());
            capture_patch(ctx, file, &wt);
            return Ok(Outcome::Review(reason));
        }
        if declared.as_deref() != Some("complete") {
            capture_patch(ctx, file, &wt);
            return Ok(Outcome::Review("agent ended without declaring completion".into()));
        }

        // Checks gate: run them in the item worktree (where the edit is).
        let (ok, detail) = run_checks_in(&wt, &ctx.checks);
        if !ok {
            capture_patch(ctx, file, &wt);
            return Ok(Outcome::Review(detail));
        }

        // Anything to commit?
        run_git(&wt, &["add", "-A"]).ok();
        let staged = git_out(&wt, &["diff", "--cached", "--name-only"]).unwrap_or_default();
        if staged.trim().is_empty() {
            return Ok(Outcome::Review("declared complete but produced no changes".into()));
        }

        // Commit in the (detached) item worktree, then serialize the cherry-pick
        // onto the seed branch so concurrent items never race the ref.
        run_git(&wt, &["commit", "-m", &format!("loop: {file}")]).map_err(|e| format!("commit: {e}"))?;
        let sha = git_out(&wt, &["rev-parse", "HEAD"])?;
        {
            let _g = ctx.commit_lock.lock().unwrap();
            if let Err(e) = run_git(&ctx.seed, &["cherry-pick", "--allow-empty", &sha]) {
                let _ = run_git(&ctx.seed, &["cherry-pick", "--abort"]);
                capture_patch(ctx, file, &wt);
                return Ok(Outcome::Review(format!("commit conflict: {e}")));
            }
        }
        Ok(Outcome::Done)
    })();

    // Teardown the item worktree regardless of outcome.
    let _ = run_git(&ctx.repo, &["worktree", "remove", "--force", &wt]);
    let _ = std::fs::remove_dir_all(&wt);
    let _ = run_git(&ctx.repo, &["worktree", "prune"]);
    result
}

/// Persist the item's uncommitted diff so the review pane can show it without
/// keeping the worktree alive.
fn capture_patch(ctx: &Ctx, file: &str, wt: &str) {
    run_git(wt, &["add", "-A"]).ok();
    let patch = git_out(wt, &["diff", "--cached"]).unwrap_or_default();
    let _ = locke_store::merge_loop_item(&ctx.repo, &ctx.loop_id, file, json!({ "diff": parse_patch(&patch) }));
}

/// Spawn the agent in `--permission-mode auto` and stream its events, invoking
/// `on_block(kind, payload)` for each assistant block — `kind` is "text" (payload =
/// the text) or "tool" (payload = the tool name). Auto mode's classifier handles
/// routine approvals; any escalation that still reaches us is allowed (the worktree
/// is isolated and the run is explicitly unattended — the checks/review/spec gates
/// are the safety net). Returns when the process exits.
fn stream_claude<F: FnMut(&str, &str, &Value)>(ctx: &Arc<Ctx>, wt: &str, prompt: &str, cancel_key: &str, mut on_block: F) -> R<()> {
    let exe = crate::actions::resolve_agent_path("claude");
    let mut child = Command::new(&exe)
        .args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-prompt-tool",
            "stdio",
            "--permission-mode",
            "auto",
        ])
        .current_dir(wt)
        // The locke MCP server resolves the repo from $LOCKE_REPO; point it at the
        // main repo so the loop_* tools write to its `.locke/`, not the worktree.
        .env("LOCKE_REPO", &ctx.repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start claude: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    // Drain stderr in a background thread. `claude --verbose` writes copiously to
    // stderr; with the pipe never read, its OS buffer (~64KB) fills and the agent
    // BLOCKS on the next stderr write — hanging mid-run, alive but idle. A broadly-
    // exploring agent (e.g. the decomposition scope pass) hits this fast.
    let stderr_handle = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut err, &mut std::io::sink());
        })
    });
    let user_msg = json!({ "type": "user", "message": { "role": "user", "content": prompt } });
    writeln!(stdin, "{user_msg}").map_err(|e| format!("write prompt: {e}"))?;
    stdin.flush().ok();
    let stdin = Arc::new(Mutex::new(Some(stdin)));

    // Stop watchdog: the stdout read loop only notices a stop when the agent next
    // emits a line, so a stop mid-think could lag. Poll the loop-level `stopped` flag
    // AND this item's individual-cancel flag, and SIGKILL the process the moment
    // either flips — so a halted/cancelled agent stops burning tokens at once.
    let pid = child.id();
    let stopped = ctx.stopped.clone();
    let cancelled = ctx.cancelled.clone();
    let key = cancel_key.to_string();
    let watch_done = Arc::new(AtomicBool::new(false));
    let wd = watch_done.clone();
    let watcher = std::thread::spawn(move || loop {
        if wd.load(Ordering::Relaxed) {
            break;
        }
        let item_cancelled = !key.is_empty() && cancelled.lock().unwrap().contains(&key);
        if stopped.load(Ordering::Relaxed) || item_cancelled {
            let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
            break;
        }
        std::thread::sleep(Duration::from_millis(150));
    });

    for line in BufReader::new(stdout).lines() {
        if ctx.stopped.load(Ordering::Relaxed) || (!cancel_key.is_empty() && ctx.is_cancelled(cancel_key)) {
            let _ = child.kill();
            break;
        }
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(d) = serde_json::from_str::<Value>(line) else { continue };
        match d.get("type").and_then(|v| v.as_str()) {
            Some("assistant") => {
                if let Some(blocks) = d.pointer("/message/content").and_then(|v| v.as_array()) {
                    for b in blocks {
                        match b.get("type").and_then(|v| v.as_str()) {
                            Some("text") => {
                                let t = b.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
                                if !t.is_empty() {
                                    on_block("text", t, &Value::Null);
                                }
                            }
                            Some("tool_use") => {
                                let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                on_block("tool", name, b.get("input").unwrap_or(&Value::Null));
                            }
                            _ => {}
                        }
                    }
                }
            }
            Some("control_request") => {
                if d.pointer("/request/subtype").and_then(|v| v.as_str()) == Some("can_use_tool") {
                    let req_id = d.get("request_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let empty = json!({});
                    let input = d.pointer("/request/input").cloned().unwrap_or(empty);
                    allow(&stdin, &req_id, input);
                }
            }
            Some("result") => {
                // Single turn done — close stdin so the CLI exits.
                *stdin.lock().unwrap() = None;
            }
            _ => {}
        }
    }
    let _ = child.wait();
    watch_done.store(true, Ordering::Relaxed);
    let _ = watcher.join();
    if let Some(h) = stderr_handle {
        let _ = h.join();
    }
    Ok(())
}

/// Run one item's agent (build edit or plan spec), streaming progress to the UI.
fn run_agent_stream(ctx: &Arc<Ctx>, item_id: &str, p: &Picked, wt: &str, interviewing: &InterviewSignal) -> R<()> {
    let prompt = render_prompt(ctx, &p.key, &p.target, p.is_task);
    let mut steps = 0u32;
    stream_claude(ctx, wt, &prompt, &p.key, |kind, payload, input| match kind {
        "text" => emit_item(ctx, item_id, &p.key, ctx.phase.in_flight(), Some(payload.chars().take(80).collect()), None, p.wave, p.priority, vec![]),
        "tool" => {
            // A live interview: surface the question and release this pool slot so
            // other items keep speccing while the human answers (the agent blocks in
            // the MCP `loop_ask` tool meanwhile, then continues here off-pool).
            if payload == "loop_ask" {
                surface_interview(ctx, Some(&p.key), input);
                signal_interviewing(interviewing);
                emit_item(ctx, item_id, &p.key, ctx.phase.in_flight(), Some("waiting on your answer…".into()), None, p.wave, p.priority, vec![]);
                return;
            }
            // Build progress tracks edits; plan progress tracks reads/analysis.
            let verb = match (ctx.phase, payload) {
                (Phase::Build, "Edit" | "Write" | "MultiEdit") => Some("editing"),
                (Phase::Plan, "Read" | "Grep" | "Glob") => Some("analysing"),
                _ => None,
            };
            if let Some(verb) = verb {
                steps += 1;
                let pct = (10 + steps * 18).min(92);
                emit_item(ctx, item_id, &p.key, ctx.phase.in_flight(), Some(format!("{verb} {}", p.target)), Some(pct), p.wave, p.priority, vec![]);
            }
        }
        _ => {}
    })
}

/// Plan mode's global scope pass: one strategist agent reads the set read-only and
/// writes the loop's plan.md + scope metadata via `loop_write_plan`. Runs in the
/// seed worktree before the per-item fan-out. Best-effort — a failed scope pass
/// still lets per-item speccing proceed (items just lack shared conventions).
fn run_scope_agent(ctx: &Arc<Ctx>) {
    let tests = if ctx.checks.is_empty() {
        "(no checks configured)".to_string()
    } else {
        ctx.checks.iter().map(|c| c.label.clone()).collect::<Vec<_>>().join(", ")
    };
    // The scope hint seeds a CANDIDATE POOL, not the work set. Tell the agent how
    // many candidates it has so it knows whether to curate a pool or discover from
    // scratch — but in both cases IT decides the files.
    let pool = locke_store::read_loop_manifest(&ctx.repo, &ctx.loop_id)
        .unwrap_or_default()
        .iter()
        .filter(|e| e.kind != "task" && e.status == "candidate")
        .count();
    let seed_line = if pool == 0 {
        "No scope hint was given: there is NO candidate pool. EXPLORE the repository yourself to \
         find every file this task applies to, and include each one with `loop_add_item`."
            .to_string()
    } else {
        format!(
            "A scope hint surfaced {pool} CANDIDATE file(s) — call `loop_list_candidates` to see them. \
             Treat them as a starting hint, NOT the answer: the glob may include files that don't belong \
             and miss files that do. Decide the real set yourself."
        )
    };
    let prompt = format!(
        "You are the STRATEGIST opening a Locke loop (loop_id=\"{id}\"). Your job is to turn this task into a \
         concrete, reviewable WORK SET — you DECIDE which files and tasks the loop will do. The PROMPT below is the \
         source of truth for the work; the resolver's candidate pool is only a hint.\n\n\
         TASK:\n{task}\n\n\
         {seed_line}\n\n\
         Work in this order:\n\
         1. REQUIREMENTS FIRST. Before fixing the set, if anything about the objective, boundaries, or acceptance \
         criteria is ambiguous, ASK the human — call `loop_ask` (loop_id=\"{id}\", one focused `question`, optional \
         `choices`), wait for the answer, then ask the next. Leave `file` empty so it shows on the Scope tab. Prefer \
         asking over guessing on anything that changes the scope.\n\
         2. EXPLORE read-only to understand the shared shape of the work and where it actually lives. Call \
         `loop_list_candidates` to see the pool.\n\
         3. AUTHOR THE SET. This is the core of your job:\n\
         - `loop_add_item(path)` — include a file you've decided is in scope (a candidate you're keeping, OR a file \
         the hint missed entirely).\n\
         - `loop_drop_item(path, reason)` — exclude a candidate (or task) that doesn't belong. ALWAYS give a clear \
         `reason`; the human sees it in the work graph and may re-include. Drop, don't silently ignore.\n\
         - `loop_add_task(id, title, spec, blocks?, requires?)` — for work that ISN'T one of the files: a shared \
         module/composable, a dependency, a codemod, fixtures. Use `blocks` (glob or paths) to make dependent files \
         wait; `requires` to order tasks. This is also how you GROUP files under a shared prerequisite or SPLIT one \
         concern across several units.\n\
         4. WRITE THE PLAN. When the set is settled, call `loop_write_plan` once with `plan` (markdown conventions \
         injected into every build worker), `assumptions` (so the human can correct them), and `summary` (a few rows \
         describing what the loop will do; `pend=true` on any row still needing a decision).\n\n\
         You own the orchestration — propose the structure you think is right; the human reviews the work graph before \
         any build runs. The build workers must make these checks pass: {tests}. Do NOT edit any file — analysis only. \
         Call `loop_write_plan` exactly once, when the work set is complete.",
        id = ctx.loop_id,
        task = ctx.template,
        seed_line = seed_line,
        tests = tests,
    );
    emit_stream(ctx, "running", "plan", "reading the codebase…");
    let _ = stream_claude(ctx, &ctx.seed, &prompt, "", |kind, payload, input| {
        if kind == "text" {
            emit_stream(ctx, "running", "plan", &payload.chars().take(80).collect::<String>());
        } else if kind == "tool" {
            // Surface what the strategist is doing so a long exploration shows live
            // progress instead of looking frozen.
            match payload {
                "loop_ask" => {
                    // Scope-level question — surface it on the Scope tab. The scope pass
                    // runs sequentially in the coordinator, so it blocks until answered.
                    surface_interview(ctx, None, input);
                }
                "Read" | "Grep" | "Glob" => emit_stream(ctx, "running", "plan", "exploring the repository…"),
                "loop_list_candidates" => emit_stream(ctx, "running", "plan", "reviewing the candidate pool…"),
                "loop_add_item" => {
                    let p = input.get("path").and_then(|v| v.as_str()).unwrap_or("a file");
                    emit_stream(ctx, "running", "plan", &format!("including {p}"));
                }
                "loop_drop_item" => {
                    let p = input.get("path").and_then(|v| v.as_str()).unwrap_or("a file");
                    emit_stream(ctx, "running", "plan", &format!("excluding {p}"));
                }
                "loop_add_task" => {
                    let t = input.get("title").and_then(|v| v.as_str()).unwrap_or("a task");
                    emit_stream(ctx, "running", "plan", &format!("adding task: {t}"));
                }
                "loop_write_plan" => emit_stream(ctx, "running", "plan", "writing the plan…"),
                _ => {}
            }
        }
    });
    emit_stream(ctx, "done", "plan", "plan ready");
}

fn allow(stdin: &Arc<Mutex<Option<std::process::ChildStdin>>>, request_id: &str, input: Value) {
    if let Some(s) = stdin.lock().unwrap().as_mut() {
        let resp = json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": request_id,
                          "response": { "behavior": "allow", "updatedInput": input } }
        });
        let _ = writeln!(s, "{resp}");
        let _ = s.flush();
    }
}

/// Fixed worker pool over the scheduler: each worker takes the next *ready* item
/// (deps satisfied), parking (not exiting) while work is blocked but the run hasn't
/// settled — so dependents run only after prerequisites settle. Shared by both the
/// Build and Plan runners (`process_item` branches on `ctx.phase`).
fn spawn_workers(ctx: &Arc<Ctx>, n: usize) -> Vec<std::thread::JoinHandle<()>> {
    let mut workers = Vec::new();
    for _ in 0..n {
        let ctx = ctx.clone();
        workers.push(std::thread::spawn(move || loop {
            if ctx.stopped.load(Ordering::Relaxed) {
                break;
            }
            if ctx.paused.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(250));
                continue;
            }
            let picked = {
                let mut g = ctx.sched.lock().unwrap();
                loop {
                    if ctx.stopped.load(Ordering::Relaxed) {
                        break None;
                    }
                    if let Some(p) = g.next_ready() {
                        break Some(p);
                    }
                    if g.settled() {
                        break None;
                    }
                    // No ready work yet, but a running blocker may clear it — park.
                    let (ng, _) = ctx.cond.wait_timeout(g, Duration::from_millis(500)).unwrap();
                    g = ng;
                }
            };
            match picked {
                Some(p) => process_item(&ctx, &p),
                None => {
                    // Wake any peers also parked so they re-evaluate `settled`.
                    ctx.cond.notify_all();
                    break;
                }
            }
        }));
    }
    workers
}

// ---- public API (Tauri commands call these) ----

/// Start a Build-mode loop. Returns immediately; workers stream events keyed by
/// `loop_id`. `targets` is the explicit file set (from the builder); when empty the
/// `pattern` is globbed against the repo.
#[allow(clippy::too_many_arguments)]
pub fn start_loop(
    app: AppHandle,
    registry: &LoopRegistry,
    loop_id: String,
    repo: String,
    branch: String,
    base: String,
    pattern: String,
    title: String,
    template: String,
    targets: Vec<String>,
    concurrency: u64,
    checks: Vec<CheckSpec>,
    review_on_done: bool,
) -> R<()> {
    // Fall back to the loop's persisted record where approve→build reuses the
    // planning loop and may not re-send everything: the original prompt, the loop's
    // name, and the creator's "open a review when done" choice (set on the plan).
    let prior = locke_store::read_loop(&repo, &loop_id).ok().flatten();
    let template = if template.trim().is_empty() {
        prior.as_ref().map(|l| l.template.clone()).filter(|t| !t.trim().is_empty()).unwrap_or(template)
    } else {
        template
    };
    let title = if title.trim().is_empty() {
        prior.as_ref().map(|l| l.title.clone()).filter(|t| !t.trim().is_empty()).unwrap_or_else(|| pattern.clone())
    } else {
        title
    };
    let review_on_done = prior.as_ref().map(|l| l.review_on_done).unwrap_or(review_on_done);
    // Seed worktree on the loop branch (create it from base if new). A branch can
    // only be checked out once, so a brand-new chore branch is expected.
    let seed = std::env::temp_dir()
        .join(format!("locke-loop-{}", locke_store::sanitize_path(&loop_id)))
        .join("seed")
        .to_string_lossy()
        .to_string();
    let _ = run_git(&repo, &["worktree", "remove", "--force", &seed]);
    let _ = std::fs::remove_dir_all(&seed);
    if branch_exists(&repo, &branch) {
        run_git(&repo, &["worktree", "add", &seed, &branch]).map_err(|e| format!("seed worktree on {branch}: {e}"))?;
    } else {
        run_git(&repo, &["worktree", "add", "-b", &branch, &seed, &base])
            .map_err(|e| format!("create {branch} from {base}: {e}"))?;
    }

    // The work graph: prefer the loop's checked-in manifest (its `inc` rows carry
    // requires/priority/wave); fall back to a flat node-per-file set otherwise.
    let manifest = locke_store::read_loop_manifest(&repo, &loop_id).unwrap_or_default();
    let entries: Vec<ManifestEntry> = if manifest.iter().any(|e| e.inc) {
        manifest.into_iter().filter(|e| e.inc).collect()
    } else {
        let files = if targets.is_empty() { collect_targets(&repo, &pattern) } else { targets };
        files
            .into_iter()
            .map(|path| ManifestEntry { id: path.clone(), path, inc: true, kind: "file".into(), ..Default::default() })
            .collect()
    };
    let sched = Scheduler::new(&entries);
    let total = sched.total();

    // Persist the loop record.
    locke_store::upsert_loop(
        &repo,
        locke_store::Loop {
            id: loop_id.clone(),
            title: title.clone(),
            branch: branch.clone(),
            base: base.clone(),
            mode: "build".into(),
            state: "building".into(),
            pattern: pattern.clone(),
            total,
            queued: total,
            template: template.clone(),
            concurrency,
            review_on_done,
            pull_id: prior.as_ref().map(|l| l.pull_id).unwrap_or(0),
            ..Default::default()
        },
    )?;

    let paused = Arc::new(AtomicBool::new(false));
    let stopped = Arc::new(AtomicBool::new(false));
    let cancelled = Arc::new(Mutex::new(HashSet::new()));
    registry
        .0
        .lock()
        .unwrap()
        .insert(loop_id.clone(), LoopHandle { paused: paused.clone(), stopped: stopped.clone(), cancelled: cancelled.clone() });

    let ctx = Arc::new(Ctx {
        app,
        repo: repo.clone(),
        loop_id: loop_id.clone(),
        phase: Phase::Build,
        base,
        seed: seed.clone(),
        template,
        checks,
        total,
        sched: Mutex::new(sched),
        cond: Condvar::new(),
        commit_lock: Mutex::new(()),
        paused,
        stopped,
        cancelled,
        start: Instant::now(),
    });
    emit_progress(&ctx);

    let workers = spawn_workers(&ctx, concurrency.clamp(1, 16) as usize);

    // Coordinator: join the pool, mark unreachable items blocked, finalize.
    std::thread::spawn(move || {
        for w in workers {
            let _ = w.join();
        }
        let (c, blocked) = {
            let mut g = ctx.sched.lock().unwrap();
            g.finalize_blocked();
            (g.counts(), g.blocked_emissions())
        };
        for (id, key, wave, prio, unmet) in blocked {
            let line = format!("blocked by {}", unmet.join(", "));
            emit_item(&ctx, &id, &key, "blocked", Some(line), None, wave, prio, unmet);
        }
        emit_progress(&ctx);
        let state = if ctx.stopped.load(Ordering::Relaxed) {
            "stopped"
        } else if c.review > 0 || c.failed > 0 || c.blocked > 0 {
            "review"
        } else {
            "done"
        };
        let _ = locke_store::update_loop(&ctx.repo, &ctx.loop_id, |l| l.state = if state == "stopped" { "paused".into() } else { "done".into() });
        let _ = run_git(&ctx.repo, &["worktree", "remove", "--force", &ctx.seed]);
        let _ = std::fs::remove_dir_all(&ctx.seed);
        let _ = run_git(&ctx.repo, &["worktree", "prune"]);
        // Open a review of the loop's branch for the creator's attention (opt-out).
        // A stopped run produced no settled output, so only on a real finish.
        let pull_id = if state != "stopped" && review_on_done {
            locke_store::ensure_loop_review(&ctx.repo, &ctx.loop_id).unwrap_or(0)
        } else {
            0
        };
        let _ = ctx.app.emit("loop:done", DonePayload { loop_id: ctx.loop_id.clone(), state: state.into(), pull_id });
    });

    Ok(())
}

/// Start a Plan-mode (strategist) run. Returns immediately; a coordinator thread
/// first runs one global scope agent (→ `plan.md` + scope metadata), then fans out
/// a read-only spec agent per item (→ each enriches its manifest row + writes a
/// per-item spec via `loop_write_spec`). Nothing is committed; the loop settles to
/// `planning`, awaiting the creator's approve→build (`start_loop` then consumes the
/// enriched manifest unchanged).
#[allow(clippy::too_many_arguments)]
pub fn start_plan(
    app: AppHandle,
    registry: &LoopRegistry,
    loop_id: String,
    repo: String,
    branch: String,
    base: String,
    pattern: String,
    title: String,
    template: String,
    targets: Vec<String>,
    concurrency: u64,
    checks: Vec<CheckSpec>,
    review_on_done: bool,
) -> R<()> {
    // Fall back to the loop's persisted record — a resume reuses the loop record and
    // may not re-send the prompt, the loop's name, or the review-on-done choice.
    let prior = locke_store::read_loop(&repo, &loop_id).ok().flatten();
    let template = if template.trim().is_empty() {
        prior.as_ref().map(|l| l.template.clone()).filter(|t| !t.trim().is_empty()).unwrap_or(template)
    } else {
        template
    };
    let title = if title.trim().is_empty() {
        prior.as_ref().map(|l| l.title.clone()).filter(|t| !t.trim().is_empty()).unwrap_or_else(|| pattern.clone())
    } else {
        title
    };
    let review_on_done = prior.as_ref().map(|l| l.review_on_done).unwrap_or(review_on_done);
    // A throwaway read worktree detached at `base` — the strategist analyses files
    // here and per-item workers cut their sandboxes from its tip. No branch, no
    // commits: a planning pass never touches the user's tree.
    let seed = std::env::temp_dir()
        .join(format!("locke-loop-{}", locke_store::sanitize_path(&loop_id)))
        .join("seed")
        .to_string_lossy()
        .to_string();
    let _ = run_git(&repo, &["worktree", "remove", "--force", &seed]);
    let _ = std::fs::remove_dir_all(&seed);
    run_git(&repo, &["worktree", "add", "--detach", &seed, &base])
        .map_err(|e| format!("plan worktree at {base}: {e}"))?;

    // Requirements-first: the PROMPT is the source of truth for the work, not the
    // resolver. The scope hint only seeds a *candidate pool* (`inc=false`,
    // status=`candidate`); the decomposition agent (run_scope_agent) authors the
    // actual set by promoting candidates (`loop_add_item` → queued) / dropping them
    // (`loop_drop_item` → excluded) / adding tasks. So here we DON'T pre-queue the
    // glob: we keep every row (candidates + excluded + anything already authored) and
    // only (re)queue rows the model has already included. The post-scope rebuild
    // (below) seeds the spec scheduler from whatever the agent authors.
    let mut entries = locke_store::read_loop_manifest(&repo, &loop_id).unwrap_or_default();
    // If the manifest is empty but a scope hint was passed, seed it as CANDIDATES
    // (not authoritative) — robustness when the front-end didn't pre-write them.
    // No hint at all ⇒ leave empty: a prompt-only loop where the agent discovers.
    if entries.is_empty() {
        let files = if targets.is_empty() {
            if pattern.trim().is_empty() { Vec::new() } else { collect_targets(&repo, &pattern) }
        } else {
            targets
        };
        entries = files
            .into_iter()
            .map(|path| {
                let loc = count_loc(&repo, &path);
                ManifestEntry {
                    id: path.clone(),
                    path,
                    kind: "file".into(),
                    loc,
                    risk: risk_band(loc).to_string(),
                    inc: false,
                    status: "candidate".into(),
                    origin: "resolver".into(),
                    ..Default::default()
                }
            })
            .collect();
    }
    for e in &mut entries {
        if e.id.is_empty() {
            e.id = e.path.clone();
        }
        if e.kind.is_empty() {
            e.kind = "file".into();
        }
        // Leave the candidate pool and dropped items as the model authored them.
        if e.status == "candidate" || e.status == "excluded" {
            continue;
        }
        // Resume-safe: keep already-finished specs (specced / flagged-for-review);
        // (re-)queue everything else the model included. So a resumed plan only
        // re-specs what's left.
        if e.inc && e.status != "specced" && e.status != "review" {
            e.status = "queued".into();
        }
    }
    let _ = locke_store::write_loop_manifest(&repo, &loop_id, &entries);
    // Only spec the unfinished items — a fresh run has them all queued; a resume
    // skips what's already specced so it doesn't re-burn tokens.
    let to_spec: Vec<ManifestEntry> = entries.iter().filter(|e| e.status == "queued").cloned().collect();
    let sched = Scheduler::new(&to_spec);
    let total = sched.total();
    // Skip the scope pass on a resume — the plan was already drafted.
    let has_plan = locke_store::read_loop_plan(&repo, &loop_id).ok().flatten().is_some_and(|s| !s.trim().is_empty());

    locke_store::upsert_loop(
        &repo,
        locke_store::Loop {
            id: loop_id.clone(),
            title: title.clone(),
            branch: branch.clone(),
            base: base.clone(),
            mode: "plan".into(),
            state: "planning".into(),
            pattern: pattern.clone(),
            total,
            queued: total,
            template: template.clone(),
            concurrency,
            review_on_done,
            pull_id: prior.as_ref().map(|l| l.pull_id).unwrap_or(0),
            ..Default::default()
        },
    )?;

    let paused = Arc::new(AtomicBool::new(false));
    let stopped = Arc::new(AtomicBool::new(false));
    let cancelled = Arc::new(Mutex::new(HashSet::new()));
    registry
        .0
        .lock()
        .unwrap()
        .insert(loop_id.clone(), LoopHandle { paused: paused.clone(), stopped: stopped.clone(), cancelled: cancelled.clone() });

    let ctx = Arc::new(Ctx {
        app,
        repo: repo.clone(),
        loop_id: loop_id.clone(),
        phase: Phase::Plan,
        base,
        seed: seed.clone(),
        template,
        checks,
        total,
        sched: Mutex::new(sched),
        cond: Condvar::new(),
        commit_lock: Mutex::new(()),
        paused,
        stopped,
        cancelled,
        start: Instant::now(),
    });
    emit_progress(&ctx);

    let n = concurrency.clamp(1, 16) as usize;
    // Coordinator: scope pass → per-item spec fan-out → finalize to `planning`.
    std::thread::spawn(move || {
        if !ctx.stopped.load(Ordering::Relaxed) && !has_plan {
            run_scope_agent(&ctx);
            // The scope agent may have added prerequisite/custom task nodes (via
            // `loop_add_task`) and fanned `requires` edges across files. Rebuild the
            // scheduler from the now-current manifest so any still-queued items it
            // introduced get specced and the planning counts include them. Tasks the
            // agent specced inline are already `specced` (not re-queued), so they're
            // skipped here and picked up by the build scheduler after approval.
            if let Ok(entries) = locke_store::read_loop_manifest(&ctx.repo, &ctx.loop_id) {
                let in_scope = entries.iter().filter(|e| e.inc && e.status != "excluded").count() as u64;
                let to_spec: Vec<ManifestEntry> =
                    entries.into_iter().filter(|e| e.status == "queued").collect();
                let fresh = Scheduler::new(&to_spec);
                *ctx.sched.lock().unwrap() = fresh;
                let _ = locke_store::update_loop(&ctx.repo, &ctx.loop_id, |l| l.total = in_scope.max(l.total));
                emit_progress(&ctx);
            }
        }
        let workers = spawn_workers(&ctx, n);
        for w in workers {
            let _ = w.join();
        }
        let (c, blocked) = {
            let mut g = ctx.sched.lock().unwrap();
            g.finalize_blocked();
            (g.counts(), g.blocked_emissions())
        };
        for (id, key, wave, prio, unmet) in blocked {
            let line = format!("blocked by {}", unmet.join(", "));
            emit_item(&ctx, &id, &key, "blocked", Some(line), None, wave, prio, unmet);
        }
        emit_progress(&ctx);
        // A planning pass always settles to `planning` (awaiting approve→build),
        // unless the human stopped it (→ back to draft-like `paused`).
        let stopped = ctx.stopped.load(Ordering::Relaxed);
        let done_state = if stopped { "stopped" } else { "planning" };
        let _ = locke_store::update_loop(&ctx.repo, &ctx.loop_id, |l| {
            l.state = if stopped { "paused".into() } else { "planning".into() };
            l.review = c.review;
            l.done = c.done; // specced count
        });
        let _ = run_git(&ctx.repo, &["worktree", "remove", "--force", &ctx.seed]);
        let _ = std::fs::remove_dir_all(&ctx.seed);
        let _ = run_git(&ctx.repo, &["worktree", "prune"]);
        // A planning pass settles to `planning` and opens no review (that happens on
        // the build that follows approval).
        let _ = ctx.app.emit("loop:done", DonePayload { loop_id: ctx.loop_id.clone(), state: done_state.into(), pull_id: 0 });
    });

    Ok(())
}

pub fn pause_loop(registry: &LoopRegistry, loop_id: &str, paused: bool) -> R<()> {
    let guard = registry.0.lock().unwrap();
    let h = guard.get(loop_id).ok_or("loop not found")?;
    h.paused.store(paused, Ordering::Relaxed);
    Ok(())
}

pub fn stop_loop(registry: &LoopRegistry, loop_id: &str) -> R<()> {
    let guard = registry.0.lock().unwrap();
    let h = guard.get(loop_id).ok_or("loop not found")?;
    h.stopped.store(true, Ordering::Relaxed);
    Ok(())
}

/// Stop speccing a single item (by its key/path) without stopping the rest of the
/// run: the agent for that item is SIGKILLed and the item is left queued (unspecced,
/// still in scope) — not excluded.
pub fn stop_loop_item(registry: &LoopRegistry, loop_id: &str, key: &str) -> R<()> {
    let guard = registry.0.lock().unwrap();
    let h = guard.get(loop_id).ok_or("loop not found")?;
    h.cancelled.lock().unwrap().insert(key.to_string());
    Ok(())
}

/// Resolve a review item: approve → apply its captured patch onto the loop branch;
/// request changes → re-queue (feedback is appended as a note for the re-run).
pub fn resolve_loop_item(repo: &str, loop_id: &str, file: &str, decision: &str, feedback: &str) -> R<Value> {
    if decision == "approve" {
        let item = locke_store::read_loop_item(repo, loop_id, file)?.ok_or("item not found")?;
        let lp = locke_store::read_loop(repo, loop_id)?.ok_or("loop not found")?;
        // Apply the stored diff onto a throwaway worktree on the branch, commit.
        let patch_lines = item.get("diff").and_then(|d| d.as_array()).cloned().unwrap_or_default();
        let patch = reconstruct_patch(file, &patch_lines);
        let wt = std::env::temp_dir()
            .join(format!("locke-loop-{}", locke_store::sanitize_path(loop_id)))
            .join("resolve")
            .to_string_lossy()
            .to_string();
        let _ = run_git(repo, &["worktree", "remove", "--force", &wt]);
        run_git(repo, &["worktree", "add", &wt, &lp.branch]).map_err(|e| format!("resolve worktree: {e}"))?;
        let res = (|| -> R<()> {
            std::fs::write(Path::new(&wt).join(".locke-item.patch"), &patch).map_err(|e| format!("write patch: {e}"))?;
            run_git(&wt, &["apply", ".locke-item.patch"]).map_err(|e| format!("apply: {e}"))?;
            let _ = std::fs::remove_file(Path::new(&wt).join(".locke-item.patch"));
            run_git(&wt, &["add", "-A"])?;
            run_git(&wt, &["commit", "-m", &format!("loop: {file} (approved)")])?;
            Ok(())
        })();
        let _ = run_git(repo, &["worktree", "remove", "--force", &wt]);
        let _ = std::fs::remove_dir_all(&wt);
        res?;
        locke_store::merge_loop_item(repo, loop_id, file, json!({ "status": "done", "line": "approved" }))?;
        locke_store::update_loop(repo, loop_id, |l| {
            l.review = l.review.saturating_sub(1);
            l.done += 1;
        })?;
        Ok(json!({ "ok": true, "status": "done" }))
    } else {
        if !feedback.trim().is_empty() {
            locke_store::append_loop_note(repo, loop_id, file, &format!("review feedback: {feedback}"))?;
        }
        locke_store::merge_loop_item(repo, loop_id, file, json!({ "status": "queued", "declared": Value::Null }))?;
        locke_store::update_loop(repo, loop_id, |l| {
            l.review = l.review.saturating_sub(1);
            l.queued += 1;
        })?;
        Ok(json!({ "ok": true, "status": "queued" }))
    }
}

/// Rebuild a minimal unified patch from the parsed `LoopDiffLine[]` we stored.
fn reconstruct_patch(file: &str, lines: &[Value]) -> String {
    let mut out = format!("--- a/{file}\n+++ b/{file}\n");
    for l in lines {
        if let Some(h) = l.get("h").and_then(|v| v.as_str()) {
            out.push_str(h);
            out.push('\n');
        } else if let Some(code) = l.get("c").and_then(|v| v.as_str()) {
            let sign = match l.get("t").and_then(|v| v.as_str()) {
                Some("add") => '+',
                Some("del") => '-',
                _ => ' ',
            };
            out.push(sign);
            out.push_str(code);
            out.push('\n');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_matches_double_star() {
        assert!(glob_match("src/**/*.vue", "src/a/b/C.vue"));
        assert!(glob_match("src/**/*.vue", "src/C.vue"));
        assert!(glob_match("**/*.txt", "a/b.txt"));
        assert!(!glob_match("src/**/*.vue", "lib/C.vue"));
        assert!(!glob_match("src/**/*.vue", "src/C.ts"));
    }

    #[test]
    fn glob_expands_braces() {
        assert!(glob_match("packages/**/*.{vue,ts}", "packages/ui/src/B.vue"));
        assert!(glob_match("packages/**/*.{vue,ts}", "packages/core/x.ts"));
        assert!(!glob_match("packages/**/*.{vue,ts}", "packages/core/x.js"));
        // multiple groups
        assert!(glob_match("{src,lib}/*.{ts,tsx}", "lib/a.tsx"));
        assert!(!glob_match("{src,lib}/*.{ts,tsx}", "app/a.tsx"));
    }

    #[test]
    fn resolves_targets_across_kinds() {
        let dir = std::env::temp_dir().join(format!("locke-resolve-{}", std::process::id()));
        let src = dir.join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("small.txt"), "a\nb\nc\n").unwrap();
        std::fs::write(src.join("big.txt"), "x\n".repeat(305)).unwrap();
        std::fs::write(src.join("note.md"), "no match\n").unwrap();
        let repo = dir.to_string_lossy().to_string();

        // Glob: loc + risk band, included by default, sorted, .txt only.
        let g = resolve_targets(&repo, &ResolverSpec::Glob { pattern: "src/**/*.txt".into() });
        let paths: Vec<&str> = g.iter().map(|t| t.path.as_str()).collect();
        assert_eq!(paths, vec!["src/big.txt", "src/small.txt"]);
        let big = g.iter().find(|t| t.path == "src/big.txt").unwrap();
        assert_eq!((big.loc, big.risk.as_str(), big.inc), (305, "high", true));
        assert_eq!(g.iter().find(|t| t.path == "src/small.txt").unwrap().risk, "low");

        // Globs: include .txt + .md, exclude big.
        let gs = resolve_targets(
            &repo,
            &ResolverSpec::Globs { include: vec!["src/**/*.txt".into(), "src/**/*.md".into()], exclude: vec!["**/big.txt".into()] },
        );
        let paths: Vec<&str> = gs.iter().map(|t| t.path.as_str()).collect();
        assert_eq!(paths, vec!["src/note.md", "src/small.txt"]);

        // List: real files kept, escapes/missing dropped.
        let ls = resolve_targets(
            &repo,
            &ResolverSpec::List { paths: vec!["src/small.txt".into(), "../etc/passwd".into(), "nope.txt".into()] },
        );
        assert_eq!(ls.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), vec!["src/small.txt"]);

        // Command: stdout lines, validated against the tree.
        let cmd = resolve_targets(&repo, &ResolverSpec::Command { command: "printf 'src/big.txt\\nsrc/missing.txt\\n'".into() });
        assert_eq!(cmd.iter().map(|t| t.path.as_str()).collect::<Vec<_>>(), vec!["src/big.txt"]);

        std::fs::remove_dir_all(&dir).ok();
    }

    fn node(id: &str, requires: &[&str], priority: i64) -> ManifestEntry {
        ManifestEntry {
            id: id.into(),
            path: id.into(),
            kind: "file".into(),
            inc: true,
            requires: requires.iter().map(|s| s.to_string()).collect(),
            priority,
            ..Default::default()
        }
    }

    #[test]
    fn computes_topological_waves() {
        let es = vec![node("a", &[], 0), node("b", &["a"], 0), node("c", &["b"], 0), node("d", &["a"], 0)];
        let w = compute_waves(&es);
        assert_eq!((w["a"], w["b"], w["c"], w["d"]), (0, 1, 2, 1));
    }

    #[test]
    fn scheduler_runs_in_dependency_order_with_priority() {
        // a (foundation) unblocks b & c; d is independent. Higher priority runs first.
        let es = vec![node("a", &[], 0), node("b", &["a"], 1), node("c", &["a"], 5), node("d", &[], 0)];
        let mut s = Scheduler::new(&es);
        let mut order = Vec::new();
        while let Some(p) = s.next_ready() {
            order.push(p.id.clone());
            s.mark(p.i, St::Done);
        }
        assert!(s.settled());
        assert_eq!(order.len(), 4);
        let pos = |id: &str| order.iter().position(|x| x == id).unwrap();
        assert!(pos("a") < pos("b") && pos("a") < pos("c"), "foundation before dependents");
        assert!(pos("c") < pos("b"), "higher priority first among ready");
    }

    #[test]
    fn dependents_block_when_prerequisite_fails() {
        let es = vec![node("a", &[], 0), node("b", &["a"], 0)];
        let mut s = Scheduler::new(&es);
        let p = s.next_ready().unwrap();
        assert_eq!(p.id, "a");
        s.mark(p.i, St::Failed); // foundation fails → b can never be satisfied
        assert!(s.next_ready().is_none());
        assert!(s.settled());
        s.finalize_blocked();
        let c = s.counts();
        assert_eq!((c.failed, c.blocked), (1, 1));
    }

    #[test]
    fn cycle_and_unknown_deps() {
        // A 2-cycle never becomes ready → both blocked.
        let mut cyc = Scheduler::new(&[node("a", &["b"], 0), node("b", &["a"], 0)]);
        assert!(cyc.next_ready().is_none() && cyc.settled());
        cyc.finalize_blocked();
        assert_eq!(cyc.counts().blocked, 2);
        // An unknown (out-of-graph) dep is treated as satisfied, not a deadlock.
        let mut ok = Scheduler::new(&[node("a", &["ghost"], 0)]);
        assert_eq!(ok.next_ready().unwrap().id, "a");
    }

    #[test]
    fn task_node_gates_its_dependent_files() {
        // A model-authored prerequisite task (kind:"task", keyed by id, addressed by
        // its title) must run wave 0; the files that `require` it sit at wave 1 and
        // only become ready once the task is Done.
        let task = ManifestEntry {
            id: "add-use-cart".into(),
            kind: "task".into(),
            title: Some("Create the shared useCart composable".into()),
            inc: true,
            origin: "model".into(),
            status: "specced".into(),
            ..Default::default()
        };
        let mut file = node("src/Cart.vue", &["add-use-cart"], 0);
        file.path = "src/Cart.vue".into();
        file.id = "src/Cart.vue".into();
        let es = vec![task, file];

        let w = compute_waves(&es);
        assert_eq!((w["add-use-cart"], w["src/Cart.vue"]), (0, 1));

        let mut s = Scheduler::new(&es);
        let first = s.next_ready().unwrap();
        // The task is picked first, addressed as a task by its title (not a path).
        assert_eq!(first.id, "add-use-cart");
        assert!(first.is_task);
        assert_eq!(first.key, "add-use-cart");
        assert_eq!(first.target, "Create the shared useCart composable");
        // The dependent file is blocked until the task completes.
        assert!(s.next_ready().is_none());
        s.mark(first.i, St::Done);
        let second = s.next_ready().unwrap();
        assert_eq!(second.id, "src/Cart.vue");
        assert!(!second.is_task);
        assert_eq!(second.target, "src/Cart.vue");
    }

    #[test]
    fn parses_unified_patch_into_diff_lines() {
        let patch = "@@ -1,2 +1,2 @@\n-old\n+new\n ctx\n";
        let lines = parse_patch(patch);
        assert_eq!(lines[0]["h"], "@@ -1,2 +1,2 @@");
        assert_eq!(lines[1]["t"], "del");
        assert_eq!(lines[1]["c"], "old");
        assert_eq!(lines[2]["t"], "add");
        assert_eq!(lines[2]["c"], "new");
        assert_eq!(lines[3]["c"], "ctx");
    }
}
