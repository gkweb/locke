# Resolve runs (v1.5)

Distinct from Loops, **Resolve runs** let you launch a single agent against **one** review to make a change, and watch it work live — inside the Workspace's **Run** tab. This shipped in v1.5 and predates Loops; think of it as the single-review counterpart to a loop's per-item build.

## Plan-first Resolve

A Resolve run can start in **Plan mode**: the agent proposes a plan before it makes any live edits, and you approve it before the build proceeds. This mirrors the Loops [Plan mode](/guide/plan-mode) idea at the scale of a single review — plan first, then act — so you're never surprised by what the agent does.

Once approved, the run switches into build and the agent applies changes, streaming as it goes.

## The Run tab

The **Run** tab in the [Workspace](/guide/mission-control#screens) streams the agent's activity for that review:

- A live event stream of what the agent is doing.
- An **approvals tray** with **Allow / Deny / Stop** controls, so tool calls that need your sign-off pause for you.
- A hero-flow state machine driving the run's lifecycle.

## Per-review run surface

Each review gets its **own** run surface, keyed by review id. That means runs **survive navigation** — you can start a run, move to another review, and come back to find it still going — and multiple reviews can run **concurrently** without stepping on each other.

## Relationship to Loops

| | Resolve run | Loop |
| --- | --- | --- |
| Scope | One review / branch | A set of files across the repo |
| Planning | Plan-first Resolve (single plan) | Full strategist Plan mode (interview + per-item specs) |
| Execution | One agent, live in the Run tab | Worker pool over a [work graph](/guide/work-graph) |
| Review | The review itself | Per item / per file / per wave |

If you're changing one branch, a Resolve run is the direct tool. If you're running the same task across many files, reach for a [loop](/guide/loops-quickstart).
