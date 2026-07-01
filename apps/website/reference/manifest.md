# Manifest & work graph

A loop's work graph is persisted as `manifest.json` — a JSON array of `ManifestEntry` objects — in the loop's directory (`.locke/loops/<id>/manifest.json`). Each entry is one node: a file to edit or a shared task. Edges are expressed by the `requires` field. See [Work graph & dependencies](/guide/work-graph) for the conceptual model.

## `ManifestEntry`

The canonical definition lives in `crates/locke-store/src/lib.rs`; the TypeScript mirror is in `packages/core/src/types.ts`.

```typescript
export interface ManifestEntry extends LoopTarget {
  id?: string;
  kind?: string;
  title?: string;
  requires?: string[];
  priority?: number;
  wave?: number;
  approach?: string;
  detected?: string[];
  steps?: string[];
  tests?: string[];
  note?: string;
  spec?: string;
  status?: string;
  origin?: string;
}
```

### Identity & kind

| Field | Type | Description |
| --- | --- | --- |
| `path` | string | Repo-relative path (from `LoopTarget`). For file nodes this is also the natural key. |
| `id` | string | Stable node id. File items default to `path`; task items get a slug. Referenced by other nodes' `requires`. |
| `kind` | string | `"file"` (edit a path) or `"task"` (a shared/prerequisite job with no single path). |
| `title` | string? | Human label for task nodes; file nodes use `path`. |
| `origin` | string | `"resolver"` \| `"model"` \| `"human"`. Empty is treated as `"resolver"`. |

### Dependencies & scheduling

| Field | Type | Description |
| --- | --- | --- |
| `requires` | string[] | Ids that must reach `done` before this item is eligible (blocked-by edges). |
| `priority` | number | Human-pinned ordering within the ready set (higher runs first). Default `0`. |
| `wave` | number | Topological level, derived from `requires` (hand-overridable). |

### Audit & risk

| Field | Type | Description |
| --- | --- | --- |
| `loc` | number | Lines of code (from `LoopTarget`). |
| `risk` | string | `"low"` \| `"med"` \| `"high"`. |
| `flags` | string[] | Detected concerns, e.g. `["mixins", "filters"]`. |
| `inc` | boolean | Whether this file is in scope (builder audit toggle). |
| `reason` | string? | Why excluded (set when `status == "excluded"`). |

### Spec enrichment (written by Plan mode)

| Field | Type | Description |
| --- | --- | --- |
| `approach` | string? | Chosen strategy id, e.g. `"script-setup"`. |
| `detected` | string[] | Detected patterns/concerns. |
| `steps` | string[] | Ordered edit steps. |
| `tests` | string[] | Tests/checks that must pass. |
| `note` | string? | Caveat/decision for a human. |
| `spec` | string? | Repo-relative ref to the per-item markdown spec, once written. |

### Status & lifecycle

| Field | Type | Description |
| --- | --- | --- |
| `status` | string | See values below. |
| `injected` | boolean | Whether the task was injected mid-run via `loop_block_on_task`. |

**`status` values:**

| Value | Meaning |
| --- | --- |
| `""` | Legacy / default. |
| `"candidate"` | Surfaced by the scope hint but not (yet) chosen by the strategist (`inc=false`). |
| `"speccing"` | Actively being specced. |
| `"specced"` | Specification complete. |
| `"review"` | Awaiting review. |
| `"excluded"` | Dropped by the strategist (with an optional `reason`). |

## How it's written

The strategist authors and enriches the manifest during [Plan mode](/guide/plan-mode) via `loop_add_item`, `loop_drop_item`, `loop_add_task`, and `loop_write_spec`. Build workers can inject a task node via `loop_block_on_task`. See the [MCP tool reference](/reference/mcp-tools).
