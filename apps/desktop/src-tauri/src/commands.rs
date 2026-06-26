// Thin Tauri command layer over the git module. Keeping the git logic in pure
// functions (git.rs) lets it be unit-tested without a Tauri runtime.

use crate::actions;
use crate::cli;
use crate::config;
use crate::git;
use crate::mcp;
use crate::run;
use crate::store;
use crate::watch;
use serde_json::Value;
use tauri::Manager;

#[tauri::command]
pub fn get_review(repo: String, branch: String, base: String) -> Result<git::GitReviewDetail, String> {
    git::get_review(&repo, &branch, &base)
}

#[tauri::command]
pub fn get_diff(
    repo: String,
    branch: String,
    base: String,
    file: String,
) -> Result<git::GitDiff, String> {
    git::get_diff(&repo, &branch, &base, &file)
}

#[tauri::command]
pub fn review_summary(
    repo: String,
    branch: String,
    base: String,
) -> Result<Option<git::GitReview>, String> {
    git::review_summary(&repo, &branch, &base)
}

// ---- repo file explorer (Files screen) ----

#[tauri::command]
pub fn list_file_tree(repo: String) -> Result<Vec<git::FileNode>, String> {
    git::list_file_tree(&repo)
}

#[tauri::command]
pub fn read_repo_file(repo: String, file: String) -> Result<String, String> {
    git::read_repo_file(&repo, &file)
}

#[tauri::command]
pub fn list_branches(repo: String) -> Result<Vec<String>, String> {
    git::list_branches(&repo)
}

#[tauri::command]
pub fn detect_base(repo: String) -> Result<String, String> {
    git::detect_base(&repo)
}

#[tauri::command]
pub fn push_branch(repo: String, branch: String, remote: Option<String>) -> Result<String, String> {
    actions::push_branch(&repo, &branch, remote.as_deref().unwrap_or("origin"))
}

#[tauri::command]
pub fn delete_branch(repo: String, branch: String) -> Result<(), String> {
    actions::delete_branch(&repo, &branch)
}

// ---- pull-request registry (.locke/pulls.json) ----

#[tauri::command]
pub fn read_pulls(repo: String) -> Result<store::PullStore, String> {
    store::read_pulls(&repo)
}

#[tauri::command]
pub fn create_pull(
    repo: String,
    branch: String,
    base: String,
    title: String,
    author: String,
    is_agent: bool,
) -> Result<store::Pull, String> {
    store::create_pull(&repo, &branch, &base, &title, &author, is_agent)
}

#[tauri::command]
pub fn update_pull(repo: String, pull: store::Pull) -> Result<(), String> {
    store::update_pull(&repo, pull)
}

#[tauri::command]
pub fn delete_pull(repo: String, id: u64) -> Result<(), String> {
    store::delete_pull(&repo, id)
}

#[tauri::command]
pub fn detect_checks(repo: String) -> Vec<actions::CheckSpec> {
    actions::detect_checks(&repo)
}

// ---- agent CLI detection (PATH-based, repo-independent) ----

#[tauri::command]
pub fn detect_agents() -> Vec<actions::AgentInfo> {
    actions::detect_agents()
}

// ---- app-global agent settings (<app_config_dir>/agents.json) ----

#[tauri::command]
pub fn read_agent_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let dir = app.path().app_config_dir().map_err(|e| format!("config dir: {e}"))?;
    store::read_agent_settings(&dir)
}

#[tauri::command]
pub fn write_agent_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| format!("config dir: {e}"))?;
    store::write_agent_settings(&dir, settings)
}

#[tauri::command]
pub fn run_checks(
    repo: String,
    branch: String,
    checks: Vec<actions::CheckSpec>,
) -> Result<Vec<actions::CheckResult>, String> {
    actions::run_checks(&repo, &branch, checks)
}

// ---- headless agent run (Phase 6): run an enabled agent on the branch ----

#[tauri::command]
pub fn run_agent(
    repo: String,
    branch: String,
    agent_cmd: String,
    prompt: String,
) -> Result<String, String> {
    actions::run_agent(&repo, &branch, &agent_cmd, &prompt)
}

// ---- live streaming agent runs (Claude stream-json control protocol) ----

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_run(
    app: tauri::AppHandle,
    registry: tauri::State<run::RunRegistry>,
    run_id: String,
    repo: String,
    branch: String,
    agent_cmd: String,
    prompt: String,
    use_worktree: bool,
    permission_mode: String,
) -> Result<(), String> {
    run::start_run(app.clone(), &registry, run_id, repo, branch, agent_cmd, prompt, use_worktree, permission_mode)
}

