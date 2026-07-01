# Loops quick-start

A **loop** runs one task across many files as a single, planned, reviewable operation. This page walks the whole flow at a glance; the following pages go deep on each phase.

## The shape of a loop

```
Builder  →  Plan mode  →  Build mode  →  Review  →  Done
   │            │             │            │
 prompt +    strategist    workers      human
 resolver    + interview   + commit      approve
 + settings  + specs       (in worktrees) + push
```

A loop moves through those phases and is **resumable** at each one — drafts auto-save, and you can stop, re-plan, or pick a build back up.

## 1. Create a loop (Builder)

Open the **Loops** view and start a new loop. You provide:

- **A prompt** — the task to run across the set (e.g. *"Convert this component from the Options API to `<script setup>`"*).
- **A resolver** — how Locke finds the candidate files: a **glob**, an explicit **list**, a shell **command**, or a **custom** resolver. Glob resolvers support brace expansion and multiple lines.
- **Optional scope hint & settings** — concurrency, base branch, and review scope.

The resolver runs and produces a **candidate pool** — a preview of matched paths with per-file risk and lines-of-code flags. You can include/exclude candidates here, but remember the pool is only a starting hint: the strategist refines it in Plan mode.

::: tip Drafts are saved automatically
A half-configured loop is persisted, so you can close the app and resume setup later.
:::

## 2. Plan (Plan mode)

When you start planning, Locke runs a **strategist** agent that reads the set **read-only** — it edits nothing. It:

- decides the real work set (adds files the hint missed, drops ones that don't belong, each with a reason),
- **interviews you** with focused questions when a decision would change the plan,
- writes a **global plan** (shared conventions for every worker), and
- writes a **per-item spec** for each file — or flags an item `needs review` when it's unsure.

You watch this happen live in the **Scope** and **Item specs** tabs, and nothing builds until you approve. → [Plan mode in depth](/guide/plan-mode).

## 3. Approve & build

Review the plan, edit specs or exclusions if you like, and **approve**. Locke's build runner fans out **workers**, one per item, respecting the [work graph's](/guide/work-graph) dependencies (prerequisites run first; independent items run in parallel "waves").

Each worker edits its file(s) in an **isolated git worktree**, runs the configured checks, and declares the item done. An item only lands when its agent called `loop_item_complete` **and** its checks passed — otherwise it's routed to review.

## 4. Monitor & review

The **Monitor** shows live per-item status, counts, and elapsed time. As items complete, they surface in **Review**: a per-item diff with a feedback box and a resolve action. Review can be scoped per item, per file, or per **wave** (approve everything in one tier before the next runs). → [Building & review](/guide/building-and-review).

## 5. Done

Approved changes are committed to the loop's branch. From there it's an ordinary Locke review — approve and push to your remote when you're ready.

---

**Next:** [Plan mode](/guide/plan-mode) · [Work graph & dependencies](/guide/work-graph) · [MCP tools the agents use](/reference/mcp-tools)
