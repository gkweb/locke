// Filesystem-backed review state, written into the repo under `.locke/` so it's
// portable and can optionally be committed to git. State is plain pretty-printed
// JSON:
//   .locke/pulls.json          explicit pull requests (global registry + id counter)
//   .locke/comments/<id>.json  per-PR comment threads, nextThreadId, viewed
//   .locke/checks.json         per-repo check-command overrides
//   .locke/README.md           explains the folder

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::fs::{File, OpenOptions};
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

fn requests_path(repo: &str, id: u64) -> PathBuf {
    locke_dir(repo).join("requests").join(format!("{id}.md"))
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
             - `requests/<id>.md` — per-PR agent prompts generated from open change\n  \
             requests (a durable, diffable record of what was asked).\n\
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

/// Write JSON atomically: serialize to a per-process temp file in the same dir,
/// then rename over the target. Rename is atomic on a single filesystem, so a
/// concurrent reader (which takes no lock) always sees either the old or the new
/// complete file — never a half-written one.
fn write_json(path: &Path, value: &Value) -> R<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| format!("serialize: {e}"))?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, format!("{text}\n")).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp); // don't leave the temp behind on failure
        format!("commit {}: {e}", path.display())
    })
}

// ---- cross-process write lock (.locke/.lock) ----

/// Acquire the repo-wide advisory write lock, held until the returned guard drops
/// (the fd closes — including on process exit/crash, so locks never go stale).
/// All `.locke/` mutations take this so concurrent writers in the same repo (two
/// agents, or an agent and the desktop app) serialize instead of clobbering each
/// other's read-modify-write. Different repos use different lock files, so they
/// never block one another.
fn lock_repo(repo: &str) -> R<File> {
    ensure_locke(repo)?;
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(locke_dir(repo).join(".lock"))
        .map_err(|e| format!("open .locke/.lock: {e}"))?;
    file.lock_exclusive().map_err(|e| format!("lock .locke: {e}"))?;
    Ok(file)
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

// ---- per-PR agent request artifacts (.locke/requests/<id>.md) ----

/// Persist a generated agent prompt as a durable markdown artifact, keyed by the
/// pull request's numeric id. Mirrors `write_check_overrides`, but writes raw
/// markdown rather than JSON.
pub fn write_agent_prompt(repo: &str, id: u64, content: &str) -> R<()> {
    ensure_locke(repo)?;
    let path = requests_path(repo, id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    fs::write(&path, content).map_err(|e| format!("write {}: {e}", path.display()))
}

// ---- app-global agent settings (<app_config_dir>/agents.json) ----
//
// The first state in Locke that is NOT keyed by repo: which detected agents the
// user has explicitly opted out of, persisted app-wide. The caller resolves the
// OS config dir (Tauri's `app_config_dir`); store.rs stays Tauri-free and just
// reads/writes JSON under it. `write_json` creates the dir if absent.

pub fn read_agent_settings(config_dir: &Path) -> R<Option<Value>> {
    read_json(&config_dir.join("agents.json"))
}

pub fn write_agent_settings(config_dir: &Path, data: Value) -> R<()> {
    write_json(&config_dir.join("agents.json"), &data)
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

pub fn now_iso() -> String {
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
    let _lock = lock_repo(repo)?;
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
    let _lock = lock_repo(repo)?;
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
    let _lock = lock_repo(repo)?;
    let mut store = read_pulls(repo)?;
    store.pulls.retain(|p| p.id != id);
    write_pulls(repo, &store)?;
    delete_comments(repo, id)
}

// ---- streaming run logs (.locke/runs/<runId>.json) ----

fn runs_dir(repo: &str) -> PathBuf {
    locke_dir(repo).join("runs")
}

/// Persist a finished run's full record (events, result, meta), keyed by runId.
/// Written once when a run ends; powers the History tab.
pub fn write_run(repo: &str, run_id: &str, record: &Value) -> R<()> {
    ensure_locke(repo)?;
    let safe: String = run_id.chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
    write_json(&runs_dir(repo).join(format!("{safe}.json")), record)
}

/// Read every persisted run record, newest first (by `endedAt`). The frontend
/// filters these by branch for a review's History timeline.
pub fn read_runs(repo: &str) -> R<Vec<Value>> {
    let dir = runs_dir(repo);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut runs: Vec<Value> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read runs dir: {e}"))? {
        let path = entry.map_err(|e| format!("read entry: {e}"))?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(v) = read_json(&path)? {
                runs.push(v);
            }
        }
    }
    runs.sort_by(|a, b| {
        let ea = a.get("endedAt").and_then(|v| v.as_u64()).unwrap_or(0);
        let eb = b.get("endedAt").and_then(|v| v.as_u64()).unwrap_or(0);
        eb.cmp(&ea)
    });
    Ok(runs)
}

// ---- per-PR comments (.locke/comments/<id>.json) ----

pub fn read_comments(repo: &str, id: u64) -> R<Option<Value>> {
    read_json(&comments_path(repo, id))
}

pub fn write_comments(repo: &str, id: u64, data: Value) -> R<()> {
    let _lock = lock_repo(repo)?;
    write_comments_inner(repo, id, data)
}

/// Unlocked comments write, for callers that already hold the repo lock (e.g.
/// `append_comment_item`) or run before any concurrency (`migrate_from_index`).
fn write_comments_inner(repo: &str, id: u64, data: Value) -> R<()> {
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

/// Append a pre-built comment item (a `CommentItem`-shaped JSON value) to the
/// thread `thread_id` within pull `pull_id`'s comments file. The caller owns the
/// item's shape (author/initials/isAgent/time/body) so this stays format-neutral;
/// it just locates the thread and pushes onto its `items` array, then persists.
/// Errors if the comments file, the thread, or its `items` array is missing.
pub fn append_comment_item(repo: &str, pull_id: u64, thread_id: u64, item: Value) -> R<()> {
    let _lock = lock_repo(repo)?;
    let mut data = read_comments(repo, pull_id)?
        .ok_or_else(|| format!("pull {pull_id} has no comments file"))?;
    let threads = data
        .get_mut("threads")
        .and_then(|t| t.as_array_mut())
        .ok_or("comments file has no `threads` array")?;
    let thread = threads
        .iter_mut()
        .find(|t| t.get("id").and_then(|v| v.as_u64()) == Some(thread_id))
        .ok_or_else(|| format!("thread {thread_id} not found in pull {pull_id}"))?;
    thread
        .get_mut("items")
        .and_then(|i| i.as_array_mut())
        .ok_or("thread has no `items` array")?
        .push(item);
    write_comments_inner(repo, pull_id, data) // lock already held above
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
        // Unlocked: migration may run while a caller holds the lock (via read_pulls).
        write_comments_inner(repo, id, comments)?;

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

// ---- loops (.locke/loops.json registry + .locke/loops/<id>/ tree) ----
//
// A "loop" runs one task across many files. The registry `.locke/loops.json`
// holds the Loop records (counts, branch, pattern, prompt template) — like
// pulls.json. Per-loop artifacts live under `.locke/loops/<id>/`:
//   spec/<sanitized-path>.md    optional per-item spec the worker reads
//   items/<sanitized-path>.json per-item runtime state + result record
//   plan.md                     global plan / assumptions / conventions
//   progress.jsonl              durable append-only event log
// The desktop runner and the standalone locke-mcp tools both read/write this
// tree, so item writes take the repo lock and use atomic writes.

/// A loop — a task applied across a matched set of files. Counts are carried
/// explicitly so a 1,000-item set needn't be rescanned on every read. Mirrors the
/// front-end `Loop` shape, plus the backend-only `template`/`concurrency`.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Loop {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub branch: String,
    #[serde(default)]
    pub base: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub pattern: String,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub done: u64,
    #[serde(default)]
    pub running: u64,
    #[serde(default)]
    pub review: u64,
    #[serde(default)]
    pub failed: u64,
    #[serde(default)]
    pub queued: u64,
    #[serde(default)]
    pub blocked: u64,
    #[serde(default)]
    pub rate: String,
    #[serde(default)]
    pub elapsed: String,
    /// Per-item prompt template (the creator's, with `{{file}}` etc. interpolated).
    #[serde(default)]
    pub template: String,
    #[serde(default)]
    pub concurrency: u64,
    /// Open a review of the loop's branch when it finishes (the creator's opt-out
    /// choice). Default false for legacy records; the builder sets it explicitly.
    #[serde(default)]
    pub review_on_done: bool,
    /// The review (pull) opened for this loop's output, once one exists (0 = none).
    /// Lets the completed loop deep-link back to its review and dedup creation.
    #[serde(default)]
    pub pull_id: u64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoopStore {
    #[serde(default)]
    pub loops: Vec<Loop>,
}

fn loops_index_path(repo: &str) -> PathBuf {
    locke_dir(repo).join("loops.json")
}

fn loop_dir(repo: &str, id: &str) -> PathBuf {
    locke_dir(repo).join("loops").join(sanitize_seg(id))
}

/// Filename-safe single segment: keep alnum/`.`/`-`/`_`, drop everything else to
/// `-`. Used for loop ids.
fn sanitize_seg(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Filename-safe rendering of a repo-relative path: `/` → `__`, other unsafe chars
/// → `-`. Keeps the extension readable and avoids collisions between distinct
/// paths (unlike collapsing every separator to `-`).
pub fn sanitize_path(path: &str) -> String {
    let mut out = String::new();
    for c in path.chars() {
        match c {
            '/' => out.push_str("__"),
            c if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' => out.push(c),
            _ => out.push('-'),
        }
    }
    out
}

/// Read the loop registry (empty when absent).
pub fn read_loops(repo: &str) -> R<Vec<Loop>> {
    match read_json(&loops_index_path(repo))? {
        Some(v) => {
            let store: LoopStore =
                serde_json::from_value(v).map_err(|e| format!("parse loops.json: {e}"))?;
            Ok(store.loops)
        }
        None => Ok(Vec::new()),
    }
}

pub fn read_loop(repo: &str, id: &str) -> R<Option<Loop>> {
    Ok(read_loops(repo)?.into_iter().find(|l| l.id == id))
}

/// Insert or replace a loop record by id (bumps `updated_at`). Serialized with the
/// repo lock so concurrent count updates don't clobber each other.
pub fn upsert_loop(repo: &str, mut lp: Loop) -> R<()> {
    let _lock = lock_repo(repo)?;
    let mut store = LoopStore { loops: read_loops(repo)? };
    lp.updated_at = now_iso();
    if lp.created_at.is_empty() {
        lp.created_at = lp.updated_at.clone();
    }
    if let Some(slot) = store.loops.iter_mut().find(|l| l.id == lp.id) {
        *slot = lp;
    } else {
        store.loops.push(lp);
    }
    let value = serde_json::to_value(&store).map_err(|e| format!("serialize loops: {e}"))?;
    write_json(&loops_index_path(repo), &value)
}

/// Apply a closure to one loop record under the repo lock (read-modify-write).
/// Used by the runner to bump counts/state atomically.
pub fn update_loop<F: FnOnce(&mut Loop)>(repo: &str, id: &str, f: F) -> R<()> {
    let _lock = lock_repo(repo)?;
    let mut store = LoopStore { loops: read_loops(repo)? };
    if let Some(lp) = store.loops.iter_mut().find(|l| l.id == id) {
        f(lp);
        lp.updated_at = now_iso();
        let value = serde_json::to_value(&store).map_err(|e| format!("serialize loops: {e}"))?;
        write_json(&loops_index_path(repo), &value)?;
    }
    Ok(())
}

/// Get-or-create the review (pull) for a loop's branch+base, stamping `pull_id` on
/// the loop record. Idempotent and the single point of dedup: reuses the loop's
/// linked pull if it still exists, else any pull already on this branch+base, else
/// creates one (title = the loop title). So a loop never spawns two reviews, whether
/// opened automatically on completion or on demand from the UI.
pub fn ensure_loop_review(repo: &str, loop_id: &str) -> R<u64> {
    let lp = read_loop(repo, loop_id)?.ok_or_else(|| format!("loop {loop_id} not found"))?;
    let pulls = read_pulls(repo)?;
    if lp.pull_id != 0 && pulls.pulls.iter().any(|p| p.id == lp.pull_id) {
        return Ok(lp.pull_id);
    }
    if lp.branch.trim().is_empty() {
        return Err("loop has no branch to review".into());
    }
    let id = match pulls.pulls.iter().find(|p| p.branch == lp.branch && p.base == lp.base) {
        Some(p) => p.id,
        None => {
            let title = if lp.title.trim().is_empty() { lp.branch.clone() } else { lp.title.clone() };
            create_pull(repo, &lp.branch, &lp.base, &title, "Locke loop", true)?.id
        }
    };
    update_loop(repo, loop_id, |l| l.pull_id = id)?;
    Ok(id)
}

/// Remove a loop from the registry and delete its `.locke/loops/<id>/` tree.
/// Only Locke's tracking is removed — git commits/branches are untouched.
pub fn delete_loop(repo: &str, id: &str) -> R<()> {
    let _lock = lock_repo(repo)?;
    let mut store = LoopStore { loops: read_loops(repo)? };
    store.loops.retain(|l| l.id != id);
    let value = serde_json::to_value(&store).map_err(|e| format!("serialize loops: {e}"))?;
    write_json(&loops_index_path(repo), &value)?;
    let _ = fs::remove_dir_all(loop_dir(repo, id));
    Ok(())
}

// ---- per-item state + result records (.locke/loops/<id>/items/<path>.json) ----

fn loop_item_path(repo: &str, id: &str, file: &str) -> PathBuf {
    loop_dir(repo, id).join("items").join(format!("{}.json", sanitize_path(file)))
}

pub fn read_loop_item(repo: &str, id: &str, file: &str) -> R<Option<Value>> {
    read_json(&loop_item_path(repo, id, file))
}

/// Overwrite an item's record (runner's final write after a worker finishes).
pub fn write_loop_item(repo: &str, id: &str, file: &str, record: &Value) -> R<()> {
    ensure_locke(repo)?;
    write_json(&loop_item_path(repo, id, file), record)
}

/// Merge top-level keys into an item's record (the MCP tools' declaration write),
/// stamping `path`/`updatedAt`. Read-modify-write under the repo lock so a worker
/// declaration and a `loop_write_note` append can't clobber each other.
pub fn merge_loop_item(repo: &str, id: &str, file: &str, patch: Value) -> R<()> {
    let _lock = lock_repo(repo)?;
    let path = loop_item_path(repo, id, file);
    let mut cur = read_json(&path)?.unwrap_or_else(|| json!({}));
    if let (Some(obj), Some(p)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            obj.insert(k.clone(), v.clone());
        }
    }
    cur["path"] = json!(file);
    cur["updatedAt"] = json!(now_iso());
    write_json(&path, &cur)
}

/// Append a note to an item's `notes` array (carries forward to the next step).
pub fn append_loop_note(repo: &str, id: &str, file: &str, note: &str) -> R<()> {
    let _lock = lock_repo(repo)?;
    let path = loop_item_path(repo, id, file);
    let mut cur = read_json(&path)?.unwrap_or_else(|| json!({}));
    let obj = cur.as_object_mut().ok_or("item record is not an object")?;
    obj.entry("notes").or_insert_with(|| json!([]));
    if let Some(arr) = obj.get_mut("notes").and_then(|n| n.as_array_mut()) {
        arr.push(json!({ "note": note, "time": now_iso() }));
    }
    obj.insert("path".into(), json!(file));
    obj.insert("updatedAt".into(), json!(now_iso()));
    write_json(&path, &cur)
}

/// Read every item record for a loop (unordered).
pub fn read_loop_items(repo: &str, id: &str) -> R<Vec<Value>> {
    let dir = loop_dir(repo, id).join("items");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("read items dir: {e}"))? {
        let path = entry.map_err(|e| format!("read entry: {e}"))?.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(v) = read_json(&path)? {
                items.push(v);
            }
        }
    }
    Ok(items)
}

// ---- per-item specs (.locke/loops/<id>/spec/<path>.md) ----

fn loop_spec_path(repo: &str, id: &str, file: &str) -> PathBuf {
    loop_dir(repo, id).join("spec").join(format!("{}.md", sanitize_path(file)))
}

pub fn read_loop_spec(repo: &str, id: &str, file: &str) -> R<Option<String>> {
    let path = loop_spec_path(repo, id, file);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| format!("read spec: {e}"))
}

