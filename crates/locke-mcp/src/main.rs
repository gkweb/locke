//! Locke MCP server.
//!
//! Exposes Locke's local pull-request system to any MCP client over the MCP
//! **stdio transport**: newline-delimited JSON-RPC 2.0, one complete message per
//! line, requests/responses on stdin/stdout and logs on stderr. No async runtime
//! — a blocking read loop, mirroring `run.rs`'s newline-delimited JSON handling.
//!
//! The target repo is discovered from the process working directory (the dir the
//! MCP client launched us in): walk up to the nearest ancestor containing
//! `.locke/`, falling back to the git root (`.git`). `$LOCKE_REPO` overrides this,
//! and `$LOCKE_AGENT` sets the author attribution for writes (default "agent").

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

/// MCP protocol version we default to when a client doesn't request one. We echo
/// the client's requested version back when present (forward/backward compatible).
const DEFAULT_PROTOCOL: &str = "2024-11-05";

fn main() {
    let repo = discover_repo();
    let agent = std::env::var("LOCKE_AGENT").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "agent".into());
    match &repo {
        Some(r) => eprintln!("locke-mcp: serving repo {r} as author '{agent}'"),
        None => eprintln!("locke-mcp: no Locke repo found from CWD or $LOCKE_REPO — tools will error until one is set"),
    }

    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            // Unparseable line: emit a JSON-RPC parse error with null id.
            write_msg(&mut out, &error_response(Value::Null, -32700, "parse error"));
            continue;
        };

        // Notifications have no `id` and never get a response.
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

        let response = match method {
            "initialize" => Some(handle_initialize(&msg, id.clone())),
            "tools/list" => Some(ok(id.clone(), tools_list())),
            "tools/call" => Some(handle_tools_call(&msg, id.clone(), repo.as_deref(), &agent)),
            "ping" => Some(ok(id.clone(), json!({}))),
            // Notifications (e.g. notifications/initialized) and anything else with
            // no id: ack silently. Unknown *requests* (with an id) get an error.
            _ => {
                if id.is_some() {
                    Some(error_response(id.clone().unwrap_or(Value::Null), -32601, &format!("method not found: {method}")))
                } else {
                    None
                }
            }
        };

        if let Some(resp) = response {
            write_msg(&mut out, &resp);
        }
    }
}

// ---- repo discovery ----

/// Resolve the target repo: `$LOCKE_REPO` if set, else walk up from the working
/// directory to the nearest ancestor that has a `.locke/` dir or a `.git` entry.
fn discover_repo() -> Option<String> {
    if let Ok(r) = std::env::var("LOCKE_REPO") {
        if !r.is_empty() {
            return Some(r);
        }
    }
    let mut dir = std::env::current_dir().ok()?;
    loop {
        if dir.join(".locke").is_dir() || dir.join(".git").exists() {
            return Some(dir.to_string_lossy().into_owned());
        }
        if !dir.pop() {
            return None;
        }
    }
}

// ---- JSON-RPC framing ----

fn write_msg(out: &mut impl Write, msg: &Value) {
    // One JSON object per line (MCP stdio framing); flush so the client sees it.
    let _ = writeln!(out, "{msg}");
    let _ = out.flush();
}

fn ok(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "result": result })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

// ---- MCP lifecycle ----

fn handle_initialize(msg: &Value, id: Option<Value>) -> Value {
    let protocol = msg
        .pointer("/params/protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_PROTOCOL)
        .to_string();
    ok(
        id,
        json!({
            "protocolVersion": protocol,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "locke", "version": env!("CARGO_PKG_VERSION") }
        }),
    )
}

// ---- tools/list ----

