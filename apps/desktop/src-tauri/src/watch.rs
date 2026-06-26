// Filesystem watcher for a repo's `.locke/` directory.
//
// The desktop app and the `locke-mcp` server are separate processes over the same
// `.locke/*.json` files. Live agent runs already stream to the UI, but changes an
// agent makes through MCP (e.g. `reply_to_comment` appending to a comment thread)
// have no push channel. This watches `.locke/` and emits a `locke:fs-change` event
// so the frontend can re-pull the open review's diff + comments within ~1s. The
// frontend debounces, so we forward raw change notifications.

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

type R<T> = Result<T, String>;

/// Holds the active `.locke` watcher so it lives for as long as it's watching.
/// Opening another repo replaces it (dropping the old watcher stops its thread).
#[derive(Default)]
pub struct WatchState(pub Mutex<Option<RecommendedWatcher>>);

/// Start (or replace) the watcher on `<repo>/.locke`, emitting `locke:fs-change`
/// on any change beneath it. A missing `.locke/` directory is not an error — there
/// is simply nothing to watch yet (it appears once the first review is created).
pub fn watch_locke(app: AppHandle, state: &WatchState, repo: String) -> R<()> {
    // Drop any previous watcher first so we don't leak threads across repo opens.
    *state.0.lock().unwrap() = None;

    let dir = Path::new(&repo).join(".locke");
    if !dir.exists() {
        return Ok(());
    }

    let app = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        // Forward any successful change; ignore watcher errors (e.g. transient
        // rename races) so the watch stays alive.
        if res.is_ok() {
            let _ = app.emit("locke:fs-change", ());
        }
    })
    .map_err(|e| format!("create .locke watcher: {e}"))?;

    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {}: {e}", dir.display()))?;

    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}
