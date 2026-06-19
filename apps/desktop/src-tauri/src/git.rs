// Real local-git reads via libgit2. Each function opens the repo fresh (cheap,
// keeps things stateless) and returns serde-serializable DTOs that mirror the
// frontend's @locke/core shapes. Push is handled out-of-band via the git CLI.

use git2::{Branch, BranchType, Commit, Diff, DiffOptions, Oid, Patch, Repository, Tree};
use serde::Serialize;

/// Git-derived facts about one review (a head branch ahead of a base branch).
/// The frontend merges this with locally-stored metadata (status, agent, …).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReview {
    pub id: String,
    pub branch: String,
    pub base: String,
    pub title: String,
    pub author: String,
    pub files: usize,
    pub add: usize,
    pub del: usize,
    pub commits: usize,
    pub time: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub sha: String,
    pub msg: String,
    pub time: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileSummary {
    pub path: String,
    pub dir: String,
    pub name: String,
    pub st: String,
    pub add: usize,
    pub del: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReviewDetail {
    pub head: String,
    pub base: String,
    pub commits: Vec<GitCommit>,
    pub file_summary: Vec<GitFileSummary>,
}

/// [kind, oldNo, newNo, text] — same tuple the design's diff builders consume.
#[derive(Serialize)]
pub struct GitDiffLine(pub String, pub u32, pub u32, pub String);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHunk {
    pub hdr: String,
    pub lines: Vec<GitDiffLine>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub hunks: Vec<GitHunk>,
}

type R<T> = Result<T, String>;

fn open(path: &str) -> R<Repository> {
    // discover() walks upward to find the .git dir, so picking a subfolder of a
    // repo (not just its root) still works.
    Repository::discover(path).map_err(|e| format!("open repo: {e}"))
}

/// Best-effort detection of the repo's trunk branch: origin/HEAD's target, then
/// common names, then the current branch. Used when no base is configured.
pub fn detect_base(repo_path: &str) -> R<String> {
    let repo = open(repo_path)?;
    let exists = |n: &str| repo.find_branch(n, BranchType::Local).is_ok();

    if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Some(target) = reference.symbolic_target() {
            if let Some(name) = target.rsplit('/').next() {
                if exists(name) {
                    return Ok(name.to_string());
                }
            }
        }
    }
    for cand in ["main", "master", "trunk", "develop"] {
        if exists(cand) {
            return Ok(cand.to_string());
        }
    }
    if let Ok(head) = repo.head() {
        if head.is_branch() {
            if let Some(name) = head.shorthand() {
                return Ok(name.to_string());
            }
        }
    }
    Err("could not determine a base branch (no main/master found)".to_string())
}

fn branch_tip<'r>(repo: &'r Repository, name: &str) -> R<Commit<'r>> {
    let branch = repo
        .find_branch(name, BranchType::Local)
        .map_err(|e| format!("find branch {name}: {e}"))?;
    branch
        .get()
        .peel_to_commit()
        .map_err(|e| format!("peel {name}: {e}"))
}

/// Tree to diff *from*: the merge-base of head and base, giving `base...head`
/// (three-dot) semantics so only the branch's own changes show.
fn merge_base_tree<'r>(repo: &'r Repository, base: Oid, head: Oid) -> R<Tree<'r>> {
    let mb = repo.merge_base(base, head).unwrap_or(base);
    let commit = repo.find_commit(mb).map_err(|e| format!("merge-base commit: {e}"))?;
    commit.tree().map_err(|e| format!("merge-base tree: {e}"))
}

fn diff_for<'r>(
    repo: &'r Repository,
    branch: &str,
    base: &str,
    pathspec: Option<&str>,
) -> R<Diff<'r>> {
    let head_commit = branch_tip(repo, branch)?;
    let base_commit = branch_tip(repo, base)?;
    let from = merge_base_tree(repo, base_commit.id(), head_commit.id())?;
    let to = head_commit.tree().map_err(|e| format!("head tree: {e}"))?;

    let mut opts = DiffOptions::new();
    opts.context_lines(3);
    if let Some(p) = pathspec {
        opts.pathspec(p);
    }
    repo.diff_tree_to_tree(Some(&from), Some(&to), Some(&mut opts))
        .map_err(|e| format!("diff: {e}"))
}