fn tools_list() -> Value {
    json!({ "tools": [
        {
            "name": "open_pull_request",
            "description": "Open a new local pull request in Locke for a head branch reviewed against a base branch. Returns the created pull (with its numeric id).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "branch": { "type": "string", "description": "Head branch to review." },
                    "base": { "type": "string", "description": "Base branch to review against." },
                    "title": { "type": "string", "description": "Pull request title." },
                    "body": { "type": "string", "description": "Optional description / body." }
                },
                "required": ["branch", "base", "title"]
            }
        },
        {
            "name": "list_pull_requests",
            "description": "List local pull requests, newest id first. Optionally filter by status (e.g. ready, merged).",
            "inputSchema": {
                "type": "object",
                "properties": { "status": { "type": "string", "description": "Optional status filter." } }
            }
        },
        {
            "name": "get_pull_request",
            "description": "Get one pull request by id, including its comment threads.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "integer", "description": "Pull request id." } },
                "required": ["id"]
            }
        },
        {
            "name": "list_comments",
            "description": "List the comment threads on a pull request (line-anchored discussion and change requests).",
            "inputSchema": {
                "type": "object",
                "properties": { "pull_id": { "type": "integer", "description": "Pull request id." } },
                "required": ["pull_id"]
            }
        },
        {
            "name": "reply_to_comment",
            "description": "Reply to a comment thread on a pull request. The reply is attributed to this agent and marked as an agent comment.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pull_id": { "type": "integer", "description": "Pull request id." },
                    "thread_id": { "type": "integer", "description": "Thread id within the pull's comments." },
                    "body": { "type": "string", "description": "Reply text." }
                },
                "required": ["pull_id", "thread_id", "body"]
            }
        },
        {
            "name": "get_history",
            "description": "View run history across pull requests, newest first. Pass a pull id to scope history to that PR's branch; omit it for the full cross-PR timeline.",
            "inputSchema": {
                "type": "object",
                "properties": { "pull_id": { "type": "integer", "description": "Optional pull id to scope history to its branch." } }
            }
        },
        {
            "name": "loop_item_complete",
            "description": "Declare THIS loop item done. Call this only once the change is finished and its tests pass. Locke gates committing the item on this call plus its checks passing; without it the item is routed to human review. Persists a structured result record carried to the next step.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loop_id": { "type": "string", "description": "The loop id (given in your task prompt)." },
                    "file": { "type": "string", "description": "The repo-relative file this item is migrating (given in your task prompt)." },
                    "summary": { "type": "string", "description": "One-line summary of what you changed." },
                    "artifacts": { "type": "array", "items": { "type": "string" }, "description": "Optional files/tests touched." }
                },
                "required": ["loop_id", "file", "summary"]
            }
        },
        {
            "name": "loop_item_needs_review",
            "description": "Flag THIS loop item for human review instead of completing it. Use when you are uncertain, a decision needs the human, or the change can't be made safely. The item will NOT be committed; your reason is shown to the reviewer.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loop_id": { "type": "string", "description": "The loop id (given in your task prompt)." },
                    "file": { "type": "string", "description": "The repo-relative file this item is migrating." },
                    "reason": { "type": "string", "description": "Why this needs a human's call." }
                },
                "required": ["loop_id", "file", "reason"]
            }
        },
        {
            "name": "loop_write_note",
            "description": "Persist a durable note/decision on THIS loop item that carries forward to a re-queue or the next loop (e.g. an assumption you made or a follow-up).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loop_id": { "type": "string", "description": "The loop id." },
                    "file": { "type": "string", "description": "The repo-relative file." },
                    "note": { "type": "string", "description": "The note to persist." }
                },
                "required": ["loop_id", "file", "note"]
            }
        },
        {
            "name": "loop_read_spec",
            "description": "Read the pre-written spec for THIS loop item (objective, planned steps, tests), if the loop creator produced one. Returns the spec markdown or a note that none exists.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loop_id": { "type": "string", "description": "The loop id." },
                    "file": { "type": "string", "description": "The repo-relative file." }
                },
                "required": ["loop_id", "file"]
            }
        },
        {
            "name": "loop_write_spec",
            "description": "Plan mode (strategist): write the per-item spec for THIS loop item. Call this exactly once, after analysing the file, with how the build worker should change it. Persists the spec (so the later build reads it) and marks the item specced. If a human decision is needed before the build can proceed, set needs_review=true with a reason instead of guessing — the item is shown for the creator's call.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loop_id": { "type": "string", "description": "The loop id (given in your task prompt)." },
                    "file": { "type": "string", "description": "The repo-relative file this spec is for (given in your task prompt)." },
                    "spec": { "type": "string", "description": "The full per-item spec as markdown — objective, the concrete edits, and how to verify. This is handed verbatim to the build worker." },
                    "approach": { "type": "string", "description": "Optional short id for the chosen strategy (e.g. \"script-setup\")." },
                    "detected": { "type": "array", "items": { "type": "string" }, "description": "Optional short tags for what you found in the file (e.g. \"Options API\", \"Vuex getter\")." },
                    "steps": { "type": "array", "items": { "type": "string" }, "description": "Optional ordered list of the concrete edits the build will make." },
                    "tests": { "type": "array", "items": { "type": "string" }, "description": "Optional tests/checks that must pass for this item." },
                    "note": { "type": "string", "description": "Optional caveat/decision for the reviewer or build worker." },
                    "needs_review": { "type": "boolean", "description": "Set true when a human must decide before this item can be built; pair with `note` as the reason." },
                    "requires": { "type": "array", "items": { "type": "string" }, "description": "Optional ids of work-graph nodes (file paths or task ids) that must finish before this item runs. Use to pin a prerequisite for this specific file." },
                    "priority": { "type": "integer", "description": "Optional ordering within the ready set (higher runs first). Default 0." }
                },
                "required": ["loop_id", "file", "spec"]
            }
        },
        {
            "name": "loop_add_task",
            "description": "Plan mode (strategist): add a prerequisite or custom TASK to the loop's work graph — a unit of work that isn't one of the resolver's files (e.g. \"create the shared composable\", \"add the dependency\", \"write the codemod\"). The task runs as its own agent job in dependency order. Use `blocks` to make the resolver files that depend on it wait until it's done. The human reviews the graph before the build runs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loop_id": { "type": "string", "description": "The loop id (given in your task prompt)." },
                    "id": { "type": "string", "description": "Stable slug id for this task node (e.g. \"add-use-cart\"). Other nodes reference it in `requires`." },
                    "title": { "type": "string", "description": "Short human-readable title for the task." },
                    "spec": { "type": "string", "description": "The task spec as markdown — objective, the concrete work, and how to verify. Handed verbatim to the agent that runs the task." },
                    "requires": { "type": "array", "items": { "type": "string" }, "description": "Optional ids of other tasks that must finish before this one runs." },
                    "blocks": { "description": "Optional: the file items that depend on this task — a glob (e.g. \"src/components/**/*.vue\") or an array of repo-relative paths. Each matching in-scope file gains a `requires` edge to this task.", "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ] },
                    "priority": { "type": "integer", "description": "Optional ordering within the ready set (higher runs first). Default 0." },
                    "note": { "type": "string", "description": "Optional caveat/decision for the reviewer." }
                },
                "required": ["loop_id", "id", "title", "spec"]
            }
        },
        {
            "name": "loop_write_plan",
            "description": "Plan mode (strategist): write the loop's GLOBAL plan once, before/while speccing items. `plan` is markdown conventions handed to every build worker (objective, shared rules). `assumptions` and `summary` populate the Plan view's Scope tab. Call this once for the whole loop, not per item.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "loop_id": { "type": "string", "description": "The loop id (given in your task prompt)." },
                    "plan": { "type": "string", "description": "Global plan / conventions as markdown — injected into every build worker's prompt." },
                    "assumptions": { "type": "array", "items": { "type": "string" }, "description": "Assumptions the loop is making, shown to the creator before they approve." },
                    "summary": { "type": "array", "items": { "type": "object", "properties": { "label": { "type": "string" }, "detail": { "type": "string" }, "pend": { "type": "boolean" } }, "required": ["label", "detail"] }, "description": "Optional dry-run summary rows (what the loop will do across the set). `pend=true` flags a row still awaiting a decision." }
                },
                "required": ["loop_id", "plan"]
            }
        }
    ]})
}

