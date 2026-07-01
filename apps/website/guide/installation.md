# Installation

Locke is a pnpm monorepo with a Tauri (Rust) backend. To run it from source you need Node, pnpm, and a Rust toolchain.

## Prerequisites

| Tool | Version used by the project |
| --- | --- |
| Node.js | 22.x |
| pnpm | 10.x (`packageManager` is pinned in `package.json`) |
| Rust | stable, with the Tauri v2 prerequisites for your OS |

Follow the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform (Xcode command-line tools on macOS, `webkit2gtk` etc. on Linux, MSVC on Windows).

## Run from source

```bash
pnpm install
pnpm tauri dev          # launch the desktop app (frameless window)
```

On first launch the queue is empty. Click **Open repository…** (or the repo selector at the top of the sidebar) to choose a local git repository. Branches ahead of the base (`main` by default, or the `base` in [`locke.config.json`](/reference/config)) show up as reviews, and you can start a [loop](/guide/loops-quickstart) from the Loops view.

## Other scripts

```bash
pnpm dev                              # frontend only (browser; git-backed features need the Tauri shell)
pnpm --filter @locke/desktop build    # typecheck + build the frontend
pnpm -r typecheck                     # typecheck all packages
cd apps/desktop/src-tauri && cargo test   # git + checks unit tests (real temp repos)
```

::: tip Frontend-only mode
`pnpm dev` serves the React app in a browser. It's handy for UI work, but anything that touches git — reviews, checks, and loop builds — needs the Tauri shell (`pnpm tauri dev`) because that logic lives in the Rust core.
:::

## Packaged builds

macOS signed/notarized builds are produced with the runbook in `apps/desktop/RELEASING.md`. See [Building & releasing](/contributing/building) for an overview.
