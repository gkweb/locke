# Investigation — opening Locke's agent runner to multiple backends

**Status:** investigation brief (not started). Read-only research → design doc; no
code changes until this produces a plan.

Locke currently drives **Claude Code** (the `claude` CLI) for all agent work:

- the loops runner — the plan **scope agent** plus the per-item **build** and **spec**
  agents,
- the one-shot **review/resolve** run, and
- the headless **post-review** agent.

We want to open this up to alternative coding-agent backends (**Codex CLI**,
**opencode / "open code zen"**, **Aider**, **Gemini CLI**, **Cursor CLI**). This doc is
the brief for scoping that — it does **not** implement anything.

## Why this is non-trivial (the load-bearing dependency)

The `loop_*` MCP tools are the spine of the entire loops feature. Completion signalling
(`loop_item_complete`), spec authoring (`loop_write_spec` / `loop_write_plan`), the plan
interview (`loop_ask`), set authoring (`loop_add_item` / `loop_drop_item` /
`loop_add_task`), block-on-task, and per-wave sealing all key off the agent **calling
these tools over MCP**. Any backend that doesn't speak MCP breaks this control channel.
That — not argv or streaming-format differences — is where the real cost sits.

## Coupling inventory (verified starting points)

| Seam | Where |
| --- | --- |
| Process launch & argv | `loops.rs stream_claude` (~1517), `run.rs claude_stream_argv` (~199), `actions.rs agent_argv` (~338); binary resolution `resolve_agent_path` / `which_on_path` |
| Stdout wire format | `stream-json` parser assuming `type: assistant\|user\|control_request\|result` + `tool_use`/`text` blocks — `loops.rs` (~1597), `run.rs` (~374) |
| MCP registration/discovery | `claude mcp add` (`mcp.rs` ~82), CLI-side discovery, `LOCKE_REPO`; tool surface in `crates/locke-mcp/src/main.rs` |
| Permissions | `control_request`/`control_response` `can_use_tool` handshake, `--permission-mode` (`auto`/`plan`/`acceptEdits`), `set_permission_mode`, auto-approve rules — `run.rs` (~442), `loops.rs` (~1628) |
| Tool-name & prompt assumptions | `Read`/`Edit`/`Bash`/`ExitPlanMode`, the `loop_*` protocol footers — `loops.rs` (~834, ~1736) |
| Existing multi-agent hints | `actions.rs` `KNOWN_AGENTS`, `detect_agents`, per-agent `agent_argv` — how far they reach, where they stop (the loops/streaming path ignores them) |

## The brief — what to produce

Hand the following to a research/plan agent (or run it as a `/code-review`-style
investigation). Deliver a single design doc: inventory table, capability matrix, trait
sketch, phased plan. **No code changes.**

1. **Coupling inventory (confirm + extend).** Map every Claude-Code-specific seam with
   `file:line`, expanding the table above: process launch & argv; stdout wire format
   (the `stream-json` schema); MCP registration + CLI-side discovery + `LOCKE_REPO` +
   the `locke-mcp` tool surface (`loop_add_item`, `loop_write_spec`, `loop_ask`,
   `loop_item_complete`, …); the permission `control_request`/`control_response`
   handshake and `--permission-mode` values; tool-name & prompt assumptions; model/
   session handling. Note how far the existing `actions.rs` multi-agent hints
   (`KNOWN_AGENTS`, `detect_agents`, per-agent `agent_argv`) already reach and where
   they stop.

2. **Backend capability matrix.** For each candidate (Codex, opencode, Aider, Gemini
   CLI, Cursor CLI): headless/non-interactive mode? Streaming output format (JSON events
   vs plain text) and its schema? **MCP support** (so `loop_*` works as-is) or not
   (→ how would the runner receive `loop_item_complete` / `loop_write_spec` / `loop_ask`
   — file/exit-code protocol, wrapper, stdout markers?)? Permission/approval model?
   Tool-call visibility (can we render a live trail?)? Model/auth config? Cite docs.

3. **The hard problems, ranked.** Chiefly the non-MCP control-channel break described
   above — propose fallbacks (a stdout sentinel protocol, a local control socket, or a
   thin per-backend MCP shim). Also: normalizing divergent streaming schemas into one
   internal event enum; differing permission handshakes; tool-name mapping.

4. **Proposed abstraction.** A minimal `AgentBackend` trait (Rust) covering: `argv`/
   spawn; a normalized event stream (`Text`, `ToolUse{name,input}`, `ToolResult`,
   `PermissionRequest`, `Turn/Result`); the permission response channel; and the
   control-channel strategy (MCP vs shim). Show how today's Claude path becomes
   `ClaudeBackend` behind it, and how `stream_claude` / `run_agent_stream` /
   `run_scope_agent` / `run.rs` consume the trait instead of `claude` directly.

5. **Phased plan + risks.**
   - **Phase 1** — extract `ClaudeBackend` behind the trait (no behaviour change;
     guarded by the loops smoke tests).
   - **Phase 2** — add one alternative end-to-end on the smoke repo.
   - **Phase 3** — backend-selection UI (reuse `detect_agents` / `KNOWN_AGENTS`;
     per-loop or global setting).
   - Call out where the `loop_*` MCP dependency is load-bearing and what each non-MCP
     backend would lose.
