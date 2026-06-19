// Write-side git actions and local checks. Push shells out to the user's `git`
// so it reuses their existing credential/SSH setup. Checks run arbitrary
// configured shell commands in the repo and report pass/fail.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

type R<T> = Result<T, String>;

/// Pick the JS package manager from the repo's lockfile, defaulting to npm.
fn detect_package_manager(root: &Path) -> &'static str {
    if root.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if root.join("yarn.lock").exists() {
        "yarn"
    } else if root.join("bun.lockb").exists() {
        "bun"
    } else {
        "npm"
    }
}

/// Inspect the repo and propose a check list from its tooling: known
/// package.json scripts (lint/typecheck/test/build) run via the detected package
/// manager, plus Cargo checks when a Cargo.toml is present. Order is fast→slow.
pub fn detect_checks(repo: &str) -> Vec<CheckSpec> {
    let root = Path::new(repo);
    let mut checks = Vec::new();

    let pkg = root.join("package.json");
    if pkg.exists() {
        let pm = detect_package_manager(root);
        if let Ok(text) = std::fs::read_to_string(&pkg) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                let scripts = json.get("scripts").and_then(|s| s.as_object());
                // Preferred scripts, in display order. Aliases map to one label.
                let wanted: [(&str, &[&str]); 4] = [
                    ("Lint", &["lint"]),
                    ("Typecheck", &["typecheck", "type-check", "tsc"]),
                    ("Tests", &["test"]),
                    ("Build", &["build"]),
                ];
                for (label, names) in wanted {
                    if let Some(name) = names
                        .iter()
                        .find(|n| scripts.map_or(false, |s| s.contains_key(**n)))
                    {
                        checks.push(CheckSpec {
                            label: label.to_string(),
                            command: format!("{pm} run {name}"),
                        });
                    }
                }
            }
        }
    }

    if root.join("Cargo.toml").exists() {
        checks.push(CheckSpec { label: "cargo check".into(), command: "cargo check".into() });
        checks.push(CheckSpec { label: "cargo test".into(), command: "cargo test".into() });
    }

    checks
}

/// Push a branch to a remote. Returns combined output on success.
pub fn push_branch(repo: &str, branch: &str, remote: &str) -> R<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["push", remote, branch])
        .output()
        .map_err(|e| format!("spawn git: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if out.status.success() {
        Ok(format!("{stdout}{stderr}").trim().to_string())
    } else {
        Err(format!("{stdout}{stderr}").trim().to_string())
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CheckSpec {
    pub label: String,
    pub command: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub label: String,
    pub status: String, // "pass" | "fail"
    pub detail: String,
}

fn run_git(repo: &str, args: &[&str]) -> R<()> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("spawn git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn sanitize(branch: &str) -> String {
    branch.chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect()
}

/// Run checks against the **reviewed branch's** content via a detached git
/// worktree, so they reflect the branch under review without touching the user's
/// working tree (no checkout/stash). `node_modules` is symlinked from the main
/// worktree when present so dependency-backed checks work without a reinstall.
/// `detail` is a short human summary (last non-empty output line, or the exit).
pub fn run_checks(repo: &str, branch: &str, checks: Vec<CheckSpec>) -> R<Vec<CheckResult>> {
    let wt = std::env::temp_dir().join(format!("locke-wt-{}", sanitize(branch)));
    let wt_str = wt.to_string_lossy().to_string();

    // Clean any stale worktree, then create a fresh detached one at the branch tip.
    let _ = run_git(repo, &["worktree", "remove", "--force", &wt_str]);
    let _ = std::fs::remove_dir_all(&wt);
    run_git(repo, &["worktree", "add", "--detach", &wt_str, branch])
        .map_err(|e| format!("create worktree for {branch}: {e}"))?;

    #[cfg(unix)]
    {
        let nm = Path::new(repo).join("node_modules");
        if nm.exists() && !wt.join("node_modules").exists() {
            let _ = std::os::unix::fs::symlink(&nm, wt.join("node_modules"));
        }
    }

    let results = run_in(&wt, checks);

    let _ = run_git(repo, &["worktree", "remove", "--force", &wt_str]);
    let _ = std::fs::remove_dir_all(&wt);
    let _ = run_git(repo, &["worktree", "prune"]);

    Ok(results)
}

fn run_in(dir: &Path, checks: Vec<CheckSpec>) -> Vec<CheckResult> {
    let mut results = Vec::new();
    for c in checks {
        let out = Command::new("sh")
            .arg("-c")
            .arg(&c.command)
            .current_dir(dir)
            .output();
        match out {
            Ok(o) => {
                let combined = format!(
                    "{}{}",
                    String::from_utf8_lossy(&o.stdout),
                    String::from_utf8_lossy(&o.stderr)
                );
                let last = combined.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
                let pass = o.status.success();
                results.push(CheckResult {
                    label: c.label,
                    status: if pass { "pass" } else { "fail" }.to_string(),
                    detail: if !last.is_empty() {
                        last.chars().take(80).collect()
                    } else if pass {
                        "passed".to_string()
                    } else {
                        format!("exit {}", o.status.code().unwrap_or(-1))
                    },
                });
            }
            Err(e) => results.push(CheckResult {
                label: c.label,
                status: "fail".to_string(),
                detail: format!("could not run: {e}"),
            }),
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_run_against_reviewed_branch_worktree() {
        let dir = std::env::temp_dir().join(format!("locke-checks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let g = |args: &[&str]| {
            let st = Command::new("git")
                .args(["-c", "commit.gpgsign=false"])
                .args(args)
                .current_dir(&dir)
                .env("GIT_AUTHOR_NAME", "T")
                .env("GIT_AUTHOR_EMAIL", "t@t")
                .env("GIT_COMMITTER_NAME", "T")
                .env("GIT_COMMITTER_EMAIL", "t@t")
                .status()
                .unwrap();
            assert!(st.success());
        };
        g(&["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("marker.txt"), "base").unwrap();
        g(&["add", "."]);
        g(&["commit", "-q", "-m", "base"]);
        g(&["checkout", "-q", "-b", "feature"]);
        std::fs::write(dir.join("marker.txt"), "feature").unwrap();
        g(&["add", "."]);
        g(&["commit", "-q", "-m", "feat"]);
        g(&["checkout", "-q", "main"]); // working tree is on main…

        let repo = dir.to_str().unwrap();
        let results = run_checks(
            repo,
            "feature",
            vec![
                CheckSpec { label: "content".into(), command: "cat marker.txt".into() },
                CheckSpec { label: "bad".into(), command: "exit 3".into() },
            ],
        )
        .unwrap();
        // …but the check ran in the feature worktree, so it sees "feature".
        assert_eq!(results[0].status, "pass");
        assert_eq!(results[0].detail, "feature");
        assert_eq!(results[1].status, "fail");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_node_and_cargo_checks() {
        let dir = std::env::temp_dir().join(format!("locke-detect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("package.json"),
            r#"{"scripts":{"lint":"eslint .","test":"vitest","build":"vite build"}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        std::fs::write(dir.join("Cargo.toml"), "[package]\nname=\"x\"").unwrap();

        let checks = detect_checks(dir.to_str().unwrap());
        let cmds: Vec<&str> = checks.iter().map(|c| c.command.as_str()).collect();
        assert!(cmds.contains(&"pnpm run lint"));
        assert!(cmds.contains(&"pnpm run test"));
        assert!(cmds.contains(&"pnpm run build"));
        assert!(cmds.contains(&"cargo check"));
        assert!(!cmds.iter().any(|c| c.contains("typecheck")), "no typecheck script defined");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
