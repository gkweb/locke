# `locke.config.json`

An optional, committable config file at the **repository root**. It sets the base branch, the push remote, and the repo's default checks. Everything in it is optional — Locke has sensible defaults.

It's read directly by the Rust core (`apps/desktop/src-tauri/src/config.rs`), so it's plain JSON, not a TypeScript module — a packaged desktop app has no JS runtime to execute a `.ts` config at review time.

## Example

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

## Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `base` | string | `"main"` | The branch reviews (and loops) are compared against. |
| `remote` | string | `"origin"` | The remote approved branches are pushed to. |
| `checks` | array | — | Default checks for this repo. Each is `{ "label": string, "command": string }`. |

`checks[]` entries:

| Field | Type | Description |
| --- | --- | --- |
| `label` | string | Display name for the check (e.g. `"Tests"`). |
| `command` | string | Shell command run against the branch in an isolated worktree. |

## Check precedence

When Locke decides which checks to run, it resolves in this order (highest first):

1. **`.locke/checks.json`** — a per-repo override edited in the UI.
2. **`checks`** in `locke.config.json` — this file.
3. **Auto-detection** — `package.json` scripts (via the detected package manager) and `Cargo.toml`.

So an in-app override beats the committed config, which beats auto-detection.

## Commit it or ignore it

`locke.config.json` is committable — sharing it gives everyone on the repo the same base, remote, and checks. The per-repo `.locke/` state directory (review verdicts, comments, loop state) can be committed to **share review history** or `.gitignore`d to keep it local. See the [on-disk layout](/reference/on-disk-layout).
