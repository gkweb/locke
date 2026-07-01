# Loops — Plan interview (Phase 2, live per-item + scope Q&A)

> Comprehensive implementation spec for a **fresh session**. Supersedes the
> "Phase 2" sketch in `docs/loops-plan-strategist.md` (read that first for Phase 1
> context). Grounded in the current code as of branch `feat/v2.2-loops` (work-graph
> authoring already shipped: `loop_add_task`, `origin`, the Work-graph tab).

## Context — the gap this closes

**Reframing — a "Needs your call" item is an *incomplete spec*, not a yes/no gate.** When the
strategist flags review it's because it has **open questions it needs answered to finish the
spec** — it wants to keep asking until the requirement is pinned down. The current model treats
review as a terminal approve/exclude decision, which is wrong: there's nothing to approve yet,
because the spec isn't done. What's missing is the *conversation that completes it*.

When the Plan-mode strategist is uncertain it calls `loop_write_spec(needs_review=true,
note=…)` and the item shows **"Needs your call"**. Today that review is **one-directional**:
the note renders read-only and there is **no way for the human to answer the model's questions
and let it continue specifying**. The note is really an unanswered question (often several). Concretely, in `apps/desktop/src/views/loops/LoopPlan.tsx` the "PER-ITEM
INSTRUCTION" box (`:521-530`) is a static `<span>` placeholder; "Add a step for this item"
(`:515`) has no handler; the APPROACH buttons + step toggles write to session-local maps
(`specApproach`/`specSteps`) that are never persisted.

Real example that motivated this (a Vuetify `VBtn` migration loop): the strategist correctly
refused to guess and asked three things — confirm source/output filename, spin off the missing
Tailwind / `@vitejs/plugin-vue` prerequisites, and decide greenfield-vs-replace + which props the
minimal keep. The human had no way to respond. **Build is blocked on a question the tool can't
ask interactively.**

## Decisions (from the user)

- **Full live interview** (not just persist-a-note, not just one-shot re-spec): a real multi-turn
  Q&A where the strategist asks, the human answers, the strategist asks the *next* question, and
  keeps going until the spec is complete — then writes it. A "needs review" item is the entry
  point into this conversation, not an endpoint.
- Works at the **per-item** level (the Item-specs detail pane) **and** the **scope** level (the
  Scope tab) — the per-item case is the primary need.
- Plus **persist approach + steps** (make the deferred per-spec editing real) and a **quick-add
  prereq task** shortcut from a blocked item (wired to the `loop_add_task` we shipped).

## Architecture — blocking-file `loop_ask` (chosen over stdin-injection)

The Phase-2 sketch in `loops-plan-strategist.md` proposed keeping the agent's stdin open and
feeding answers as new `user` turns via an `InterviewRegistry` of stdin handles. **Reject that.**
Reading `stream_claude` (`loops.rs:1005-1115`): the agent runs `claude -p --input-format
stream-json`, gets ONE `user` message, and stdin is **closed on the first `result`** (`:1104-1107`)
so the CLI exits. Multi-turn continuation over that stdin after a `result` is unproven and fragile,
and per-item spec agents each run their own process — a stdin registry would have to track all of
them.

**Use a blocking tool instead.** When an agent calls `loop_ask`, the **MCP server blocks**
(polls the filesystem) until the human's answer appears, then returns the answer as the tool
result. The agent is naturally alive the whole time (it's mid-tool-call), so:
- It works identically for the one-shot **scope agent** and every **per-item spec agent** — no
  special process management, no kept-open stdin, no `InterviewRegistry`.
- The existing per-item worker model is untouched: the worker is still "run one agent to
  completion" — it just takes longer while the human answers (it holds its concurrency slot;
  see Guardrails re: plan concurrency).
- The watchdog (`:1054-1064`) only SIGKILLs on the loop-stop / item-cancel flags — there is **no
  idle timeout**, so a long human pause won't kill the agent. (Add a generous `loop_ask` server
  timeout as a backstop.)

### The protocol, end to end

All paths under the **main repo** `.locke/` (agents run with `LOCKE_REPO` pointing at the main
repo, `:1028-1030`, so the MCP server writes there — not the item worktree).

```
.locke/loops/<id>/interview/
    <key>.q.json        pending question  { nonce, question, choices?, file?, ts }
    <key>.a.json        the human's answer { nonce, text }
    transcript.json     append-only [{ role:"agent"|"you", text, file?, ts }]
```
`<key>` = the item's manifest key (`sanitize_path(path)` for files, the task id) for a per-item
question; a reserved key like `__scope__` for a scope-level question.

