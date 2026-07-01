# Architecture

Locke is a **Tauri v2 desktop app**: a React + TypeScript frontend over a Rust backend, in a combined pnpm + Cargo workspace. This page orients you to the code.

## Workspace layout

```
locke/                          pnpm workspace + Cargo workspace
├── package.json                root scripts (pnpm dev, pnpm tauri dev)
├── Cargo.toml                  workspace: src-tauri, locke-store, locke-mcp
├── apps/desktop/               the app
│   ├── package.json            @locke/desktop (React/Vite)
│   ├── src/                    React frontend
│   └── src-tauri/              Rust core (the Tauri app)
├── packages/core/              @locke/core — shared TS types only
└── crates/
    ├── locke-store/            on-disk persistence (source of truth)
    └── locke-mcp/              standalone MCP server (agent tools)
```

## The layers

| Layer | Tech | Notes |
| --- | --- | --- |
| Frontend | React 18, TypeScript 5.6, Vite 6 | Zustand for state; `@tauri-apps/api` for IPC. |
| Backend | Rust (2021), Tauri v2 | `git2` (libgit2) for git reads; shells out to `git` for push. |
| Persistence | Rust (`locke-store`) | Atomic writes, cross-process locking; all `.locke/` state. |
| Agent tools | Rust (`locke-mcp`) | JSON-RPC 2.0 MCP server over stdio. |
| Shared types | TypeScript (`@locke/core`) | The contract between front and back. |

## Frontend (`apps/desktop/src`)

| Path | Responsibility |
| --- | --- |
| `state/store.ts` | The Zustand store — reviews, loops, selections, and mutations. |
| `views/` | Top-level screens (Activity, Reviews, Loops, Workspace, …). |
| `views/loops/` | The six Loops screens — see below. |
| `components/` | Reusable React components. |
| `lib/` | Helpers — `loops.ts` (rendering), `mockFleet.ts` (demo/preview data). |
| `api/` | Tauri command invocations (`git.ts`, etc.). |
| `theme/tokens.ts` | The shared token palette; styles are typed style objects. |

### The six Loops views (`views/loops/`)

| File | Renders |
| --- | --- |
| `LoopsView.tsx` | Router — switches between list / builder / plan / monitor / review on `loopView` state. |
| `LoopsList.tsx` | Every loop as a card: title, branch, mode chip, target count, progress, state pill, delete. |
| `LoopBuilder.tsx` | The loop seed editor: title, branch (auto-slug), prompt, plan/build toggle, resolver, and the audit grid. |
| `LoopPlan.tsx` | Plan mode: the scope interview + dry-run summary (Scope tab) and per-item specs (Item-specs tab). |
| `LoopMonitor.tsx` | The live run — Board / Stream / Grid layouts over the item states and counters. |
| `LoopReview.tsx` | One paused item: unified diff + note + re-queue composer (Approve / Request changes). |

## Backend (`apps/desktop/src-tauri/src`)

| File | Responsibility |
| --- | --- |
| `lib.rs` | Tauri app init and event handlers. |
| `commands.rs` | Tauri commands exposed to the frontend (`resolve_targets`, `load_pulls`, …). |
| `loops.rs` | The loop runner: scheduler, worker pool, resolver implementations, event emission. |
| `run.rs` | Agent execution and per-item event streaming. |
| `git.rs` | `git2` operations — worktree, checkout, commit, diff, blame. |
| `actions.rs` | Check/action execution and process spawning. |
| `config.rs` | Reads `locke.config.json`. |

## Crates

- **`crates/locke-store`** — the persistence layer and single source of truth for everything under `.locke/`: the pull registry, comments, checks, the loop registry, and every per-loop artifact (manifest, specs, items, interview, block, progress). Writes are atomic (temp + rename) and cross-process safe. See the [on-disk layout](/reference/on-disk-layout).
- **`crates/locke-mcp`** — a standalone MCP server speaking JSON-RPC 2.0 over stdio. It exposes the [`loop_*` tools](/reference/mcp-tools) to agents running inside a loop. It discovers the repo from the CWD or `$LOCKE_REPO`, and attributes authorship via `$LOCKE_AGENT` (default `agent`).

## How a loop flows through the code

1. **Builder** (`LoopBuilder.tsx`) drafts a loop; `resolve_targets` (`commands.rs` → `loops.rs`) runs the resolver and returns the candidate pool.
2. **Plan mode** — `loops.rs` launches the strategist (`run.rs`); the agent calls `loop_*` tools in `locke-mcp`, which write through `locke-store` (manifest, specs, plan, interview).
3. **Build** — the `loops.rs` scheduler walks the work graph, spawns workers in isolated worktrees (`git.rs`), runs checks (`actions.rs`), and streams events to the Monitor.
4. **Persist** — everything lands under `.locke/loops/<id>/` via `locke-store`.

## What's mocked vs wired

- **Backend, MCP, persistence** — fully wired and production-shaped (real runner, real worktrees, atomic store).
- **Frontend** — some fleet surfaces fall back to `lib/mockFleet.ts` demo data outside the Tauri shell. The Loops and review paths are live. See the [Mission Control](/guide/mission-control) status table.

## Dev commands

```bash
pnpm install
pnpm tauri dev                            # full app (frameless window)
pnpm dev                                  # frontend only (browser)
pnpm -r typecheck                         # typecheck all packages
cd apps/desktop/src-tauri && cargo test   # git + checks unit tests (real temp repos)
```
