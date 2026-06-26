import type { Thread } from "@locke/core";
import { useStore } from "../state/store.js";
import { alpha, color, font } from "../theme/tokens.js";
import { HoverButton } from "./primitives.js";
import { CommentBody } from "./CommentBody.js";
import { ChatIcon, CheckIcon, CommentIcon } from "./icons.js";

// A deterministic colour per agent so multiple agents are distinguishable at a
// glance — e.g. a change by Claude and a review comment by Codex get different
// avatars. Humans keep the neutral slate avatar.
function agentTint(name: string): { bg: string; border: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return { bg: `hsl(${h} 42% 17%)`, border: `hsl(${h} 42% 32%)`, fg: `hsl(${h} 60% 80%)` };
}

// Agent identities arrive lowercased from $LOCKE_AGENT (e.g. "claude", "codex");
// title-case the first letter for display. Humans are shown verbatim.
const prettyAgent = (name: string) => (name ? name[0].toUpperCase() + name.slice(1) : name);

export function CommentThread({ thread }: { thread: Thread }) {
  const replyOpen = useStore((s) => s.replyOpen) === thread.id;
  const replyDraft = useStore((s) => s.replyDraft);
  const setReplyOpen = useStore((s) => s.setReplyOpen);
  const setReplyDraft = useStore((s) => s.setReplyDraft);
  const submitReply = useStore((s) => s.submitReply);
  const toggleResolve = useStore((s) => s.toggleResolve);
  const toggleChangeRequest = useStore((s) => s.toggleChangeRequest);
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const currentRunId = useStore((s) => s.currentRunId);
  const isChangeRequest = thread.kind === "change_request";

  // While an agent run is in flight on this review, an open change request is
  // actively being addressed — surface which run is on it.
  const review = reviews.find((r) => r.id === selectedPR);
  const beingAddressed = isChangeRequest && !thread.resolved && review?.runState === "running";
  const activeRunId = currentRunId ?? review?.runId;

  return (
    <div
      style={{
        margin: "2px 14px 8px 14px",
        border: "1px solid #262c38",
        borderRadius: 10,
        background: "#12151c",
        overflow: "hidden",
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid #1c212b",
          background: "#161a22",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ChatIcon size={13} color={color.textFaint} />
          <span style={{ fontSize: 11.5, color: color.textFaint, fontWeight: 500, letterSpacing: ".2px" }}>
            Conversation
          </span>
          {thread.resolved && (
            <span
              style={{
                fontSize: 10,
                color: color.green,
                background: "rgba(63,183,99,.12)",
                border: "1px solid rgba(63,183,99,.3)",
                padding: "1px 7px",
                borderRadius: 20,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <CheckIcon size={9} color={color.green} stroke={2.4} />
              Resolved
            </span>
          )}
          {isChangeRequest && (
            <span
              style={{
                fontSize: 10,
                color: color.amber,
                background: alpha.amber(0.12),
                border: `1px solid ${alpha.amber(0.3)}`,
                padding: "1px 7px",
                borderRadius: 20,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              Change request
            </span>
          )}
          {beingAddressed && (
            <span
              style={{
                fontSize: 11,
                color: color.textFaint,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.teal, animation: "lkpulse 1.6s infinite" }} />
              being addressed{activeRunId ? ` in ${activeRunId}` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <HoverButton
            onClick={() => toggleChangeRequest(thread.id)}
            style={{
              fontFamily: font.sans,
              fontSize: 11,
              color: isChangeRequest ? color.amber : color.textSoft,
              background: isChangeRequest ? alpha.amber(0.1) : "#1d232e",
              border: `1px solid ${isChangeRequest ? alpha.amber(0.32) : "#2c333f"}`,
              padding: "4px 10px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 500,
            }}
            hoverStyle={{ background: isChangeRequest ? alpha.amber(0.16) : "#252c39" }}
          >
            {isChangeRequest ? "Unmark" : "Request change"}
          </HoverButton>
          <HoverButton
            onClick={() => toggleResolve(thread.id)}
            style={{
              fontFamily: font.sans,
              fontSize: 11,
              color: color.textSoft,
              background: "#1d232e",
              border: "1px solid #2c333f",
              padding: "4px 10px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 500,
            }}
            hoverStyle={{ background: "#252c39" }}
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </HoverButton>
        </div>
      </div>

      <div style={{ padding: "2px 0" }}>
        {thread.items.map((item, i) => {
          const tint = item.isAgent ? agentTint(item.author) : null;
          return (
          <div key={i} style={{ display: "flex", gap: 10, padding: "11px 14px" }}>
            <div
              style={{
                flex: "none",
                width: 27,
                height: 27,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10.5,
                fontWeight: 600,
                background: tint?.bg ?? "#232a36",
                color: tint?.fg ?? "#c3cad6",
                border: `1px solid ${tint?.border ?? "#2e3744"}`,
              }}
            >
              {item.initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: color.text }}>
                  {item.isAgent ? prettyAgent(item.author) : item.author}
                </span>
                {item.isAgent ? (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: color.teal,
                      background: "rgba(63,208,192,.1)",
                      border: "1px solid rgba(63,208,192,.28)",
                      padding: "1px 6px",
                      borderRadius: 5,
                      letterSpacing: ".3px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <svg width={9} height={9} viewBox="0 0 16 16" fill={color.teal}>
                      <path d="M8 1l1.6 4.2L14 6.4l-3.4 3 1 4.6L8 11.7 4.4 14l1-4.6L2 6.4l4.4-1.2z" />
                    </svg>
                    AGENT
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: "#9aa3b4",
                      background: "#1d232e",
                      border: "1px solid #2c333f",
                      padding: "1px 6px",
                      borderRadius: 5,
                      letterSpacing: ".3px",
                    }}
                  >
                    {item.roleLabel ?? "REVIEWER"}
                  </span>
                )}
                <span style={{ fontSize: 11, color: color.textGhost }}>{item.time}</span>
              </div>
              <CommentBody body={item.body} />
            </div>
          </div>
          );
        })}
      </div>

      {replyOpen ? (
        <div style={{ padding: "6px 14px 12px 14px", borderTop: "1px solid #1c212b" }}>
          <textarea
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            placeholder="Reply…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 58,
              resize: "vertical",
              background: color.panelBg,
              border: "1px solid #2c333f",
              borderRadius: 7,
              padding: "8px 10px",
              color: color.text,
              fontFamily: font.sans,
              fontSize: 12.5,
              lineHeight: 1.5,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={() => setReplyOpen(null)}
              style={{
                fontFamily: font.sans,
                fontSize: 12,
                color: "#aab2c0",
                background: "transparent",
                border: "1px solid #2c333f",
                padding: "6px 13px",
                borderRadius: 7,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <HoverButton
              onClick={() => submitReply(thread.id)}
              style={{
                fontFamily: font.sans,
                fontSize: 12,
                fontWeight: 600,
                color: "#fff",
                background: color.violet,
                border: `1px solid ${color.violet}`,
                padding: "6px 14px",
                borderRadius: 7,
                cursor: "pointer",
              }}
              hoverStyle={{ background: color.violetHover }}
            >
              Reply
            </HoverButton>
          </div>
        </div>
      ) : (
        <HoverButton
          onClick={() => setReplyOpen(thread.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            textAlign: "left",
            padding: "10px 14px",
            borderTop: "1px solid #1c212b",
            background: "transparent",
            borderLeft: "none",
            borderRight: "none",
            borderBottom: "none",
            cursor: "pointer",
            fontFamily: font.sans,
            fontSize: 12,
            color: color.textFainter,
          }}
          hoverStyle={{ background: "#161a22", color: "#9aa3b4" }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              background: "#1d232e",
              border: "1px solid #2c333f",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CommentIcon size={10} color="#7b8494" stroke={1.6} />
          </span>
          Reply to this thread…
        </HoverButton>
      )}
    </div>
  );
}