pub fn write_loop_spec(repo: &str, id: &str, file: &str, content: &str) -> R<()> {
    let path = loop_spec_path(repo, id, file);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create spec dir: {e}"))?;
    }
    fs::write(&path, content).map_err(|e| format!("write spec: {e}"))
}

/// Global plan / conventions for the loop (Plan mode writes this; Build may omit).
pub fn read_loop_plan(repo: &str, id: &str) -> R<Option<String>> {
    let path = loop_dir(repo, id).join("plan.md");
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| format!("read plan: {e}"))
}

pub fn write_loop_plan(repo: &str, id: &str, content: &str) -> R<()> {
    let dir = loop_dir(repo, id);
    fs::create_dir_all(&dir).map_err(|e| format!("create loop dir: {e}"))?;
    fs::write(dir.join("plan.md"), content).map_err(|e| format!("write plan: {e}"))
}

/// Structured scope metadata for the Plan view's Scope tab — `{ summary, assumptions }`,
/// shaped to the front-end `LoopPlanMeta` (a `SpecSummary[]` + a string list). The
/// strategist's scope pass writes this beside the human-readable `plan.md`.
pub fn read_loop_plan_meta(repo: &str, id: &str) -> R<Option<Value>> {
    read_json(&loop_dir(repo, id).join("plan.json"))
}

