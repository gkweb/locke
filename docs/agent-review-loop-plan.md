# Plan: Agent review loop — human↔agent back-and-forth in Locke PRs

> Status: proposed. Branch: `feature/agent-review-loop` (off `feature/explicit-pr-tracking`).
> This feature depends on the explicit-PR + comments store, which is **not on `main` yet**.

## Context

Locke reviews local git branches that coding agents produce. Today a reviewer can leave
line-anchored comments (`.locke/comments/<id>.json`), but there's no path back to the
agent: telling it "change X" or "I don't like this style" and having it amend the branch
is a manual, unstructured copy-paste.

This feature makes the review a **conversation that can drive an amendment**. The contract
already exists on disk — the git branch (agent's output, read live by `git.rs`) plus the
comment threads — so we don't need IPC between Locke and the agent. We add: (1) a way to
mark a comment as an actionable **change request**, (2) serialization of open change
requests into an **agent-ready prompt**, (3) a durable request artifact, and (4) an
app-global **agent registry** auto-detected from the system, with a Settings panel.

**v1 dispatch model = copyable prompt** (you paste into Claude Code running on the branch).
The design keeps the door open for Locke to spawn the agent headlessly later (see
Phase 6, out of scope) reusing the detached-worktree machinery in `actions.rs`.

Each phase below is **small and independently shippable** — it leaves the app working and
delivers value without any later phase.

---

## Phase 1 — Thread `kind` (change-request flag) · frontend-only

Label a comment thread as a change request vs. plain discussion. No backend change: the
Rust store reads/writes comments as opaque `serde_json::Value` (`store.rs:227-234`), so a
new optional field round-trips automatically; back-compat is the optional `?`.

- `packages/core/src/types.ts:157-164` — add `kind?: "comment" | "change_request"` to `Thread`.
- `apps/desktop/src/state/store.ts`:
  - `submitComment` (387-408) — set `kind: "comment"` (or `"change_request"` if filed from
    the change-request composer) on the new `Thread`.
  - add `toggleChangeRequest(id)` mirroring `toggleResolve` (410-415); declare it in the
    `LockeState` interface (149-159); call `persistComments` after mutating.
- `apps/desktop/src/components/CommentThread.tsx` — in the header row beside the Resolve
  button (61-77), add a toggle control + a "Change request" badge when set.

**Ships:** reviewers can triage threads into actionable vs. discussion; persists across
sessions. **Verify:** flag a thread, reload repo, confirm badge persists; inspect
`../locke-smoke/.locke/comments/<id>.json` shows `"kind": "change_request"`.

## Phase 2 — Copy agent prompt · frontend-only

Serialize open change requests into one prompt and copy it to the clipboard. No backend.

- New pure builder `apps/desktop/src/lib/agentPrompt.ts` — `buildAgentPrompt(state)` reads
  from `useStore`: `repoPath` (store.ts:104), the selected review via
  `reviews.find(r => r.id === selectedPR)` → `.branch`/`.base` (pattern at store.ts:211-213),
  PR `title`, and the open change-request threads (`threads.filter(t => !t.resolved &&
  t.kind === "change_request")`, each `file` + `lineId` + concatenated `items[].body`),
  plus changed-file paths (`files`). Returns a markdown instruction block (amend branch,
  commit to it, reply per thread).
- `apps/desktop/src/views/OverviewView.tsx` — add a **"Copy agent prompt"** button to the
  `Main` action row (342-415), beside Run tests / Approve & push. Use
  `navigator.clipboard.writeText` (works in the webview — no new dependency). Disable when
  there are zero open change requests.

**Ships:** the full manual loop — copy, paste into Claude Code on the branch, it amends,
Locke live-refreshes the diff. **Verify:** flag two threads on `agent/fix-divide-by-zero`,
click Copy, paste into a terminal-run agent on that branch, confirm the prompt is coherent.

> Clipboard note: if `navigator.clipboard` proves unreliable in the webview, a tiny
> follow-up adds `tauri-plugin-clipboard-manager` (+ a `clipboard-manager:allow-write-text`
> permission in `capabilities/default.json`). Not expected to be needed.

## Phase 3 — Persist request artifact · +1 Rust command

Also write the prompt to `.locke/requests/<id>.md` so there's a durable, diffable artifact
(audit trail today; the file an external watcher/agent could consume tomorrow).

- `apps/desktop/src-tauri/src/store.rs` — add `requests_path(repo, id)` mirroring
  `comments_path` (68-70); add `write_agent_prompt(repo, id, content)` mirroring
  `write_check_overrides` (115-118) — `ensure_locke` then write the markdown file.
- Register in `lib.rs:16-38`; wrap in `commands.rs` (delegate pattern).
- Frontend: api wrapper (mirror `api/pulls.ts`); the Phase-2 button writes the file in
  addition to copying.

**Ships:** every "send" leaves `../locke-smoke/.locke/requests/<id>.md`. **Verify:** click
send, confirm the file exists with the expected content.

## Phase 4 — Agent detection · +1 Rust command, read-only

Detect which known agent CLIs are installed. No persistence, no UI toggles yet — pure
detection surfaced as status.

- `apps/desktop/src-tauri/src/actions.rs` — add a `KNOWN_AGENTS` registry (id, display
  name, probe argv, e.g. Claude Code `claude --version`, Codex, Aider, Gemini CLI,
  Cursor CLI) and `detect_agents()` mirroring `detect_checks` (27-65): run each probe via
  `std::process::Command` (pattern: `run_in` 154-191), return `Vec<AgentInfo { id, name,
  cmd, detected, version }>`.
- Register in `lib.rs`; wrap in `commands.rs`; api wrapper frontend-side. Call on launch.

**Ships:** Locke knows what's installed. **Verify:** with `claude` on PATH, `detect_agents`
returns it `detected: true` with a version.

## Phase 5 — Settings panel + enable/disable + opt-out persistence · app-global config

The Settings area you described: auto-enable every detected agent **unless the user has
explicitly disabled it**, with toggles. This is the first **app-global** (not per-repo)
state in Locke — there's none today (everything is keyed by `repo`).

- Rust: add global settings via `tauri::Manager::path().app_config_dir()` — commands
  `read_agent_settings(app)` / `write_agent_settings(app, settings)` taking
  `app: tauri::AppHandle`, persisting `agents.json` (e.g. `{ disabled: string[] }`), reusing
  `read_json`/`write_json` (store.rs:92-107). Register + wrap as above.
- Frontend: new `SettingsModal` following `NewReviewModal` (ListView.tsx:662-759); gear
  trigger in `Titlebar.tsx` (always mounted via App.tsx:23, so reachable with no repo open —
  correct for app-global settings). Merge Phase-4 detection with settings: an agent is
  **enabled = detected && not in `disabled`**. Toggling persists the opt-out.

**Ships:** the settings experience end-to-end — detection drives defaults, explicit
opt-outs stick. **Verify:** disable a detected agent, restart, confirm it stays disabled;
the enabled agent selects the Phase-2 prompt template.

---

## Phase 6 — Headless spawn (OUT OF SCOPE for v1, captured for direction)

Behind the same "Send to agent" button: Locke runs the enabled agent headlessly
(`claude -p "<prompt>"`) in a **detached worktree** on the branch — the exact machinery
`actions.rs` already uses for checks (`git worktree add --detach` + `node_modules` symlink,
~127-191). The agent commits to the branch and replies in-thread; Locke streams output and
live-refreshes the diff. Closes the loop entirely inside Locke.

## Cross-cutting notes

- Comment threads stay schema-less in Rust (raw `Value`) — only `packages/core` and the
  frontend know the shape. Keep new thread fields optional for back-compat.
- `CommentItem` already carries `isAgent` (types.ts:143-151), so agent replies render
  distinctly with no schema change when the loop writes them back.
- Smoke repo for manual verification: `../locke-smoke` (5 branches ahead of `main`).
