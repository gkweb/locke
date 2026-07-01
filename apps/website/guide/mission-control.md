# Mission Control (fleet overview)

Mission Control is Locke's shell for working across *many* runs and reviews at once — a fleet view rather than a single-review view. It was built out over several phases alongside Loops.

::: warning Preview surfaces
Mission Control is **partly preview**. The shell, navigation, and Loops surfaces are live, but several fleet screens render **mock data** (from `apps/desktop/src/lib/mockFleet.ts`) when a live backend isn't wired. Each screen below is labelled **Live** or **Preview** so you know what you're looking at. Preview screens still ship in the app — they just may show placeholder data.
:::

## The shell

The redesigned shell provides a persistent action bar, a side panel, a status bar, and top-level navigation/routing between fleet screens. This chrome is **live**; the data each screen shows varies (below).

## Screens

| Screen | Status | What it shows |
| --- | --- | --- |
| **Activity** | Preview | Fleet home: a grid of in-flight runs, a "needs you" band for items awaiting your input, and a ready list. |
| **Runs** | Preview | A global table of runs with per-run state and duration. |
| **Reviews** | Live | Your local branch reviews (the original Locke queue). |
| **Loops** | **Live** | The Loops feature — list, builder, plan, monitor, review. See [Loops quick-start](/guide/loops-quickstart). |
| **Workspace** | Mixed | A per-review tabbed view: **Diff**, **Run**, **Checks**, **History**. Diff/Checks/History are live; the Run tab streams live agent activity (see [Resolve runs](/guide/resolve-runs)). |
| **Files** | Live | A repo file-tree explorer backed by real file reads. |
| **Agents** | Live | Detects installed agent CLIs on your machine. |
| **Extensions** | Preview | A language-plugin host — pluggable per language. Framework in place. |
| **Integrations** | Preview | External-service integrations. Framework stub. |
| **Settings** | Live | Theme and navigation configuration. |

## Workspace tabs

When you open a review, the **Workspace** presents it as tabs:

- **Diff** — the file diff and inline comment threads (live).
- **Run** — a live stream of agent activity for the review, with an approvals tray and Allow / Deny / Stop controls. See [Resolve runs](/guide/resolve-runs).
- **Checks** — configured checks run against the branch in an isolated worktree (live).
- **History** — the branch's commit history (live).

## Why the split

The Loops and review paths are the load-bearing, fully-wired parts of Locke today. The broader fleet screens (Activity, Runs, Extensions, Integrations) are the **direction** Mission Control is heading — the IA and shell are in place, and backends are being wired screen by screen. Treating them as preview lets the shell ship without pretending every panel is live.

---

**Next:** [Resolve runs (v1.5)](/guide/resolve-runs) · [Loops quick-start](/guide/loops-quickstart)
