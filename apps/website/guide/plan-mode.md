# Plan mode

Before a loop touches a single file, it runs **Plan mode**: a read-only pass where a **strategist** agent studies the set, decides what's really in scope, interviews you where it matters, and writes the specs the build workers will follow. Nothing is edited and nothing is committed during planning.

This is the phase that turns a rough prompt + a pile of files into a concrete, reviewable plan.

## What the strategist does

The strategist reads the candidate files read-only and, using the [`loop_*` MCP tools](/reference/mcp-tools), it:

1. **Lists the candidate pool** (`loop_list_candidates`) — the files the resolver surfaced, each with `loc`, `risk`, and status.
2. **Shapes the real work set**:
   - `loop_add_item` — promote a candidate, or add a file the resolver missed.
   - `loop_drop_item` — exclude one that doesn't belong, **with a reason** that stays visible in the work graph.
   - `loop_add_task` — author a shared **prerequisite** that isn't one of the files (e.g. "create the shared composable"), and make dependent files wait on it.
3. **Interviews you** (`loop_ask`) — one focused, blocking question at a time whenever a decision would change the plan. Answers can be free text or one-click choice chips, and are stored in a durable transcript.
4. **Writes the global plan** (`loop_write_plan`) — shared conventions injected into every build worker's prompt, plus the assumptions and dry-run summary shown on the Scope tab.
5. **Writes a per-item spec** (`loop_write_spec`) for each file — the objective, concrete edit steps, and tests. If it can't decide safely, it marks the item `needs_review` instead of guessing.

::: tip The candidate pool is a hint, not the plan
A resolver's match list is a starting point. The strategist's job is to decide the *actual* work set — which is why it can add and drop files, each with a rationale you get to see.
:::

## What you see (LoopPlan)

The **Plan** view has two tabs:

- **Scope** — the live scope interview (the strategist's questions and your answers) on one side, and the dry-run spec summary (`plan.md` assumptions + summary rows) on the other. You watch the strategist work in real time.
- **Item specs** — every file's spec, which you can tune before the build starts. Items the strategist flagged `needs_review` are called out so you can make the call.

Planning streams its activity, so you're never staring at a spinner — you see each decision as it lands.

## Interview flow

`loop_ask` **blocks** the strategist until you answer, so the plan genuinely incorporates your decisions rather than guessing and hoping. A question can be:

- **Scope-level** — omit `file`; it surfaces as a general question about the loop.
- **Item-level** — pass the item key; it surfaces on that specific file/task.

If you don't answer in time, the tool tells the agent to proceed with best judgment, and the agent falls back to marking the item `needs_review` where it was unsure. Nothing silently guesses past a real decision.

## Live controls

Plan mode is interactive. You can:

- **Stop a single item's** speccing without halting the whole plan.
- **Re-plan** — re-run the strategist after changing the seed.
- **Recover a stalled plan** — Locke tracks liveness and lets you resume if a strategist stalls.

## Settling to `planning`

When the strategist finishes, the loop sits in the `planning` state awaiting your approval — no builds have started. You review the plan and specs, edit anything you like, and only then **approve** to move into the [build & review](/guide/building-and-review) phase.

---

**Next:** [Building & review](/guide/building-and-review) · [Work graph & dependencies](/guide/work-graph)