// ---- tools/call ----

fn handle_tools_call(msg: &Value, id: Option<Value>, repo: Option<&str>, agent: &str) -> Value {
    let name = msg.pointer("/params/name").and_then(|v| v.as_str()).unwrap_or("");
    let args = msg.pointer("/params/arguments").cloned().unwrap_or_else(|| json!({}));

    let Some(repo) = repo else {
        log_call("?", agent, name, &args, false, Some("no Locke repo found"));
        return ok(id, tool_error("No Locke repo found. Run the client inside a repository (one containing .git or .locke), or set $LOCKE_REPO."));
    };

    let result = match name {
        "open_pull_request" => tool_open_pull_request(repo, agent, &args),
        "list_pull_requests" => tool_list_pull_requests(repo, &args),
        "get_pull_request" => tool_get_pull_request(repo, &args),
        "list_comments" => tool_list_comments(repo, &args),
        "reply_to_comment" => tool_reply_to_comment(repo, agent, &args),
        "get_history" => tool_get_history(repo, &args),
        "loop_item_complete" => tool_loop_item_complete(repo, &args),
        "loop_item_needs_review" => tool_loop_item_needs_review(repo, &args),
        "loop_write_note" => tool_loop_write_note(repo, &args),
        "loop_read_spec" => tool_loop_read_spec(repo, &args),
        "loop_write_spec" => tool_loop_write_spec(repo, &args),
        "loop_write_plan" => tool_loop_write_plan(repo, &args),
        "loop_add_task" => tool_loop_add_task(repo, &args),
        other => Err(format!("unknown tool: {other}")),
    };

    log_call(repo, agent, name, &args, result.is_ok(), result.as_ref().err().map(|s| s.as_str()));

    match result {
        Ok(value) => ok(id, tool_text(&serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()))),
        Err(e) => ok(id, tool_error(&e)),
    }
}

