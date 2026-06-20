// Filesystem-backed review state, written into the repo under `.locke/` so it's
// portable and can optionally be committed to git. State is plain pretty-printed
// JSON:
//   .locke/pulls.json          explicit pull requests (global registry + id counter)
//   .locke/comments/<id>.json  per-PR comment threads, nextThreadId, viewed
//   .locke/checks.json         per-repo check-command overrides
//   .locke/README.md           explains the folder

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

type R<T> = Result<T, String>;

/// An explicitly-created pull request: a head branch reviewed against a chosen
/// base. Identified by a stable numeric id (never reused) so future agents can
/// reference it across branch renames. Lifecycle fields (status/verdict) and
/// authorship are captured here at create time; live git stats (files/add/del)
/// are derived separately by the git module at load time.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pull {
    pub id: u64,
    pub branch: String,
    pub base: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub is_agent: bool,
    pub status: String,
    #[serde(default)]
    pub verdict: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// The whole `.locke/pulls.json` document: the registry plus a monotonic id
/// counter so ids are never reused even after a pull is deleted.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullStore {
    pub next_id: u64,
    pub pulls: Vec<Pull>,
}

impl Default for PullStore {
    fn default() -> Self {
        PullStore { next_id: 1, pulls: Vec::new() }
    }
}

fn locke_dir(repo: &str) -> PathBuf {
    Path::new(repo).join(".locke")
}

fn checks_path(repo: &str) -> PathBuf {
    locke_dir(repo).join("checks.json")
}

fn pulls_path(repo: &str) -> PathBuf {
    locke_dir(repo).join("pulls.json")
}

fn comments_path(repo: &str, id: u64) -> PathBuf {
    locke_dir(repo).join("comments").join(format!("{id}.json"))
}

