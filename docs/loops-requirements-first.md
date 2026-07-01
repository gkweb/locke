# Loops — Requirements-first decomposition (model decides the task set)

> Comprehensive session brief for a **fresh session**. Builds on the live plan
> interview (`docs/loops-plan-interview.md`, SHIPPED) and the model-authored work
> graph (Phase 3b). Grounded in the current code on branch `feat/v2.2-loops`.
>
> **One-line goal:** stop treating the resolver's glob as the task list. Make the
> model **interview the prompt → gather requirements → then decide the tasks** to
> work on. Lean on the model; the glob becomes a *hint*, not the units.

## Context — the gap this closes

**Today the resolver glob IS the task set, fixed before the model is ever involved.**
Verified end to end:

1. The builder resolves the glob to rows for preview — `resolve_targets` (`loops.rs:573-585`)
   maps each matched path to a `ManifestEntry { origin:"resolver", inc:true, .. }`
   (`entry_for`, `loops.rs:588-598`).
2. On "Start", the front-end folds the audit (`targetSel`) into those rows and
   **writes `manifest.json` as `inc=true` BEFORE any agent runs** — `startLoop`
   (`state/store.ts:1624-1663`), then calls `start_plan` (`:1678`).
3. `start_plan` reads that manifest, keeps its `inc` rows verbatim as the set,
   normalizes them to `status:"queued"`, and **re-persists** (`loops.rs:1546-1569`)
   — all before the coordinator thread spawns (`:1627`).
4. Only *then* does the model run: the scope agent (`run_scope_agent`, `:1629`) writes
   `plan.md` and may `loop_add_task`, and the per-item fan-out **specs each existing
   row** (`:1646`). The model **enriches** rows (approach/steps/tests/note/spec) and can
   **add** task nodes, but it never **reshapes** the glob-matched file set into a
   different task set — it can't merge files into one unit of work, split one file into
   several, drop files it judges out of scope, or recognise that the right unit isn't
   "one matched file."

So the model is a *specifier of a pre-decided list*, not a *decider of the work*. The
user's report: it "takes the glob patterns verbatim and loops over them." That's
correct by construction — and it's the fundamental UX/orchestration deficit.

## The reframe (decided with the user)

Flip the order. The **prompt** is the source of truth for *what work exists*; the glob
is at most a *candidate pool* the model curates.

```
TODAY:   glob → manifest(authoritative) → model specs each row
WANTED:  prompt → [interview: gather requirements] → model DECIDES the task set
         (using the repo + the glob as a candidate hint) → human reviews → specs → build
```

New pipeline (the `discover → order → curate → execute` arc, with discover/order moved
*into* the model):

1. **Seed** — creator gives the **prompt** (the task) and an *optional* scope hint
   (a broad glob / dir / `List`). The hint resolves to a **candidate pool**, NOT an
   authoritative `inc=true` manifest.
2. **Requirements interview** — a model pass interviews the creator FIRST, before any
   work set is fixed, using the **shipped `loop_ask`** tool (scope key `__scope__`).
   It asks until it understands the objective, boundaries, and acceptance criteria.
3. **Decomposition** — the model explores the repo read-only, reads the candidate pool,
   and **authors the work set**: it includes/excludes candidates, adds files the glob
   missed, groups work into task nodes, splits where needed, and sets edges/order —
   mapping *requirements → tasks*, not *glob matches → rows*.
4. **Review** — the human reviews the authored graph at the existing plan gate
   (Work-graph tab + Scope/Item-specs), edits if needed, approves.
5. **Spec + build** — unchanged: per-item fan-out specs the *authored* set, approve →
   build runs it. (The interview, off-pool detach, tray notifications, and per-spec
   editing from the last phase all still apply.)

The key inversion: **the manifest is an OUTPUT of the model's decomposition, not an
INPUT the model is handed.** The glob, if given, is demoted to candidate context.

## What already exists to build on (don't rebuild)

- **`loop_ask`** (blocking-file interview) + transcript + off-pool detach + tray
  notifications — SHIPPED. The requirements interview is this tool run at the scope
  stage, *before* decomposition. No new interview plumbing needed.
