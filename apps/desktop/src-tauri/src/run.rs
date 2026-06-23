// Live streaming agent runs.
//
// Claude Code speaks a bidirectional stream-json control protocol: launched with
// `--input-format stream-json --output-format stream-json --permission-prompt-tool
// stdio`, it emits newline-delimited JSON events on stdout and routes every
// tool-permission decision back as a `can_use_tool` control_request. We parse the
// event stream into UI run events, surface permission prompts to the app for an
// in-app Allow/Deny, and write the decision back on stdin as a `control_response`.
// A run can be cancelled by killing the child. The full run is persisted under
// `.locke/runs/<runId>.json` for the History tab.
//
// Only Claude speaks this protocol; other agents fall back to the one-shot
// headless `actions::run_agent` (see `commands::run_agent`).

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

type R<T> = Result<T, String>;

/// One live run: its child process, an stdin handle for permission responses,
/// and the context needed to finalize (commit + persist) when it ends.
struct RunSlot {
    child: Child,
    /// Taken (dropped → pipe closed) once the run's final `result` arrives, to
    /// let the CLI exit; also written to when answering a permission prompt.
    stdin: Option<ChildStdin>,
    repo: String,
    branch: String,
    workdir: String,
    use_worktree: bool,
    /// Set by `cancel_run` so finalize skips the commit and marks it cancelled.
    canceled: bool,
}

