// Locke desktop core. Git reads live in `git`, write actions + checks in
// `actions`, and `.locke/`-backed review state in `store`. Tauri command
// wrappers are in `commands`.

mod actions;
mod commands;
mod config;
mod git;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::review_summary,
            commands::list_branches,
            commands::detect_base,
            commands::get_review,
            commands::get_diff,
            commands::push_branch,
            commands::delete_branch,
            commands::read_pulls,
            commands::create_pull,
            commands::update_pull,
            commands::delete_pull,
            commands::detect_checks,
            commands::detect_agents,
            commands::run_checks,
            commands::read_comments,
            commands::write_comments,
            commands::read_check_overrides,
            commands::write_check_overrides,
            commands::clear_check_overrides,
            commands::write_agent_prompt,
            commands::read_config,
            commands::get_locke_tracking,
            commands::set_locke_tracking,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Locke");
}
