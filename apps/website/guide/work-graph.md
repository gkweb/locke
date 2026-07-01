# Work graph & dependencies

A loop is not just a flat list of files — it's a **work graph**. Nodes are units of work (files to edit, or shared tasks), and edges express "this has to happen before that." Locke schedules the build over this graph so prerequisites land first and independent work runs in parallel.

The graph is persisted as `manifest.json` in the loop's directory. See the [Manifest reference](/reference/manifest) for the exact schema.

## Nodes: files and tasks

Every node is a `ManifestEntry` with a `kind`:

- **`file`** — edit a specific repo-relative path. Its `id` defaults to the `path`.
- **`task`** — a shared or prerequisite job that isn't tied to one path (e.g. "create the shared `useCart` composable", "add the dependency", "write the codemod"). It gets a stable slug `id` and a `title`, and runs as its own agent job.

Tasks are how a migration expresses the work that has to exist *before* the per-file edits make sense.

## Edges: `requires` and `blocks`

Dependencies are directed:

- **`requires: [id, …]`** on a node — it can't start until every listed node reaches `done` (a "blocked-by" edge).
- **`blocks`** on a task (`loop_add_task`) — the inverse, expressed as a glob or path list. Each matching in-scope file gains a `requires` edge to that task. Handy for "this composable blocks every `.vue` file that uses it."

The strategist authors these during [Plan mode](/guide/plan-mode); a build worker can also inject one mid-run with `loop_block_on_task` when it discovers a missing prerequisite.

## Scheduling: waves & priority

From the `requires` edges Locke computes a **`wave`** for each node — its topological level:

- Wave 0 = nodes with no prerequisites.
- A node's wave is one past the highest wave among its prerequisites.
- Waves are hand-overridable if you need to nudge ordering.

At run time:

- Items whose prerequisites are all `done` become **eligible**.
- Eligible items run concurrently, capped by the loop's **concurrency** setting.
- **`priority`** breaks ties within the ready set (higher runs first).

An item waiting on unmet prerequisites sits in the `blocked` state until they clear.

## Origin: who put a node here

Each node records where it came from via `origin`:

| `origin` | Meaning |
| --- | --- |
| `resolver` | Surfaced by the loop's resolver (glob/list/command/custom). Empty origin is treated as `resolver`. |
| `model` | Authored by the strategist (a promoted file or a task it decided was needed). |
| `human` | You added or pinned it. |

This is what makes the graph honest: you can always see what the model chose to add or drop, and why (dropped items keep their `reason` and stay visible rather than disappearing).

## A worked example

A "migrate components to a shared cart composable" loop might produce:

```
task: add-use-cart        (wave 0)  — create composables/useCart.ts
  └─ blocks: src/components/**/*.vue
       ├─ file: src/components/Cart.vue      (wave 1, requires add-use-cart)
       ├─ file: src/components/MiniCart.vue  (wave 1, requires add-use-cart)
       └─ file: src/components/Header.vue    (wave 1, requires add-use-cart)
```

Wave 0 builds the composable. Once it's `done`, all three components become eligible and build in parallel in wave 1.

---

**Next:** [Manifest schema](/reference/manifest) · [MCP tools that author the graph](/reference/mcp-tools)