pub fn write_loop_plan_meta(repo: &str, id: &str, meta: &Value) -> R<()> {
    ensure_locke(repo)?;
    write_json(&loop_dir(repo, id).join("plan.json"), meta)
}

// ---- plan interview (.locke/loops/<id>/interview/) ----
//
// A live, multi-turn Q&A between the Plan-mode strategist and the human. When the
// strategist needs a decision before it can finish a spec it calls the `loop_ask`
// MCP tool, which BLOCKS (polling the filesystem) until the human answers. The
// per-key `.q`/`.a` files are the wire; `transcript.json` is the durable,
// append-only record the Plan view replays on reload.
//
//   interview/<key>.q.json     pending question { nonce, question, choices, file?, ts }
//   interview/<key>.a.json     the human's answer { nonce, text }
//   interview/transcript.json  append-only [{ key, role, text, file?, ts }]
//
// `<key>` is `sanitize_path(file)` for a per-item question, or the reserved
// `__scope__` for a scope-level one (`file` absent). Per-item and scope interviews
// coexist (one `.q.json` per key), so a blocked item doesn't hide the scope chat.

fn loop_interview_dir(repo: &str, id: &str) -> PathBuf {
    loop_dir(repo, id).join("interview")
}

/// The RAW interview key for a question: the item's repo-relative path / task id, or
/// the reserved `__scope__` for a scope-level question (`file` absent or empty). This
/// is the key the live event, the transcript rows, and the front-end all share — the
/// `.q`/`.a` files sanitize it for the filename (`interview_stem`), but every API here
/// takes the raw key so callers don't have to agree on a sanitizer.
pub fn interview_key(file: Option<&str>) -> String {
    match file {
        Some(f) if !f.is_empty() => f.to_string(),
        _ => "__scope__".to_string(),
    }
}

