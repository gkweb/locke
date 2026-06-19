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
    Repository::open(path).map_err(|e| format!("open repo: {e}"))
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

pub fn list_reviews(repo_path: &str, base: &str) -> R<Vec<GitReview>> {
    let repo = open(repo_path)?;
    let now = now_secs();
    let base_commit = branch_tip(&repo, base)?;
    let base_oid = base_commit.id();

    let mut out = Vec::new();
    let branches = repo.branches(Some(BranchType::Local)).map_err(|e| format!("branches: {e}"))?;
    for entry in branches {
        let (branch, _) = entry.map_err(|e| format!("branch entry: {e}"))?;
        let name = match branch_name(&branch) {
            Some(n) if n != base => n,
            _ => continue,
        };
        let tip = match branch.get().peel_to_commit() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let (ahead, _behind) = repo
            .graph_ahead_behind(tip.id(), base_oid)
            .unwrap_or((0, 0));
        if ahead == 0 {
            continue;
        }
        let diff = diff_for(&repo, &name, base, None)?;
        let stats = diff.stats().map_err(|e| format!("stats: {e}"))?;
        out.push(GitReview {
            id: name.clone(),
            branch: name.clone(),
            base: base.to_string(),
            title: tip.summary().unwrap_or("").to_string(),
            author: tip.author().name().unwrap_or("").to_string(),
            files: stats.files_changed(),
            add: stats.insertions(),
            del: stats.deletions(),
            commits: ahead,
            time: humanize(tip.time().seconds(), now),
        });
    }
    // Most-recently-updated first.
    out.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(out)
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

        let _ = std::fs::remove_dir_all(&dir);
    }
}
