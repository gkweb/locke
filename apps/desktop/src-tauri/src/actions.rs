// Write-side git actions and local checks. Push shells out to the user's `git`
// so it reuses their existing credential/SSH setup. Checks run arbitrary
// configured shell commands in the repo and report pass/fail.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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

/// Force-delete a local branch (`git branch -D`). Used by the review "Delete
/// branch" action after the user confirms.
pub fn delete_branch(repo: &str, branch: &str) -> R<()> {
    run_git(repo, &["branch", "-D", branch])
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    /// The binary looked up on PATH, e.g. "claude".
    pub cmd: String,
    pub detected: bool,
    /// Where the binary resolved on PATH when detected (no process is run).
    pub path: Option<String>,
    /// Reserved for an opt-in `--version` probe; always None at launch detection.
    pub version: Option<String>,
}

/// Known coding-agent CLIs Locke can hand a prompt to: (id, display name, binary).
const KNOWN_AGENTS: &[(&str, &str, &str)] = &[
    ("claude", "Claude Code", "claude"),
    ("codex", "Codex CLI", "codex"),
    ("aider", "Aider", "aider"),
    ("gemini", "Gemini CLI", "gemini"),
    ("cursor", "Cursor CLI", "cursor-agent"),
];

/// Detect which known agent CLIs are installed by resolving each binary on
/// `PATH`. Presence-only: nothing is executed, so detection never triggers
/// Gatekeeper/XProtect and never runs an untrusted, slow, or hanging binary.
/// Read-only and side-effect-free.
pub fn detect_agents() -> Vec<AgentInfo> {
    probe_agents(KNOWN_AGENTS)
}

fn probe_agents(agents: &[(&str, &str, &str)]) -> Vec<AgentInfo> {
    agents
        .iter()
        .map(|&(id, name, bin)| {
            let found = which_on_path(bin);
            AgentInfo {
                id: id.into(),
                name: name.into(),
                cmd: bin.into(),
                detected: found.is_some(),
                path: found.map(|p| p.to_string_lossy().into_owned()),
                version: None,
            }
        })
        .collect()
}

/// Well-known install dirs that a GUI app launched from Finder/Dock won't see,
/// because it doesn't inherit the login shell's `PATH` (the shell rc/profile
/// that adds them is never sourced). These augment — never replace — `PATH`.
/// A leading `~/` is expanded against `$HOME`.
const EXTRA_BIN_DIRS: &[&str] = &[
    "~/.local/bin",        // Claude Code native installer, pipx, uv, many CLIs
    "~/.claude/local",     // Claude Code legacy local install
    "~/bin",               // common personal bin
    "/opt/homebrew/bin",   // Homebrew (Apple Silicon)
    "/usr/local/bin",      // Homebrew (Intel) + common manual installs
    "/usr/bin",
    "/bin",
    "~/.npm-global/bin",   // npm with a user global prefix
    "~/.bun/bin",          // bun global
    "~/.deno/bin",         // deno
    "~/.cargo/bin",        // cargo install
    "~/.volta/bin",        // Volta-managed node tools
    "~/.local/share/pnpm", // pnpm global (Linux default PNPM_HOME)
    "~/Library/pnpm",      // pnpm global (macOS default PNPM_HOME)
    "~/.asdf/shims",       // asdf shims
];

/// Build the ordered, de-duplicated list of directories to search for a binary.
/// `PATH` comes first so the user's own ordering and overrides win; then the
/// well-known fallbacks above; then every nvm node version's `bin` (where
/// nvm-installed CLIs and npm globals live).
fn search_dirs() -> Vec<PathBuf> {
    use std::collections::HashSet;
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut dirs: Vec<PathBuf> = Vec::new();
    let push = |dir: PathBuf, dirs: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>| {
        if seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    };

    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            push(dir, &mut dirs, &mut seen);
        }
    }

    for entry in EXTRA_BIN_DIRS {
        let dir = match entry.strip_prefix("~/") {
            Some(rest) => match &home {
                Some(h) => h.join(rest),
                None => continue,
            },
            None => PathBuf::from(entry),
        };
        push(dir, &mut dirs, &mut seen);
    }

    if let Some(h) = &home {
        if let Ok(entries) = std::fs::read_dir(h.join(".nvm/versions/node")) {
            for e in entries.flatten() {
                let bin = e.path().join("bin");
                if bin.is_dir() {
                    push(bin, &mut dirs, &mut seen);
                }
            }
        }
    }

    dirs
}

