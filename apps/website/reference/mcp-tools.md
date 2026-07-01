# MCP loop tools

When an agent runs inside a Locke loop, Locke exposes a set of MCP tools prefixed `loop_`. These are how an agent **reads its assignment, shapes the work set, writes specs, asks you questions, and declares an item done**. They are provided by the `locke-mcp` crate and are only meaningful inside a running loop.

Every tool takes a `loop_id`. Locke passes the `loop_id` — and, for item-scoped tools, the `file` (or task `id`) — into the agent's task prompt, so an agent always knows which loop and item it is working on.

The tools split into two phases:

- **Plan mode** — a read-only strategist pass. The agent shapes the work set and writes specs. No files are edited, nothing is committed.
- **Build mode** — a worker edits files for one item, and may discover a prerequisite mid-flight.

::: tip You author the work set
The candidate pool a resolver surfaces is a **hint, not the plan**. In Plan mode the strategist decides what's actually in scope — including files the hint missed and excluding ones that don't belong. See [Plan mode](/guide/plan-mode).
:::

## Plan-mode tools

### `loop_list_candidates`

List the loop's current file set: the candidate pool (`candidate`), files already included (`queued` / `specced`), and any excluded (`excluded`, with the reason). Returns each row's `path`, `loc`, `risk`, `inc` flag, `status`, and `origin`.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id (from your task prompt). |

Use this first, to see what the resolver surfaced before deciding scope.

### `loop_add_item`

Include a file as a real work item — whether or not it was in the candidate pool. Promotes a candidate you've decided is in scope, or adds a file the scope hint missed. The file becomes a queued item the per-item spec pass will plan.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `path` | ✓ | string | Repo-relative path to include (e.g. `src/components/VBtn.vue`). |
| `note` | | string | Why this file is in scope (shown to the reviewer). |

### `loop_drop_item`

Exclude a file or task — a candidate you've decided is out of scope, or a previously-included item you're removing. The item is dropped from the build but stays visible in the work graph **with your reason**, so the human can see what you skipped and re-include it if they disagree. Always give a clear `reason`.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `path` | ✓ | string | The item to exclude: a repo-relative file path, or a task id. |
| `reason` | ✓ | string | Why it's out of scope — shown in the work graph. Be specific. |

### `loop_add_task`

Add a prerequisite or custom **task** to the work graph — a unit of work that isn't one of the resolver's files (e.g. "create the shared composable", "add the dependency", "write the codemod"). The task runs as its own agent job in dependency order. Use `blocks` to make dependent files wait for it.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `id` | ✓ | string | Stable slug id (e.g. `add-use-cart`). Other nodes reference it in `requires`. |
| `title` | ✓ | string | Short human-readable title. |
| `spec` | ✓ | string (md) | Objective, the concrete work, and how to verify. Handed verbatim to the agent that runs the task. |
| `blocks` | | string \| string[] | File items that depend on this task — a glob (e.g. `src/components/**/*.vue`) or an array of paths. Each match gains a `requires` edge to this task. |
| `requires` | | string[] | Ids of other tasks that must finish first. |
| `priority` | | integer | Ordering within the ready set (higher runs first). Default `0`. |
| `note` | | string | Caveat/decision for the reviewer. |

### `loop_write_spec`

Write the per-item spec for **this** loop item. Call exactly once, after analysing the file, describing how the build worker should change it. Persists the spec (the later build reads it) and marks the item `specced`. If a human decision is needed first, set `needs_review=true` with a `note` reason instead of guessing.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `file` | ✓ | string | The repo-relative file this spec is for. |
| `spec` | ✓ | string (md) | Full per-item spec — objective, concrete edits, how to verify. Handed verbatim to the build worker. |
| `approach` | | string | Short id for the chosen strategy (e.g. `script-setup`). |
| `detected` | | string[] | Short tags for what you found (e.g. `Options API`, `Vuex getter`). |
| `steps` | | string[] | Ordered list of the concrete edits the build will make. |
| `tests` | | string[] | Tests/checks that must pass for this item. |
| `requires` | | string[] | Work-graph node ids (file paths or task ids) that must finish before this item runs. |
| `priority` | | integer | Ordering within the ready set. Default `0`. |
| `needs_review` | | boolean | `true` when a human must decide before this item can build; pair with `note`. |
| `note` | | string | Caveat/decision for the reviewer or build worker. |

