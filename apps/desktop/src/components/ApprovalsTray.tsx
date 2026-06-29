import { useStore } from "../state/store.js";
import { color, font, alpha, agentKind, agentAccent, tint } from "../theme/tokens.js";
import { AgentMark } from "./AgentMark.js";
import { ChevronRightIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// The global approvals tray — every agent currently blocked on a permission OR on a
// plan-interview question. Reachable from the action bar / status bar / Activity
// needs-you band so a run never blocks unseen. Permission rows wire to allow/deny +
// open-run; interview rows deep-link to the item to answer.

export function ApprovalsTray() {
  const pending = useStore((s) => s.pending);
  const allow = useStore((s) => s.allowApproval);
  const deny = useStore((s) => s.denyApproval);
  const openReview = useStore((s) => s.openReview);
  const loopInterview = useStore((s) => s.loopInterview);
  const loops = useStore((s) => s.loops);
  const openLoopQuestion = useStore((s) => s.openLoopQuestion);

  // Every loop with a still-open question — the model is blocked awaiting an answer.
  const questions = Object.entries(loopInterview).flatMap(([loopId, threads]) =>
    Object.entries(threads)
      .filter(([, t]) => t.pending)
      .map(([key, t]) => ({
        loopId,
        key,
        question: t.pending!.question,
        loopTitle: loops.find((l) => l.id === loopId)?.title ?? loopId,
        where: key === "__scope__" ? "scope" : key.split("/").pop() ?? key,
      })),
  );
  const total = pending.length + questions.length;

  return (
    <div
      style={{
        position: "absolute",
        top: 50,
        right: 13,
        width: 340,
        background: color.popoverBg,
        border: `1px solid ${color.borderPopover}`,
        borderRadius: 13,
        boxShadow: "0 20px 60px -16px rgba(0,0,0,.7)",
        overflow: "hidden",
        zIndex: 60,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "13px 15px",
          borderBottom: `1px solid ${color.borderRail}`,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: color.text }}>Needs you</span>
        <span
          style={{
            fontSize: 11,
            color: color.amber,
            background: alpha.amber(0.12),
            border: `1px solid ${alpha.amber(0.34)}`,
            borderRadius: 20,
            padding: "1px 8px",
            fontWeight: 600,
          }}
        >
          {total} blocked
        </span>
      </div>

      {total === 0 ? (
        <div style={{ padding: "26px 16px", textAlign: "center", fontSize: 12, color: color.textGhost }}>
          No agents are waiting on you.
        </div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          {/* Plan-interview questions — the strategist is blocked on your answer. */}
          {questions.map((q) => (
            <div key={`${q.loopId}:${q.key}`} style={{ padding: "13px 15px", borderBottom: `1px solid ${color.borderRow}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: color.teal,
                    background: tint(color.teal, "22"),
                    border: `1px solid ${tint(color.teal, "55")}`,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  ?
                </span>
                <span style={{ fontSize: 11.5, color: color.textSoft, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {q.loopTitle}
                </span>
                <span style={{ fontSize: 11, color: color.textGhost, fontFamily: font.mono, marginLeft: "auto", flex: "none" }}>{q.where}</span>
              </div>
              <div style={{ fontSize: 12, color: color.text, lineHeight: 1.5, marginBottom: 10 }}>{q.question}</div>
              <HoverButton
                onClick={() => openLoopQuestion(q.loopId, q.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  width: "100%",
                  padding: "6px 12px",
                  background: tint(color.teal, "14"),
                  border: `1px solid ${tint(color.teal, "57")}`,
                  borderRadius: 7,
                  color: color.teal,
                  fontFamily: font.sans,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                hoverStyle={{ background: tint(color.teal, "22") }}
              >
                Answer
                <ChevronRightIcon size={12} stroke={1.6} />
              </HoverButton>
            </div>
          ))}
          {pending.map((a) => {
            const kind = agentKind(a.initials);
            const accent = agentAccent[kind];
            return (
              <div key={a.id} style={{ padding: "13px 15px", borderBottom: `1px solid ${color.borderRow}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: accent,
                      background: `${tint(accent, "22")}`,
                      border: `1px solid ${tint(accent, "55")}`,
                    }}
                  >
                    <AgentMark kind={kind} label={a.initials} px={13} />
                  </span>
                  <span
                    style={{ fontSize: 11, color: color.textGhost, fontFamily: font.mono, marginLeft: "auto" }}
                  >
                    {a.branch}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: color.textFaint, marginBottom: 7 }}>wants to run</div>
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 12,
                    color: color.amber,
                    background: color.titlebarBg,
                    border: "1px solid #221c12",
                    borderRadius: 7,
                    padding: "7px 10px",
                    marginBottom: 10,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {a.cmd}
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  <HoverButton
                    onClick={() => deny(a.id)}
                    style={{
                      flex: "none",
                      padding: "6px 12px",
                      background: "transparent",
                      border: `1px solid ${color.borderInput}`,
                      borderRadius: 7,
                      color: color.textDim,
                      fontFamily: font.sans,
                      fontSize: 11.5,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                    hoverStyle={{ borderColor: "#3a414e" }}
                  >
                    Deny
                  </HoverButton>
                  <HoverButton
                    onClick={() => allow(a.id)}
                    style={{
                      flex: 1,
                      padding: "6px 12px",
                      background: alpha.amber(0.14),
                      border: `1px solid ${alpha.amber(0.4)}`,
                      borderRadius: 7,
                      color: color.amber,
                      fontFamily: font.sans,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                    hoverStyle={{ background: alpha.amber(0.22) }}
                  >
                    Allow once
                  </HoverButton>
                  <HoverButton
                    onClick={() => openReview(a.reviewId, "run")}
                    title="Open run"
                    style={{
                      flex: "none",
                      width: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "transparent",
                      border: `1px solid ${color.borderInput}`,
                      borderRadius: 7,
                      color: color.textFainter,
                      cursor: "pointer",
                    }}
                    hoverStyle={{ borderColor: "#3a414e", color: color.textDim }}
                  >
                    <ChevronRightIcon size={12} stroke={1.6} />
                  </HoverButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
