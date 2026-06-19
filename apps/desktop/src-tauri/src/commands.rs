// Thin Tauri command layer over the git module. Keeping the git logic in pure
// functions (git.rs) lets it be unit-tested without a Tauri runtime.

use crate::actions;
use crate::config;
use crate::git;
use crate::store;
use serde_json::Value;

#[tauri::command]
pub fn list_reviews(repo: String, base: String) -> Result<Vec<git::GitReview>, String> {
    git::list_reviews(&repo, &base)
}

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
pub fn push_branch(repo: String, branch: String, remote: Option<String>) -> Result<String, String> {
    actions::push_branch(&repo, &branch, remote.as_deref().unwrap_or("origin"))
}

#[tauri::command]
pub fn detect_checks(repo: String) -> Vec<actions::CheckSpec> {
    actions::detect_checks(&repo)
}

#[tauri::command]
pub fn run_checks(
    repo: String,
    branch: String,
    checks: Vec<actions::CheckSpec>,
) -> Result<Vec<actions::CheckResult>, String> {
    actions::run_checks(&repo, &branch, checks)
}

// ---- filesystem review state (.locke/) ----

#[tauri::command]
pub fn read_review_state(repo: String, branch: String) -> Result<Option<Value>, String> {
    store::read_review_state(&repo, &branch)
}

#[tauri::command]
pub fn write_review_state(repo: String, branch: String, data: Value) -> Result<(), String> {
    store::write_review_state(&repo, &branch, data)
}

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
