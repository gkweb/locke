# Building & review

Once you approve the plan, the loop enters the **building** state. Locke's runner fans out workers across the work set, and every change is gated before it lands.

## How the build runs

The build runner starts a worker pool sized by the loop's **concurrency** setting. It walks the [work graph](/guide/work-graph) in dependency order:

- An item is **eligible** only when everything in its `requires` list has reached `done`.
- Eligible items are grouped into **waves** (topological levels). Items within a wave run in parallel; the next wave starts as its prerequisites clear.
- Within the ready set, higher `priority` items run first.

Each worker:

1. Gets an **isolated git worktree** — no shared checkout, no stashing, so parallel workers never collide.
2. Reads its spec (`loop_read_spec`) and edits the file(s).
3. May discover it needs shared work first and call `loop_block_on_task` — which blocks it until the prerequisite runs (subject to the loop's block policy and a per-run cap).
4. Ends by declaring the outcome:
   - `loop_item_complete` — the change is done and its tests pass.
   - `loop_item_needs_review` — it's uncertain, or the change can't be made safely.

## The commit gate

An item is **only committed** when **both**:

- its agent called `loop_item_complete`, **and**
- its configured checks passed.

Anything else — the agent flagged `needs_review`, a check failed, or the agent errored — routes the item to **review** instead of landing it. This is the core safety contract: agents don't get to silently commit; they declare done, and Locke verifies.

## Monitoring (LoopMonitor)

The **Monitor** view shows the live run under a header of state, progress, and counts (`done` / `running` / `review` / `failed` / `queued` / `blocked`), plus throughput (e.g. "5.8 / min") and elapsed time. It offers three layouts:

| Layout | Shows |
| --- | --- |
| **Board** | A kanban by item state: queued · running · review · done · failed. |
| **Stream** | The event feed — a running log of what each worker is doing. |
| **Grid** | Tiles, one per item, with per-item detail. |

## Reviewing items (LoopReview)

When an item needs your attention, it surfaces in the **Review** view: a unified **diff** on the left, and the loop's note plus a re-queue composer on the right.

- **Approve** — accept the change; the loop continues.
- **Request changes** — re-queue the item with your feedback, so a worker takes another pass.

### Review scope

You can control how much you review at once:

- **Per item** or **per file** — review each change on its own.
- **Per wave** — a stacked mode where you review *all* items in wave N before wave N+1 runs. Each wave can open its own review (Locke keeps a per-wave ledger of which pull each wave produced).

The loop's `review_on_done` setting can also **open a review automatically** when the loop finishes, so the output lands straight in your queue.

## Failure & recovery

- Uncertain or failed items are never lost — they wait in `review` for your call.
- Exceptions are captured durably (in the loop's progress log) so you can diagnose what went wrong.
- Loops are resumable: a `paused` loop can be picked back up.

## When it's done

When every item has reached a terminal state, the loop is `done`. Its committed changes live on the loop's branch — from there it's an ordinary Locke review: approve and push to your remote.

---

**Next:** [Work graph & dependencies](/guide/work-graph) · [Loop lifecycle reference](/reference/loop-lifecycle)
