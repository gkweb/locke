# Changelog

A feature-level history of the Loops line and the surfaces around it. This is a docs-oriented summary grouped by capability, not a per-commit log. The current version is **v2.2.3** on branch `feat/v2.2-loops`.

::: info
Git tags exist for `v1.2.0`, `v1.4.0`, and `v1.5.0`. The v2.x releases are versioned in `apps/desktop/package.json` and `tauri.conf.json`; they are not (yet) tagged.
:::

## v2.0 — Loops arrives

The first Loops release: run one task across many files, with a front-end and a Build-mode runner.

- **Loops (v2.0.0)** — the feature itself: builder, target list, and a Build-mode runner.
- **Target resolvers + checked-in manifest** — glob/list/command/custom resolvers producing a `manifest.json` work list.
- **Target-match backend** — a real audit list with honored exclusions (no mock draft in the app).
- **Seed-branch integration** — suggest, validate, and warn on branch-name collisions.
- **Dependency-aware scheduler** — the work-graph executor that runs items in topological order.
- **Autosaved, resumable drafts**; a delete-loop affordance; mnemonic, collision-resistant ids.

## v2.1 — Plan mode & the work graph

Loops gains a real planning phase and a model-authored graph.

- **Plan strategist** — real per-item spec generation before any build runs.
- **Model-authored work graph** — custom task nodes, prerequisites, and dependency edges.
- **Plan controls** — live speccing, instant stop, re-plan, dev concurrency.
- **Per-item stop** — cancel one spec without halting the run.
- **Recover a stalled plan** — liveness tracking + resume.
- **Glob brace expansion** and multi-line resolver inputs.

## v2.2 — Interview, requirements-first, per-wave review

The current line. Planning becomes interactive and decomposition becomes the model's job.

- **Live plan interview** — blocking `loop_ask` Q&A, off-pool detach, and tray notifications.
- **Requirements-first decomposition** — the model authors the work set rather than the resolver dictating it. See [Plan mode](/guide/plan-mode).
- **Block-on-task prerequisites** — an approvals tray, item controls, and a live trail (`loop_block_on_task`).
- **Per-wave reviews** — stacked review, one wave at a time, under `"wave"` review scope.
- **Configurable review scope** — per item, per file, or per wave; collapsible builder settings.
- **Open a review on completion** — plus completion-state UX.
- **Streaming scope-agent activity** — the strategist's work streams into the Scope tab; the seed prompt is shown there too.
- **Legible progress feedback (Tier 1)** — live elapsed, last-action, and staleness clock for slow agents.
- **Durable exception capture** — critical exceptions are persisted for later diagnosis.

### v2.2.1 – v2.2.3 (fixes)

- Item review surface shows real data and handles the no-diff case.
- The scope pass no longer reports "plan ready" while specs are still writing.
- Inapplicable placeholder sections are dropped from item specs.

## Related surfaces

- **Mission Control** fleet shell and screens were built out across phases alongside Loops — parts live, parts [preview](/guide/mission-control).
- **v1.5** shipped Plan-first Resolve runs and the [per-review run surface](/guide/resolve-runs).