/// App-managed registry of in-flight runs, keyed by runId.
#[derive(Default)]
pub struct RunRegistry(Mutex<HashMap<String, RunSlot>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EventPayload {
    run_id: String,
    key: String,
    /// One of: msg | read | edit | result | done | denied.
    kind: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sub: Option<String>,
    time: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PermissionPayload {
    run_id: String,
    request_id: String,
    /// Tool family for "Always allow {tool}", e.g. "Bash", "Write".
    tool: String,
    /// The command (Bash) or a short summary of the tool input.
    cmd: String,
    why: String,
    scope: String,
    suggestions: Value,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    run_id: String,
    /// done | failed | canceled.
    state: String,
    result: String,
    duration: String,
    branch: String,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn elapsed_str(start: Instant) -> String {
    let s = start.elapsed().as_secs();
    format!("{}:{:02}", s / 60, s % 60)
}

fn sanitize(branch: &str) -> String {
    branch.chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect()
}

fn run_git(dir: &str, args: &[&str]) -> R<()> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map_err(|e| format!("spawn git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// First non-empty line of a string, truncated, for compact event summaries.
fn first_line(s: &str, max: usize) -> String {
    let line = s.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    line.chars().take(max).collect()
}

/// Classify a tool_use into a UI event (kind, text, optional sub-block).
fn tool_event(name: &str, input: &Value) -> (String, String, Option<String>) {
    let path = input
        .get("file_path")
        .or_else(|| input.get("path"))
        .or_else(|| input.get("notebook_path"))
        .and_then(|v| v.as_str());
    match name {
        "Read" | "Grep" | "Glob" | "LS" | "NotebookRead" => {
            let what = path.unwrap_or_else(|| input.get("pattern").and_then(|v| v.as_str()).unwrap_or(""));
            ("read".into(), format!("{name} {what}").trim().to_string(), None)
        }
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" | "Update" => {
            ("edit".into(), format!("Edited {}", path.unwrap_or("file")), None)
        }
        "Bash" => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            ("msg".into(), format!("Running `{}`", first_line(cmd, 80)), Some(cmd.to_string()))
        }
        _ => ("msg".into(), format!("Using {name}"), None),
    }
}

/// A short, human command/summary for the permission card.
fn permission_summary(tool: &str, input: &Value) -> String {
    match tool {
        "Bash" => input.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        _ => {
            if let Some(p) = input.get("file_path").or_else(|| input.get("path")).and_then(|v| v.as_str()) {
                format!("{tool} {p}")
            } else {
                tool.to_string()
            }
        }
    }
}

/// Headless argv for the streaming Claude protocol. The prompt is delivered as a
/// stream-json user message on stdin (not argv), so it can't be shell-injected.
fn claude_stream_argv() -> Vec<String> {
    vec![
        "-p".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--permission-prompt-tool".into(),
        "stdio".into(),
        "--permission-mode".into(),
        "default".into(),
    ]
}

/// Resolve (and, for the worktree mode, create) the directory the agent runs in.
/// Worktree mode mirrors `actions::run_agent` isolation (checked out on the branch
/// so commits advance it, node_modules symlinked); direct mode runs in the repo's
/// own working tree so edits are live where the user sees them.
fn prepare_workdir(repo: &str, branch: &str, use_worktree: bool) -> R<String> {
    if !use_worktree {
        return Ok(repo.to_string());
    }
    let wt = std::env::temp_dir().join(format!("locke-run-{}", sanitize(branch)));
    let wt_str = wt.to_string_lossy().to_string();
    let _ = run_git(repo, &["worktree", "remove", "--force", &wt_str]);
    let _ = std::fs::remove_dir_all(&wt);
    run_git(repo, &["worktree", "add", &wt_str, branch])
        .map_err(|e| format!("create worktree for {branch} (checked out elsewhere?): {e}"))?;
    #[cfg(unix)]
    {
        let nm = Path::new(repo).join("node_modules");
        if nm.exists() && !wt.join("node_modules").exists() {
            let _ = std::os::unix::fs::symlink(&nm, wt.join("node_modules"));
        }
    }
    Ok(wt_str)
}

/// Start a live streaming Claude run. Returns immediately; events stream to the
/// frontend via Tauri events (`run:event`, `run:permission`, `run:done`) keyed by
/// `run_id`. The agent edits in `workdir` (the repo or an isolated worktree); on a
/// clean finish in worktree mode, Locke commits whatever was left onto the branch.
#[allow(clippy::too_many_arguments)]
pub fn start_run(
    app: AppHandle,
    registry: &RunRegistry,
    run_id: String,
    repo: String,
    branch: String,
    agent_cmd: String,
    prompt: String,
    use_worktree: bool,
) -> R<()> {
    let workdir = prepare_workdir(&repo, &branch, use_worktree)?;

    let mut child = Command::new(&agent_cmd)
        .args(claude_stream_argv())
        .current_dir(&workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            // Best-effort worktree cleanup if the agent never launched.
            if use_worktree {
                let _ = run_git(&repo, &["worktree", "remove", "--force", &workdir]);
            }
            format!("could not start {agent_cmd}: {e}")
        })?;

    let mut stdin = child.stdin.take().ok_or("no stdin handle")?;
    let stdout = child.stdout.take().ok_or("no stdout handle")?;

    // Deliver the prompt as the first stream-json user message.
    let user_msg = json!({ "type": "user", "message": { "role": "user", "content": prompt } });
    writeln!(stdin, "{user_msg}").map_err(|e| format!("write prompt: {e}"))?;
    stdin.flush().ok();

    registry.0.lock().unwrap().insert(
        run_id.clone(),
        RunSlot {
            child,
            stdin: Some(stdin),
            repo: repo.clone(),
            branch: branch.clone(),
            workdir: workdir.clone(),
            use_worktree,
            canceled: false,
        },
    );

    // Reader thread: parse stdout, emit UI events, accumulate the run log, then
    // finalize (commit + persist) on EOF.
    let start = Instant::now();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut events: Vec<Value> = Vec::new();
        let mut n = 0usize;
        let mut result_text = String::new();
        let mut perm_count = 0u32;

        let emit = |app: &AppHandle, events: &mut Vec<Value>, n: &mut usize, kind: &str, text: String, sub: Option<String>| {
            *n += 1;
            let key = format!("e{n}");
            let time = elapsed_str(start);
            let payload = EventPayload { run_id: run_id.clone(), key: key.clone(), kind: kind.into(), text: text.clone(), sub: sub.clone(), time: time.clone() };
            events.push(json!({ "key": key, "kind": kind, "text": text, "sub": sub, "time": time }));
            let _ = app.emit("run:event", payload);
        };

        for line in reader.lines() {
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
                                        emit(&app, &mut events, &mut n, "msg", t.to_string(), None);
                                    }
                                }
                                Some("tool_use") => {
                                    let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                                    let empty = json!({});
                                    let input = b.get("input").unwrap_or(&empty);
                                    let (kind, text, sub) = tool_event(name, input);
                                    emit(&app, &mut events, &mut n, &kind, text, sub);
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Some("user") => {
                    if let Some(blocks) = d.pointer("/message/content").and_then(|v| v.as_array()) {
                        for b in blocks {
                            if b.get("type").and_then(|v| v.as_str()) == Some("tool_result") {
                                let content = b.get("content");
                                let text = match content {
                                    Some(Value::String(s)) => s.clone(),
                                    Some(Value::Array(arr)) => arr
                                        .iter()
                                        .filter_map(|x| x.get("text").and_then(|v| v.as_str()))
                                        .collect::<Vec<_>>()
                                        .join("\n"),
                                    _ => String::new(),
                                };
                                let is_err = b.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                                let summary = first_line(&text, 120);
                                if !summary.is_empty() {
                                    let kind = if is_err { "denied" } else { "result" };
                                    emit(&app, &mut events, &mut n, kind, summary, None);
                                }
                            }
                        }
                    }
                }
                Some("control_request") => {
                    if d.pointer("/request/subtype").and_then(|v| v.as_str()) == Some("can_use_tool") {
                        perm_count += 1;
                        let req_id = d.get("request_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let tool = d.pointer("/request/tool_name").and_then(|v| v.as_str()).unwrap_or("tool").to_string();
                        let empty = json!({});
                        let input = d.pointer("/request/input").unwrap_or(&empty);
                        let why = d.pointer("/request/description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let suggestions = d.pointer("/request/permission_suggestions").cloned().unwrap_or(json!([]));
                        let _ = app.emit(
                            "run:permission",
                            PermissionPayload {
                                run_id: run_id.clone(),
                                request_id: req_id,
                                tool: tool.clone(),
                                cmd: permission_summary(&tool, input),
                                why,
                                scope: if use_worktree { "isolated worktree".into() } else { "repo working dir".into() },
                                suggestions,
                            },
                        );
                    }
                }
                Some("result") => {
                    result_text = d.get("result").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    // The single turn is done; close stdin so the CLI exits.
                    if let Some(slot) = app.state::<RunRegistry>().0.lock().unwrap().get_mut(&run_id) {
                        slot.stdin = None;
                    }
                }
                _ => {}
            }
        }

        // Reader hit EOF: the process has ended (cleanly, by result, or by kill).
        finalize(&app, &run_id, start, events, result_text, perm_count);
    });

    Ok(())
}

