import { useStore } from "../state/store.js";
import { color, font, agentKind, agentAccent, runStateMeta } from "../theme/tokens.js";
import { AgentMark } from "../components/AgentMark.js";
import { ChevronRightIcon } from "../components/icons.js";
import { HoverDiv } from "../components/primitives.js";

// Global runs table — every agent run in the repo, live and historical. Each row
// opens its review on the Run tab. (Mock-seeded; real persisted runs are a later
// backend phase.)

const GRID = "80px 1.4fr 1.4fr 1fr 90px 40px";
const headCell: React.CSSProperties = { padding: "11px 8px" };

export function RunsView() {
  const runRows = useStore((s) => s.runRows);
  const openReview = useStore((s) => s.openReview);

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "26px 32px 40px", background: color.appBg }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 23, fontWeight: 700, letterSpacing: "-.5px", color: color.textBright }}>
        Runs
      </h1>
      <p style={{ margin: "0 0 22px", fontSize: 13, color: color.textFainter }}>
        Every agent run in this repo — live and historical. Each run is saved with its log, diff and test output.
      </p>

      <div style={{ border: `1px solid ${color.borderPanel}`, borderRadius: 13, overflow: "hidden", background: color.panelBg }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: ".4px",
            color: color.textFainter,
            background: color.panelHeaderBg,
            borderBottom: `1px solid ${color.borderRowFaint2}`,
          }}
        >
          <div style={{ padding: "11px 16px" }}>RUN</div>
          <div style={headCell}>AGENT</div>
          <div style={headCell}>BRANCH</div>
          <div style={headCell}>STATE</div>
          <div style={headCell}>DURATION</div>
          <div />
        </div>

        {runRows.length === 0 ? (
          <div style={{ padding: "22px 16px", fontSize: 12.5, color: color.textGhost }}>No runs yet.</div>
        ) : (
          runRows.map((r) => {
            const kind = agentKind(r.initials);
            const accent = agentAccent[kind];
            const m = runStateMeta[r.state];
            return (
              <HoverDiv
                key={r.runId}
                onClick={() => openReview(r.rev, "run")}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID,
                  alignItems: "center",
                  borderBottom: `1px solid ${color.borderRowFaint3}`,
                  cursor: "pointer",
                }}
                hoverStyle={{ background: color.rowHoverBg }}
              >
                <div style={{ padding: "13px 16px", fontFamily: font.mono, fontSize: 12, color: "#7b8494" }}>{r.runId}</div>
                <div style={{ padding: "13px 8px", display: "flex", alignItems: "center", gap: 7 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: accent,
                      background: `${accent}22`,
                      border: `1px solid ${accent}55`,
                    }}
                  >
                    <AgentMark kind={kind} label={r.initials} px={12} />
                  </span>
                </div>
                <div style={{ padding: "13px 8px", fontFamily: font.mono, fontSize: 11.5, color: color.greenText }}>{r.branch}</div>
                <div style={{ padding: "13px 8px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: m.color }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                    {m.label === "Awaiting permission" ? "Awaiting you" : m.label}
                  </span>
                </div>
                <div style={{ padding: "13px 8px", fontFamily: font.mono, fontSize: 11.5, color: color.textFaint }}>{r.duration}</div>
                <div style={{ padding: "13px 8px" }}>
                  <ChevronRightIcon size={13} color="#454d5b" stroke={1.5} />
                </div>
              </HoverDiv>
            );
          })
        )}
      </div>
    </div>
  );
}