/// Filesystem-safe stem for an interview key's `.q`/`.a` files (paths → `__`-joined).
fn interview_stem(key: &str) -> String {
    if key == "__scope__" {
        key.to_string()
    } else {
        sanitize_path(key)
    }
}

fn interview_q_path(repo: &str, id: &str, key: &str) -> PathBuf {
    loop_interview_dir(repo, id).join(format!("{}.q.json", interview_stem(key)))
}

fn interview_a_path(repo: &str, id: &str, key: &str) -> PathBuf {
    loop_interview_dir(repo, id).join(format!("{}.a.json", interview_stem(key)))
}

fn interview_transcript_path(repo: &str, id: &str) -> PathBuf {
    loop_interview_dir(repo, id).join("transcript.json")
}

/// A fresh nonce pairing a question with its answer. Nanosecond clock + pid is
/// unique enough that a stale answer (to a since-replaced question under the same
/// key) never satisfies the blocked poller.
fn fresh_nonce() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{}-{}", nanos, std::process::id())
}

/// Write the pending question for `key` (overwriting any prior), returning its
/// nonce. The blocked `loop_ask` then polls `read_loop_answer` for a matching nonce.
pub fn write_loop_question(
    repo: &str,
    id: &str,
    key: &str,
    question: &str,
    choices: &[String],
    file: Option<&str>,
) -> R<String> {
    ensure_locke(repo)?;
    let nonce = fresh_nonce();
    let q = json!({
        "nonce": nonce,
        "question": question,
        "choices": choices,
        "file": file,
        "ts": now_iso(),
    });
    write_json(&interview_q_path(repo, id, key), &q)?;
    Ok(nonce)
}

/// The pending question for `key`, if any (`{ nonce, question, choices, file?, ts }`).
pub fn read_loop_question(repo: &str, id: &str, key: &str) -> R<Option<Value>> {
    read_json(&interview_q_path(repo, id, key))
}

/// Drop the `.q`/`.a` pair for `key` (called once the agent has consumed the answer).
pub fn clear_loop_question(repo: &str, id: &str, key: &str) -> R<()> {
    for p in [interview_q_path(repo, id, key), interview_a_path(repo, id, key)] {
        if p.exists() {
            fs::remove_file(&p).map_err(|e| format!("clear interview file: {e}"))?;
        }
    }
    Ok(())
}

/// Record the human's answer for `key`, stamped with the pending question's nonce so
/// the blocked `loop_ask` only unblocks on an answer to the question it actually
/// asked (a no-op if there is no pending question).
pub fn write_loop_answer(repo: &str, id: &str, key: &str, text: &str) -> R<()> {
    ensure_locke(repo)?;
    let nonce = read_loop_question(repo, id, key)?
        .and_then(|q| q.get("nonce").and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_default();
    write_json(&interview_a_path(repo, id, key), &json!({ "nonce": nonce, "text": text }))
}

/// The recorded answer for `key`, if any (`{ nonce, text }`).
pub fn read_loop_answer(repo: &str, id: &str, key: &str) -> R<Option<Value>> {
    read_json(&interview_a_path(repo, id, key))
}

/// Append one turn to the durable interview transcript (under the repo lock so the
/// agent's `loop_ask` and the desktop's optimistic append don't clobber each other).
pub fn append_interview_msg(repo: &str, id: &str, key: &str, role: &str, text: &str, file: Option<&str>) -> R<()> {
    ensure_locke(repo)?;
    let _lock = lock_repo(repo)?;
    let path = interview_transcript_path(repo, id);
    let mut log: Vec<Value> = match read_json(&path)? {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("parse transcript: {e}"))?,
        None => Vec::new(),
    };
    log.push(json!({ "key": key, "role": role, "text": text, "file": file, "ts": now_iso() }));
    write_json(&path, &serde_json::to_value(&log).map_err(|e| format!("serialize transcript: {e}"))?)
}

/// How many `agent`-role turns the transcript holds — the strategist's question
/// count, which the `loop_ask` turn cap is enforced against.
pub fn interview_agent_turns(repo: &str, id: &str) -> R<usize> {
    let log: Vec<Value> = match read_json(&interview_transcript_path(repo, id))? {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("parse transcript: {e}"))?,
        None => Vec::new(),
    };
    Ok(log.iter().filter(|m| m.get("role").and_then(|v| v.as_str()) == Some("agent")).count())
}

/// The whole interview for the Plan view on (re)load: the transcript plus every
/// still-pending question keyed by interview key (so a reopened/stalled plan shows
/// the open questions across all items and scope).
pub fn read_interview(repo: &str, id: &str) -> R<Value> {
    let transcript: Vec<Value> = match read_json(&interview_transcript_path(repo, id))? {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("parse transcript: {e}"))?,
        None => Vec::new(),
    };
    // Key pending questions by the RAW item key (the q.json's `file`, or `__scope__`
    // when absent) — not the sanitized filename stem — so a reloaded plan keys an
    // open question the same way the live `loop:interview` event does (the front-end
    // matches it to a spec by its raw id).
    let mut pending = serde_json::Map::new();
    let dir = loop_interview_dir(repo, id);
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("read interview dir: {e}"))? {
            let entry = entry.map_err(|e| format!("read interview entry: {e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".q.json") {
                if let Some(q) = read_json(&entry.path())? {
                    let key = q.get("file").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).unwrap_or("__scope__");
                    pending.insert(key.to_string(), q);
                }
            }
        }
    }
    Ok(json!({ "transcript": transcript, "pending": pending }))
}

// ---- target+spec manifest (.locke/loops/<id>/manifest.json) ----