// ---- debug call log (~/.locke/mcp-log.jsonl) ----

/// App-global JSONL log of MCP tool calls, for the Settings → Integrations debug
/// view. App-global (home dir, not per-repo) so the page shows calls from every
/// repo without a repo needing to be open, and so the standalone binary can
/// compute the path without Tauri. Best-effort: logging never fails a tool call.
fn log_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".locke").join("mcp-log.jsonl"))
}

fn log_call(repo: &str, agent: &str, tool: &str, args: &Value, ok: bool, error: Option<&str>) {
    let Some(path) = log_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let entry = json!({
        "time": locke_store::now_iso(),
        "tool": tool,
        "agent": agent,
        "repo": repo,
        "args": args,
        "ok": ok,
        "error": error,
    });
    // Append one line. O_APPEND keeps concurrent writers from interleaving lines.
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{entry}");
    }
}

/// A successful tool result carrying a single text block.
fn tool_text(text: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": text }] })
}

/// A tool-level error result (MCP convention: a normal result with isError=true so
/// the model sees the failure, rather than a transport-level JSON-RPC error).
fn tool_error(text: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": true })
}

// ---- tool implementations (all backed by locke-store) ----

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key).and_then(|v| v.as_str()).ok_or_else(|| format!("missing required string argument `{key}`"))
}

fn arg_u64(args: &Value, key: &str) -> Result<u64, String> {
    args.get(key).and_then(|v| v.as_u64()).ok_or_else(|| format!("missing required integer argument `{key}`"))
}

fn tool_open_pull_request(repo: &str, agent: &str, args: &Value) -> Result<Value, String> {
    let branch = arg_str(args, "branch")?;
    let base = arg_str(args, "base")?;
    let title = arg_str(args, "title")?;
    let body = args.get("body").and_then(|v| v.as_str()).unwrap_or("");

    let mut pull = locke_store::create_pull(repo, branch, base, title, agent, true)?;
    if !body.is_empty() {
        pull.body = body.to_string();
        locke_store::update_pull(repo, pull.clone())?;
    }
    serde_json::to_value(&pull).map_err(|e| format!("serialize pull: {e}"))
}

fn tool_list_pull_requests(repo: &str, args: &Value) -> Result<Value, String> {
    let status = args.get("status").and_then(|v| v.as_str());
    let store = locke_store::read_pulls(repo)?;
    let pulls: Vec<_> = store
        .pulls
        .into_iter()
        .filter(|p| status.map(|s| p.status == s).unwrap_or(true))
        .rev() // newest id first
        .collect();
    serde_json::to_value(&pulls).map_err(|e| format!("serialize pulls: {e}"))
}

fn tool_get_pull_request(repo: &str, args: &Value) -> Result<Value, String> {
    let id = arg_u64(args, "id")?;
    let store = locke_store::read_pulls(repo)?;
    let pull = store.pulls.into_iter().find(|p| p.id == id).ok_or_else(|| format!("pull {id} not found"))?;
    let comments = locke_store::read_comments(repo, id)?.unwrap_or_else(|| json!({ "threads": [] }));
    Ok(json!({ "pull": pull, "comments": comments }))
}

fn tool_list_comments(repo: &str, args: &Value) -> Result<Value, String> {
    let pull_id = arg_u64(args, "pull_id")?;
    Ok(locke_store::read_comments(repo, pull_id)?.unwrap_or_else(|| json!({ "threads": [] })))
}

fn tool_reply_to_comment(repo: &str, agent: &str, args: &Value) -> Result<Value, String> {
    let pull_id = arg_u64(args, "pull_id")?;
    let thread_id = arg_u64(args, "thread_id")?;
    let body = arg_str(args, "body")?;

    let item = json!({
        "author": agent,
        "initials": initials(agent),
        "isAgent": true,
        "roleLabel": "AGENT",
        "time": "just now",
        "body": body,
    });
    locke_store::append_comment_item(repo, pull_id, thread_id, item)?;
    Ok(json!({ "ok": true, "pullId": pull_id, "threadId": thread_id }))
}

