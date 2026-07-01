# What is Locke?

Locke is a desktop app (Tauri v2) for reviewing the work coding agents (Claude, Codex, …) produce on **local git branches** — before any of it reaches `origin/main`.

It presents each branch as a reviewable "pull request": the prompt, the agent-written description, checks, file diffs, inline comment threads, and an approve-&-push flow — all against your local repo, with **no GitHub round-trip**.

## Two ways to work

Locke has grown from a review tool into two complementary modes:

### 1. Review what already exists

Point Locke at a local git repository. Every branch ahead of your base branch shows up as a **review**. You read the diff, leave inline comments, run checks in an isolated worktree, and — when you're happy — approve and push. This is the original Locke, described in the project [README](https://github.com/).

Local git has no PRs or comment threads, so Locke derives what it can from git and stores the rest as plain files under `<repo>/.locke/`:

| Concept | Source |
| --- | --- |
| A "review" | a head branch ahead of a base branch |
| Files / hunks / commits | `git diff <base>...<head>` and `git log` (via `git2`) |
| Status / verdict / comments | files in `<repo>/.locke/reviews/<branch>.json` |
| Approve & push | `git push` to the configured remote |
| Run checks | configured commands, run against the branch in a detached git worktree |

### 2. Loops — produce work across a whole codebase {#loops}

**Loops** (new in v2.0, matured through v2.2) invert the flow. Instead of reviewing one branch an agent already made, you give Locke **one task and a set of files**, and it:

1. **Plans** — a strategist agent reads the set read-only, interviews you where it matters, and writes a per-item spec.
2. **Builds** — workers fan out across the files (in dependency order), each editing in an isolated git worktree.
3. **Reviews** — every change is gated on its checks and routed through review before it lands.

Loops is how you run "convert every component to `<script setup>`", "add telemetry to every route handler", or "migrate this package off the deprecated API" — as a single, reviewable, resumable operation instead of dozens of hand-managed agent runs.

→ Jump to the [Loops quick-start](/guide/loops-quickstart).

## The stack, briefly

- **Frontend** — React + TypeScript + Vite, styled with typed style objects over a shared token palette.
- **Backend** — Rust (Tauri v2). Git reads via `git2` (libgit2); push shells out to your `git`; checks run configured shell commands.
- **Agent tools** — the `locke-mcp` crate exposes `loop_*` MCP tools to agents running inside a loop ([reference](/reference/mcp-tools)).
- **Persistence** — plain files under `<repo>/.locke/`. Commit them to share history via git, or `.gitignore` them to keep review state local.

For the full picture, see [Architecture](/contributing/architecture).

## What's shipped vs preview

Everything under **Loops** in these docs is fully wired end-to-end. Some **Mission Control** fleet surfaces are still preview / mocked and are flagged inline:

::: warning Preview feature
Callouts like this mark surfaces that are partially mocked or not yet wired to a live backend.
:::
