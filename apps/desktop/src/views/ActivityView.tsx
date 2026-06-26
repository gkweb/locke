import type { Review } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, alpha, tint } from "../theme/tokens.js";
import { reviewKind, reviewAccent } from "../lib/fleet.js";
import { AgentMark } from "../components/AgentMark.js";
import { BranchIcon, CheckCircleIcon, ChevronRightIcon, ArrowRightIcon, SpinnerIcon } from "../components/icons.js";
import { HoverDiv } from "../components/primitives.js";

// The fleet home. Agent-mode shows agent stats, a needs-you band and the
// RUNS IN FLIGHT grid; reviews-only collapses to "N ready" + the ready list.

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".8px",
  color: color.textGhost,
};

function StateBadge({ r }: { r: Review }) {
  if (r.runState === "running") {
    return (
      <span style={pill(color.teal, alpha.teal(0.1), alpha.teal(0.32))}>
        <SpinnerIcon size={10} color={color.teal} stroke={1.8} />
        Running
      </span>
    );
  }
  if (r.runState === "awaiting") {
    return (
      <span style={pill(color.amber, alpha.amber(0.12), alpha.amber(0.34))}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", animation: "lkpulse 1.2s infinite" }} />
        Awaiting you
      </span>
    );
  }
  return (
    <span style={pill(color.green, alpha.green(0.1), alpha.green(0.32))}>Ready</span>
  );
}

function pill(c: string, bg: string, border: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 9px",
    borderRadius: 20,
    color: c,
    background: bg,
    border: `1px solid ${border}`,
  };
}

function actionGlyph(r: Review): { ch: string; col: string } {
  if (r.runState === "awaiting") return { ch: "◆", col: color.amber };
  if (r.runState === "done") return { ch: "✓", col: color.green };
  return { ch: "✎", col: reviewAccent(r) }; // running
}