/// Ensure `.locke/` exists and carries an explanatory README on first write.
fn ensure_locke(repo: &str) -> R<()> {
    let dir = locke_dir(repo);
    fs::create_dir_all(&dir).map_err(|e| format!("create .locke: {e}"))?;
    let readme = dir.join("README.md");
    if !readme.exists() {
        let _ = fs::write(
            &readme,
            "# .locke\n\nLocke review state. Pull requests are explicit and tracked here:\n\n\
             - `pulls.json` — the pull-request registry (id, branch, base, title,\n  \
             status, verdict, …) plus a monotonic id counter.\n\
             - `comments/<id>.json` — per-PR comment threads, plus viewed-file state.\n\
             - `checks.json` — per-repo check-command overrides.\n\n\
             Commit this folder to share review history (and let agents respond to\n\
             comments) via git, or add it to `.gitignore` to keep it local.\n",
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

// ---- check overrides (.locke/checks.json) ----

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

// ---- pull-request registry (.locke/pulls.json) ----

/// Read the pull-request registry. When `pulls.json` is absent, a legacy
/// `index.json` (the old branch/base list) is migrated in once; otherwise an
/// empty store is returned.
pub fn read_pulls(repo: &str) -> R<PullStore> {
    if let Some(v) = read_json(&pulls_path(repo))? {
        return serde_json::from_value(v).map_err(|e| format!("parse pulls.json: {e}"));
    }
    if let Some(store) = migrate_from_index(repo)? {
        return Ok(store);
    }
    Ok(PullStore::default())
}

fn write_pulls(repo: &str, store: &PullStore) -> R<()> {
    ensure_locke(repo)?;
    let value = serde_json::to_value(store).map_err(|e| format!("serialize pulls: {e}"))?;
    write_json(&pulls_path(repo), &value)
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // Minimal RFC3339-ish UTC stamp without pulling in a date crate.
    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (h, mi, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Convert days-since-epoch to a (year, month, day) civil date (Howard Hinnant's
/// algorithm). Keeps timestamps human-readable without a date dependency.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Create a new pull request, allocating the next id. Captured authorship/title
/// are stored so later rebases or renames don't change the PR's identity.
pub fn create_pull(
    repo: &str,
    branch: &str,
    base: &str,
    title: &str,
    author: &str,
    is_agent: bool,
) -> R<Pull> {
    let mut store = read_pulls(repo)?;
    let now = now_iso();
    let pull = Pull {
        id: store.next_id,
        branch: branch.to_string(),
        base: base.to_string(),
        title: title.to_string(),
        body: String::new(),
        author: author.to_string(),
        is_agent,
        status: "ready".to_string(),
        verdict: None,
        created_at: now.clone(),
        updated_at: now,
    };
    store.next_id += 1;
    store.pulls.push(pull.clone());
    write_pulls(repo, &store)?;
    Ok(pull)
}

/// Replace an existing pull by id (bumps `updated_at`). No-op if id is unknown.
pub fn update_pull(repo: &str, mut pull: Pull) -> R<()> {
    let mut store = read_pulls(repo)?;
    pull.updated_at = now_iso();
    if let Some(slot) = store.pulls.iter_mut().find(|p| p.id == pull.id) {
        *slot = pull;
        write_pulls(repo, &store)?;
    }
    Ok(())
}

/// Remove a pull and its comments file (used by Delete branch).
pub fn delete_pull(repo: &str, id: u64) -> R<()> {
    let mut store = read_pulls(repo)?;
    store.pulls.retain(|p| p.id != id);
    write_pulls(repo, &store)?;
    delete_comments(repo, id)
}

// ---- per-PR comments (.locke/comments/<id>.json) ----

pub fn read_comments(repo: &str, id: u64) -> R<Option<Value>> {
    read_json(&comments_path(repo, id))
}

pub fn write_comments(repo: &str, id: u64, data: Value) -> R<()> {
    ensure_locke(repo)?;
    write_json(&comments_path(repo, id), &data)
}

pub fn delete_comments(repo: &str, id: u64) -> R<()> {
    let p = comments_path(repo, id);
    if p.exists() {
        fs::remove_file(&p).map_err(|e| format!("remove {}: {e}", p.display()))?;
    }
    Ok(())
}

// ---- legacy migration (index.json + reviews/<branch>.json) ----

/// One-shot, non-destructive migration from the pre-explicit format. Each old
/// `index.json` entry becomes a numbered pull; any matching
/// `reviews/<branch>.json` is split into a `comments/<id>.json` file (threads,
/// nextThreadId, viewed) with its status/verdict lifted onto the pull. Old files
/// are left in place. Returns None when there's nothing to migrate.
fn migrate_from_index(repo: &str) -> R<Option<PullStore>> {
    let index_path = locke_dir(repo).join("index.json");
    let Some(index) = read_json(&index_path)? else {
        return Ok(None);
    };
    let entries = index.as_array().cloned().unwrap_or_default();
    let now = now_iso();
    let mut store = PullStore::default();
    for entry in entries {
        let branch = entry.get("branch").and_then(|v| v.as_str()).unwrap_or("");
        let base = entry.get("base").and_then(|v| v.as_str()).unwrap_or("");
        if branch.is_empty() || base.is_empty() {
            continue;
        }
        let id = store.next_id;
        store.next_id += 1;

        // Lift any saved per-branch review state into the new layout.
        let legacy = locke_dir(repo).join("reviews").join(format!("{branch}.json"));
        let saved = read_json(&legacy)?.unwrap_or_else(|| json!({}));
        let status = saved.get("status").and_then(|v| v.as_str()).unwrap_or("ready").to_string();
        let verdict = saved.get("verdict").and_then(|v| v.as_str()).map(|s| s.to_string());

        let comments = json!({
            "threads": saved.get("threads").cloned().unwrap_or_else(|| json!([])),
            "nextThreadId": saved.get("nextThreadId").cloned().unwrap_or_else(|| json!(100)),
            "viewed": saved.get("viewed").cloned().unwrap_or_else(|| json!({})),
        });
        write_comments(repo, id, comments)?;

        store.pulls.push(Pull {
            id,
            branch: branch.to_string(),
            base: base.to_string(),
            title: String::new(),
            body: String::new(),
            author: String::new(),
            is_agent: branch.starts_with("agent/"),
            status,
            verdict,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }
    write_pulls(repo, &store)?;
    Ok(Some(store))
}

// ---- git-tracking toggle (.locke/.gitignore) ----

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

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("locke-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_pulls_with_incrementing_ids() {
        let dir = tmp("pulls");
        let repo = dir.to_str().unwrap();

        assert!(read_pulls(repo).unwrap().pulls.is_empty());
        let a = create_pull(repo, "agent/x", "develop", "First", "Claude", true).unwrap();
        let b = create_pull(repo, "feature/y", "main", "Second", "Dana", false).unwrap();
        assert_eq!(a.id, 1);
        assert_eq!(b.id, 2);
        assert!(dir.join(".locke/pulls.json").exists());
        assert!(dir.join(".locke/README.md").exists());

        let store = read_pulls(repo).unwrap();
        assert_eq!(store.next_id, 3);
        assert_eq!(store.pulls.len(), 2);
        assert_eq!(store.pulls[0].base, "develop");
        assert!(store.pulls[0].is_agent);

        // Update status/verdict round-trips.
        let mut p = store.pulls[0].clone();
        p.status = "merged".to_string();
        p.verdict = Some("approve".to_string());
        update_pull(repo, p).unwrap();
        let reread = read_pulls(repo).unwrap();
        assert_eq!(reread.pulls[0].status, "merged");
        assert_eq!(reread.pulls[0].verdict.as_deref(), Some("approve"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_id_reuse_after_delete() {
        let dir = tmp("reuse");
        let repo = dir.to_str().unwrap();

        let a = create_pull(repo, "agent/x", "develop", "t", "C", true).unwrap();
        write_comments(repo, a.id, json!({ "threads": [], "nextThreadId": 100, "viewed": {} })).unwrap();
        assert!(dir.join(".locke/comments/1.json").exists());

        delete_pull(repo, a.id).unwrap();
        assert!(read_pulls(repo).unwrap().pulls.is_empty());
        assert!(!dir.join(".locke/comments/1.json").exists(), "comments file removed too");

        // Next pull gets id 2 — the counter never goes backwards.
        let b = create_pull(repo, "feature/z", "main", "t", "C", false).unwrap();
        assert_eq!(b.id, 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn comments_round_trip() {
        let dir = tmp("comments");
        let repo = dir.to_str().unwrap();

        assert!(read_comments(repo, 1).unwrap().is_none());
        write_comments(repo, 1, json!({ "threads": [{ "id": 100 }], "nextThreadId": 101, "viewed": { "0": true } })).unwrap();
        let got = read_comments(repo, 1).unwrap().unwrap();
        assert_eq!(got["nextThreadId"], 101);
        assert_eq!(got["threads"][0]["id"], 100);

        write_check_overrides(repo, json!([{ "label": "Test", "command": "npm test" }])).unwrap();
        assert!(read_check_overrides(repo).unwrap().is_some());
        clear_check_overrides(repo).unwrap();
        assert!(read_check_overrides(repo).unwrap().is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrates_legacy_index() {
        let dir = tmp("migrate");
        let repo = dir.to_str().unwrap();
        let locke = dir.join(".locke");
        fs::create_dir_all(locke.join("reviews/agent")).unwrap();
        fs::write(
            locke.join("index.json"),
            r#"[{ "branch": "agent/x", "base": "develop" }, { "branch": "feature/y", "base": "main" }]"#,
        )
        .unwrap();
        fs::write(
            locke.join("reviews/agent/x.json"),
            r#"{ "threads": [{ "id": 100, "resolved": false }], "nextThreadId": 101, "viewed": { "0": true }, "status": "changes", "verdict": "changes" }"#,
        )
        .unwrap();

        // First read triggers the one-shot migration.
        let store = read_pulls(repo).unwrap();
        assert_eq!(store.pulls.len(), 2);
        assert_eq!(store.next_id, 3);
        let x = &store.pulls[0];
        assert_eq!(x.branch, "agent/x");
        assert!(x.is_agent);
        assert_eq!(x.status, "changes");
        assert_eq!(x.verdict.as_deref(), Some("changes"));

        // Threads moved into comments/<id>.json; old files left untouched.
        let c = read_comments(repo, x.id).unwrap().unwrap();
        assert_eq!(c["threads"][0]["id"], 100);
        assert_eq!(c["nextThreadId"], 101);
        assert!(locke.join("index.json").exists(), "non-destructive");
        assert!(dir.join(".locke/pulls.json").exists());

        // Subsequent reads use pulls.json directly (no re-migration).
        assert_eq!(read_pulls(repo).unwrap().pulls.len(), 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn toggles_git_tracking_via_gitignore() {
        let dir = tmp("track");
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
