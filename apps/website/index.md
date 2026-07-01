---
layout: home

hero:
  name: Locke
  text: Review what your agents built — locally
  tagline: Inspect, run, and review agent work before it ever reaches origin/main. Now with Loops — run one task across an entire codebase.
  actions:
    - theme: brand
      text: What is Locke?
      link: /guide/what-is-locke
    - theme: alt
      text: Loops quick-start
      link: /guide/loops-quickstart
    - theme: alt
      text: MCP tool reference
      link: /reference/mcp-tools

features:
  - title: Loops
    details: Give one task and a set of files. A strategist agent plans the work, fans out workers across the codebase, and routes every change through review. New in v2.0–v2.2.
    link: /guide/loops-quickstart
  - title: Plan mode
    details: Before any file is touched, a strategist reads the set read-only, interviews you where it matters, and writes a per-item spec you approve.
    link: /guide/plan-mode
  - title: Work graph
    details: Model-authored tasks, prerequisites, and dependency-aware wave scheduling — the loop figures out what has to land first.
    link: /guide/work-graph
  - title: Mission Control
    details: A fleet view over your runs, reviews, and agents. Parts are live, parts are preview — clearly flagged throughout the docs.
    link: /guide/mission-control
---

## Who these docs are for

| You are… | Start here |
| --- | --- |
| **Using the Locke app** to run and review work | [What is Locke?](/guide/what-is-locke) → [Loops quick-start](/guide/loops-quickstart) |
| **Writing agents** that run inside a loop | [MCP loop tools](/reference/mcp-tools) → [Manifest & work graph](/reference/manifest) |
| **Hacking on Locke itself** | [Architecture](/contributing/architecture) → [Building & releasing](/contributing/building) |

::: info Version & status
These docs describe **Locke v2.2** (branch `feat/v2.2-loops`). Loops is the headline feature and is fully wired end-to-end. Some Mission Control surfaces are still **preview / mocked** — every such section is flagged inline with a callout like the one below.
:::

::: warning Preview feature
Sections marked like this describe surfaces that are partially mocked or not yet wired to a live backend. They ship in the app but may show placeholder data.
:::
