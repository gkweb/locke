# On-disk layout

Locke persists everything git can't hold as plain files under `<repo>/.locke/`. The `locke-store` crate is the single source of truth and writes atomically (write-to-temp then rename) with cross-process locking.

Commit `.locke/` to **share review history** via git, or `.gitignore` it to keep review state local.

## Top level

```
<repo>/
├── locke.config.json          # optional, committable config (base/remote/checks)
└── .locke/
    ├── pulls.json             # review/pull registry
    ├── loops.json             # loop registry (array of Loop records)
    ├── checks.json            # per-repo check overrides (edited in the UI)
    ├── index.json             # review index (heads/bases)
    ├── reviews/<branch>.json  # per-branch status, verdict, comments, viewed flags
    ├── comments/<id>.json     # comment threads
    └── loops/<id>/            # one directory per loop (below)
```

## Per-loop directory

Each loop gets `.locke/loops/<id>/`, where `<id>` is filename-safe:

```
.locke/loops/<id>/
├── manifest.json          # the work graph — array of ManifestEntry (targets, specs, dependencies)
├── draft.json             # the Builder's unsaved draft (title/branch/base/prompt/mode/resolver)
├── plan.md                # global plan / conventions / assumptions (from Plan mode)
├── plan.json              # structured scope metadata { summary, assumptions } for the Plan view
├── progress.jsonl         # durable append-only event log (one JSON value per line)
├── spec/
│   └── <sanitized-path>.md     # per-item markdown spec (path sanitized: / → __, unsafe → -)
├── items/
│   └── <sanitized-path>.json   # per-item runtime state + result record
├── interview/
│   ├── transcript.json         # append-only interview history [{ key, role, text, file?, ts }]
│   ├── <key>.q.json            # a pending question { nonce, question, choices, file?, ts }
│   └── <key>.a.json            # the human's answer { nonce, text }
└── block/
    ├── <key>.req.json          # loop_block_on_task request { nonce, taskId, title, spec, requires, priority, ts }
    └── <key>.done.json         # injected task terminal state { nonce, status, summary }
```

## What writes what

| Path | Written by |
| --- | --- |
| `manifest.json` | Plan-mode tools (`loop_add_item` / `loop_drop_item` / `loop_add_task` / `loop_write_spec`) and the scheduler. |
| `plan.md`, `plan.json` | `loop_write_plan`. |
| `spec/<path>.md` | `loop_write_spec`. |
| `items/<path>.json` | The build runner + `loop_item_complete` / `loop_item_needs_review` / `loop_write_note`. |
| `interview/*` | `loop_ask` (questions) and the UI (answers). |
| `block/*` | `loop_block_on_task` (requests) and the runner (terminal state). |
| `progress.jsonl` | The runner, continuously — powers the Monitor's Stream and durable exception capture. |
| `draft.json` | The Builder, on autosave. |

## The loop registry

`.locke/loops.json` holds an array of `Loop` records — the fields the Loops list and Monitor read (title, branch, base, `mode`, `state`, counters, `concurrency`, `review_on_done`, `block_policy`, `review_scope`, `wave_pulls`, timestamps). See [Loop lifecycle](/reference/loop-lifecycle#loop-record-counters).
