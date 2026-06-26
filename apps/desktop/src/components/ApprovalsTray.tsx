import { useStore } from "../state/store.js";
import { color, font, alpha, agentKind, agentAccent, tint } from "../theme/tokens.js";
import { AgentMark } from "./AgentMark.js";
import { ChevronRightIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// The global approvals tray — every agent currently blocked on a permission,
// reachable from the action bar / status bar / Activity needs-you band so a run
// never blocks unseen. Rows are wired to allow/deny + open-run; the list is
// driven by `pending` (populated by the Phase 5 hero-flow).

export function ApprovalsTray() {
  const pending = useStore((s) => s.pending);
  const allow = useStore((s) => s.allowApproval);
  const deny = useStore((s) => s.denyApproval);
  const openReview = useStore((s) => s.openReview);

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
        <span style={{ fontSize: 13, fontWeight: 600, color: color.text }}>Pending approvals</span>
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
          {pending.length} blocked
        </span>
      </div>

      {pending.length === 0 ? (
        <div style={{ padding: "26px 16px", textAlign: "center", fontSize: 12, color: color.textGhost }}>
          No agents are waiting on you.
        </div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
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
