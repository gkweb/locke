# Loops — Plan strategist

The Plan mode of a loop. Before a build, a **strategist** pass analyses the matched
set and produces a checked-in, hand-editable plan: a global `plan.md` + per-item
specs in the manifest. The creator reviews/tunes, then approves → the existing build
runner consumes the enriched manifest unchanged.

`discover → order → curate → execute` — the strategist is the *curate* step made
real (it used to be a hand-edit of `manifest.json`).

---

## Phase 1 — non-interactive strategist (SHIPPED, `feat/v2.2-loops`)

What a Plan run does today:

1. **Scope pass** — one strategist agent reads the set read-only and calls
   `loop_write_plan` → writes `.locke/loops/<id>/plan.md` (conventions, injected into
   every build worker via `{{conventions}}`) + `plan.json` (`{ summary, assumptions }`
   for the Scope tab).
2. **Per-item fan-out** — a read-only spec agent per item (same worker pool /
   scheduler / DAG as build, `ctx.phase = Plan`) calls `loop_write_spec` →
   enriches its `ManifestEntry` (`approach`/`detected`/`steps`/`tests`/`note`/`spec`/
   `status`) and writes the per-item `spec/<path>.md`. Uncertain items →
   `needs_review=true` → status `review`.
3. **Settle to `planning`** — nothing committed; the loop awaits approval.
4. **Approve → build** — `approveLoopPlan` flips the loop to build in place and calls
   `start_loop`, which reads the enriched manifest's `inc` rows. Exclusions made in
   the Item-specs tab persist (`inc=false`) and drop out of the build.

Key pieces:

- Backend: `Phase` enum + `start_plan` in `apps/desktop/src-tauri/src/loops.rs`
  (shares `spawn_workers` / `stream_claude` / scheduler with `start_loop`); read-only
  per-item worktrees, no commit/cherry-pick. `run_scope_agent` for the scope pass.
- MCP: `loop_write_spec` / `loop_write_plan` in `crates/locke-mcp`.
- Store: `read/write_loop_plan_meta` (plan.json) in `crates/locke-store`.
- Commands: `start_plan`, `read_loop_plan_meta`.
- Front-end: `startPlan`/`readLoopPlanMeta` (api/git.ts), `LoopPlanMeta` type,
  `loopManifest`/`loopPlanMeta` store slices + `loadLoopPlan`, `manifestToSpecs`
  (lib/loops.ts). `LoopPlan.tsx` reads real data (mock fallback kept for plain-vite).

**Deliberately deferred from Phase 1** (kept as stubs in the Scope tab, Tauri mode):
the interactive interview reply box ("coming soon"), pending-question chips, and
per-spec **approach buttons / step toggles / per-item instruction** editing (those
remain session-local override maps; see Phase 2 §4).

---

## Phase 2 — interactive interview (DEFERRED, the "extra item")

Goal: the Scope tab becomes a real multi-turn conversation. The strategist can ask
the creator clarifying questions, the creator answers (free text or a chip), and the
strategist revises `plan.md` + assumptions + (optionally) re-specs affected items
**before** the build. Phase 1 is the one-shot "no questions needed" branch of this.

This is **strictly additive** — nothing in Phase 1 is reworked. The spec/manifest/
approve layer is identical; Phase 2 only adds a conversational input modality in
front of the same engine.

### 1. Interview session protocol (backend)

A long-lived strategist agent process per planning loop (instead of the one-shot
scope agent), driven over the existing `stream-json` stdin/stdout that `stream_claude`
already speaks — Phase 1 closes stdin on the first `result`; Phase 2 keeps it open
for follow-up `user` turns.

- New `Ctx`-adjacent handle: `InterviewSession { stdin, loop_id }`, stored in a new
  managed `InterviewRegistry` (mirrors `LoopRegistry`) so a reply command can write
  to the live process.
- The scope prompt gains: "If a decision materially changes the plan, ask the human
  ONE question at a time by calling `loop_ask` with `question` + optional `choices[]`,
  then wait. When you have enough, call `loop_write_plan` and stop asking."

### 2. New MCP tool: `loop_ask`

`loop_ask(loop_id, question, choices?: string[])` →
- persists the pending question to `.locke/loops/<id>/interview.json`
  (`{ transcript: InterviewMsg[], pending?: { question, choices } }`),
- the desktop runner watches/streams it as a `loop:interview` event,
- the tool **blocks** (or returns immediately and the agent is told to await a
  follow-up `user` turn — simpler: return immediately, runner injects the answer as
  the next stdin `user` message). Prefer the non-blocking form: `loop_ask` just
  records the question; the runner emits it; the creator's answer is fed back via a
  new `user` turn on the kept-open stdin.

### 3. New event + command + store wiring

- Event `loop:interview` → `{ loopId, transcript: InterviewMsg[], pending? }`.
  Add a listener in `App.tsx` and an `onLoopInterview` store handler that fills a new
  `loopInterview` slice (transcript + pending). Reuse `InterviewMsg` (already in core).
- Command `answer_plan(repo, loopId, text)` → writes the answer onto the kept-open
  stdin of the loop's `InterviewSession` as a `user` message, appends it to
  `interview.json` transcript. Front-end wrapper `answerPlan`; wire the reply box's
  send + the chip clicks to it (replace the Phase 1 disabled stub).
- `loadLoopPlan` also reads `interview.json` → `loopInterview`.

### 4. Per-spec editing made real (folds in the deferred Phase 1 tuning)

Persist what are currently session-local override maps into the manifest, the same
way `acceptSpec`/`excludeSpec` already do:
- `setSpecApproach` → `merge_loop_manifest_entry` set `approach`.
- `toggleSpecStep` → edit the entry's `steps[]` (drop/restore the step).
- Per-item instruction box → append to the entry's `note` (or a new `instruction`
  field) — re-render the per-item `spec/<path>.md` so the build worker sees it.
- "Add a step for this item" → push to `steps[]`.

(Needs a `merge_loop_manifest_entry` Tauri command, or keep writing the whole
manifest array as `acceptSpec` does.)

### 5. View

`PlanScope` in `LoopPlan.tsx`: render `loopInterview.transcript` as the chat (the
mock already shows the shape), the `pending` question with `choices[]` as chips, and
enable the reply box → `answerPlan`. The dry-run summary/assumptions already update
live off `plan.json` as the strategist revises them.

### Scope guardrails

- One question at a time; cap total interview turns (e.g. 6) so a planning pass can't
  loop forever — `log()`/emit when the cap is hit.
- The interview is optional: a creator can approve at any point; unanswered questions
  carry into the build as `loop_read_spec` notes (the Phase 1 "start anyway" path).