/// Resolve a bare binary name to the first executable regular file across the
/// search dirs (`PATH` plus well-known install locations). `metadata` follows
/// symlinks, so a dangling symlink (e.g. a binary macOS quarantined and removed)
/// correctly reads as absent. No process is spawned — pure filesystem lookup.
fn which_on_path(bin: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    search_dirs().into_iter().find_map(|dir| {
        let candidate = dir.join(bin);
        match std::fs::metadata(&candidate) {
            Ok(m) if m.is_file() && m.permissions().mode() & 0o111 != 0 => Some(candidate),
            _ => None,
        }
    })
}

/// Resolve an agent's bare binary name to its full path via the same search as
/// detection, so a GUI process that lacks the login shell's `PATH` can still
/// spawn it. Falls back to the bare name (let the OS resolve it via `PATH` at
/// spawn time) when not found, preserving prior behaviour.
pub fn resolve_agent_path(cmd: &str) -> String {
    which_on_path(cmd)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| cmd.to_string())
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

/// Headless argv for an agent binary. The prompt is passed as one argument and
/// never shell-interpolated, so its markdown/quotes can't inject. We aim for
/// "edit autonomously without a TTY"; Locke commits the result afterward, so the
/// agent needs only edit permission (not shell/commit access).
fn agent_argv(cmd: &str, prompt: &str) -> Vec<String> {
    match cmd {
        "claude" => vec![
            "-p".into(),
            prompt.into(),
            "--permission-mode".into(),
            "acceptEdits".into(),
        ],
        "codex" => vec!["exec".into(), prompt.into()],
        "aider" => vec!["--message".into(), prompt.into(), "--yes-always".into()],
        // Best-effort default — most one-shot CLIs accept `-p <prompt>`.
        _ => vec!["-p".into(), prompt.into()],
    }
}

