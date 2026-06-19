# Locke

Review what your agents built locally — before it reaches `origin/main`.

Locke is a desktop app (Tauri v2) for reviewing work coding agents (Claude, Codex, …)
produce on **local git branches**. It presents each branch as a reviewable "pull
request": prompt, agent-written description, checks, file diffs, inline comment
threads, and an approve-&-push flow — all against your local repo, no GitHub round-trip.

## Stack

- **pnpm monorepo** — `apps/desktop` (the app) + `packages/*` (shared code).
- **Frontend** — React + TypeScript + Vite, styled with typed style objects and a
  shared token palette (`apps/desktop/src/theme/tokens.ts`). Fonts (Geist / Geist
  Mono) are bundled, not CDN-loaded.
- **Backend** — Rust (Tauri v2). Git reads via `git2` (libgit2); push shells out to
  the user's `git`; local checks run configured shell commands.
- **Persistence** — plain files under `<repo>/.locke/` for the things git can't
  hold: comment threads, the reviewer's verdict, status, and viewed flags
  (`reviews/<branch>.json`) plus per-repo check overrides (`checks.json`). Commit
  `.locke/` to share review history via git, or `.gitignore` it to keep it local.
- **Config** — optional `locke.config.json` at the repo root (committable) sets the
  `base` branch, push `remote`, and default `checks`.

## Layout

```
apps/desktop/        Tauri app
  src/               React frontend (views/, components/, state/, lib/, api/, theme/)
  src-tauri/         Rust core (git.rs, actions.rs, commands.rs, lib.rs)
packages/core/       Shared TS types + mock sample data (@locke/core)
```

## How "PRs" map to git

Local git has no PRs or comments, so Locke derives what it can and stores the rest:

| Concept                     | Source                                            |
| --------------------------- | ------------------------------------------------- |
| A "review"                  | a head branch ahead of a base branch              |
| Files / hunks / commits     | `git diff <base>...<head>` and `git log` (git2)   |
| Status / verdict / comments | files in `<repo>/.locke/reviews/<branch>.json`    |
| Approve & push              | `git push` to the configured remote               |
| Run tests                   | checks run against the branch in a detached **git worktree** (no checkout/stash) |

Check precedence: a per-repo override in `.locke/checks.json` (edited in the UI) >
`checks` in `locke.config.json` > auto-detection (`package.json` scripts via the
detected package manager + `Cargo.toml`).

### locke.config.json (optional, committable)

```json
{
  "base": "main",
  "remote": "origin",
  "checks": [
    { "label": "Lint", "command": "pnpm lint" },
    { "label": "Tests", "command": "pnpm test" }
  ]
}
```

> JSON, not `locke.config.ts`: Locke is a packaged desktop app with no JS runtime
> to *execute* a TS module at review time. JSON is read directly by the Rust core,
> is equally committable, and needs no build step. A future `locke.config.ts` could
> be compiled to this same shape by the frontend bundler if authoring ergonomics
> matter.

## Develop

```bash
pnpm install
pnpm tauri dev          # launch the desktop app (frameless window)
```

With no repo open, the UI runs on `@locke/core` mock data. Click the repo selector
(top of the sidebar) to open a real git repository; branches ahead of `main` show up
as reviews.

Other scripts:

```bash
pnpm dev                # frontend only (browser, mock data — window controls no-op)
pnpm --filter @locke/desktop build      # typecheck + build frontend
pnpm -r typecheck                       # typecheck all packages
cd apps/desktop/src-tauri && cargo test # git + checks unit tests (real temp repos)
```
