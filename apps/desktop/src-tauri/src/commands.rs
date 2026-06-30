// Thin Tauri command layer over the git module. Keeping the git logic in pure
// functions (git.rs) lets it be unit-tested without a Tauri runtime.

use crate::actions;
use crate::cli;
use crate::config;
use crate::git;
use crate::loops;
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

// ---- loops (the fan-out runner; .locke/loops/<id>/) ----

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_loop(
    app: tauri::AppHandle,
    registry: tauri::State<loops::LoopRegistry>,
    loop_id: String,
    repo: String,
    branch: String,
    base: String,
    pattern: String,
    title: String,
    template: String,
    targets: Vec<String>,
    concurrency: u64,
    checks: Vec<actions::CheckSpec>,
    review_on_done: bool,
    block_policy: String,
    review_scope: String,
) -> Result<(), String> {
    loops::start_loop(app.clone(), &registry, loop_id, repo, branch, base, pattern, title, template, targets, concurrency, checks, review_on_done, block_policy, review_scope)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn start_plan(
    app: tauri::AppHandle,
    registry: tauri::State<loops::LoopRegistry>,
    loop_id: String,
    repo: String,
    branch: String,
    base: String,
    pattern: String,
    title: String,
    template: String,
    targets: Vec<String>,
    concurrency: u64,
    checks: Vec<actions::CheckSpec>,
    review_on_done: bool,
    review_scope: String,
) -> Result<(), String> {
    loops::start_plan(app.clone(), &registry, loop_id, repo, branch, base, pattern, title, template, targets, concurrency, checks, review_on_done, review_scope)
}

/// Get-or-create the review for a loop's branch and return its id (stamps the loop's
/// `pull_id`). Backs the completed loop's "Open review" button; deduped server-side.
#[tauri::command]
pub fn open_loop_review(repo: String, loop_id: String) -> Result<u64, String> {
    store::ensure_loop_review(&repo, &loop_id)
}

#[tauri::command]
pub fn read_loop_plan_meta(repo: String, loop_id: String) -> Result<Option<Value>, String> {
    store::read_loop_plan_meta(&repo, &loop_id)
}

/// Flip a loop's mode/state on disk — used to return an approved (build) loop to
/// Plan mode so its strategist specs can be reviewed/re-run.
#[tauri::command]
pub fn set_loop_mode(repo: String, loop_id: String, mode: String, state: String) -> Result<(), String> {
    store::update_loop(&repo, &loop_id, |l| {
        l.mode = mode.clone();
        l.state = state.clone();
    })
}

#[tauri::command]
pub fn pause_loop(
    registry: tauri::State<loops::LoopRegistry>,
    loop_id: String,
    paused: bool,
) -> Result<(), String> {
    loops::pause_loop(&registry, &loop_id, paused)
}

#[tauri::command]
pub fn stop_loop(registry: tauri::State<loops::LoopRegistry>, loop_id: String) -> Result<(), String> {
    loops::stop_loop(&registry, &loop_id)
}

#[tauri::command]
pub fn stop_loop_item(registry: tauri::State<loops::LoopRegistry>, loop_id: String, key: String) -> Result<(), String> {
    loops::stop_loop_item(&registry, &loop_id, &key)
}

#[tauri::command]
pub fn requeue_loop_item(registry: tauri::State<loops::LoopRegistry>, loop_id: String, key: String) -> Result<(), String> {
    loops::requeue_loop_item(&registry, &loop_id, &key)
}

#[tauri::command]
pub fn nudge_loop_item(registry: tauri::State<loops::LoopRegistry>, loop_id: String, key: String, text: String) -> Result<(), String> {
    loops::nudge_loop_item(&registry, &loop_id, &key, &text)
}

#[tauri::command]
pub fn resolve_loop_block(registry: tauri::State<loops::LoopRegistry>, loop_id: String, task_id: String, approve: bool) -> Result<(), String> {
    loops::resolve_loop_block(&registry, &loop_id, &task_id, approve)
}

#[tauri::command]
pub fn resolve_loop_item(
    repo: String,
    loop_id: String,
    file: String,
    decision: String,
    feedback: String,
) -> Result<Value, String> {
    loops::resolve_loop_item(&repo, &loop_id, &file, &decision, &feedback)
}

#[tauri::command]
pub fn read_loops(repo: String) -> Result<Vec<store::Loop>, String> {
    store::read_loops(&repo)
}

#[tauri::command]
pub fn read_loop_items(repo: String, loop_id: String) -> Result<Vec<Value>, String> {
    store::read_loop_items(&repo, &loop_id)
}

#[tauri::command]
pub fn resolve_targets(repo: String, resolver: loops::ResolverSpec) -> Result<Vec<store::ManifestEntry>, String> {
    Ok(loops::resolve_targets(&repo, &resolver))
}

#[tauri::command]
pub fn read_loop_manifest(repo: String, loop_id: String) -> Result<Vec<store::ManifestEntry>, String> {
    store::read_loop_manifest(&repo, &loop_id)
}

#[tauri::command]
pub fn save_loop_draft(repo: String, record: store::Loop, draft: Value) -> Result<(), String> {
    let id = record.id.clone();
    store::upsert_loop(&repo, record)?;
    store::write_loop_draft(&repo, &id, &draft)
}

#[tauri::command]
pub fn read_loop_draft(repo: String, loop_id: String) -> Result<Option<Value>, String> {
    store::read_loop_draft(&repo, &loop_id)
}

#[tauri::command]
pub fn delete_loop(repo: String, loop_id: String) -> Result<(), String> {
    store::delete_loop(&repo, &loop_id)
}

#[tauri::command]
pub fn write_loop_manifest(repo: String, loop_id: String, entries: Vec<store::ManifestEntry>) -> Result<(), String> {
    store::write_loop_manifest(&repo, &loop_id, &entries)
}

/// Add a human-authored task node to the loop's work graph (the UI mirror of the
/// model's `loop_add_task`). Stamped `origin:"human"`. A spec is optional — when
/// given the task is born `specced`; otherwise the build agent works from the title.
#[tauri::command]
pub fn add_loop_task(
    repo: String,
    loop_id: String,
    id: String,
    title: String,
    spec: String,
    requires: Vec<String>,
    priority: i64,
) -> Result<(), String> {
    let has_spec = !spec.trim().is_empty();
    let spec_ref = if has_spec {
        store::write_loop_spec(&repo, &loop_id, &id, &spec)?;
        Some(format!("spec/{}.md", store::sanitize_path(&id)))
    } else {
        None
    };
    store::update_loop_manifest(&repo, &loop_id, |entries| {
        if let Some(e) = entries.iter_mut().find(|e| !e.id.is_empty() && e.id == id) {
            e.kind = "task".into();
            e.title = Some(title);
            e.requires = requires;
            e.priority = priority;
            e.spec = spec_ref;
            e.status = if has_spec { "specced".into() } else { "queued".into() };
            e.inc = true;
            e.origin = "human".into();
        } else {
            entries.push(store::ManifestEntry {
                id,
                kind: "task".into(),
                title: Some(title),
                requires,
                priority,
                spec: spec_ref,
                status: if has_spec { "specced".into() } else { "queued".into() },
                inc: true,
                origin: "human".into(),
                ..Default::default()
            });
        }
    })
}

/// Remove a node (file or task) from the work graph by id-or-path, and drop any
/// `requires` edges pointing at it so nothing is left blocked on a gone node.
#[tauri::command]
pub fn remove_loop_node(repo: String, loop_id: String, node: String) -> Result<(), String> {
    store::update_loop_manifest(&repo, &loop_id, |entries| {
        entries.retain(|e| e.id != node && e.path != node);
        for e in entries.iter_mut() {
            e.requires.retain(|r| r != &node);
        }
    })
}

/// Set a node's dependency edges / ordering (the UI mirror of the model's edits).
/// `node` is a file path or a task id.
#[tauri::command]
pub fn set_loop_deps(
    repo: String,
    loop_id: String,
    node: String,
    requires: Vec<String>,
    priority: Option<i64>,
    wave: Option<u32>,
) -> Result<(), String> {
    store::update_loop_manifest(&repo, &loop_id, |entries| {
        if let Some(e) = entries.iter_mut().find(|e| e.id == node || e.path == node) {
            e.requires = requires;
            if let Some(p) = priority {
                e.priority = p;
            }
            if let Some(w) = wave {
                e.wave = w;
            }
        }
    })
}

// ---- plan interview (.locke/loops/<id>/interview/) ----

/// Record the human's answer to a live plan-interview question. `key` is the raw item
/// key (file path or task id) the question was about, or `__scope__` for a scope-level
/// one. The blocked MCP `loop_ask` (polling the filesystem) picks the answer up by its
/// nonce and returns it to the strategist, which then continues speccing.
#[tauri::command]
pub fn answer_loop_question(repo: String, loop_id: String, key: String, text: String) -> Result<(), String> {
    store::write_loop_answer(&repo, &loop_id, &key, &text)
}

/// The interview transcript + any still-pending questions for a loop, so a reopened or
/// stalled plan shows the open questions across all items and the Scope tab.
#[tauri::command]
pub fn read_loop_interview(repo: String, loop_id: String) -> Result<Value, String> {
    store::read_interview(&repo, &loop_id)
}

/// Pending block-on-task proposals (no decision yet) — surfaced in the approvals tray;
/// read on (re)load so a reopened run still shows its open prerequisite proposals.
#[tauri::command]
pub fn read_loop_blocks(repo: String, loop_id: String) -> Result<Vec<Value>, String> {
    store::read_loop_block_requests(&repo, &loop_id)
}

/// Set a loop's block-on-task policy ("auto" | "approve"); read at build-run start.
#[tauri::command]
pub fn set_loop_block_policy(repo: String, loop_id: String, policy: String) -> Result<(), String> {
    store::update_loop(&repo, &loop_id, |l| l.block_policy = policy.clone())
}

/// Merge per-spec edits the creator makes in the Plan view into a manifest row (the
/// UI mirror of the strategist's `loop_write_spec` fields): the chosen `approach`, the
/// edited `steps`, and a per-item `instruction` appended to the row's `note`. When an
/// instruction is given it is also appended to the per-item `spec/<key>.md` so the
/// later build worker (which reads the spec via `loop_read_spec`) sees it. `file` is
/// the item key (file path or task id).
#[tauri::command]
pub fn merge_loop_spec_edit(
    repo: String,
    loop_id: String,
    file: String,
    approach: Option<String>,
    steps: Option<Vec<String>>,
    instruction: Option<String>,
) -> Result<(), String> {
    let instr = instruction.as_deref().map(str::trim).filter(|s| !s.is_empty());
    // Match by id-or-path so task specs work too; only edit an existing row.
    store::update_loop_manifest(&repo, &loop_id, |entries| {
        if let Some(e) = entries.iter_mut().find(|e| e.id == file || e.path == file) {
            if let Some(a) = approach {
                e.approach = Some(a);
            }
            if let Some(s) = steps {
                e.steps = s;
            }
            if let Some(instr) = instr {
                e.note = Some(match e.note.take() {
                    Some(n) if !n.trim().is_empty() => format!("{n}\n{instr}"),
                    _ => instr.to_string(),
                });
            }
        }
    })?;
    // Surface the instruction to the build worker by appending it to the spec md.
    if let Some(instr) = instr {
        let prior = store::read_loop_spec(&repo, &loop_id, &file)?.unwrap_or_default();
        let next = format!("{prior}\n\n## Creator instruction\n\n{instr}\n");
        store::write_loop_spec(&repo, &loop_id, &file, &next)?;
    }
    Ok(())
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
