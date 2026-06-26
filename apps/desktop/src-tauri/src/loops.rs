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
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

type R<T> = Result<T, String>;

// ---- event payloads (camelCase, keyed by loopId) ----

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemPayload {
    loop_id: String,
    item_id: String,
    path: String,
    /// queued | running | review | done | failed.
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pct: Option<u32>,
    agent: String,
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
}

/// App-managed registry of in-flight loops, keyed by loopId.
#[derive(Default)]
pub struct LoopRegistry(pub Mutex<HashMap<String, LoopHandle>>);

pub struct LoopHandle {
    paused: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
}

#[derive(Default, Clone, Copy)]
struct Counts {
    done: u64,
    running: u64,
    review: u64,
    failed: u64,
    queued: u64,
}

/// Shared per-loop context handed to every worker thread.
struct Ctx {
    app: AppHandle,
    repo: String,
    loop_id: String,
    base: String,
    seed: String,
    template: String,
    checks: Vec<CheckSpec>,
    total: u64,
    counts: Mutex<Counts>,
    queue: Mutex<VecDeque<String>>,
    commit_lock: Mutex<()>,
    paused: Arc<AtomicBool>,
    stopped: Arc<AtomicBool>,
    item_seq: AtomicU64,
    start: Instant,
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

/// Match a repo-relative path against a glob with `**` (any depth) and `*`
/// (within a segment), e.g. `src/**/*.vue`.
pub fn glob_match(pat: &str, path: &str) -> bool {
    let p: Vec<&str> = pat.split('/').filter(|s| !s.is_empty()).collect();
    let s: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    seg_match(&p, &s)
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

/// Walk the repo working tree, returning repo-relative paths matching `pattern`.
/// Skips dotfiles/dirs (incl. `.git`/`.locke`), `node_modules`, and `target`.
fn collect_targets(repo: &str, pattern: &str) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(repo), repo, pattern, &mut out);
    out.sort();
    out
}

fn walk(dir: &Path, repo: &str, pattern: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        if path.is_dir() {
            walk(&path, repo, pattern, out);
        } else if let Ok(rel) = path.strip_prefix(repo) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            if glob_match(pattern, &rel) {
                out.push(rel);
            }
        }
    }
}

// ---- prompt rendering ----

/// Always-appended completion protocol so even a custom template carries the
/// exact tool-call parameters. This is the worker's objective/boundaries/output
/// contract (per Anthropic's subagent-spec guidance).
fn protocol_footer(loop_id: &str, file: &str, tests: &str) -> String {
    format!(
        "\n\n---\nYou are running UNATTENDED as one item of a Locke loop.\n\
         - Work ONLY on this file: `{file}`. Do not modify unrelated files.\n\
         - Success criteria: the change is complete AND these checks pass: {tests}.\n\
         - When done and checks pass, call the `loop_item_complete` tool with \
         loop_id=\"{loop_id}\" and file=\"{file}\".\n\
         - If you are uncertain, or a human decision is needed, call \
         `loop_item_needs_review` with loop_id=\"{loop_id}\", file=\"{file}\" and a \
         reason instead — do not guess.\n\
         - You can fetch any pre-written spec with `loop_read_spec`."
    )
}

fn render_prompt(ctx: &Ctx, file: &str) -> String {
    let tests = if ctx.checks.is_empty() {
        "(no checks configured)".to_string()
    } else {
        ctx.checks.iter().map(|c| c.label.clone()).collect::<Vec<_>>().join(", ")
    };
    let spec = locke_store::read_loop_spec(&ctx.repo, &ctx.loop_id, file).ok().flatten().unwrap_or_default();
    let conventions = locke_store::read_loop_plan(&ctx.repo, &ctx.loop_id).ok().flatten().unwrap_or_default();
    let body = ctx
        .template
        .replace("{{file}}", file)
        .replace("{{loop_id}}", &ctx.loop_id)
        .replace("{{tests}}", &tests)
        .replace("{{base}}", &ctx.base)
        .replace("{{spec}}", &spec)
        .replace("{{conventions}}", &conventions);
    format!("{body}{}", protocol_footer(&ctx.loop_id, file, &tests))
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
    let c = *ctx.counts.lock().unwrap();
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
            rate,
            elapsed,
        },
    );
}