1. **Agent asks** — calls `loop_ask(loop_id, question, choices?, file?)`. The MCP handler writes
   `<key>.q.json` with a fresh `nonce`, appends `{role:"agent", …}` to `transcript.json`, then
   **polls** for `<key>.a.json` with a matching nonce (e.g. every 500ms, backstop timeout ~20 min).
   On answer: delete the `.q`/`.a` pair, append `{role:"you", …}` to the transcript, return the
   answer text as the tool result. On timeout: return "no answer received; proceed with your best
   judgment and flag needs_review if still unsure."
2. **Desktop surfaces the question** — two equivalent detection options; pick **(a)**:
   - **(a) From the stream (preferred):** extend `stream_claude` to pass the tool *input* (not just
     the name) for `loop_ask` tool_use blocks (`:1088-1090` currently drops the input). The runner
     emits `loop:interview { loopId, key, file?, question, choices? }` directly — no file watch, no
     latency. (Keep `interview/<key>.q.json` as the durable record for reload/restart.)
   - (b) A filesystem watch on `interview/` (more moving parts; only if (a) proves unreliable).
3. **Human answers** — a new Tauri command `answer_loop_question(repo, loopId, key, text)` writes
   `<key>.a.json` with the nonce read from `<key>.q.json`. The blocked MCP `loop_ask` picks it up
   and returns; the agent continues. No agent-process plumbing needed on the desktop side.
4. **Agent revises & finishes** — when satisfied it calls `loop_write_spec` (per-item) or
   `loop_write_plan` (scope) as today; on `result` the process exits and the worker proceeds
   exactly as Phase 1. Mid-interview it may now also call `loop_add_task` (shipped) to spin off the
   prerequisites it proposed.

## Implementation pieces

### A. MCP — `crates/locke-mcp/src/main.rs`
- New tool **`loop_ask`** (schema in `tools_list()` + impl + dispatch arm, mirroring the existing
  `loop_*` tools): args `loop_id`, `question` (required), `choices?: string[]`, `file?` (the item
  key when per-item; absent = scope). Impl: write `<key>.q.json` (nonce via a counter/time — note
  the MCP binary is sync, no async runtime), append to `transcript.json`, poll for the answer,
  return `{ answer }`. Reuse `sanitize_path` for the key; default key `__scope__` when `file` absent.
- Store helpers it calls live in `locke-store` (below). Logs to `~/.locke/mcp-log.jsonl` like the
  others (`log_call`).
- **Prompt guidance** — update the strategist prompts so it *prefers asking over guessing*:
  - `run_scope_agent` (`loops.rs:1143`): "If a decision materially changes the plan, ask the human
    ONE question at a time via `loop_ask` (optional `choices[]`), wait for the answer, then continue.
    When confident, call `loop_write_plan`."
  - per-item Plan `protocol_footer` (`loops.rs:644-660`): "If a human decision is needed before you
    can spec this item, call `loop_ask` (with `file` = this item key) and wait — only fall back to
    `loop_write_spec(needs_review=true)` if the human doesn't answer."

### B. Store — `crates/locke-store/src/lib.rs`
- `loop_interview_dir(repo,id)` + helpers: `write_loop_question`, `read_loop_question`,
  `write_loop_answer`, `read_loop_answer`, `clear_loop_question`, `append_interview_msg`,
  `read_interview(repo,id) -> { transcript, pending? }`. All under the repo advisory lock +
  atomic `write_json`, mirroring the manifest helpers (`:786-819`).
- Reuse the existing `InterviewMsg` (already in `packages/core`) shape for transcript rows.

### C. Runner — `apps/desktop/src-tauri/src/loops.rs`
- Extend `stream_claude`'s `on_block` (or add a dedicated callback) so a `loop_ask` tool_use
  surfaces its **input** (question/choices/file), and emit a new `loop:interview` Tauri event from
  `run_agent_stream` / `run_scope_agent`.
- **Plan concurrency:** raise plan concurrency above 1 (it was noted as `plan=1`) so one item
  blocked on an interview doesn't stall all other speccing — or run interview-bearing agents
  outside the fixed pool. Decide during impl; document the choice.

### D. Command + api + event — `commands.rs`, `lib.rs`, `api/git.ts`, `App.tsx`
- Command `answer_loop_question(repo, loopId, key, text)` → `store::write_loop_answer` (+ register
  in `lib.rs` invoke_handler). api wrapper `answerLoopQuestion`.
- New event payload `LoopInterviewEvent { loopId, key, file?, question, choices? }` in `api/git.ts`;
  add an `App.tsx` listener routed to a store `onLoopInterview` handler.

