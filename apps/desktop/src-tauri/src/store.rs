// Filesystem-backed review state, written into the repo under `.locke/` so it's
// portable and can optionally be committed to git. Replaces the app-global
// plugin-store. State is plain pretty-printed JSON:
//   .locke/reviews/<branch>.json   per-branch threads/verdict/status/viewed
//   .locke/checks.json             per-repo check-command overrides
//   .locke/README.md               explains the folder

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

type R<T> = Result<T, String>;

/// An explicitly-created review: a head branch tracked against a chosen base.
/// Stored in `.locke/index.json` so reviews against non-default bases (or
/// branches not auto-listed) persist across restarts.
#[derive(Serialize, Deserialize, Clone)]
pub struct IndexEntry {
    pub branch: String,
    pub base: String,
}

fn locke_dir(repo: &str) -> PathBuf {
    Path::new(repo).join(".locke")
}

fn review_path(repo: &str, branch: &str) -> PathBuf {
    // Branch names may contain `/`; keep the structure as nested dirs.
    locke_dir(repo).join("reviews").join(format!("{branch}.json"))
}

fn checks_path(repo: &str) -> PathBuf {
    locke_dir(repo).join("checks.json")
}

/// Ensure `.locke/` exists and carries an explanatory README on first write.
fn ensure_locke(repo: &str) -> R<()> {
    let dir = locke_dir(repo);
    fs::create_dir_all(&dir).map_err(|e| format!("create .locke: {e}"))?;
    let readme = dir.join("README.md");
    if !readme.exists() {
        let _ = fs::write(
            &readme,
            "# .locke\n\nLocke review state — comment threads, verdicts, status, and viewed files\n(`reviews/<branch>.json`) plus per-repo check overrides (`checks.json`).\n\nCommit this folder to share review history via git, or add it to `.gitignore`\nto keep it local.\n",
        );
    }
    Ok(())
}

fn read_json(path: &Path) -> R<Option<Value>> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let value = serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))?;
    Ok(Some(value))
}

fn write_json(path: &Path, value: &Value) -> R<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("serialize: {e}"))?;
    fs::write(path, format!("{text}\n")).map_err(|e| format!("write {}: {e}", path.display()))
}

pub fn read_review_state(repo: &str, branch: &str) -> R<Option<Value>> {
    read_json(&review_path(repo, branch))
}

pub fn write_review_state(repo: &str, branch: &str, data: Value) -> R<()> {
    ensure_locke(repo)?;
    write_json(&review_path(repo, branch), &data)
}

pub fn read_check_overrides(repo: &str) -> R<Option<Value>> {
    read_json(&checks_path(repo))
}

pub fn write_check_overrides(repo: &str, data: Value) -> R<()> {
    ensure_locke(repo)?;
    write_json(&checks_path(repo), &data)
}

pub fn clear_check_overrides(repo: &str) -> R<()> {
    let p = checks_path(repo);
    if p.exists() {
        fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
    }
    Ok(())
}

fn index_path(repo: &str) -> PathBuf {
    locke_dir(repo).join("index.json")
}

pub fn read_index(repo: &str) -> R<Vec<IndexEntry>> {
    match read_json(&index_path(repo))? {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("parse index.json: {e}")),
        None => Ok(Vec::new()),
    }
}

fn write_index(repo: &str, entries: &[IndexEntry]) -> R<()> {
    ensure_locke(repo)?;
    let value = serde_json::to_value(entries).map_err(|e| format!("serialize index: {e}"))?;
    write_json(&index_path(repo), &value)
}

/// Add (or replace) a tracked review for `branch`.
pub fn add_index_entry(repo: &str, branch: &str, base: &str) -> R<()> {
    let mut entries = read_index(repo)?;
    entries.retain(|e| e.branch != branch);
    entries.push(IndexEntry { branch: branch.to_string(), base: base.to_string() });
    write_index(repo, &entries)
}

/// Remove a tracked review and its stored state (used by Delete branch).
pub fn remove_index_entry(repo: &str, branch: &str) -> R<()> {
    let mut entries = read_index(repo)?;
    entries.retain(|e| e.branch != branch);
    write_index(repo, &entries)?;
    delete_review_state(repo, branch)
}

pub fn delete_review_state(repo: &str, branch: &str) -> R<()> {
    let p = review_path(repo, branch);
    if p.exists() {
        fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
    }
    Ok(())
}

fn gitignore_path(repo: &str) -> PathBuf {
    locke_dir(repo).join(".gitignore")
}

/// Whether `.locke/` review history is tracked in git. "Not tracked" is a
/// `.locke/.gitignore` containing `*`, which hides the whole folder from git.
pub fn get_locke_tracking(repo: &str) -> bool {
    !gitignore_path(repo).exists()
}

pub fn set_locke_tracking(repo: &str, tracked: bool) -> R<()> {
    let p = gitignore_path(repo);
    if tracked {
        if p.exists() {
            fs::remove_file(&p).map_err(|e| format!("remove .gitignore: {e}"))?;
        }
    } else {
        ensure_locke(repo)?;
        fs::write(&p, "*\n").map_err(|e| format!("write .gitignore: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_review_state_under_dot_locke() {
        let dir = std::env::temp_dir().join(format!("locke-store-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_str().unwrap();

        assert!(read_review_state(repo, "agent/x").unwrap().is_none());
        write_review_state(repo, "agent/x", json!({ "verdict": "approve" })).unwrap();

        // Nested branch path + README created.
        assert!(dir.join(".locke/reviews/agent/x.json").exists());
        assert!(dir.join(".locke/README.md").exists());
        let got = read_review_state(repo, "agent/x").unwrap().unwrap();
        assert_eq!(got["verdict"], "approve");

        write_check_overrides(repo, json!([{ "label": "Test", "command": "npm test" }])).unwrap();
        assert!(read_check_overrides(repo).unwrap().is_some());
        clear_check_overrides(repo).unwrap();
        assert!(read_check_overrides(repo).unwrap().is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tracks_created_reviews_in_index() {
        let dir = std::env::temp_dir().join(format!("locke-index-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_str().unwrap();

        assert!(read_index(repo).unwrap().is_empty());
        add_index_entry(repo, "agent/x", "develop").unwrap();
        add_index_entry(repo, "agent/x", "main").unwrap(); // replace, not duplicate
        let idx = read_index(repo).unwrap();
        assert_eq!(idx.len(), 1);
        assert_eq!(idx[0].base, "main");

        write_review_state(repo, "agent/x", json!({ "verdict": "approve" })).unwrap();
        remove_index_entry(repo, "agent/x").unwrap();
        assert!(read_index(repo).unwrap().is_empty());
        assert!(read_review_state(repo, "agent/x").unwrap().is_none(), "state removed too");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn toggles_git_tracking_via_gitignore() {
        let dir = std::env::temp_dir().join(format!("locke-track-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_str().unwrap();

        assert!(get_locke_tracking(repo), "tracked by default (no .gitignore)");
        set_locke_tracking(repo, false).unwrap();
        assert!(!get_locke_tracking(repo));
        assert_eq!(fs::read_to_string(dir.join(".locke/.gitignore")).unwrap(), "*\n");
        set_locke_tracking(repo, true).unwrap();
        assert!(get_locke_tracking(repo));
        assert!(!dir.join(".locke/.gitignore").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