### `loop_write_plan`

Write the loop's **global** plan once, before/while speccing items. `plan` is the markdown conventions injected into every build worker's prompt. `assumptions` and `summary` populate the Plan view's Scope tab.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `plan` | ✓ | string (md) | Global plan / conventions injected into every build worker's prompt. |
| `assumptions` | | string[] | Assumptions the loop is making, shown before approval. |
| `summary` | | object[] | Dry-run summary rows: `{ label, detail, pend? }`. `pend=true` flags a row awaiting a decision. |

### `loop_ask`

Ask the human **one** clarifying question and **block** until they answer, then continue. Prefer asking over guessing whenever a decision would materially change the plan or a spec. Ask one focused question at a time. Returns the human's answer as text; if none arrives in time, it returns a note telling you to proceed with best judgment (only then fall back to `loop_write_spec(needs_review=true)`).

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `question` | ✓ | string | The single, focused question. Be concrete; reference the file/decision at stake. |
| `file` | | string | The item key (file path or task id) this question is about. Omit for a scope-level question. |
| `choices` | | string[] | Suggested answers, shown as one-click chips. The human may still type their own. |

::: tip
You may call `loop_add_task` mid-conversation to spin off a prerequisite the human confirms during the interview.
:::

## Build-mode tools

### `loop_read_spec`

Read the pre-written spec for **this** item (objective, planned steps, tests), if the loop produced one. Returns the spec markdown or a note that none exists.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `file` | ✓ | string | The repo-relative file. |

### `loop_item_complete`

Declare **this** item done. Call only once the change is finished and its tests pass. Locke gates committing the item on this call **plus** its checks passing; without it, the item is routed to human review. Persists a structured result record.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `file` | ✓ | string | The repo-relative file this item is migrating. |
| `summary` | ✓ | string | One-line summary of what you changed. |
| `artifacts` | | string[] | Files/tests touched. |

### `loop_item_needs_review`

Flag **this** item for human review instead of completing it. Use when you're uncertain, a decision needs the human, or the change can't be made safely. The item will **not** be committed; your reason is shown to the reviewer.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `file` | ✓ | string | The repo-relative file. |
| `reason` | ✓ | string | Why this needs a human's call. |

### `loop_block_on_task`

When, partway through your item, you discover it needs a **prerequisite** done first (a shared util, a migration, a fix in another file), declare it as a task. This **blocks** until the prerequisite has run, then returns its status so you can continue on top of it. Depending on the loop's policy it either runs immediately or waits for the human to approve it. There's a per-run cap on injected work; if you hit it (status `capped`) or it times out, do what you safely can, otherwise call `loop_item_needs_review`. Don't use this for trivial in-file changes you can just make yourself.

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `id` | ✓ | string | Unique kebab-case id for the prerequisite (e.g. `extract-theme-util`). |
| `title` | ✓ | string | Short human label (e.g. "Extract shared theme helper"). |
| `spec` | ✓ | string (md) | What the prerequisite must do — concrete enough for another agent to execute without you. |
| `requires` | | string[] | Ids the prerequisite itself depends on. |
| `priority` | | number | Scheduling priority (higher runs first). |

### `loop_write_note`

Persist a durable note/decision on **this** item that carries forward to a re-queue or the next loop (e.g. an assumption you made, or a follow-up).

| Param | Required | Type | Description |
| --- | --- | --- | --- |
| `loop_id` | ✓ | string | The loop id. |
| `file` | ✓ | string | The repo-relative file. |
| `note` | ✓ | string | The note to persist. |

## A typical agent flow

**Plan mode (strategist):**

1. `loop_list_candidates` — see what the resolver surfaced.
2. `loop_add_item` / `loop_drop_item` — shape the real work set.
3. `loop_add_task` — author any shared prerequisites.
4. `loop_ask` — resolve anything ambiguous with the human.
5. `loop_write_plan` — write the shared conventions once.
6. `loop_write_spec` (per item) — one spec each; `needs_review=true` where you're unsure.

**Build mode (worker, per item):**

1. `loop_read_spec` — read your assignment.
2. Edit the file(s).
3. If blocked on shared work → `loop_block_on_task`.
4. Success → `loop_item_complete`. Uncertain/unsafe → `loop_item_needs_review`.

See [Plan mode](/guide/plan-mode) and [Building & review](/guide/building-and-review) for the human-facing side of the same flow.
