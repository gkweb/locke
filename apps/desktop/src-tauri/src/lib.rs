// Locke desktop core. Git reads live in `git`, write actions + checks in
// `actions`, and `.locke/`-backed review state in `store`. Tauri command
// wrappers are in `commands`.

mod actions;
mod cli;
mod commands;
mod config;
mod git;
mod loops;
mod mcp;
mod run;
mod store;
mod watch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Repo path from a cold `locke <path>` launch; taken once by the frontend.
    let initial_repo = cli::repo_from_argv(&std::env::args().collect::<Vec<_>>());

    let mut builder = tauri::Builder::default();
    // Must be the first plugin registered. A second `locke <path>` launch forwards
    // its argv here (instead of opening a new window) so we switch repo + focus.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(repo) = cli::repo_from_argv(&argv) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
                let _ = app.emit("cli:open-repo", repo);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(run::RunRegistry::default())
        .manage(loops::LoopRegistry::default())
        .manage(watch::WatchState::default())
        .manage(cli::InitialRepo(std::sync::Mutex::new(initial_repo)))
        .invoke_handler(tauri::generate_handler![
            commands::log_ui_error,
            commands::review_summary,
            commands::list_branches,
            commands::detect_base,
            commands::get_review,
            commands::get_diff,
            commands::list_file_tree,
            commands::read_repo_file,
            commands::push_branch,
            commands::delete_branch,
            commands::read_pulls,
            commands::create_pull,
            commands::update_pull,
            commands::delete_pull,
            commands::detect_checks,
            commands::detect_agents,
            commands::read_agent_settings,
            commands::write_agent_settings,
            commands::run_checks,
            commands::run_agent,
            commands::start_run,
            commands::respond_permission,
            commands::cancel_run,
            commands::set_permission_mode,
            commands::read_runs,
            commands::start_loop,
            commands::start_plan,
            commands::open_loop_review,
            commands::read_loop_plan_meta,
            commands::set_loop_mode,
            commands::pause_loop,
            commands::stop_loop,
            commands::stop_loop_item,
            commands::requeue_loop_item,
            commands::nudge_loop_item,
            commands::resolve_loop_block,
            commands::read_loop_blocks,
            commands::set_loop_block_policy,
            commands::resolve_loop_item,
            commands::read_loops,
            commands::read_loop_items,
            commands::resolve_targets,
            commands::read_loop_manifest,
            commands::write_loop_manifest,
            commands::add_loop_task,
            commands::remove_loop_node,
            commands::set_loop_deps,
            commands::answer_loop_question,
            commands::read_loop_interview,
            commands::merge_loop_spec_edit,
            commands::save_loop_draft,
            commands::read_loop_draft,
            commands::delete_loop,
            commands::read_comments,
            commands::write_comments,
            commands::read_check_overrides,
            commands::write_check_overrides,
            commands::clear_check_overrides,
            commands::write_agent_prompt,
            commands::read_config,
            commands::get_locke_tracking,
            commands::set_locke_tracking,
            commands::mcp_server_status,
            commands::install_mcp_server,
            commands::uninstall_mcp_server,
            commands::mcp_call_log,
            commands::clear_mcp_call_log,
            commands::watch_locke,
            commands::take_initial_repo,
            commands::cli_command_status,
            commands::install_cli_command,
            commands::uninstall_cli_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Locke");
}