- **`loop_add_task`** (id/title/spec/`requires`/`blocks` glob|paths/priority) + the
  `origin` provenance field (`resolver`/`model`/`human`) + `update_loop_manifest`
  (whole-manifest read-modify-write under the repo lock) + the **Work-graph tab** —
  SHIPPED. The model can already author task nodes and edges; what's missing is letting
  it author the *file* set (include/exclude/from-scratch), and demoting the glob.
- The **manifest as the editable source of truth** + the **approve→build** gate — the
  human review surface for whatever the model decides already exists.

## Decisions — decided vs. open (resolve the open ones with the user first)

**Decided:** prompt-first; requirements interview before the set is fixed; model decides
the task set; glob is a candidate hint not authoritative; human still reviews/approves
at the existing plan gate; reuse `loop_ask` + the work-graph authoring foundation.

**Open — ask the user at the start of the next session:**
- **Glob optional or always-a-pool?** Is a pure prompt-only loop (no glob; model explores
  the whole repo to find the work) a first-class mode, or is a candidate hint always
  required? (Recommendation: glob optional — absent ⇒ model discovers; present ⇒ pool.)
- **Keep a "verbatim" escape hatch?** Should the old behaviour survive as an explicit
  "I know the exact files" mode (e.g. the `List` resolver stays authoritative), with
  model-decides the default for `Glob`/prompt? (Recommendation: yes — `List` = manual
  authoritative; `Glob`/`Command` = candidate pool the model curates.)