#[tauri::command]
pub fn respond_permission(
    registry: tauri::State<run::RunRegistry>,
    run_id: String,
    request_id: String,
    allow: bool,
    updated_input: Option<Value>,
    message: Option<String>,
) -> Result<(), String> {
    run::respond_permission(&registry, &run_id, &request_id, allow, updated_input, message)
}

#[tauri::command]
pub fn cancel_run(registry: tauri::State<run::RunRegistry>, run_id: String) -> Result<(), String> {
    run::cancel_run(&registry, &run_id)
}

#[tauri::command]
pub fn set_permission_mode(
    registry: tauri::State<run::RunRegistry>,
    run_id: String,
    mode: String,
) -> Result<(), String> {
    run::set_permission_mode(&registry, &run_id, &mode)
}

/// Watch the repo's `.locke/` directory for out-of-process changes (MCP edits) and
/// emit `locke:fs-change` so the frontend can refresh the open review.
#[tauri::command]
pub fn watch_locke(
    app: tauri::AppHandle,
    state: tauri::State<watch::WatchState>,
    repo: String,
) -> Result<(), String> {
    watch::watch_locke(app.clone(), &state, repo)
}

#[tauri::command]
pub fn read_runs(repo: String) -> Result<Vec<Value>, String> {
    store::read_runs(&repo)
}

// ---- per-PR comments (.locke/comments/<id>.json) ----

#[tauri::command]
pub fn read_comments(repo: String, id: u64) -> Result<Option<Value>, String> {
    store::read_comments(&repo, id)
}

#[tauri::command]
pub fn write_comments(repo: String, id: u64, data: Value) -> Result<(), String> {
    store::write_comments(&repo, id, data)
}

// ---- per-repo check overrides (.locke/checks.json) ----

#[tauri::command]
pub fn read_check_overrides(repo: String) -> Result<Option<Value>, String> {
    store::read_check_overrides(&repo)
}

#[tauri::command]
pub fn write_check_overrides(repo: String, data: Value) -> Result<(), String> {
    store::write_check_overrides(&repo, data)
}

#[tauri::command]
pub fn clear_check_overrides(repo: String) -> Result<(), String> {
    store::clear_check_overrides(&repo)
}

// ---- per-PR agent request artifacts (.locke/requests/<id>.md) ----

#[tauri::command]
pub fn write_agent_prompt(repo: String, id: u64, content: String) -> Result<(), String> {
    store::write_agent_prompt(&repo, id, &content)
}

#[tauri::command]
pub fn read_config(repo: String) -> Result<config::LockeConfig, String> {
    config::read_config(&repo)
}

#[tauri::command]
pub fn get_locke_tracking(repo: String) -> bool {
    store::get_locke_tracking(&repo)
}

#[tauri::command]
pub fn set_locke_tracking(repo: String, tracked: bool) -> Result<(), String> {
    store::set_locke_tracking(&repo, tracked)
}

// ---- MCP server install/status (Settings → Integrations) ----

#[tauri::command]
pub fn mcp_server_status(app: tauri::AppHandle) -> Value {
    mcp::status(&app)
}

#[tauri::command]
pub fn install_mcp_server(app: tauri::AppHandle) -> Result<(), String> {
    mcp::install(&app)
}

#[tauri::command]
pub fn uninstall_mcp_server() -> Result<(), String> {
    mcp::uninstall()
}

#[tauri::command]
pub fn mcp_call_log(limit: Option<usize>) -> Vec<Value> {
    mcp::call_log(limit.unwrap_or(200))
}

#[tauri::command]
pub fn clear_mcp_call_log() -> Result<(), String> {
    mcp::clear_call_log()
}

// ---- `locke <path>` CLI launch (Settings → Integrations) ----

/// Consume the repo path from a cold `locke <path>` launch (one-shot).
#[tauri::command]
pub fn take_initial_repo(state: tauri::State<cli::InitialRepo>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
pub fn cli_command_status() -> Value {
    cli::status()
}

#[tauri::command]
pub fn install_cli_command(app: tauri::AppHandle) -> Result<(), String> {
    cli::install(&app)
}

#[tauri::command]
pub fn uninstall_cli_command() -> Result<(), String> {
    cli::uninstall()
}
