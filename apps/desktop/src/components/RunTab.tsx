import type { Review, RunEvent } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { ShieldIcon, StopIcon, SpinnerIcon, CheckIcon, CheckCircleIcon, PauseIcon, PlayIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// The live agent-run surface: status strip, streamed event log, inline permission
// prompt (real in-app Allow/Deny via the stream-json control protocol), done/ended
// banners, and a meta rail with the run location toggle. Driven by real backend
// events in Tauri mode; by the scripted hero-flow in mock mode.

const EV: Record<RunEvent["kind"], { ch: string; ic: string; tc: string }> = {
  msg: { ch: "◆", ic: "var(--lk-teal)", tc: "var(--lk-textSoft)" },
  read: { ch: "○", ic: "var(--lk-textGhost)", tc: "var(--lk-textFaint)" },
  edit: { ch: "✎", ic: "var(--lk-violetLight)", tc: "var(--lk-textSoft)" },
  result: { ch: "✓", ic: "var(--lk-green)", tc: "#9fc6ab" },
  done: { ch: "✓", ic: "var(--lk-green)", tc: "#bfe6c9" },
  denied: { ch: "✕", ic: "var(--lk-red)", tc: "#ca9aa0" },
};

function statusMetaForRun(agent: string, awaiting: boolean, done: boolean, paused: boolean, active: boolean) {
  if (done) return { label: "Run complete", headline: `${agent} · finished`, c: color.green, bg: alpha.green(0.1), border: alpha.green(0.34) };
  if (paused) return { label: "Run ended", headline: `${agent} · stopped before finishing`, c: color.red, bg: alpha.red(0.1), border: alpha.red(0.34) };
  if (awaiting) return { label: "Awaiting permission", headline: `${agent} · blocked on a tool`, c: color.amber, bg: alpha.amber(0.12), border: alpha.amber(0.4) };
  if (active) return { label: "Running", headline: `${agent} · working`, c: color.teal, bg: alpha.teal(0.1), border: alpha.teal(0.34) };
  return { label: "Idle", headline: `${agent} · no run in progress`, c: color.textFaint, bg: color.titlebarBg, border: color.borderPopover };
}

function EventRow({ ev }: { ev: RunEvent }) {
  const m = EV[ev.kind];
  return (
    <div style={{ display: "flex", gap: 11, padding: "6px 4px" }}>
      <span style={{ width: 22, flex: "none", display: "flex", justifyContent: "center", paddingTop: 2, color: m.ic, fontSize: 13, fontWeight: 700 }}>
        {m.ch}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: m.tc }}>{ev.text}</div>
        {ev.sub && (
          <div style={{ marginTop: 5, fontFamily: font.mono, fontSize: 11.5, color: "#7b8494", background: color.titlebarBg, border: `1px solid ${color.borderRail2}`, borderRadius: 7, padding: "8px 11px", whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>
            {ev.sub}
          </div>
        )}
      </div>
      <span style={{ flex: "none", fontSize: 10.5, color: "var(--lk-lineNo)", fontFamily: font.mono, paddingTop: 3 }}>{ev.time}</span>
    </div>
  );
}

const metaRow = (label: string, value: string, mono = false) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
    <span style={{ color: color.textFainter, flex: "none" }}>{label}</span>
    <span style={{ color: color.textSoft, fontFamily: mono ? font.mono : font.sans, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
  </div>
);

export function RunTab({ review }: { review: Review }) {
  const runEvents = useStore((s) => s.runEvents);
  const pending = useStore((s) => s.pending);
  const runDone = useStore((s) => s.runDone);
  const runPaused = useStore((s) => s.runPaused);
  const currentRunId = useStore((s) => s.currentRunId);
  const setWorkspaceTab = useStore((s) => s.setWorkspaceTab);
  const allowApproval = useStore((s) => s.allowApproval);
  const denyApproval = useStore((s) => s.denyApproval);
  const requestRun = useStore((s) => s.requestRun);
  const cancelRun = useStore((s) => s.cancelRun);
  const runUseWorktree = useStore((s) => s.runUseWorktree);
  const setRunUseWorktree = useStore((s) => s.setRunUseWorktree);
  const threads = useStore((s) => s.threads);
  const agents = useStore((s) => s.agents);
  const disabledAgents = useStore((s) => s.disabledAgents);
  const runSelectedAgentId = useStore((s) => s.runSelectedAgentId);

  const flagCount = threads.filter((t) => t.kind === "change_request" && !t.resolved).length;
  const perm = pending.find((p) => p.reviewId === review.id);
  const awaiting = !!perm && !runDone && !runPaused;
  const runActive = (!!currentRunId || review.runState === "running") && !awaiting && !runDone && !runPaused;
  const idle = !runActive && !awaiting && !runDone && !runPaused && runEvents.length === 0;
  // Label the run surface with the agent that actually performs the run — the
  // one the user picked in the approval modal, else the first detected, enabled
  // CLI (matching startRun's selection) — not review.agent, which is the branch
  // author's git commit name. Falls back to "Claude" before any agent is detected.
  const enabled = (a: typeof agents[number]) => a.detected && !disabledAgents.includes(a.id);
  const runner = agents.find((a) => a.id === runSelectedAgentId && enabled(a)) ?? agents.find(enabled);
  const agent = runner ? (runner.id === "claude" ? "Claude" : runner.name) : "Claude";
  const sm = statusMetaForRun(agent, awaiting, runDone, runPaused, runActive);
  const runId = currentRunId ?? review.runId ?? "—";
  const editCount = runEvents.filter((e) => e.kind === "edit").length;
  const elapsed = runEvents.length ? runEvents[runEvents.length - 1].time || "—" : "—";
  const canStop = runActive || awaiting;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* status strip */}
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "13px 24px", borderBottom: `1px solid ${color.borderSubtle}`, background: color.titlebarBg }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, color: sm.c, background: sm.bg, border: `1px solid ${sm.border}` }}>
            {runActive && <SpinnerIcon size={12} color="currentColor" stroke={1.8} />}
            {awaiting && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: "lkpulse 1.2s infinite" }} />}
            {runDone && <CheckIcon size={13} color="currentColor" stroke={1.9} />}
            {sm.label}
          </span>
          <span style={{ fontSize: 12.5, color: color.textFaint }}>{sm.headline}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.textGhost }}>{runId}</span>
            {canStop && (
              <HoverButton
                onClick={() => void cancelRun()}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", background: "transparent", border: `1px solid ${color.borderPopover}`, borderRadius: 8, color: color.textDim, fontFamily: font.sans, fontSize: 11.5, cursor: "pointer" }}
                hoverStyle={{ borderColor: alpha.red(0.5), color: color.red }}
              >
                <StopIcon size={11} color="currentColor" stroke={1.6} />
                Stop
              </HoverButton>
            )}
          </div>
        </div>

        {/* stream */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
          {idle ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, color: color.textGhost, textAlign: "center", padding: "0 32px" }}>
              {flagCount > 0 ? (
                <>
                  <div style={{ fontSize: 13 }}>
                    {flagCount} open change request{flagCount === 1 ? "" : "s"} to action.
                  </div>
                  <HoverButton
                    onClick={requestRun}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: alpha.teal(0.12), border: `1px solid ${alpha.teal(0.4)}`, borderRadius: 9, color: color.teal, fontFamily: font.sans, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    hoverStyle={{ background: alpha.teal(0.2) }}
                  >
                    <PlayIcon size={14} color="currentColor" stroke={1.6} />
                    Resolve the open change requests
                  </HoverButton>
                </>
              ) : (
                <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 420 }}>
                  No open change requests on this review — nothing for the agent to action.
                  <br />
                  Flag a comment as a change request in the Diff tab to enable a run.
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {runEvents.map((ev) => (
                <EventRow key={ev.key} ev={ev} />
              ))}

              {awaiting && perm && (
                <div style={{ margin: "10px 0 6px 33px", border: `1px solid ${alpha.amber(0.42)}`, borderRadius: 12, overflow: "hidden", background: "linear-gradient(180deg,rgba(240,184,110,.07),rgba(240,184,110,.02))" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 15px", borderBottom: `1px solid ${alpha.amber(0.18)}` }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: alpha.amber(0.18), display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <ShieldIcon size={11} color={color.amber} stroke={1.7} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#f4d4a0" }}>{agent} wants to use {perm.tool}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#b08a4e" }}>paused until you decide</span>
                  </div>
                  <div style={{ padding: "14px 15px" }}>
                    {perm.cmd && (
                      <div style={{ fontFamily: font.mono, fontSize: 13, color: color.amber, background: color.titlebarBg, border: "1px solid #221c12", borderRadius: 8, padding: "11px 13px", marginBottom: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {perm.tool === "Bash" ? "$ " : ""}{perm.cmd}
                      </div>
                    )}
                    {perm.why && <div style={{ fontSize: 12, color: color.textFaint, lineHeight: 1.5, marginBottom: 14 }}>{perm.why}</div>}
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <HoverButton
                        onClick={() => denyApproval(perm.id)}
                        style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${color.borderInput}`, borderRadius: 8, color: color.textDim, fontFamily: font.sans, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
                        hoverStyle={{ borderColor: "#3a414e" }}
                      >
                        Deny
                      </HoverButton>
                      <HoverButton
                        onClick={() => allowApproval(perm.id)}
                        style={{ padding: "8px 16px", background: alpha.amber(0.16), border: `1px solid ${alpha.amber(0.44)}`, borderRadius: 8, color: color.amber, fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                        hoverStyle={{ background: alpha.amber(0.24) }}
                      >
                        Allow
                      </HoverButton>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: color.textGhost }}>{perm.scope}</span>
                    </div>
                  </div>
                </div>
              )}

              {runDone && (
                <div style={{ margin: "12px 0 6px 33px", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: `1px solid ${alpha.green(0.3)}`, borderRadius: 12, background: alpha.green(0.06) }}>
                  <CheckCircleIcon size={18} color={color.green} stroke={1.8} />
                  <span style={{ fontSize: 13, color: "#9fc6ab", flex: 1 }}>
                    <span style={{ fontWeight: 600, color: "#bfe6c9" }}>Run complete.</span> Re-review the updated diff, then approve.
                  </span>
                  <HoverButton
                    onClick={() => setWorkspaceTab("diff")}
                    style={{ flex: "none", padding: "8px 14px", background: color.violet, border: `1px solid ${color.violet}`, borderRadius: 8, color: "#fff", fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    hoverStyle={{ background: color.violetHover }}
                  >
                    Re-review diff
                  </HoverButton>
                </div>
              )}

              {runPaused && (
                <div style={{ margin: "12px 0 6px 33px", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: `1px solid ${alpha.red(0.3)}`, borderRadius: 12, background: alpha.red(0.06) }}>
                  <PauseIcon size={17} color={color.red} stroke={1.8} />
                  <span style={{ fontSize: 13, color: "#ca9aa0", flex: 1 }}>
                    <span style={{ fontWeight: 600, color: "#f0a5ac" }}>Run ended.</span> It was stopped or hit an error before finishing — start another run to try again.
                  </span>
                  <HoverButton
                    onClick={requestRun}
                    style={{ flex: "none", padding: "8px 14px", background: "transparent", border: `1px solid ${color.borderInput}`, borderRadius: 8, color: color.textDim, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    hoverStyle={{ borderColor: "#3a414e" }}
                  >
                    Resolve again
                  </HoverButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* meta rail */}
      <div style={{ width: 248, flex: "none", borderLeft: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, overflowY: "auto", padding: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, marginBottom: 11 }}>THIS RUN</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 20 }}>
          {metaRow("Agent", agent)}
          {metaRow("Branch", review.branch, true)}
          {metaRow("Edits", String(editCount), true)}
          {metaRow("Elapsed", elapsed, true)}
        </div>

        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, marginBottom: 11 }}>RUN LOCATION</div>
        <div style={{ display: "flex", gap: 2, background: color.titlebarBg, border: `1px solid ${color.borderRail2}`, borderRadius: 9, padding: 3, marginBottom: 8, opacity: canStop ? 0.5 : 1, pointerEvents: canStop ? "none" : "auto" }}>
          {([
            ["Worktree", true],
            ["Working dir", false],
          ] as const).map(([label, val]) => {
            const on = runUseWorktree === val;
            return (
              <button
                key={label}
                onClick={() => setRunUseWorktree(val)}
                style={{ flex: 1, padding: "6px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: font.sans, fontSize: 11.5, fontWeight: 600, color: on ? color.textBright : color.textFaint, background: on ? color.rowActiveBg : "transparent" }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: color.textGhost, lineHeight: 1.5 }}>
          {runUseWorktree
            ? "Edits run in an isolated worktree and are committed onto the branch on success."
            : "Edits run directly in the repo working tree, where you'll see them live."}
        </div>
      </div>
    </div>
  );
}
