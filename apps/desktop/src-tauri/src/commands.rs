// Thin Tauri command layer over the git module. Keeping the git logic in pure
// functions (git.rs) lets it be unit-tested without a Tauri runtime.

use crate::actions;
use crate::config;
use crate::git;
use crate::store;
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