fn tool_get_history(repo: &str, args: &Value) -> Result<Value, String> {
    let runs = locke_store::read_runs(repo)?; // newest first
    let scoped = match args.get("pull_id").and_then(|v| v.as_u64()) {
        Some(id) => {
            let store = locke_store::read_pulls(repo)?;
            let branch = store
                .pulls
                .into_iter()
                .find(|p| p.id == id)
                .map(|p| p.branch)
                .ok_or_else(|| format!("pull {id} not found"))?;
            runs.into_iter()
                .filter(|r| r.get("branch").and_then(|v| v.as_str()) == Some(branch.as_str()))
                .collect::<Vec<_>>()
        }
        None => runs,
    };
    Ok(Value::Array(scoped))
}

// ---- loop item tools (backed by the .locke/loops/<id>/ tree) ----

fn tool_loop_item_complete(repo: &str, args: &Value) -> Result<Value, String> {
    let loop_id = arg_str(args, "loop_id")?;
    let file = arg_str(args, "file")?;
    let summary = arg_str(args, "summary")?;
    let artifacts = args.get("artifacts").cloned().unwrap_or_else(|| json!([]));
    locke_store::merge_loop_item(
        repo,
        loop_id,
        file,
        json!({ "declared": "complete", "summary": summary, "artifacts": artifacts }),
    )?;
    Ok(json!({ "ok": true, "declared": "complete", "loopId": loop_id, "file": file }))
}

fn tool_loop_item_needs_review(repo: &str, args: &Value) -> Result<Value, String> {
    let loop_id = arg_str(args, "loop_id")?;
    let file = arg_str(args, "file")?;
    let reason = arg_str(args, "reason")?;
    locke_store::merge_loop_item(
        repo,
        loop_id,
        file,
        json!({ "declared": "needs_review", "reason": reason }),
    )?;
    Ok(json!({ "ok": true, "declared": "needs_review", "loopId": loop_id, "file": file }))
}

fn tool_loop_write_note(repo: &str, args: &Value) -> Result<Value, String> {
    let loop_id = arg_str(args, "loop_id")?;
    let file = arg_str(args, "file")?;
    let note = arg_str(args, "note")?;
    locke_store::append_loop_note(repo, loop_id, file, note)?;
    Ok(json!({ "ok": true, "loopId": loop_id, "file": file }))
}

fn tool_loop_read_spec(repo: &str, args: &Value) -> Result<Value, String> {
    let loop_id = arg_str(args, "loop_id")?;
    let file = arg_str(args, "file")?;
    match locke_store::read_loop_spec(repo, loop_id, file)? {
        Some(spec) => Ok(json!({ "file": file, "spec": spec })),
        None => Ok(json!({ "file": file, "spec": null, "note": "No spec was written for this item; use the task prompt." })),
    }
}