/// One row of a loop's manifest: a target file plus (once Plan mode runs) its
/// spec. The manifest is the loop's checked-in, hand-editable source of truth —
/// the runner takes its active set from here, not a live glob. A superset of the
/// builder's `LoopTarget` (path/loc/risk/flags/inc/reason) plus spec fields.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub path: String,
    /// Stable node id for the work graph. File items default to their `path`;
    /// task items get a slug. Edges (`requires`) reference these.
    #[serde(default)]
    pub id: String,
    /// "file" (edit a path) | "task" (a shared/prerequisite job, no single path).
    #[serde(default)]
    pub kind: String,
    /// Human label for task nodes (file nodes use `path`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Ids that must reach `done` before this item is eligible (blocked-by edges).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<String>,
    /// Human-pinned ordering within the ready set (higher runs first).
    #[serde(default)]
    pub priority: i64,
    /// Topological level, derived from `requires` (hand-overridable).
    #[serde(default)]
    pub wave: u32,
    #[serde(default)]
    pub loc: u64,
    #[serde(default)]
    pub risk: String,
    #[serde(default)]
    pub flags: Vec<String>,
    /// Whether this file is in scope (the builder audit toggle).
    #[serde(default)]
    pub inc: bool,
    /// Provenance: who authored this node — "resolver" (matched by the glob/list),
    /// "model" (strategist-suggested task), or "human" (user-added). Empty on
    /// pre-existing rows (treated as "resolver").
    #[serde(default)]
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    // ---- spec enrichment (written by Plan mode) ----
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approach: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub detected: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tests: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Repo-relative ref to the per-item markdown spec, once written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<String>,
    /// Spec lifecycle: "" | candidate | speccing | specced | review | excluded.
    /// `candidate` = surfaced by the scope hint but NOT yet chosen by the strategist
    /// (inc=false); it authors the work set by promoting candidates (`loop_add_item`
    /// → queued) or dropping them (`loop_drop_item` → excluded, with `reason`).
    #[serde(default)]
    pub status: String,
}

fn loop_manifest_path(repo: &str, id: &str) -> PathBuf {
    loop_dir(repo, id).join("manifest.json")
}

/// The builder's serialized draft (title/branch/base/prompt/mode/resolver/targetSel),
/// so an unfinished loop survives navigation + app restart and reopens fully.
pub fn read_loop_draft(repo: &str, id: &str) -> R<Option<Value>> {
    read_json(&loop_dir(repo, id).join("draft.json"))
}

pub fn write_loop_draft(repo: &str, id: &str, draft: &Value) -> R<()> {
    ensure_locke(repo)?;
    write_json(&loop_dir(repo, id).join("draft.json"), draft)
}

pub fn read_loop_manifest(repo: &str, id: &str) -> R<Vec<ManifestEntry>> {
    match read_json(&loop_manifest_path(repo, id))? {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("parse manifest: {e}")),
        None => Ok(Vec::new()),
    }
}

pub fn write_loop_manifest(repo: &str, id: &str, entries: &[ManifestEntry]) -> R<()> {
    ensure_locke(repo)?;
    let _lock = lock_repo(repo)?;
    let value = serde_json::to_value(entries).map_err(|e| format!("serialize manifest: {e}"))?;
    write_json(&loop_manifest_path(repo, id), &value)
}

/// Read-modify-write a single manifest entry under the repo lock, applying `f` to
/// the row matching `file` (created if absent). Lets concurrent Plan-mode workers
/// enrich their own row without clobbering the manifest.
pub fn merge_loop_manifest_entry<F: FnOnce(&mut ManifestEntry)>(repo: &str, id: &str, file: &str, f: F) -> R<()> {
    ensure_locke(repo)?;
    let _lock = lock_repo(repo)?;
    let mut entries: Vec<ManifestEntry> = match read_json(&loop_manifest_path(repo, id))? {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("parse manifest: {e}"))?,
        None => Vec::new(),
    };
    if let Some(e) = entries.iter_mut().find(|e| e.path == file) {
        f(e);
    } else {
        let mut e = ManifestEntry { path: file.to_string(), inc: true, ..Default::default() };
        f(&mut e);
        entries.push(e);
    }
    let value = serde_json::to_value(&entries).map_err(|e| format!("serialize manifest: {e}"))?;
    write_json(&loop_manifest_path(repo, id), &value)
}

/// Read-modify-write the WHOLE manifest under the repo lock. The general primitive
/// for graph edits that span rows (adding a task node, fanning a `requires` edge
/// across many file rows, reordering) — `merge_loop_manifest_entry` only reaches one
/// row keyed by `path`, which can't address task nodes (keyed by `id`).
pub fn update_loop_manifest<F: FnOnce(&mut Vec<ManifestEntry>)>(repo: &str, id: &str, f: F) -> R<()> {
    ensure_locke(repo)?;
    let _lock = lock_repo(repo)?;
    let mut entries: Vec<ManifestEntry> = match read_json(&loop_manifest_path(repo, id))? {
        Some(v) => serde_json::from_value(v).map_err(|e| format!("parse manifest: {e}"))?,
        None => Vec::new(),
    };
    f(&mut entries);
    let value = serde_json::to_value(&entries).map_err(|e| format!("serialize manifest: {e}"))?;
    write_json(&loop_manifest_path(repo, id), &value)
}

// ---- glob matching (no deps; mirrors the desktop runner's matcher) ----

/// Match a repo-relative path against a glob with `**` (any depth), `*` (within a
/// segment), and `{a,b}` brace alternation, e.g. `packages/**/*.{vue,ts}`. Shared so
/// the MCP server can resolve a task's `blocks` glob to the file rows it gates.
pub fn glob_match(pat: &str, path: &str) -> bool {
    glob_expand_braces(pat).iter().any(|p| glob_match_one(p, path))
}

fn glob_match_one(pat: &str, path: &str) -> bool {
    let p: Vec<&str> = pat.split('/').filter(|s| !s.is_empty()).collect();
    let s: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    glob_seg_match(&p, &s)
}