- **Candidate representation:** do candidates live in the manifest as `inc=false`
  rows (status `"candidate"`) the model flips to `inc=true`, or are they passed to the
  agent purely as prompt context and the model authors fresh rows? (Recommendation:
  persist as `inc=false` candidate rows so the Work-graph tab can show "considered but
  excluded," and so the model's include/exclude is auditable.)
- **One decomposition agent or two passes?** Fold requirements-interview + decomposition
  into one strategist pass, or run an explicit interview pass then a decomposition pass?
  (Recommendation: one agent, interview-then-author in a single run — it already stays
  alive across `loop_ask` calls.)

## Architecture — the new "scope = author the set" pass

The smallest correct change is to **invert what `start_plan` seeds and what the scope
agent does.** Concretely:

### A. Don't pre-write the glob as authoritative
- **Front-end** (`state/store.ts:1624-1663`): for a model-decides resolver, write the
  resolved rows as **candidates** (`inc:false`, `status:"candidate"`) instead of
  `inc:true`, and DON'T pass them as the authoritative `targets`. For a `List` (manual)
  resolver, keep today's `inc:true` behaviour (the escape hatch).
- **`start_plan`** (`loops.rs:1546-1569`): when the manifest has no `inc` rows but has
  `candidate` rows (or none), the **decomposition agent authors the set** — don't fall
  back to globbing `targets` into `inc:true` file rows. The scheduler that the per-item
  fan-out runs is seeded *after* the decomposition pass, from the authored set.

### B. New MCP tools for the model to AUTHOR the file set
(beside the shipped `loop_add_task`, in `crates/locke-mcp/src/main.rs` + `locke-store`)
- **`loop_list_candidates(loop_id)`** → the candidate pool (the glob matches +
  loc/risk), so the model can see what the hint surfaced and pick.
- **`loop_add_item(loop_id, path, …)`** → include a file as a real work item
  (`inc:true`, `origin:"model"`), whether or not it was a candidate (lets the model add
  files the glob missed).
- **`loop_drop_item(loop_id, path|id, reason?)`** → exclude a candidate/file it judges
  out of scope (`inc:false`, `status:"excluded"`, note the reason for the audit trail).
- (`loop_add_task` already covers grouping several files into one unit via `blocks`, and
  splitting via multiple tasks + `requires`.)
- These are thin wrappers over the existing `update_loop_manifest` primitive; mirror the
  `loop_add_task` impl shape (schema + dispatch arm + impl, `main.rs`).

### C. The decomposition agent (evolve `run_scope_agent`, `loops.rs:1144`)
Rewrite the strategist scope prompt so it: (1) interviews via `loop_ask` to gather
requirements first; (2) explores the repo read-only + `loop_list_candidates`; (3)
authors the work set with `loop_add_item`/`loop_drop_item`/`loop_add_task` + edges; (4)
calls `loop_write_plan` when the graph is settled. Then `start_plan` rebuilds the
scheduler from the authored manifest (the rebuild already exists at `loops.rs:1630-1644`
for added tasks — extend it to the full authored set) and fans out specs over it.

### D. Builder UX shift (`views/loops/LoopBuilder.tsx`)
- Elevate the **prompt** (it's now the task source); make the resolver field read as an
  optional **"scope hint / candidate pool"**, not "the files."
- Reframe the audit list as **"candidates the model will curate"** (preview), not an
  authoritative include checklist — or keep manual include/exclude as an *override* the
  model respects. Decide with the user (tie to the "escape hatch" open question).

### E. Plan view (`views/loops/LoopPlan.tsx`)
- The Work-graph tab already renders model/human/resolver nodes — surface **excluded
  candidates** (with the model's reason) so the human can see what it chose to skip and
  re-include if wanted. The requirements interview already shows on the Scope tab.

## Guardrails
- **Human-in-the-loop is preserved** — the model proposes the decomposition; the human
  reviews/edits/approves at the existing plan gate before any build. Nothing auto-builds.
- **Auditability** — every include/exclude/merge carries `origin` + a reason note, so the
  graph explains *why* these tasks (not the glob) are the work.
- **Cost** — the decomposition pass is one strategist agent (concurrency stays 1, as the
  interview phase chose); the candidate pool bounds its exploration.
- **Escape hatch** — a manual `List` (or an explicit toggle) keeps the old verbatim
  behaviour for "I know exactly the files," so this is additive, not a forced rewrite.

## Files to touch
- `crates/locke-mcp/src/main.rs` — `loop_list_candidates` / `loop_add_item` /
  `loop_drop_item` (schema + dispatch + impl); decomposition prompt guidance.
- `crates/locke-store/src/lib.rs` — candidate status helpers if needed (mostly reuses
  `update_loop_manifest`); a `status:"candidate"` convention.
- `apps/desktop/src-tauri/src/loops.rs` — `start_plan` seeding (don't pre-author from
  glob); `run_scope_agent` → requirements-interview-then-decompose; scheduler rebuild
  from the authored set; candidate-vs-authoritative handling.
- `apps/desktop/src-tauri/src/commands.rs` + `lib.rs` — any new command (e.g. read
  candidates) + registration.
- `apps/desktop/src/state/store.ts` — `startLoop` writes candidates (`inc:false`) for
  model-decides resolvers; keep `List` authoritative; load/show excluded candidates.
- `apps/desktop/src/views/loops/LoopBuilder.tsx` — prompt-forward UX; resolver as
  "scope hint"; audit list as candidate preview.
- `apps/desktop/src/views/loops/LoopPlan.tsx` — show excluded candidates + reasons in
  the Work-graph tab.
- `packages/core/src/types.ts` — `status:"candidate"`; any new payload types.

## Verification
1. **Unit (store):** candidate round-trip — write `inc:false` candidates, model
   `loop_add_item`/`loop_drop_item` flips them, manifest reflects the authored set.
2. **MCP (scratch repo):** `loop_list_candidates` returns the pool; `loop_add_item`/
   `loop_drop_item` mutate the manifest with correct `origin`/`status`.
3. **E2E (the Vuetify VBtn repo):** start a prompt-first loop with a broad glob hint;
   confirm the model interviews for requirements FIRST, then authors a task set that is
   NOT 1:1 with the glob (merges/splits/excludes visible in the Work-graph tab), human
   approves, build runs the authored set. **This is the scenario the user is already
   testing — it currently loops the glob verbatim; success = it no longer does.**
4. **Regression:** a `List` (manual) loop still runs the exact files verbatim (escape
   hatch intact); a no-questions decomposition still settles to `planning`.

## Status at hand-off
- Branch `feat/v2.2-loops`. Committed: the live plan interview (`2956111`) and the
  item-review feedback textarea fix (`bc39dc9`).
- Memory: `loops-task-decomposition-gap` (the deficit) + `loops-feature-v2` (full
  history). This doc is the actionable spec for closing it.
