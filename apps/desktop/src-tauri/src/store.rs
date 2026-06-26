// `.locke/`-backed review state (pulls, comments, runs, settings) now lives in the
// standalone, Tauri-free `locke-store` crate, so the desktop app and the MCP server
// (`locke-mcp`) share one implementation of the on-disk format. Re-exported here so
// existing `store::…` call sites in `commands.rs`/`run.rs`/`actions.rs` are unchanged.
pub use locke_store::*;
