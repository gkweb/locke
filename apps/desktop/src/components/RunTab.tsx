import type { Review, RunEvent } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { ShieldIcon, StopIcon, SpinnerIcon, CheckIcon, CheckCircleIcon, PauseIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// The live agent-run surface (prototype): status strip, event stream, inline
// permission prompt, done/paused banners and a meta rail with a mock terminal.
// Driven by the scripted hero-flow in the store (real streaming is a later phase).

const EV: Record<RunEvent["kind"], { ch: string; ic: string; tc: string }> = {
  msg: { ch: "◆", ic: "#3fd0c0", tc: "#cdd3de" },
  read: { ch: "○", ic: "#5f6878", tc: "#8b94a6" },
  edit: { ch: "✎", ic: "#b3a8ff", tc: "#cdd3de" },
  result: { ch: "✓", ic: "#43c46b", tc: "#9fc6ab" },
  done: { ch: "✓", ic: "#43c46b", tc: "#bfe6c9" },
  denied: { ch: "✕", ic: "#f0616d", tc: "#ca9aa0" },
};

function statusMetaForRun(awaiting: boolean, done: boolean, paused: boolean) {
  if (done) return { label: "Run complete", headline: "Claude · addressed 2 change requests", c: color.green, bg: alpha.green(0.1), border: alpha.green(0.34) };
  if (paused) return { label: "Run paused", headline: "Claude · waiting for you to resume", c: color.red, bg: alpha.red(0.1), border: alpha.red(0.34) };
  if (awaiting) return { label: "Awaiting permission", headline: "Claude · blocked on a command", c: color.amber, bg: alpha.amber(0.12), border: alpha.amber(0.4) };
  return { label: "Running", headline: "Claude · working", c: color.teal, bg: alpha.teal(0.1), border: alpha.teal(0.34) };
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
          <div style={{ marginTop: 5, fontFamily: font.mono, fontSize: 11.5, color: "#7b8494", background: color.titlebarBg, border: `1px solid ${color.borderRail2}`, borderRadius: 7, padding: "8px 11px", whiteSpace: "pre-wrap" }}>
            {ev.sub}
          </div>
        )}
      </div>
      <span style={{ flex: "none", fontSize: 10.5, color: "#454d5b", fontFamily: font.mono, paddingTop: 3 }}>{ev.time}</span>
    </div>
  );
}

const metaRow = (label: string, value: string, mono = false) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
    <span style={{ color: color.textFainter }}>{label}</span>
    <span style={{ color: color.textSoft, fontFamily: mono ? font.mono : font.sans }}>{value}</span>
  </div>
);

export function RunTab({ review }: { review: Review }) {
  const runEvents = useStore((s) => s.runEvents);
  const pending = useStore((s) => s.pending);
  const runDone = useStore((s) => s.runDone);
  const runPaused = useStore((s) => s.runPaused);
  const setWorkspaceTab = useStore((s) => s.setWorkspaceTab);
  const allowApproval = useStore((s) => s.allowApproval);
  const denyApproval = useStore((s) => s.denyApproval);

  const perm = pending.find((p) => p.reviewId === review.id);
  const awaiting = !!perm && !runDone && !runPaused;
  const runActive = !awaiting && !runDone && !runPaused && review.runState === "running";
  const sm = statusMetaForRun(awaiting, runDone, runPaused);
  const runId = review.runId ?? "run #R7";
  const permsUsed = String(2 - pending.filter((p) => p.reviewId === review.id).length + (runDone ? 1 : 0));
  const elapsed = runDone ? "0:49" : review.elapsed ?? "0:41";

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
            <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", background: "transparent", border: `1px solid ${color.borderPopover}`, borderRadius: 8, color: color.textDim, fontFamily: font.sans, fontSize: 11.5 }}>
              <StopIcon size={11} color="currentColor" stroke={1.6} />
              Stop
            </span>
          </div>
        </div>

        {/* stream */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
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
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#f4d4a0" }}>Claude wants to run a command</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#b08a4e" }}>paused until you decide</span>
                </div>
                <div style={{ padding: "14px 15px" }}>
                  <div style={{ fontFamily: font.mono, fontSize: 13, color: color.amber, background: color.titlebarBg, border: "1px solid #221c12", borderRadius: 8, padding: "11px 13px", marginBottom: 8 }}>
                    $ {perm.cmd}
                  </div>
                  <div style={{ fontSize: 12, color: color.textFaint, lineHeight: 1.5, marginBottom: 14 }}>{perm.why}</div>
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
                      Allow once
                    </HoverButton>
                    <HoverButton
                      onClick={() => allowApproval(perm.id)}
                      style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${color.borderInput}`, borderRadius: 8, color: color.textFaint, fontFamily: font.sans, fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
                      hoverStyle={{ borderColor: "#3a414e" }}
                    >
                      Always allow <span style={{ fontFamily: font.mono }}>{perm.tool}</span>
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
                  <span style={{ fontWeight: 600, color: "#bfe6c9" }}>Run complete.</span> 2 change requests addressed and committed. Re-review the updated diff, then approve.
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
                  <span style={{ fontWeight: 600, color: "#f0a5ac" }}>Run paused.</span> You denied the command. Edit the prompt or resume to let the agent try another approach.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* meta rail */}
      <div style={{ width: 248, flex: "none", borderLeft: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, overflowY: "auto", padding: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, marginBottom: 11 }}>THIS RUN</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 20 }}>
          {metaRow("Task", "Address 2 requests")}
          {metaRow("Files touched", "2", true)}
          {metaRow("Permissions", permsUsed, true)}
          {metaRow("Elapsed", elapsed, true)}
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, marginBottom: 11 }}>TERMINAL</div>
        <div style={{ background: color.terminalBg, border: `1px solid ${color.borderRail2}`, borderRadius: 9, padding: "11px 12px", fontFamily: font.mono, fontSize: 11, lineHeight: 1.7, color: "#7b8494", minHeight: 120 }}>
          <div style={{ color: color.textGhost }}>payments-service · {review.branch}</div>
          <div style={{ color: "#7b8494" }}>$ git status --short</div>
          <div style={{ color: color.amber }}> M src/webhooks/retryHandler.ts</div>
          <div style={{ color: color.amber }}> M tests/webhooks/retry.test.ts</div>
          <div style={{ color: color.teal }}>
            ${" "}
            <span style={{ display: "inline-block", width: 7, height: 13, background: color.teal, verticalAlign: "middle", animation: "lkblink 1s steps(1) infinite" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