/// Human-relative time, mirroring the design's "8 min ago" style.
fn humanize(commit_time: i64, now: i64) -> String {
    let secs = (now - commit_time).max(0);
    let mins = secs / 60;
    let hours = mins / 60;
    let days = hours / 24;
    if secs < 60 {
        "just now".to_string()
    } else if mins < 60 {
        format!("{mins} min ago")
    } else if hours < 24 {
        format!("{hours} hour{} ago", if hours == 1 { "" } else { "s" })
    } else if days == 1 {
        "yesterday".to_string()
    } else if days < 30 {
        format!("{days} days ago")
    } else {
        format!("{} months ago", days / 30)
    }
}

fn split_path(path: &str) -> (String, String) {
    match path.rfind('/') {
        Some(i) => (path[..=i].to_string(), path[i + 1..].to_string()),
        None => (String::new(), path.to_string()),
    }
}

fn now_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Summarize a single head→base pair. Returns None when the head isn't ahead of
/// the base (nothing to review). Used both for the auto-listing and for explicit
/// reviews created against an arbitrary base.
fn summarize_one(repo: &Repository, branch: &str, base: &str, now: i64) -> R<Option<GitReview>> {
    if branch == base {
        return Ok(None);
    }
    let tip = match branch_tip(repo, branch) {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    let base_commit = branch_tip(repo, base)?;
    let (ahead, _behind) = repo.graph_ahead_behind(tip.id(), base_commit.id()).unwrap_or((0, 0));
    if ahead == 0 {
        return Ok(None);
    }
    let diff = diff_for(repo, branch, base, None)?;
    let stats = diff.stats().map_err(|e| format!("stats: {e}"))?;
    // Extract before building the struct so the borrowed Signature temporary is
    // dropped before `tip` at end of scope.
    let title = tip.summary().unwrap_or("").to_string();
    let author = tip.author().name().unwrap_or("").to_string();
    let time = humanize(tip.time().seconds(), now);
    Ok(Some(GitReview {
        id: branch.to_string(),
        branch: branch.to_string(),
        base: base.to_string(),
        title,
        author,
        files: stats.files_changed(),
        add: stats.insertions(),
        del: stats.deletions(),
        commits: ahead,
        time,
    }))
}

/// Examine at most this many (most-recent) branches for ahead-of-base status,
/// and return at most this many reviews. Keeps repos with thousands of branches
/// responsive — the expensive per-branch diff runs only for candidates that pass
/// the cheap recency + ahead checks. Older reviews are still reachable via the
/// New-review picker.
const SCAN_CAP: usize = 400;
const RESULT_CAP: usize = 100;

pub fn list_reviews(repo_path: &str, base: &str) -> R<Vec<GitReview>> {
    let repo = open(repo_path)?;
    let now = now_secs();
    let base_commit = branch_tip(&repo, base)?;
    let base_oid = base_commit.id();

    // Cheaply collect (name, tip) for every local branch, then sort by recency.
    let mut entries: Vec<(String, Commit)> = Vec::new();
    for entry in repo.branches(Some(BranchType::Local)).map_err(|e| format!("branches: {e}"))? {
        let (branch, _) = entry.map_err(|e| format!("branch entry: {e}"))?;
        let Some(name) = branch_name(&branch) else { continue };
        if name == base {
            continue;
        }
        if let Ok(tip) = branch.get().peel_to_commit() {
            entries.push((name, tip));
        }
    }
    entries.sort_by(|a, b| b.1.time().seconds().cmp(&a.1.time().seconds()));

    // Diff only the candidates that are actually ahead of base, capped.
    let mut out = Vec::new();
    for (name, tip) in entries.into_iter().take(SCAN_CAP) {
        let (ahead, _behind) = repo.graph_ahead_behind(tip.id(), base_oid).unwrap_or((0, 0));
        if ahead == 0 {
            continue;
        }
        let diff = diff_for(&repo, &name, base, None)?;
        let stats = diff.stats().map_err(|e| format!("stats: {e}"))?;
        let title = tip.summary().unwrap_or("").to_string();
        let author = tip.author().name().unwrap_or("").to_string();
        let time = humanize(tip.time().seconds(), now);
        out.push(GitReview {
            id: name.clone(),
            branch: name,
            base: base.to_string(),
            title,
            author,
            files: stats.files_changed(),
            add: stats.insertions(),
            del: stats.deletions(),
            commits: ahead,
            time,
        });
        if out.len() >= RESULT_CAP {
            break;
        }
    }
    Ok(out)
}

/// Summarize one explicit review (any head/base). None if the head isn't ahead.
pub fn review_summary(repo_path: &str, branch: &str, base: &str) -> R<Option<GitReview>> {
    let repo = open(repo_path)?;
    summarize_one(&repo, branch, base, now_secs())
}

/// All local branch names, sorted — for the New-review head/base pickers.
pub fn list_branches(repo_path: &str) -> R<Vec<String>> {
    let repo = open(repo_path)?;
    let mut names = Vec::new();
    for entry in repo.branches(Some(BranchType::Local)).map_err(|e| format!("branches: {e}"))? {
        let (branch, _) = entry.map_err(|e| format!("branch entry: {e}"))?;
        if let Some(n) = branch_name(&branch) {
            names.push(n);
        }
    }
    names.sort();
    Ok(names)
}

fn branch_name(branch: &Branch) -> Option<String> {
    branch.name().ok().flatten().map(|s| s.to_string())
}

pub fn get_review(repo_path: &str, branch: &str, base: &str) -> R<GitReviewDetail> {
    let repo = open(repo_path)?;
    let now = now_secs();

    // Commits in base..branch, newest first.
    let head = branch_tip(&repo, branch)?;
    let base_commit = branch_tip(&repo, base)?;
    let mut walk = repo.revwalk().map_err(|e| format!("revwalk: {e}"))?;
    walk.push(head.id()).map_err(|e| format!("push head: {e}"))?;
    walk.hide(base_commit.id()).map_err(|e| format!("hide base: {e}"))?;

    let mut commits = Vec::new();
    for oid in walk {
        let oid = oid.map_err(|e| format!("walk: {e}"))?;
        let c = repo.find_commit(oid).map_err(|e| format!("commit: {e}"))?;
        commits.push(GitCommit {
            sha: oid.to_string()[..7].to_string(),
            msg: c.summary().unwrap_or("").to_string(),
            time: humanize(c.time().seconds(), now),
        });
    }

    // Per-file summary.
    let diff = diff_for(&repo, branch, base, None)?;
    let mut file_summary = Vec::new();
    let nd = diff.deltas().len();
    for i in 0..nd {
        let patch = Patch::from_diff(&diff, i).map_err(|e| format!("patch: {e}"))?;
        let Some(patch) = patch else { continue };
        let delta = patch.delta();
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();
        let (_ctx, add, del) = patch.line_stats().map_err(|e| format!("line stats: {e}"))?;
        let (dir, name) = split_path(&path);
        file_summary.push(GitFileSummary {
            path,
            dir,
            name,
            st: status_letter(delta.status()),
            add,
            del,
        });
    }

    Ok(GitReviewDetail {
        head: branch.to_string(),
        base: base.to_string(),
        commits,
        file_summary,
    })
}

fn status_letter(s: git2::Delta) -> String {
    match s {
        git2::Delta::Added => "A",
        git2::Delta::Deleted => "D",
        git2::Delta::Renamed => "R",
        git2::Delta::Copied => "C",
        _ => "M",
    }
    .to_string()
}

pub fn get_diff(repo_path: &str, branch: &str, base: &str, file: &str) -> R<GitDiff> {
    let repo = open(repo_path)?;
    let diff = diff_for(&repo, branch, base, Some(file))?;

    let mut hunks = Vec::new();
    let nd = diff.deltas().len();
    for i in 0..nd {
        let patch = Patch::from_diff(&diff, i).map_err(|e| format!("patch: {e}"))?;
        let Some(patch) = patch else { continue };
        let nh = patch.num_hunks();
        for h in 0..nh {
            let (hunk, line_count) = patch.hunk(h).map_err(|e| format!("hunk: {e}"))?;
            let hdr = String::from_utf8_lossy(hunk.header()).trim_end().to_string();
            let mut lines = Vec::new();
            for l in 0..line_count {
                let line = patch.line_in_hunk(h, l).map_err(|e| format!("line: {e}"))?;
                let kind = match line.origin() {
                    '+' => "add",
                    '-' => "del",
                    _ => "ctx",
                };
                let text = String::from_utf8_lossy(line.content()).trim_end_matches('\n').to_string();
                lines.push(GitDiffLine(
                    kind.to_string(),
                    line.old_lineno().unwrap_or(0),
                    line.new_lineno().unwrap_or(0),
                    text,
                ));
            }
            hunks.push(GitHunk { hdr, lines });
        }
    }
    Ok(GitDiff { hunks })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    fn git(dir: &PathBuf, args: &[&str]) {
        let status = Command::new("git")
            .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "T")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "T")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn write(dir: &PathBuf, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    /// Builds a throwaway repo: main with a base file, then agent/x ahead by one
    /// commit that modifies the file. Exercises all three read functions.
    fn setup() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("locke-git-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        write(&dir, "app.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "base"]);
        git(&dir, &["checkout", "-q", "-b", "agent/feature"]);
        write(&dir, "app.ts", "const a = 1;\nconst b = 22;\nconst c = 3;\nconst d = 4;\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "tweak b and add d"]);
        dir
    }

    #[test]
    fn reads_reviews_detail_and_diff() {
        let dir = setup();
        let path = dir.to_str().unwrap();

        let reviews = list_reviews(path, "main").expect("list_reviews");
        assert_eq!(reviews.len(), 1, "only the agent branch is ahead");
        let r = &reviews[0];
        assert_eq!(r.branch, "agent/feature");
        assert_eq!(r.commits, 1);
        assert_eq!(r.title, "tweak b and add d");
        assert!(r.add >= 1 && r.del >= 1);

        let detail = get_review(path, "agent/feature", "main").expect("get_review");
        assert_eq!(detail.commits.len(), 1);
        assert_eq!(detail.file_summary.len(), 1);
        assert_eq!(detail.file_summary[0].path, "app.ts");
        assert_eq!(detail.file_summary[0].st, "M");

        let diff = get_diff(path, "agent/feature", "main", "app.ts").expect("get_diff");
        assert_eq!(diff.hunks.len(), 1);
        let kinds: Vec<&str> = diff.hunks[0].lines.iter().map(|l| l.0.as_str()).collect();
        assert!(kinds.contains(&"add"));
        assert!(kinds.contains(&"del"));
        assert!(kinds.contains(&"ctx"));

        // Branch listing + explicit single-review summary (any head/base).
        let branches = list_branches(path).expect("list_branches");
        assert!(branches.contains(&"main".to_string()));
        assert!(branches.contains(&"agent/feature".to_string()));

        let summary = review_summary(path, "agent/feature", "main").expect("summary");
        assert_eq!(summary.unwrap().commits, 1);
        // No commits ahead → no review.
        assert!(review_summary(path, "main", "agent/feature").unwrap().is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_master_trunk_and_lists_against_it() {
        let dir = std::env::temp_dir().join(format!("locke-master-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let g = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .args(["-c", "commit.gpgsign=false"])
                .args(args)
                .current_dir(&dir)
                .env("GIT_AUTHOR_NAME", "T").env("GIT_AUTHOR_EMAIL", "t@t")
                .env("GIT_COMMITTER_NAME", "T").env("GIT_COMMITTER_EMAIL", "t@t")
                .status().unwrap().success());
        };
        g(&["init", "-q", "-b", "master"]);
        std::fs::write(dir.join("f.txt"), "a\n").unwrap();
        g(&["add", "."]);
        g(&["commit", "-q", "-m", "base"]);
        g(&["checkout", "-q", "-b", "feature"]);
        std::fs::write(dir.join("f.txt"), "a\nb\n").unwrap();
        g(&["add", "."]);
        g(&["commit", "-q", "-m", "more"]);

        let path = dir.to_str().unwrap();
        // No "main" exists — detection must fall back to master.
        assert_eq!(detect_base(path).unwrap(), "master");
        let reviews = list_reviews(path, "master").unwrap();
        assert_eq!(reviews.len(), 1);
        assert_eq!(reviews[0].branch, "feature");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
