import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";
import { reviewKind, reviewAccent, reviewStatusMeta } from "../lib/fleet.js";
import { AgentMark } from "../components/AgentMark.js";
import { ChevronRightIcon } from "../components/icons.js";
import { HoverDiv } from "../components/primitives.js";

// Flat list of every review (branch) with a status pill — "by where they are in
// the loop". Ported from the design's Reviews screen.

export function ReviewsView() {
  const reviews = useStore((s) => s.reviews);
  const openReview = useStore((s) => s.openReview);
  const query = useStore((s) => s.query);

  const q = query.trim().toLowerCase();
  const list = q ? reviews.filter((r) => `${r.title} ${r.branch} #${r.id}`.toLowerCase().includes(q)) : reviews;

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "26px 32px 40px", background: color.appBg }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 23, fontWeight: 700, letterSpacing: "-.5px", color: color.textBright }}>
        Reviews
      </h1>
      <p style={{ margin: "0 0 22px", fontSize: 13, color: color.textFainter }}>
        Branches your agents built, by where they are in the loop.
      </p>

      {list.length === 0 ? (
        <div style={{ fontSize: 12.5, color: color.textGhost }}>
          {reviews.length === 0 ? "No reviews yet." : "No matches."}
        </div>
      ) : (
        list.map((r) => {
          const kind = reviewKind(r);
          const accent = reviewAccent(r);
          const sm = reviewStatusMeta(r);
          return (
            <HoverDiv
              key={r.id}
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
              hoverStyle={{ borderColor: "#2e3645", background: color.rowHoverBg }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: sm.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#eef1f5", letterSpacing: "-.2px" }}>{r.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap", fontSize: 11.5, color: color.textFainter }}>
                  <span style={{ fontFamily: font.mono, color: "#7b8494" }}>#{r.id}</span>
                  <span style={{ color: "#3a414e" }}>·</span>
                  <span style={{ fontFamily: font.mono, color: color.textFaint }}>{r.branch}</span>
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
                      background: `${accent}22`,
                      border: `1px solid ${accent}55`,
                    }}
                  >
                    <AgentMark kind={kind} label={r.initials} px={11} />
                  </span>
                </div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 11px",
                  borderRadius: 20,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: sm.color,
                  background: `${sm.color}1f`,
                  border: `1px solid ${sm.color}4d`,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
                {sm.label}
              </span>
              <ChevronRightIcon size={15} color="#454d5b" stroke={1.5} />
            </HoverDiv>
          );
        })
      )}
    </div>
  );
}
