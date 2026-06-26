// Install/uninstall/status for the Locke MCP server (`locke-mcp`).
//
// The MCP server is launched by whichever MCP *client* connects to it (e.g. the
// user's own Claude Code), not by Locke — so Locke never runs it. Locke's only
// jobs are to locate the shipped `locke-mcp` binary and, on the user's explicit
// click, register it in the client's config via `claude mcp add`. The server then
// discovers the target repo from the client's working directory (see locke-mcp).

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

/// Locate the bundled `locke-mcp` binary. Works in dev and in a packaged app:
/// 1. next to the running executable — dev (`target/<profile>/locke-mcp`) and a
///    bundled app (Tauri copies an `externalBin` into the app's binary dir);
/// 2. the Tauri resource dir, as a fallback;
/// 3. `PATH` + well-known install dirs (same search agents use).
/// Returns `None` if it can't be found anywhere.
pub fn binary_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join("locke-mcp");
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    if let Ok(res) = app.path().resource_dir() {
        let cand = res.join("locke-mcp");
        if cand.is_file() {
            return Some(cand);
        }
    }
    let p = crate::actions::resolve_agent_path("locke-mcp");
    if Path::new(&p).is_file() {
        return Some(PathBuf::from(p));
    }
    None
}

/// Resolve the Claude Code CLI (`claude`) full path, or `None` if not installed.
fn claude_bin() -> Option<String> {
    let p = crate::actions::resolve_agent_path("claude");
    if Path::new(&p).is_file() {
        Some(p)
    } else {
        None
    }
}

/// The config snippet for registering Locke in any MCP client. No `LOCKE_REPO` —
/// the server discovers the repo from the client's working directory.
fn snippet(bin: &str) -> Value {
    json!({ "mcpServers": { "locke": { "command": bin } } })
}

/// Report whether the `locke` server is registered in Claude Code, plus the data
/// the Settings UI needs: the resolved binary path, whether `claude` is available,
/// and a copy-able config snippet for other MCP clients.
pub fn status(app: &AppHandle) -> Value {
    let bin = binary_path(app);
    let bin_str = bin.as_ref().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let claude = claude_bin();
    let installed = claude
        .as_ref()
        .and_then(|c| Command::new(c).args(["mcp", "get", "locke"]).output().ok())
        .map(|o| o.status.success())
        .unwrap_or(false);
    json!({
        "installed": installed,
        "binaryAvailable": bin.is_some(),
        "binaryPath": bin_str,
        "claudeAvailable": claude.is_some(),
        "snippet": snippet(&bin_str),
    })
}

/// Register `locke-mcp` in Claude Code at user scope: `claude mcp add --scope user
/// locke -- <binary>`. User-initiated; errors if the binary or `claude` is missing.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let bin = binary_path(app).ok_or("locke-mcp binary not found alongside the app")?;
    let claude = claude_bin().ok_or("Claude Code CLI (`claude`) not found on PATH")?;
    let out = Command::new(&claude)
        .args(["mcp", "add", "--scope", "user", "locke", "--"])
        .arg(&bin)
        .output()
        .map_err(|e| format!("run `claude mcp add`: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("`claude mcp add` failed: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

// ---- debug call log (~/.locke/mcp-log.jsonl, written by locke-mcp) ----

/// The app-global MCP call log path, matching `locke-mcp`'s `log_path()`.
fn log_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".locke").join("mcp-log.jsonl"))
}

/// Read the most recent MCP tool calls (newest first), up to `limit`. Each line is
/// a JSON object written by `locke-mcp::log_call`. Unparseable lines are skipped.
pub fn call_log(limit: usize) -> Vec<Value> {
    let Some(path) = log_path() else { return Vec::new() };
    let Ok(file) = std::fs::File::open(&path) else { return Vec::new() };
    let mut entries: Vec<Value> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(&l).ok())
        .collect();
    entries.reverse(); // newest first
    entries.truncate(limit);
    entries
}

/// Clear the MCP call log (truncate the file). No-op if it doesn't exist.
pub fn clear_call_log() -> Result<(), String> {
    let Some(path) = log_path() else { return Ok(()) };
    if path.exists() {
        std::fs::write(&path, "").map_err(|e| format!("clear log: {e}"))?;
    }
    Ok(())
}

/// Remove the `locke` server registration: `claude mcp remove --scope user locke`.
pub fn uninstall() -> Result<(), String> {
    let claude = claude_bin().ok_or("Claude Code CLI (`claude`) not found on PATH")?;
    let out = Command::new(&claude)
        .args(["mcp", "remove", "--scope", "user", "locke"])
        .output()
        .map_err(|e| format!("run `claude mcp remove`: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("`claude mcp remove` failed: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}
