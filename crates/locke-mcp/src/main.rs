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