/// Commit (worktree mode) and persist the run when its stream ends.
fn finalize(app: &AppHandle, run_id: &str, start: Instant, events: Vec<Value>, result_text: String, perm_count: u32) {
    let registry = app.state::<RunRegistry>();
    let Some(mut slot) = registry.0.lock().unwrap().remove(run_id) else { return };
    let _ = slot.stdin.take(); // ensure stdin closed
    let status = slot.child.wait();
    let canceled = slot.canceled;

    let state = if canceled {
        "canceled"
    } else if status.map(|s| s.success()).unwrap_or(false) {
        "done"
    } else {
        "failed"
    };

    // On a clean worktree run, persist whatever the agent left onto the branch
    // (no-op if it already committed or changed nothing), then tear the worktree
    // down. Direct-dir runs leave edits in place for the user to review.
    if slot.use_worktree {
        if state == "done" {
            let _ = run_git(&slot.workdir, &["add", "-A"]);
            let _ = run_git(&slot.workdir, &["commit", "-m", "agent: streaming run"]);
        }
        let _ = run_git(&slot.repo, &["worktree", "remove", "--force", &slot.workdir]);
        let _ = std::fs::remove_dir_all(&slot.workdir);
        let _ = run_git(&slot.repo, &["worktree", "prune"]);
    }

    let duration = elapsed_str(start);
    let record = json!({
        "runId": run_id,
        "branch": slot.branch,
        "agent": "Claude",
        "startedAt": now_secs().saturating_sub(start.elapsed().as_secs()),
        "endedAt": now_secs(),
        "duration": duration,
        "state": state,
        "permissions": perm_count,
        "result": result_text,
        "events": events,
    });
    let _ = crate::store::write_run(&slot.repo, run_id, &record);

    let _ = app.emit(
        "run:done",
        DonePayload {
            run_id: run_id.to_string(),
            state: state.to_string(),
            result: result_text,
            duration,
            branch: slot.branch.clone(),
        },
    );
}

/// Answer a pending tool-permission prompt by writing a `control_response` on the
/// run's stdin. `allow=false` denies with an optional message.
pub fn respond_permission(
    registry: &RunRegistry,
    run_id: &str,
    request_id: &str,
    allow: bool,
    updated_input: Option<Value>,
    message: Option<String>,
) -> R<()> {
    let mut guard = registry.0.lock().unwrap();
    let slot = guard.get_mut(run_id).ok_or("run not found")?;
    let stdin = slot.stdin.as_mut().ok_or("run stdin closed")?;
    let inner = if allow {
        json!({ "behavior": "allow", "updatedInput": updated_input.unwrap_or(json!({})) })
    } else {
        json!({ "behavior": "deny", "message": message.unwrap_or_else(|| "Denied by reviewer".into()) })
    };
    let resp = json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": inner }
    });
    writeln!(stdin, "{resp}").map_err(|e| format!("write control_response: {e}"))?;
    stdin.flush().map_err(|e| format!("flush: {e}"))
}

/// Cancel an in-flight run: mark it cancelled (so finalize skips the commit) and
/// kill the child. The reader thread then hits EOF and finalizes.
pub fn cancel_run(registry: &RunRegistry, run_id: &str) -> R<()> {
    let mut guard = registry.0.lock().unwrap();
    let slot = guard.get_mut(run_id).ok_or("run not found")?;
    slot.canceled = true;
    slot.child.kill().map_err(|e| format!("kill: {e}"))
}