fn glob_expand_braces(pat: &str) -> Vec<String> {
    let Some(open) = pat.find('{') else { return vec![pat.to_string()] };
    let mut depth = 0;
    let mut close = None;
    for (i, c) in pat.char_indices().skip_while(|(i, _)| *i < open) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    close = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let Some(close) = close else { return vec![pat.to_string()] };
    let (pre, post) = (&pat[..open], &pat[close + 1..]);
    let inner = &pat[open + 1..close];
    let mut parts = Vec::new();
    let (mut d, mut start) = (0, 0);
    for (i, c) in inner.char_indices() {
        match c {
            '{' => d += 1,
            '}' => d -= 1,
            ',' if d == 0 => {
                parts.push(&inner[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&inner[start..]);
    parts.into_iter().flat_map(|part| glob_expand_braces(&format!("{pre}{part}{post}"))).collect()
}

fn glob_seg_match(p: &[&str], s: &[&str]) -> bool {
    if p.is_empty() {
        return s.is_empty();
    }
    if p[0] == "**" {
        (0..=s.len()).any(|i| glob_seg_match(&p[1..], &s[i..]))
    } else if s.is_empty() {
        false
    } else if glob_wild(&p[0].chars().collect::<Vec<_>>(), &s[0].chars().collect::<Vec<_>>()) {
        glob_seg_match(&p[1..], &s[1..])
    } else {
        false
    }
}

fn glob_wild(p: &[char], t: &[char]) -> bool {
    if p.is_empty() {
        return t.is_empty();
    }
    if p[0] == '*' {
        (0..=t.len()).any(|i| glob_wild(&p[1..], &t[i..]))
    } else {
        !t.is_empty() && p[0] == t[0] && glob_wild(&p[1..], &t[1..])
    }
}

// ---- durable progress log (.locke/loops/<id>/progress.jsonl) ----

/// Append one event (a `LoopStreamEvent`-shaped value) as a JSONL line. O_APPEND
/// keeps concurrent writers from interleaving lines. Powers the Stream layout and
/// restart recovery.
pub fn append_loop_event(repo: &str, id: &str, event: &Value) -> R<()> {
    let dir = loop_dir(repo, id);
    fs::create_dir_all(&dir).map_err(|e| format!("create loop dir: {e}"))?;
    let line = serde_json::to_string(event).map_err(|e| format!("serialize event: {e}"))?;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("progress.jsonl"))
        .map_err(|e| format!("open progress.jsonl: {e}"))?;
    use std::io::Write;
    writeln!(f, "{line}").map_err(|e| format!("append progress: {e}"))
}

/// Read the durable progress log (one JSON value per line; malformed lines skipped).
pub fn read_loop_progress(repo: &str, id: &str) -> R<Vec<Value>> {
    let path = loop_dir(repo, id).join("progress.jsonl");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read progress: {e}"))?;
    Ok(text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
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
    fn manifest_round_trips_and_merges_entries() {
        let dir = tmp("manifest");
        let repo = dir.to_str().unwrap();

        assert!(read_loop_manifest(repo, "lp1").unwrap().is_empty());

        let entries = vec![
            ManifestEntry { path: "src/a.js".into(), loc: 10, risk: "low".into(), inc: true, ..Default::default() },
            ManifestEntry { path: "src/b.js".into(), loc: 400, risk: "high".into(), inc: false, ..Default::default() },
        ];
        write_loop_manifest(repo, "lp1", &entries).unwrap();
        assert!(dir.join(".locke/loops/lp1/manifest.json").exists());

        let back = read_loop_manifest(repo, "lp1").unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[1].path, "src/b.js");
        assert!(!back[1].inc);

        // Enrich an existing row (Plan-mode spec write) without clobbering the rest.
        merge_loop_manifest_entry(repo, "lp1", "src/a.js", |e| {
            e.status = "specced".into();
            e.approach = Some("refactor".into());
            e.spec = Some("spec/src__a.js.md".into());
        })
        .unwrap();
        // Merge a brand-new row in.
        merge_loop_manifest_entry(repo, "lp1", "src/c.js", |e| e.status = "specced".into()).unwrap();

        let m = read_loop_manifest(repo, "lp1").unwrap();
        assert_eq!(m.len(), 3);
        let a = m.iter().find(|e| e.path == "src/a.js").unwrap();
        assert_eq!(a.status, "specced");
        assert_eq!(a.approach.as_deref(), Some("refactor"));
        assert_eq!(a.loc, 10, "existing fields preserved through merge");
        assert!(m.iter().any(|e| e.path == "src/c.js" && e.inc));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn interview_question_answer_round_trip() {
        let dir = tmp("interview");
        let repo = dir.to_str().unwrap();

        // No pending question, empty transcript to start.
        let iv = read_interview(repo, "lp1").unwrap();
        assert!(iv["transcript"].as_array().unwrap().is_empty());
        assert!(iv["pending"].as_object().unwrap().is_empty());

        // The interview key is the RAW item path; scope uses `__scope__`. (The
        // `.q`/`.a` files sanitize it for the filename — `src__Button.vue.q.json`.)
        let key = interview_key(Some("src/Button.vue"));
        assert_eq!(key, "src/Button.vue");
        assert_eq!(interview_key(None), "__scope__");

        let nonce = write_loop_question(repo, "lp1", &key, "Which filename?", &["a".into(), "b".into()], Some("src/Button.vue")).unwrap();
        append_interview_msg(repo, "lp1", &key, "agent", "Which filename?", Some("src/Button.vue")).unwrap();

        // The pending question surfaces for the Plan view, keyed by the RAW item key
        // (the q.json's `file`) so it matches the live event and the spec id.
        let iv = read_interview(repo, "lp1").unwrap();
        let pending = iv["pending"].as_object().unwrap();
        assert_eq!(pending["src/Button.vue"]["question"], "Which filename?");
        assert_eq!(pending["src/Button.vue"]["nonce"].as_str().unwrap(), nonce);
        assert_eq!(iv["transcript"].as_array().unwrap().len(), 1);

        // The human's answer is stamped with the pending nonce (so a stale answer
        // can't satisfy a since-replaced question).
        assert!(read_loop_answer(repo, "lp1", &key).unwrap().is_none());
        write_loop_answer(repo, "lp1", &key, "Button.vue").unwrap();
        let a = read_loop_answer(repo, "lp1", &key).unwrap().unwrap();
        assert_eq!(a["text"], "Button.vue");
        assert_eq!(a["nonce"].as_str().unwrap(), nonce);

        // The agent consumes it: append the human turn, clear the pair.
        append_interview_msg(repo, "lp1", &key, "you", "Button.vue", None).unwrap();
        clear_loop_question(repo, "lp1", &key).unwrap();
        assert!(read_loop_question(repo, "lp1", &key).unwrap().is_none());
        assert!(read_loop_answer(repo, "lp1", &key).unwrap().is_none());

        // Transcript survives the clear; pending is empty again.
        let iv = read_interview(repo, "lp1").unwrap();
        assert_eq!(iv["transcript"].as_array().unwrap().len(), 2);
        assert!(iv["pending"].as_object().unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn interview_agent_turn_count_drives_cap() {
        let dir = tmp("interview-cap");
        let repo = dir.to_str().unwrap();

        assert_eq!(interview_agent_turns(repo, "lp1").unwrap(), 0);
        append_interview_msg(repo, "lp1", "__scope__", "agent", "q1", None).unwrap();
        append_interview_msg(repo, "lp1", "__scope__", "you", "a1", None).unwrap();
        append_interview_msg(repo, "lp1", "__scope__", "agent", "q2", None).unwrap();
        // Only agent turns count toward the per-loop question cap.
        assert_eq!(interview_agent_turns(repo, "lp1").unwrap(), 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn glob_match_double_star_and_braces() {
        assert!(glob_match("src/**/*.vue", "src/a/b/C.vue"));
        assert!(!glob_match("src/**/*.vue", "lib/C.vue"));
        assert!(glob_match("packages/**/*.{vue,ts}", "packages/ui/x.ts"));
        assert!(!glob_match("packages/**/*.{vue,ts}", "packages/ui/x.js"));
    }

    #[test]
    fn update_manifest_adds_task_and_fans_blocks_edge() {
        let dir = tmp("graph");
        let repo = dir.to_str().unwrap();

        write_loop_manifest(
            repo,
            "lp1",
            &[
                ManifestEntry { path: "src/Cart.vue".into(), id: "src/Cart.vue".into(), origin: "resolver".into(), inc: true, ..Default::default() },
                ManifestEntry { path: "src/Nav.vue".into(), id: "src/Nav.vue".into(), origin: "resolver".into(), inc: true, ..Default::default() },
                ManifestEntry { path: "src/util.ts".into(), id: "src/util.ts".into(), origin: "resolver".into(), inc: true, ..Default::default() },
            ],
        )
        .unwrap();

        // Mirror `loop_add_task`: insert a model task node + fan a `requires` edge to
        // every file matching the `blocks` glob.
        let blocks = "src/**/*.vue";
        let mut linked = 0usize;
        update_loop_manifest(repo, "lp1", |entries| {
            entries.push(ManifestEntry {
                id: "add-use-cart".into(),
                kind: "task".into(),
                title: Some("Create useCart".into()),
                status: "specced".into(),
                origin: "model".into(),
                inc: true,
                ..Default::default()
            });
            for e in entries.iter_mut() {
                if e.kind != "task" && glob_match(blocks, &e.path) && !e.requires.iter().any(|r| r == "add-use-cart") {
                    e.requires.push("add-use-cart".into());
                    linked += 1;
                }
            }
        })
        .unwrap();

        assert_eq!(linked, 2, "only the two .vue files gain the edge");
        let m = read_loop_manifest(repo, "lp1").unwrap();
        let task = m.iter().find(|e| e.id == "add-use-cart").unwrap();
        assert_eq!((task.kind.as_str(), task.origin.as_str()), ("task", "model"));
        assert!(m.iter().find(|e| e.path == "src/Cart.vue").unwrap().requires.iter().any(|r| r == "add-use-cart"));
        assert!(m.iter().find(|e| e.path == "src/Nav.vue").unwrap().requires.iter().any(|r| r == "add-use-cart"));
        assert!(m.iter().find(|e| e.path == "src/util.ts").unwrap().requires.is_empty(), ".ts file untouched");

        let _ = fs::remove_dir_all(&dir);
    }

    // A candidate pool (inc=false) round-trips, and the strategist's authoring
    // (promote → queued, drop → excluded with a reason) survives a re-read.
    #[test]
    fn candidate_pool_authors_to_a_work_set() {
        let dir = tmp("candidates");
        let repo = dir.to_str().unwrap();
        write_loop_manifest(
            repo,
            "lp1",
            &[
                ManifestEntry { path: "src/A.vue".into(), id: "src/A.vue".into(), origin: "resolver".into(), inc: false, status: "candidate".into(), ..Default::default() },
                ManifestEntry { path: "src/B.vue".into(), id: "src/B.vue".into(), origin: "resolver".into(), inc: false, status: "candidate".into(), ..Default::default() },
            ],
        )
        .unwrap();
        // Candidates persist as out-of-scope until the model decides.
        let pool = read_loop_manifest(repo, "lp1").unwrap();
        assert!(pool.iter().all(|e| !e.inc && e.status == "candidate"));

        update_loop_manifest(repo, "lp1", |entries| {
            for e in entries.iter_mut() {
                if e.path == "src/A.vue" {
                    e.inc = true;
                    e.status = "queued".into();
                } else if e.path == "src/B.vue" {
                    e.inc = false;
                    e.status = "excluded".into();
                    e.reason = Some("test-only fixture".into());
                }
            }
        })
        .unwrap();

        let m = read_loop_manifest(repo, "lp1").unwrap();
        let a = m.iter().find(|e| e.path == "src/A.vue").unwrap();
        assert_eq!((a.inc, a.status.as_str()), (true, "queued"));
        let b = m.iter().find(|e| e.path == "src/B.vue").unwrap();
        assert_eq!((b.inc, b.status.as_str(), b.reason.as_deref()), (false, "excluded", Some("test-only fixture")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn loop_draft_round_trips() {
        let dir = tmp("draft");
        let repo = dir.to_str().unwrap();
        assert!(read_loop_draft(repo, "lp1").unwrap().is_none());
        let draft = json!({ "title": "Migrate", "resolver": { "kind": "glob", "pattern": "src/**/*.ts" }, "targetSel": { "a.ts": false } });
        write_loop_draft(repo, "lp1", &draft).unwrap();
        assert!(dir.join(".locke/loops/lp1/draft.json").exists());
        let back = read_loop_draft(repo, "lp1").unwrap().unwrap();
        assert_eq!(back["title"], "Migrate");
        assert_eq!(back["resolver"]["pattern"], "src/**/*.ts");
        assert_eq!(back["targetSel"]["a.ts"], false);
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
    fn appends_comment_item_to_thread() {
        let dir = tmp("append");
        let repo = dir.to_str().unwrap();

        write_comments(
            repo,
            1,
            json!({
                "threads": [{ "id": 100, "file": "a.ts", "lineId": "n1", "resolved": false,
                              "kind": "change_request", "items": [] }],
                "nextThreadId": 101, "viewed": {}
            }),
        )
        .unwrap();

        let item = json!({ "author": "claude", "initials": "CL", "isAgent": true,
                           "roleLabel": "AGENT", "time": "just now", "body": "Done." });
        append_comment_item(repo, 1, 100, item).unwrap();

        let got = read_comments(repo, 1).unwrap().unwrap();
        let items = got["threads"][0]["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["author"], "claude");
        assert_eq!(items[0]["isAgent"], true);

        // Unknown thread / unknown pull both error rather than silently no-op.
        assert!(append_comment_item(repo, 1, 999, json!({})).is_err());
        assert!(append_comment_item(repo, 42, 100, json!({})).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_agent_prompt_artifact() {
        let dir = tmp("requests");
        let repo = dir.to_str().unwrap();

        let body = "# Address review change requests\n\nGuard against count === 0.\n";
        write_agent_prompt(repo, 7, body).unwrap();

        let path = dir.join(".locke/requests/7.md");
        assert!(path.exists(), "artifact written under requests/");
        assert_eq!(fs::read_to_string(&path).unwrap(), body, "content is raw markdown");
        assert!(dir.join(".locke/README.md").exists(), "ensure_locke ran");

        // Re-writing overwrites in place (no duplication).
        write_agent_prompt(repo, 7, "updated\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "updated\n");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_logs_round_trip_newest_first() {
        let dir = tmp("runs");
        let repo = dir.to_str().unwrap();

        assert!(read_runs(repo).unwrap().is_empty(), "no runs dir yet");

        write_run(repo, "run-100", &json!({ "runId": "run-100", "branch": "agent/x", "endedAt": 100, "state": "done" })).unwrap();
        write_run(repo, "run-300", &json!({ "runId": "run-300", "branch": "agent/y", "endedAt": 300, "state": "failed" })).unwrap();
        write_run(repo, "run-200", &json!({ "runId": "run-200", "branch": "agent/x", "endedAt": 200, "state": "done" })).unwrap();
        assert!(dir.join(".locke/runs/run-100.json").exists());

        // Sorted by endedAt descending.
        let runs = read_runs(repo).unwrap();
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[0]["runId"], "run-300");
        assert_eq!(runs[1]["runId"], "run-200");
        assert_eq!(runs[2]["runId"], "run-100");

        // A non-filename-safe runId is sanitized into a valid path.
        write_run(repo, "run/../weird id", &json!({ "runId": "x", "endedAt": 400 })).unwrap();
        assert!(read_runs(repo).unwrap().iter().any(|r| r["endedAt"] == 400));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_settings_opt_out_round_trip() {
        let dir = tmp("agent-settings");

        // No file yet → None, i.e. defaults (nothing disabled, every agent on).
        assert!(read_agent_settings(&dir).unwrap().is_none());

        // Disable one agent; it persists.
        write_agent_settings(&dir, json!({ "disabled": ["codex"] })).unwrap();
        assert!(dir.join("agents.json").exists());
        let got = read_agent_settings(&dir).unwrap().unwrap();
        assert_eq!(got["disabled"][0], "codex");

        // A never-seen agent is absent from the disabled set, so the opt-out
        // model leaves it enabled by default — re-enabling codex empties the set.
        write_agent_settings(&dir, json!({ "disabled": [] })).unwrap();
        let reread = read_agent_settings(&dir).unwrap().unwrap();
        assert_eq!(reread["disabled"].as_array().unwrap().len(), 0);

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
    fn loops_registry_and_item_tree_round_trip() {
        let dir = tmp("loops");
        let repo = dir.to_str().unwrap();

        assert!(read_loops(repo).unwrap().is_empty());
        let lp = Loop {
            id: "loop-1".into(),
            title: "Migrate".into(),
            branch: "chore/x".into(),
            pattern: "src/**/*.vue".into(),
            state: "building".into(),
            total: 3,
            queued: 3,
            template: "Migrate {{file}}".into(),
            concurrency: 6,
            ..Default::default()
        };
        upsert_loop(repo, lp).unwrap();
        assert!(dir.join(".locke/loops.json").exists());

        // Count update is read-modify-write.
        update_loop(repo, "loop-1", |l| {
            l.done = 1;
            l.queued = 2;
            l.state = "building".into();
        })
        .unwrap();
        let got = read_loop(repo, "loop-1").unwrap().unwrap();
        assert_eq!(got.done, 1);
        assert_eq!(got.queued, 2);
        assert!(!got.updated_at.is_empty());

        // A spec the worker would read; path sanitization keeps it unique.
        write_loop_spec(repo, "loop-1", "src/components/Checkout.vue", "# spec\nDo X.").unwrap();
        assert_eq!(
            read_loop_spec(repo, "loop-1", "src/components/Checkout.vue").unwrap().as_deref(),
            Some("# spec\nDo X.")
        );
        assert!(dir.join(".locke/loops/loop-1/spec/src__components__Checkout.vue.md").exists());

        // MCP-style declaration merge + note append, then runner overwrite.
        merge_loop_item(
            repo,
            "loop-1",
            "src/components/Checkout.vue",
            json!({ "declared": "complete", "summary": "converted" }),
        )
        .unwrap();
        append_loop_note(repo, "loop-1", "src/components/Checkout.vue", "kept Options API").unwrap();
        let item = read_loop_item(repo, "loop-1", "src/components/Checkout.vue").unwrap().unwrap();
        assert_eq!(item["declared"], "complete");
        assert_eq!(item["summary"], "converted");
        assert_eq!(item["notes"][0]["note"], "kept Options API");
        assert_eq!(item["path"], "src/components/Checkout.vue");

        assert_eq!(read_loop_items(repo, "loop-1").unwrap().len(), 1);

        // Durable progress log appends + reads as JSONL.
        append_loop_event(repo, "loop-1", &json!({ "st": "done", "path": "a.vue", "text": "ok", "t": "12:00:00" })).unwrap();
        append_loop_event(repo, "loop-1", &json!({ "st": "review", "path": "b.vue", "text": "paused", "t": "12:01:00" })).unwrap();
        let prog = read_loop_progress(repo, "loop-1").unwrap();
        assert_eq!(prog.len(), 2);
        assert_eq!(prog[1]["st"], "review");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitize_path_is_collision_free_and_readable() {
        assert_eq!(sanitize_path("src/a/b.vue"), "src__a__b.vue");
        // Distinct paths that would collide under naive `/`→`-` stay distinct.
        assert_ne!(sanitize_path("a/b.c"), sanitize_path("a-b.c"));
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

    #[test]
    fn concurrent_creates_dont_lose_updates() {
        // Many threads create pulls in the same repo at once. Without the repo
        // write lock they'd read the same store and clobber each other (lost
        // updates → fewer than N pulls, duplicate ids). With it, all N persist.
        let dir = tmp("concurrent");
        let repo = dir.to_str().unwrap().to_string();
        let n: u64 = 16;

        let handles: Vec<_> = (0..n)
            .map(|i| {
                let repo = repo.clone();
                std::thread::spawn(move || {
                    create_pull(&repo, &format!("agent/{i}"), "main", "t", "C", true).unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let store = read_pulls(&repo).unwrap();
        assert_eq!(store.pulls.len(), n as usize, "every concurrent create persisted");
        let mut ids: Vec<u64> = store.pulls.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        assert_eq!(ids, (1..=n).collect::<Vec<_>>(), "ids unique and contiguous");
        assert_eq!(store.next_id, n + 1);

        let _ = fs::remove_dir_all(&dir);
    }
}