fn emit_item(ctx: &Ctx, item_id: &str, path: &str, status: &str, line: Option<String>, pct: Option<u32>) {
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

// ---- the per-item worker ----

enum Outcome {
    Done,
    Review(String),
    Failed(String),
}

fn process_item(ctx: &Arc<Ctx>, file: &str) {
    let item_id = format!("it-{}", ctx.item_seq.fetch_add(1, Ordering::Relaxed));
    // queued -> running
    {
        let mut c = ctx.counts.lock().unwrap();
        c.queued = c.queued.saturating_sub(1);
        c.running += 1;
    }
    emit_item(ctx, &item_id, file, "running", Some("starting…".into()), Some(2));
    emit_progress(ctx);

    let outcome = run_one(ctx, &item_id, file).unwrap_or_else(Outcome::Failed);

    let (status, line, st_glyph) = match &outcome {
        Outcome::Done => ("done", "migrated · checks pass".to_string(), "done"),
        Outcome::Review(r) => ("review", r.clone(), "review"),
        Outcome::Failed(e) => ("failed", e.clone(), "failed"),
    };
    // Persist the final item record (merging any agent declaration already there).
    let _ = locke_store::merge_loop_item(
        &ctx.repo,
        &ctx.loop_id,
        file,
        json!({ "id": item_id, "status": status, "line": line, "agent": "CL" }),
    );
    {
        let mut c = ctx.counts.lock().unwrap();
        c.running = c.running.saturating_sub(1);
        match outcome {
            Outcome::Done => c.done += 1,
            Outcome::Review(_) => c.review += 1,
            Outcome::Failed(_) => c.failed += 1,
        }
    }
    emit_item(ctx, &item_id, file, status, Some(line.clone()), Some(100));
    emit_stream(ctx, st_glyph, file, &line);
    emit_progress(ctx);
}

/// The heavy lifting for one item: worktree → agent → checks → commit/route.
fn run_one(ctx: &Arc<Ctx>, item_id: &str, file: &str) -> R<Outcome> {
    let seed_tip = git_out(&ctx.seed, &["rev-parse", "HEAD"])?;
    let wt = std::env::temp_dir()
        .join(format!("locke-loop-{}", locke_store::sanitize_path(&ctx.loop_id)))
        .join(format!("item-{}", item_id))
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
        run_agent_stream(ctx, item_id, file, &wt)?;
        if ctx.stopped.load(Ordering::Relaxed) {
            return Ok(Outcome::Failed("loop stopped".into()));
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

/// Spawn the agent in `--permission-mode auto` and stream its events. Auto mode's
/// classifier handles routine approvals; any escalation that still reaches us is
/// allowed (the worktree is isolated and the run is explicitly unattended — the
/// checks + review gates are the safety net). Returns when the process exits.
fn run_agent_stream(ctx: &Arc<Ctx>, item_id: &str, file: &str, wt: &str) -> R<()> {
    let exe = crate::actions::resolve_agent_path("claude");
    let prompt = render_prompt(ctx, file);
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
    let user_msg = json!({ "type": "user", "message": { "role": "user", "content": prompt } });
    writeln!(stdin, "{user_msg}").map_err(|e| format!("write prompt: {e}"))?;
    stdin.flush().ok();
    let stdin = Arc::new(Mutex::new(Some(stdin)));

    let mut edits = 0u32;
    for line in BufReader::new(stdout).lines() {
        if ctx.stopped.load(Ordering::Relaxed) {
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
                                    emit_item(ctx, item_id, file, "running", Some(t.chars().take(80).collect()), None);
                                }
                            }
                            Some("tool_use") => {
                                let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                if matches!(name, "Edit" | "Write" | "MultiEdit") {
                                    edits += 1;
                                    let pct = (10 + edits * 18).min(92);
                                    emit_item(ctx, item_id, file, "running", Some(format!("editing {file}")), Some(pct));
                                }
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
    Ok(())
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
    template: String,
    targets: Vec<String>,
    concurrency: u64,
    checks: Vec<CheckSpec>,
) -> R<()> {
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

    let files = if targets.is_empty() { collect_targets(&repo, &pattern) } else { targets };
    let total = files.len() as u64;

    // Persist the loop record.
    locke_store::upsert_loop(
        &repo,
        locke_store::Loop {
            id: loop_id.clone(),
            title: pattern.clone(),
            branch: branch.clone(),
            base: base.clone(),
            mode: "build".into(),
            state: "building".into(),
            pattern: pattern.clone(),
            total,
            queued: total,
            template: template.clone(),
            concurrency,
            ..Default::default()
        },
    )?;

    let paused = Arc::new(AtomicBool::new(false));
    let stopped = Arc::new(AtomicBool::new(false));
    registry.0.lock().unwrap().insert(loop_id.clone(), LoopHandle { paused: paused.clone(), stopped: stopped.clone() });

    let ctx = Arc::new(Ctx {
        app,
        repo: repo.clone(),
        loop_id: loop_id.clone(),
        base,
        seed: seed.clone(),
        template,
        checks,
        total,
        counts: Mutex::new(Counts { queued: total, ..Default::default() }),
        queue: Mutex::new(files.into_iter().collect()),
        commit_lock: Mutex::new(()),
        paused,
        stopped,
        item_seq: AtomicU64::new(1),
        start: Instant::now(),
    });
    emit_progress(&ctx);

    // Fixed worker pool draining the queue.
    let n = concurrency.clamp(1, 16) as usize;
    let mut workers = Vec::new();
    for _ in 0..n {
        let ctx = ctx.clone();
        workers.push(std::thread::spawn(move || loop {
            if ctx.stopped.load(Ordering::Relaxed) {
                break;
            }
            if ctx.paused.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(250));
                continue;
            }
            let Some(file) = ctx.queue.lock().unwrap().pop_front() else { break };
            process_item(&ctx, &file);
        }));
    }

    // Coordinator: join the pool, finalize, tear down the seed worktree.
    std::thread::spawn(move || {
        for w in workers {
            let _ = w.join();
        }
        let c = *ctx.counts.lock().unwrap();
        let state = if ctx.stopped.load(Ordering::Relaxed) {
            "stopped"
        } else if c.review > 0 || c.failed > 0 {
            "review"
        } else {
            "done"
        };
        let _ = locke_store::update_loop(&ctx.repo, &ctx.loop_id, |l| l.state = if state == "stopped" { "paused".into() } else { "done".into() });
        let _ = run_git(&ctx.repo, &["worktree", "remove", "--force", &ctx.seed]);
        let _ = std::fs::remove_dir_all(&ctx.seed);
        let _ = run_git(&ctx.repo, &["worktree", "prune"]);
        let _ = ctx.app.emit("loop:done", DonePayload { loop_id: ctx.loop_id.clone(), state: state.into() });
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
