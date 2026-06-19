// Repo-specific configuration, read from `locke.config.json` at the repo root.
// This is user-authored and committable — the place for per-repo overrides:
// the base branch, the push remote, and default check commands.
//
// Why JSON and not locke.config.ts: Locke is a packaged desktop app with no
// guaranteed JS runtime to *execute* a TS module at review time. JSON is read
// directly by this Rust layer, is equally committable, and needs no build step.
// (A future `locke.config.ts` could be supported by having the frontend's
// bundler compile it to this same shape.)

use crate::actions::CheckSpec;
use serde::{Deserialize, Serialize};
use std::path::Path;

type R<T> = Result<T, String>;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LockeConfig {
    /// Branch reviews are compared against (default: "main").
    #[serde(default)]
    pub base: Option<String>,
    /// Remote to push approved branches to (default: "origin").
    #[serde(default)]
    pub remote: Option<String>,
    /// Default checks for this repo. A `.locke/checks.json` override, when
    /// present, takes precedence over these.
    #[serde(default)]
    pub checks: Option<Vec<CheckSpec>>,
}

/// Read `locke.config.json` from the repo root. Missing file → defaults;
/// malformed file → error (so the user learns their config is broken).
pub fn read_config(repo: &str) -> R<LockeConfig> {
    let path = Path::new(repo).join("locke.config.json");
    if !path.exists() {
        return Ok(LockeConfig::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read locke.config.json: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("parse locke.config.json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_config_is_default() {
        let dir = std::env::temp_dir().join(format!("locke-cfg-none-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let cfg = read_config(dir.to_str().unwrap()).unwrap();
        assert!(cfg.base.is_none() && cfg.remote.is_none() && cfg.checks.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_base_remote_and_checks() {
        let dir = std::env::temp_dir().join(format!("locke-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("locke.config.json"),
            r#"{ "base": "develop", "remote": "upstream",
                 "checks": [{ "label": "Test", "command": "pnpm test" }] }"#,
        )
        .unwrap();
        let cfg = read_config(dir.to_str().unwrap()).unwrap();
        assert_eq!(cfg.base.as_deref(), Some("develop"));
        assert_eq!(cfg.remote.as_deref(), Some("upstream"));
        assert_eq!(cfg.checks.unwrap()[0].command, "pnpm test");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
