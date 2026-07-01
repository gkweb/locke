# Loop lifecycle

A loop has a **loop-level state** and each of its items has an **item-level state**. Both enums are defined in `packages/core/src/types.ts` and mirrored in the Rust backend.

## Loop states

```typescript
export type LoopState = "draft" | "planning" | "building" | "paused" | "done";
```

| State | Meaning |
| --- | --- |
| `draft` | The Builder is still editing the seed (title, branch, resolver, audit). Not yet running. |
| `planning` | [Plan mode](/guide/plan-mode): the strategist is speccing files read-only and interviewing for decisions. No items committed yet. |
| `building` | Actively iterating. Items move through their own states; changes are committed as they pass the gate. |
| `paused` | The build is paused, waiting on human review of a paused item. |
| `done` | Every item reached a terminal state; the loop is finished. |

```
draft ──▶ planning ──▶ building ──▶ done
                          ▲   │
                          └── paused
```

## Item states

```typescript
export type LoopItemState =
  "queued" | "running" | "review" | "done" | "failed" | "excluded" | "blocked";
```

| State | Meaning |
| --- | --- |
| `queued` | Ready to run, waiting for a free worker. |
| `running` | In flight; the agent has an exclusive worktree and is emitting progress. |
| `review` | The agent paused (or a check failed / it flagged `needs_review`); a human reviews the diff before it can continue or land. |
| `done` | Completed successfully and committed to the loop's branch. |
| `failed` | The agent errored; routed to review for a human decision. |
| `excluded` | Manually excluded from the run (a plan-mode candidate that was dropped). |
| `blocked` | Has unmet `requires` dependencies; can't start until they reach `done`. |

## The commit gate

An item transitions to `done` (and commits) **only** when its agent called `loop_item_complete` **and** its checks passed. Any other outcome routes it to `review` rather than landing it. See [Building & review](/guide/building-and-review#the-commit-gate).

## Loop record counters

The loop registry (`.locke/loops.json`) tracks live tallies used by the Monitor: `total`, `done`, `running`, `review`, `failed`, `queued`, `blocked`, plus a `rate` readout (e.g. `"5.8 / min"`) and `elapsed`. Other notable fields on the loop record:

| Field | Meaning |
| --- | --- |
| `mode` | `"plan"` or `"build"`. |
| `concurrency` | Worker pool size. |
| `review_on_done` | Open a review automatically when the loop finishes. |
| `block_policy` | `"approve"` (human approves injected tasks) or `"auto"` (they run immediately). |
| `review_scope` | `"wave"` for stacked per-wave review (empty = legacy per-item). |
| `wave_pulls` | Ledger of `(wave, pull_id)` — which review each wave opened. |

See the [on-disk layout](/reference/on-disk-layout) for where all of this is stored.
