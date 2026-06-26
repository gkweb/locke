import { useStore } from "../state/store.js";
import { color, font, alpha, agentIdAccent } from "../theme/tokens.js";
import { PlayIcon, CheckIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// Pre-run approval gate for the "Resolve" action. Before any agent touches the
// branch, the user confirms WHAT will run, sees and can change WHICH agent does
// the work, and chooses whether to hand permission decisions to the agent's own
// classifier (Auto mode). Confirming calls `confirmRun`; nothing runs otherwise.

export function RunApprovalModal() {
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const threads = useStore((s) => s.threads);
  const agents = useStore((s) => s.agents);
  const disabledAgents = useStore((s) => s.disabledAgents);
  const runUseWorktree = useStore((s) => s.runUseWorktree);
  const runSelectedAgentId = useStore((s) => s.runSelectedAgentId);
  const runAutoMode = useStore((s) => s.runAutoMode);
  const runPlanFirst = useStore((s) => s.runPlanFirst);
  const setRunSelectedAgent = useStore((s) => s.setRunSelectedAgent);
  const setRunAutoMode = useStore((s) => s.setRunAutoMode);
  const setRunPlanFirst = useStore((s) => s.setRunPlanFirst);
  const cancel = useStore((s) => s.cancelRunApproval);
  const confirm = useStore((s) => s.confirmRun);

  const review = reviews.find((r) => r.id === selectedPR);
  const available = agents.filter((a) => a.detected && !disabledAgents.includes(a.id));
  const selected = available.find((a) => a.id === runSelectedAgentId) ?? available[0];
  const flagCount = threads.filter((t) => t.kind === "change_request" && !t.resolved).length;

  // Auto mode is Claude's own permission classifier; other agents don't take the
  // `--permission-mode` flag. Codex effectively always runs unattended.
  const isClaude = selected?.id === "claude";
  const isCodex = selected?.id === "codex";
  // Plan first is the `--permission-mode plan` flow — Claude-only.
  const planSupported = isClaude;
  const planFirst = runPlanFirst && planSupported;
  // When planning first, the build phase runs with per-tool prompts (Auto can't be
  // pre-armed for it), so Auto and Plan are mutually exclusive in the UI.
  const autoSupported = isClaude && !planFirst;
  const autoNote = planFirst
    ? "You'll choose whether the build runs unattended (Auto mode) when you approve the plan."
    : isClaude
      ? "Claude approves its own in-scope actions (no per-tool prompts). Anything risky still stops for you."
      : isCodex
        ? "Codex already runs unattended — this toggle has no effect for it."
        : `${selected?.name ?? "This agent"} runs headlessly; Locke can't set its permission mode.`;
  const planNote = planSupported
    ? "Claude investigates and presents a plan for your approval before editing. Approve it to start the work."
    : `${selected?.name ?? "This agent"} doesn't support plan mode — it runs directly.`;

  const accent = selected ? agentIdAccent[selected.id] ?? color.violet : color.violet;

  return (
    <div
      onClick={cancel}
      style={{ position: "fixed", inset: 0, background: color.scrim, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, background: color.panelBg, border: `1px solid ${color.borderPanel}`, borderRadius: 14, padding: 20, fontFamily: font.sans }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <PlayIcon size={14} color={color.teal} stroke={1.7} />
          <div style={{ fontSize: 15, fontWeight: 700, color: color.textBright }}>Resolve change requests</div>
        </div>
        <div style={{ fontSize: 12.5, color: color.textFainter, marginBottom: 18, lineHeight: 1.5 }}>
          This runs an agent on the{" "}
          <span style={{ color: color.text }}>{flagCount} open change request{flagCount === 1 ? "" : "s"}</span> on{" "}
          <span style={{ fontFamily: font.mono, color: color.greenText }}>{review?.branch ?? "this branch"}</span>. It edits files
          {runUseWorktree ? " in an isolated worktree and commits onto the branch on success." : " directly in your working tree."}
        </div>

        {/* agent picker */}
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: color.textGhost, marginBottom: 8 }}>
          AGENT DOING THE WORK
        </div>
        {available.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.red, marginBottom: 16 }}>
            No enabled agent detected. Enable one in the Agents screen to run.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
            {available.map((a) => {
              const on = a.id === selected?.id;
              const ac = agentIdAccent[a.id] ?? color.violet;
              return (
                <HoverButton
                  key={a.id}
                  onClick={() => setRunSelectedAgent(a.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "10px 12px",
                    borderRadius: 9,
                    cursor: "pointer",
                    textAlign: "left",
                    background: on ? alpha.violet(0.08) : "transparent",
                    border: `1px solid ${on ? ac : color.borderInput}`,
                  }}
                  hoverStyle={on ? undefined : { borderColor: "#3a414e" }}
                >
                  <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: on ? ac : "transparent", border: `1.5px solid ${on ? ac : color.textGhost}` }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: color.textBright }}>{a.name}</span>
                    {a.version && <span style={{ fontSize: 11, color: color.textGhost, marginLeft: 7, fontFamily: font.mono }}>{a.version}</span>}
                  </span>
                  <span style={{ fontFamily: font.mono, fontSize: 11, color: ac }}>{a.cmd}</span>
                </HoverButton>
              );
            })}
          </div>
        )}

        {/* plan first */}
        <button
          onClick={() => planSupported && setRunPlanFirst(!runPlanFirst)}
          disabled={!planSupported}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 13px",
            borderRadius: 10,
            textAlign: "left",
            cursor: planSupported ? "pointer" : "default",
            background: color.appBg,
            border: `1px solid ${planFirst ? alpha.violet(0.5) : color.borderInput}`,
            opacity: planSupported ? 1 : 0.6,
            fontFamily: font.sans,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              width: 34,
              height: 20,
              flex: "none",
              borderRadius: 11,
              padding: 2,
              display: "flex",
              background: planFirst ? color.violet : "var(--lk-borderPopover)",
              justifyContent: planFirst ? "flex-end" : "flex-start",
            }}
          >
            <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff" }} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: color.textSoft, display: "block" }}>Plan first</span>
            <span style={{ fontSize: 11.5, color: color.textGhost, lineHeight: 1.45 }}>{planNote}</span>
          </span>
        </button>

        {/* auto mode */}
        <button
          onClick={() => autoSupported && setRunAutoMode(!runAutoMode)}
          disabled={!autoSupported}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 13px",
            borderRadius: 10,
            textAlign: "left",
            cursor: autoSupported ? "pointer" : "default",
            background: color.appBg,
            border: `1px solid ${runAutoMode && autoSupported ? alpha.teal(0.5) : color.borderInput}`,
            opacity: autoSupported ? 1 : 0.6,
            fontFamily: font.sans,
          }}
        >
          <span
            style={{
              width: 34,
              height: 20,
              flex: "none",
              borderRadius: 11,
              padding: 2,
              display: "flex",
              background: runAutoMode && autoSupported ? color.teal : "var(--lk-borderPopover)",
              justifyContent: runAutoMode && autoSupported ? "flex-end" : "flex-start",
            }}
          >
            <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff" }} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: color.textSoft, display: "block" }}>Auto mode</span>
            <span style={{ fontSize: 11.5, color: color.textGhost, lineHeight: 1.45 }}>{autoNote}</span>
          </span>
        </button>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button
            onClick={cancel}
            style={{ fontFamily: font.sans, fontSize: 12.5, color: "var(--lk-textDim)", background: "transparent", border: `1px solid ${color.borderInput}`, padding: "8px 15px", borderRadius: 8, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            disabled={!selected}
            onClick={confirm}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              background: selected ? accent : "var(--lk-borderPopover)",
              border: `1px solid ${selected ? accent : "var(--lk-borderPopover)"}`,
              padding: "8px 16px",
              borderRadius: 8,
              cursor: selected ? "pointer" : "not-allowed",
              opacity: selected ? 1 : 0.7,
            }}
          >
            <CheckIcon size={13} color="#fff" stroke={1.8} />
            {planFirst ? `Plan with ${selected?.name ?? "agent"}` : `Resolve with ${selected?.name ?? "agent"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