/// Optional `string[]` argument → owned `Vec<String>` (missing/wrong-typed → empty).
fn arg_str_vec(args: &Value, key: &str) -> Vec<String> {
    args.get(key)
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn tool_loop_write_spec(repo: &str, args: &Value) -> Result<Value, String> {
    let loop_id = arg_str(args, "loop_id")?;
    let file = arg_str(args, "file")?;
    let spec = arg_str(args, "spec")?;
    let approach = args.get("approach").and_then(|v| v.as_str()).map(String::from);
    let detected = arg_str_vec(args, "detected");
    let steps = arg_str_vec(args, "steps");
    let tests = arg_str_vec(args, "tests");
    let note = args.get("note").and_then(|v| v.as_str()).map(String::from);
    let needs_review = args.get("needs_review").and_then(|v| v.as_bool()).unwrap_or(false);
    let status = if needs_review { "review" } else { "specced" };
    // Optional dependency/order the strategist pins on this file item in the same call.
    let requires = arg_str_vec(args, "requires");
    let priority = args.get("priority").and_then(|v| v.as_i64());

    // Persist the markdown spec the build worker reads, then enrich the manifest row
    // (the build's source of truth) without clobbering a concurrent worker's row.
    locke_store::write_loop_spec(repo, loop_id, file, spec)?;
    let spec_ref = format!("spec/{}.md", locke_store::sanitize_path(file));
    let approach_c = approach.clone();
    let note_c = note.clone();
    locke_store::merge_loop_manifest_entry(repo, loop_id, file, |e| {
        e.approach = approach_c;
        e.detected = detected;
        e.steps = steps;
        e.tests = tests;
        e.note = note_c;
        e.spec = Some(spec_ref);
        e.status = status.to_string();
        if !requires.is_empty() {
            e.requires = requires;
        }
        if let Some(p) = priority {
            e.priority = p;
        }
    })?;
    // Record the per-item declaration the strategist runner gates on (mirrors the
    // build worker's complete/needs_review contract).
    locke_store::merge_loop_item(
        repo,
        loop_id,
        file,
        json!({ "declared": if needs_review { "review" } else { "specced" }, "reason": note }),
    )?;
    Ok(json!({ "ok": true, "status": status, "loopId": loop_id, "file": file }))
}

fn tool_loop_write_plan(repo: &str, args: &Value) -> Result<Value, String> {
    let loop_id = arg_str(args, "loop_id")?;
    let plan = arg_str(args, "plan")?;
    let assumptions = arg_str_vec(args, "assumptions");
    let summary = args.get("summary").cloned().unwrap_or_else(|| json!([]));
    // Human-readable conventions (injected into every build worker via `{{conventions}}`)
    // plus the structured scope metadata the Plan view's Scope tab renders.
    locke_store::write_loop_plan(repo, loop_id, plan)?;
    locke_store::write_loop_plan_meta(repo, loop_id, &json!({ "summary": summary, "assumptions": assumptions }))?;
    Ok(json!({ "ok": true, "loopId": loop_id }))
}

fn tool_loop_add_task(repo: &str, args: &Value) -> Result<Value, String> {
    let loop_id = arg_str(args, "loop_id")?;
    let id = arg_str(args, "id")?;
    let title = arg_str(args, "title")?;
    let spec = arg_str(args, "spec")?;
    let requires = arg_str_vec(args, "requires");
    let priority = args.get("priority").and_then(|v| v.as_i64()).unwrap_or(0);
    let note = args.get("note").and_then(|v| v.as_str()).map(String::from);
    // `blocks` is a glob OR a list of repo-relative paths: the file items that should
    // depend on this task. One call fans the edge across the whole matching set.
    let blocks: Vec<String> = match args.get("blocks") {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(_)) => arg_str_vec(args, "blocks"),
        _ => Vec::new(),
    };

    // The task carries its own spec (born `specced`), so the build worker's
    // `loop_read_spec` finds it and the planning pass needn't re-spec it.
    let spec_ref = format!("spec/{}.md", locke_store::sanitize_path(id));
    locke_store::write_loop_spec(repo, loop_id, id, spec)?;

    let id_for_node = id.to_string();
    let title_c = title.to_string();
    let note_c = note.clone();
    let mut linked = 0usize;
    locke_store::update_loop_manifest(repo, loop_id, |entries| {
        // Upsert the task node (keyed by id).
        if let Some(e) = entries.iter_mut().find(|e| !e.id.is_empty() && e.id == id_for_node) {
            e.kind = "task".into();
            e.title = Some(title_c);
            e.requires = requires;
            e.priority = priority;
            e.note = note_c;
            e.spec = Some(spec_ref);
            e.status = "specced".into();
            e.inc = true;
            if e.origin.is_empty() {
                e.origin = "model".into();
            }
        } else {
            entries.push(locke_store::ManifestEntry {
                id: id_for_node.clone(),
                kind: "task".into(),
                title: Some(title_c),
                requires,
                priority,
                note: note_c,
                spec: Some(spec_ref),
                status: "specced".into(),
                inc: true,
                origin: "model".into(),
                ..Default::default()
            });
        }
        // Fan the `requires` edge across every in-scope file row the task blocks.
        for e in entries.iter_mut() {
            if e.kind == "task" {
                continue;
            }
            let matches = blocks.iter().any(|b| b == &e.path || locke_store::glob_match(b, &e.path));
            if matches && !e.requires.iter().any(|r| r == &id_for_node) {
                e.requires.push(id_for_node.clone());
                linked += 1;
            }
        }
    })?;

    Ok(json!({ "ok": true, "loopId": loop_id, "id": id, "title": title, "linked": linked }))
}

/// Up-to-two-letter uppercase initials for the comment badge, mirroring the UI's
/// `CommentItem.initials` convention (e.g. "You" -> "YO").
fn initials(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let raw: String = if words.len() >= 2 {
        words.iter().take(2).filter_map(|w| w.chars().next()).collect()
    } else {
        name.chars().take(2).collect()
    };
    raw.to_uppercase()
}