### E. Store — `apps/desktop/src/state/store.ts`
- Slice `loopInterview: Record<string, { transcript: InterviewMsg[]; pending?: { key; file?; question; choices? } }>`
  keyed by loopId (so per-item and scope questions coexist).
- `onLoopInterview` fills it; `loadLoopPlan` also reads `interview/transcript.json` +
  any pending `.q.json` so a reopened/stalled plan shows the open question.
- Action `answerLoopQuestion(key, text)` → command + optimistic transcript append.

### F. Per-spec editing made real (the user's "persist approach + steps")
Replace the session-local maps with manifest writes (same pattern as `acceptSpec`/`excludeSpec`,
`store.ts:1763-1778`) — reuse the **`set_loop_deps`-style** whole-manifest write or add a
`merge_loop_manifest_entry` command:
- `setSpecApproach` → persist `entry.approach`.
- `toggleSpecStep` → edit `entry.steps[]` (drop/restore).
- "Add a step for this item" (`LoopPlan.tsx:515`) → push to `entry.steps[]`.
- Per-item instruction box → append to the entry's `note` and re-render `spec/<key>.md` so the
  build worker sees it.

### G. UI — `apps/desktop/src/views/loops/LoopPlan.tsx`
- **Per-item interview (primary):** in `PlanSpecs`' detail pane, replace the static instruction
  box (`:521-530`) with a real transcript + reply input bound to `answerLoopQuestion(sel.id, …)`,
  shown when this item has a `pending` question or open transcript. Render `choices[]` as clickable
  chips. Keep "Accept spec" / "Exclude item" as the always-available escape hatches.
- **Scope interview:** in `PlanScope`, render `loopInterview[id].transcript` as the chat and enable
  the (currently stubbed) reply box → `answerLoopQuestion('__scope__', …)`. The dry-run
  summary/assumptions already update live off `plan.json` as the strategist revises.
- **Quick-add prereq (the user's third pick):** on a blocked/review item, a "+ prereq task" action
  that prefills the Work-graph add-task form (or inlines it) and wires this item to `require` the
  new task — i.e. call the shipped `addLoopTask` then `setLoopDeps(sel.id, [...requires, taskId])`.

## Guardrails
- **One question at a time**; cap interview turns per loop (e.g. 6) so a plan pass can't loop
  forever — emit/log when hit. The strategist prompt enforces "one at a time".
- **Optional** — the human can Accept/Exclude/Approve at any point; an unanswered question carries
  into the build as a `loop_read_spec` note (the Phase-1 "start anyway" path). The `loop_ask`
  server timeout is the backstop so a never-answered question eventually unblocks the agent.
- **Concurrency** — ensure a blocked interview doesn't deadlock the pool (see C).

## Files to touch
- `crates/locke-mcp/src/main.rs` — `loop_ask` (schema + impl + dispatch); strategist prompt notes.
- `crates/locke-store/src/lib.rs` — interview dir + question/answer/transcript helpers.
- `apps/desktop/src-tauri/src/loops.rs` — surface `loop_ask` input + emit `loop:interview`;
  scope/per-item prompts; plan concurrency.
- `apps/desktop/src-tauri/src/commands.rs` + `src-tauri/src/lib.rs` — `answer_loop_question`
  (+ per-spec-edit command if not reusing whole-manifest write); registration.
- `apps/desktop/src/api/git.ts`, `App.tsx`, `state/store.ts` — `answerLoopQuestion`,
  `loop:interview` listener, `loopInterview` slice + `onLoopInterview`, persist approach/steps.
- `apps/desktop/src/views/loops/LoopPlan.tsx` — per-item + scope interview UI; real instruction/
  step editing; quick-add-prereq.
- `packages/core/src/types.ts` — `loop:interview` payload type (reuse `InterviewMsg`).

## Verification
1. **MCP (scratch repo, `$LOCKE_REPO`):** call `loop_ask`; confirm it writes `interview/<key>.q.json`
   and blocks; write `<key>.a.json` by hand; confirm it returns the answer and appends both turns to
   `transcript.json`.
2. **Unit:** store round-trip for question/answer/transcript helpers; a turn-cap test.
3. **End-to-end (desktop, the Vuetify VBtn repo):** run a Plan loop that triggers a per-item
   question; confirm it surfaces in the Item-specs detail pane, answer it, watch the strategist
   revise — including spinning off a prereq task via `loop_add_task` that then appears in the Work
   graph tab and gates the `.vue` item. Approve → build.
4. **Regression:** a plan needing no questions behaves exactly as Phase 1 (one-shot, no interview).
```
```