/// Run an enabled agent headlessly against the reviewed branch, then commit its
/// work onto that branch — closing the review loop inside Locke.
///
/// Mirrors `run_checks`' isolation (temp git worktree, `node_modules` symlink)
/// but checks the branch out **non-detached** so commits advance it. After the
/// agent finishes we stage and commit any changes it left (a no-op if it already
/// committed or changed nothing), so the work survives worktree removal. The
/// caller is responsible for only invoking this for a detected, enabled agent.
pub fn run_agent(repo: &str, branch: &str, agent_cmd: &str, prompt: &str) -> R<String> {
    let wt = std::env::temp_dir().join(format!("locke-agent-{}", sanitize(branch)));
    let wt_str = wt.to_string_lossy().to_string();

    let _ = run_git(repo, &["worktree", "remove", "--force", &wt_str]);
    let _ = std::fs::remove_dir_all(&wt);
    run_git(repo, &["worktree", "add", &wt_str, branch])
        .map_err(|e| format!("create worktree for {branch} (is it checked out elsewhere?): {e}"))?;

    #[cfg(unix)]
    {
        let nm = Path::new(repo).join("node_modules");
        if nm.exists() && !wt.join("node_modules").exists() {
            let _ = std::os::unix::fs::symlink(&nm, wt.join("node_modules"));
        }
    }

    let argv = agent_argv(agent_cmd, prompt);
    // Spawn the resolved full path (not the bare name) so a GUI process without
    // the login shell's PATH still launches the binary detection found.
    let exe = resolve_agent_path(agent_cmd);
    let run = Command::new(&exe).args(&argv).current_dir(&wt).output();

    // Persist whatever the agent changed onto the branch (no-op if it already
    // committed or made no edits), so removing the worktree keeps the work.
    if let Ok(o) = &run {
        if o.status.success() {
            let _ = run_git(&wt_str, &["add", "-A"]);
            let _ = run_git(&wt_str, &["commit", "-m", "agent: address review change requests"]);
        }
    }

    let _ = run_git(repo, &["worktree", "remove", "--force", &wt_str]);
    let _ = std::fs::remove_dir_all(&wt);
    let _ = run_git(repo, &["worktree", "prune"]);

    match run {
        Ok(o) => {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            if o.status.success() {
                Ok(combined.trim().to_string())
            } else {
                Err(format!("agent exited {}: {}", o.status.code().unwrap_or(-1), combined.trim()))
            }
        }
        Err(e) => Err(format!("could not run {agent_cmd}: {e}")),
    }
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
    fn agent_edits_in_worktree_and_locke_commits_to_branch() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("locke-agent-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let g = |args: &[&str]| {
            let st = Command::new("git")
                .args(["-c", "commit.gpgsign=false"])
                .args(args)
                .current_dir(&dir)
                .env("GIT_AUTHOR_NAME", "T").env("GIT_AUTHOR_EMAIL", "t@t")
                .env("GIT_COMMITTER_NAME", "T").env("GIT_COMMITTER_EMAIL", "t@t")
                .status().unwrap();
            assert!(st.success());
        };
        g(&["init", "-q", "-b", "main"]);
        std::fs::write(dir.join("seed.txt"), "seed").unwrap();
        g(&["add", "."]);
        g(&["commit", "-q", "-m", "seed"]);
        g(&["checkout", "-q", "-b", "feature"]);
        g(&["checkout", "-q", "main"]); // feature exists but is not checked out

        // run_agent commits via plain `git` (no env), so identity + no-sign must
        // live in the repo's own config for the commit to succeed hermetically.
        g(&["config", "user.name", "Agent Test"]);
        g(&["config", "user.email", "agent@test"]);
        g(&["config", "commit.gpgsign", "false"]);

        // Fake agent: makes an edit but does NOT commit — Locke must commit it.
        let agent = dir.join("fake-agent.sh");
        std::fs::write(&agent, "#!/bin/sh\nprintf 'fixed by agent\\n' > agent-edit.txt\n").unwrap();
        std::fs::set_permissions(&agent, std::fs::Permissions::from_mode(0o755)).unwrap();

        let repo = dir.to_str().unwrap();
        run_agent(repo, "feature", agent.to_str().unwrap(), "address the change requests").unwrap();

        // The edit landed as a commit on `feature` (visible without checkout)…
        let show = Command::new("git").arg("-C").arg(repo)
            .args(["show", "feature:agent-edit.txt"]).output().unwrap();
        assert!(show.status.success(), "agent edit is committed on feature");
        assert_eq!(String::from_utf8_lossy(&show.stdout).trim(), "fixed by agent");

        // …and main is untouched (isolation).
        let on_main = Command::new("git").arg("-C").arg(repo)
            .args(["show", "main:agent-edit.txt"]).output().unwrap();
        assert!(!on_main.status.success(), "main must not have the agent's file");

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

    #[test]
    fn probes_present_and_absent_agents() {
        // Presence-only and deterministic: `true` resolves on PATH; the bogus
        // name never does. Nothing is executed.
        let registry: &[(&str, &str, &str)] = &[
            ("present", "Present", "true"),
            ("absent", "Absent", "locke-no-such-agent-xyzzy"),
        ];
        let infos = probe_agents(registry);
        assert_eq!(infos.len(), 2);
        assert!(infos[0].detected, "binary on PATH is detected");
        assert!(infos[0].path.is_some(), "resolved path is recorded");
        assert!(!infos[1].detected, "missing binary is absent, not an error");
        assert!(infos[1].path.is_none());
        assert!(infos[0].version.is_none(), "no version probe at detection");
    }

    #[test]
    fn detect_agents_includes_known_registry() {
        // The real registry resolves every known agent (each detected or not)
        // via PATH lookup only — no process is spawned, so this is fast and safe.
        let infos = detect_agents();
        assert!(infos.iter().any(|a| a.id == "claude"), "claude is a known agent");
        assert_eq!(infos.len(), 5);
    }
}
