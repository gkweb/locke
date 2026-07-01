# Loops — progress feedback for slow agents

**Principle:** never let silence be ambiguous. Every quiet moment must be labelled
("thinking", "waiting on the model", "3 of 6 · 45s since last update") so a slow local
model or a poor connection reads as *working*, not *frozen*. For unknown-duration agent
work, show **elapsed + last action + a pulse — never a fake percentage**; a progress bar
stalled at 60% is worse than an honest "running tests · 1m20s".

This matters most for two futures we're designing toward: **slow connections** (high
first-token latency, slow streaming) and **local models** (every step is slow).

## Tier 1 — shipped

Frontend-only where possible, reusing signal we already emit (`loop:progress` counts +
elapsed, `loop:item` per-item status, the `loopItemActivity` last-activity timestamps).
No extra token cost.

1. **Live, phase-aware status line** (`PlanStatus` in `LoopPlan.tsx`): the Plan header
   now reads `scoping the repository…` → `speccing 3 of 6 · 2m10s` instead of a static
   "planning N targets".
2. **Heartbeat / staleness clock** (`PlanStatus`, own 1s ticker): when the agent goes
   quiet, a counter shows the silence with escalating copy — `12s since update` →
   `still working · 47s` → `still working — the agent or model may be slow · 2m3s`.
   Driven by `loopItemActivity`; the single most important change for slow models.
3. **Spec-phase activity feed** (`ScopeActivity` + a `"spec"` stream lane in
   `loops.rs process_item`/`finish_item`): the Scope tab's feed no longer freezes at
   `plan ready` — it continues `speccing src/math.js` → `specced src/math.js ✓` as each
   item settles.
4. **Dry-run spec shown as soon as scope finishes** (earlier fix): `loadLoopPlan` fires
   on the scope pass's terminal marker, so the aside populates immediately instead of
   waiting for the whole spec phase.

## Tier 2 — planned (not started)

1. **Token / partial-text streaming.** Today we emit only on *completed* text blocks and
   tool calls. Tapping the stream-json `content_block_delta` events would let the agent's
   text appear token-by-token — the strongest "it's alive" signal when first-token
   latency is high. This changes the output parser (`stream_claude` in `loops.rs`,
   `run.rs`), so it belongs with the normalized event stream from the multi-backend work
   (see [multi-backend-investigation.md](multi-backend-investigation.md)) — each backend
   streams differently, and partial-token deltas should be one variant of the shared
   `Text` event.
2. **Explicit dead-air labels.** First-token latency (model spin-up) is the worst offender
   on slow/local. Surface `Connecting to the model…` → `Thinking…` → `Running <tool>…`
   so the pre-output gap always has a caption rather than nothing.
3. **Backend heartbeat.** A ~10s "still working" tick from `stream_claude` while an agent
   runs with no other output — a belt-and-braces liveness signal for when even the
   frontend has no recent timestamp to anchor to. Only needed if Tier 1's frontend clock
   proves insufficient in practice.

## Why not just raise concurrency?

Bumping the plan/build concurrency (a DEV throttle in `store.ts`) speeds the wall-clock
but multiplies concurrent token spend, and does nothing for the fundamental case where a
*single* step is slow (a large local model, a slow link). The durable fix is making
progress legible, not making it faster — the levers above stand regardless of concurrency.