function InFlightCard({ r }: { r: Review }) {
  const openReview = useStore((s) => s.openReview);
  const kind = reviewKind(r);
  const accent = reviewAccent(r);
  const glyph = actionGlyph(r);
  const awaiting = r.runState === "awaiting";
  const cardBorder =
    r.runState === "awaiting" ? alpha.amber(0.28) : r.runState === "done" ? alpha.green(0.26) : color.borderPanel;
  return (
    <HoverDiv
      onClick={() => openReview(r.id, "run")}
      style={{
        minWidth: 0,
        border: `1px solid ${cardBorder}`,
        borderRadius: 13,
        background: color.panelBg,
        padding: "15px 16px",
        cursor: "pointer",
      }}
      hoverStyle={{ borderColor: "var(--lk-borderInput)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: accent,
            background: `${tint(accent, "22")}`,
            border: `1px solid ${tint(accent, "55")}`,
          }}
        >
          <AgentMark kind={kind} label={r.initials} px={15} />
        </span>
        <StateBadge r={r} />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: font.mono,
          fontSize: 11,
          color: color.greenText,
          marginBottom: 13,
          minWidth: 0,
        }}
      >
        <BranchIcon size={11} color="#7b8494" stroke={1.4} style={{ flex: "none" }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.branch}</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 7,
          fontSize: 11.5,
          color: color.textFaint,
          lineHeight: 1.4,
          minHeight: 32,
          minWidth: 0,
        }}
      >
        <span style={{ marginTop: 1, flex: "none", color: glyph.col, fontSize: 12, fontWeight: 700 }}>{glyph.ch}</span>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: color.textDim,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {r.lastAction}
        </span>
      </div>
      <div
        style={{
          marginTop: 13,
          paddingTop: 12,
          borderTop: `1px solid ${color.borderRowFaint}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{ fontSize: 11.5, color: "#7b8494", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {r.title}
        </span>
        {awaiting ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openReview(r.id, "run");
            }}
            style={{
              flex: "none",
              padding: "5px 11px",
              background: alpha.amber(0.14),
              border: `1px solid ${alpha.amber(0.4)}`,
              borderRadius: 7,
              color: color.amber,
              fontFamily: font.sans,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Review
          </button>
        ) : (
          <span style={{ flex: "none", fontSize: 11, color: color.textFainter }}>{r.elapsed}</span>
        )}
      </div>
    </HoverDiv>
  );
}

function ReadyRow({ r }: { r: Review }) {
  const openReview = useStore((s) => s.openReview);
  const kind = reviewKind(r);
  const accent = reviewAccent(r);
  return (
    <HoverDiv
      onClick={() => openReview(r.id, "diff")}
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        padding: "15px 18px",
        border: `1px solid ${color.borderRow}`,
        borderRadius: 12,
        background: color.panelBg,
        marginBottom: 11,
        cursor: "pointer",
      }}
      hoverStyle={{ borderColor: "var(--lk-borderInput)", background: color.rowHoverBg }}
    >
      <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: color.green }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--lk-textBright)", letterSpacing: "-.2px" }}>{r.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap", fontSize: 11.5, color: color.textFainter }}>
          <span style={{ fontFamily: font.mono, color: "#7b8494" }}>#{r.id}</span>
          <span style={{ color: "#3a414e" }}>·</span>
          <span style={{ fontFamily: font.mono, color: color.textFaint }}>{r.branch}</span>
          <ArrowRightIcon size={12} color="#3a414e" stroke={1.4} />
          <span style={{ fontFamily: font.mono, color: color.blue }}>{r.base}</span>
          <span style={{ color: "#3a414e" }}>·</span>
          <span
            style={{
              width: 18,
              height: 18,
              flex: "none",
              borderRadius: 5,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: accent,
              background: `${tint(accent, "22")}`,
              border: `1px solid ${tint(accent, "55")}`,
            }}
          >
            <AgentMark kind={kind} label={r.initials} px={11} />
          </span>
          <span style={{ color: "#3a414e" }}>·</span>
          <span>{r.time}</span>
        </div>
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: color.green }}>
        <CheckCircleIcon size={13} color={color.green} stroke={1.6} />
        checks pass
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: font.mono, fontSize: 11.5 }}>
        <span style={{ color: color.green }}>+{r.add}</span>
        <span style={{ color: color.red }}>−{r.del}</span>
      </span>
      <ChevronRightIcon size={15} color="var(--lk-lineNo)" stroke={1.5} />
    </HoverDiv>
  );
}

export function ActivityView() {
  const reviews = useStore((s) => s.reviews);
  const agentMode = useStore((s) => s.agentMode);
  const pending = useStore((s) => s.pending);
  const toggleApprovals = useStore((s) => s.toggleApprovals);

  const inFlight = reviews.filter((r) => r.runState === "running" || r.runState === "awaiting");
  const ready = reviews.filter((r) => r.status === "ready");
  const hasApprovals = agentMode && pending.length > 0;
  const repo = "payments-service";

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", background: color.appBg }}>
      <div style={{ padding: "26px 32px 0" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, letterSpacing: "-.5px", color: color.textBright }}>Activity</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 12.5, color: color.textFaint }}>
            {agentMode && (
              <span>
                <span style={{ color: color.teal, fontWeight: 600 }}>{inFlight.length}</span> agents
              </span>
            )}
            <span>
              <span style={{ color: color.textSoft, fontWeight: 600 }}>{reviews.length}</span> branches
            </span>
            {agentMode ? (
              <span>
                <span style={{ color: color.amber, fontWeight: 600 }}>{pending.length}</span> awaiting you
              </span>
            ) : (
              <span>
                <span style={{ color: color.green, fontWeight: 600 }}>{ready.length}</span> ready
              </span>
            )}
          </div>
        </div>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: color.textFainter }}>
          {agentMode ? "Everything your agents are doing in " : "Open branches in "}
          <span style={{ fontFamily: font.mono, color: color.textFaint }}>{repo}</span>, before any of it reaches{" "}
          <span style={{ fontFamily: font.mono, color: color.textFaint }}>origin/main</span>.
        </p>
      </div>

      {hasApprovals && (
        <HoverDiv
          onClick={toggleApprovals}
          style={{
            margin: "18px 32px 0",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: 11,
            background: alpha.amber(0.08),
            border: `1px solid ${alpha.amber(0.3)}`,
            cursor: "pointer",
          }}
          hoverStyle={{ background: alpha.amber(0.12) }}
        >
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: color.amber, animation: "lkpulse 1.4s infinite" }} />
          <span style={{ fontSize: 13, color: "#f4d4a0", fontWeight: 500, flex: 1 }}>
            <span style={{ fontWeight: 700, color: color.amber }}>
              {pending.length} agents are blocked on you
            </span>{" "}
            — waiting for permission to run a command.
          </span>
          <span style={{ fontSize: 12, color: color.amber, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
            Review approvals <ChevronRightIcon size={12} color={color.amber} stroke={1.7} />
          </span>
        </HoverDiv>
      )}

      {agentMode && inFlight.length > 0 && (
        <div style={{ padding: "26px 32px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <span style={sectionLabel}>RUNS IN FLIGHT</span>
            <span style={{ fontSize: 11, color: color.textFainter }}>{inFlight.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
            {inFlight.map((r) => (
              <InFlightCard key={r.id} r={r} />
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: "28px 32px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <span style={sectionLabel}>READY TO REVIEW</span>
          <span style={{ fontSize: 11, color: color.textFainter }}>{ready.length}</span>
        </div>
        {ready.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.textGhost }}>Nothing waiting on you right now.</div>
        ) : (
          ready.map((r) => <ReadyRow key={r.id} r={r} />)
        )}
      </div>
    </div>
  );
}
