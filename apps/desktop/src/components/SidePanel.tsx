import type { Review } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, statusMeta, runStateMeta, tint } from "../theme/tokens.js";
import { fleetGroup, reviewKind, reviewAccent, type FleetGroup } from "../lib/fleet.js";
import { chooseRepo } from "../lib/repo.js";
import { AgentMark } from "./AgentMark.js";
import { SearchIcon, FlipIcon, PlusIcon, FolderIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// Left (or right) review list. Groups reviews by fleet bucket, supports flipping
// sides and drag-resizing (clamped 240–560 in the store). Ported from the design.

const ORDER: FleetGroup[] = ["changes", "running", "ready", "recent"];
const LABELS: Record<FleetGroup, string> = {
  changes: "CHANGES REQUESTED",
  running: "IN PROGRESS",
  ready: "READY TO REVIEW",
  recent: "EARLIER",
};

// A live run wins the strip colour; otherwise the review's lifecycle status.
function stripColor(r: Review): string {
  if (r.runState && runStateMeta[r.runState]) return runStateMeta[r.runState].color;
  return statusMeta[r.status]?.color ?? color.textGhost;
}

function ReviewCard({ r, selected }: { r: Review; selected: boolean }) {
  const openReview = useStore((s) => s.openReview);
  const kind = reviewKind(r);
  const accent = reviewAccent(r);
  const tab = r.runState === "running" || r.runState === "awaiting" ? "run" : "diff";
  return (
    <HoverButton
      onClick={() => openReview(r.id, tab)}
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: "100%",
        textAlign: "left",
        padding: "10px 11px 10px 15px",
        border: `1px solid ${selected ? "var(--lk-borderPopover)" : "transparent"}`,
        borderRadius: 10,
        background: selected ? "var(--lk-borderRowFaint3)" : "transparent",
        cursor: "pointer",
        fontFamily: font.sans,
        marginBottom: 3,
      }}
      hoverStyle={selected ? undefined : { background: color.popoverBg }}
    >
      <span
        style={{ position: "absolute", left: 0, top: 7, bottom: 7, width: 2, borderRadius: "0 2px 2px 0", background: stripColor(r) }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 600,
            color: color.text,
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {r.title}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10.5, fontFamily: font.mono, minWidth: 0 }}>
        <span style={{ color: "#7b8494", flex: "none" }}>#{r.id}</span>
        <span style={{ color: color.greenText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.branch}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 18,
            height: 18,
            flex: "none",
            borderRadius: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: accent,
            background: `${tint(accent, "22")}`,
            border: `1px solid ${tint(accent, "55")}`,
          }}
        >
          <AgentMark kind={kind} label={r.initials} px={11} />
        </span>
        <span style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 10.5, color: color.green }}>+{r.add}</span>
        <span style={{ fontFamily: font.mono, fontSize: 10.5, color: color.red }}>−{r.del}</span>
      </div>
    </HoverButton>
  );
}

export function SidePanel() {
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const view = useStore((s) => s.view);
  const panelSide = useStore((s) => s.panelSide);
  const panelWidth = useStore((s) => s.panelWidth);
  const flipPanel = useStore((s) => s.flipPanel);
  const setPanelWidth = useStore((s) => s.setPanelWidth);
  const agentMode = useStore((s) => s.agentMode);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const repoPath = useStore((s) => s.repoPath);
  const openRepo = useStore((s) => s.openRepo);
  const setNewReviewOpen = useStore((s) => s.setNewReviewOpen);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? reviews.filter((r) => `${r.title} ${r.branch} #${r.id}`.toLowerCase().includes(q))
    : reviews;

  const groups = ORDER.map((key) => ({
    key,
    label: key === "running" && !agentMode ? "OPEN" : LABELS[key],
    live: key === "running" && agentMode,
    items: filtered.filter((r) => fleetGroup(r) === key),
  })).filter((g) => g.items.length > 0);

  // Drag-resize: record the starting pointer + width, then translate movement
  // into a width delta (sign depends on which side the panel is docked).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    const onMove = (ev: MouseEvent) => {
      const delta = panelSide === "left" ? ev.clientX - startX : startX - ev.clientX;
      setPanelWidth(startWidth + delta);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onLeft = panelSide === "left";
  const edgeBorder = `1px solid ${color.borderSubtle}`;

  return (
    <div
      style={{
        position: "relative",
        flex: "none",
        width: panelWidth,
        background: color.sidebarBg,
        borderRight: onLeft ? edgeBorder : undefined,
        borderLeft: onLeft ? undefined : edgeBorder,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <span
        onMouseDown={startResize}
        title="Drag to resize"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: onLeft ? 0 : undefined,
          left: onLeft ? undefined : 0,
          width: 7,
          cursor: "col-resize",
          zIndex: 6,
        }}
      />

      {/* header */}
      <div style={{ flex: "none", padding: "11px 11px 9px", borderBottom: `1px solid ${color.borderRow}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <SearchIcon
              size={13}
              color={color.textGhost}
              stroke={1.4}
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reviews…"
              style={{
                width: "100%",
                height: 30,
                padding: "0 10px 0 31px",
                background: color.panelBg,
                border: `1px solid ${color.borderRow}`,
                borderRadius: 8,
                color: color.textSoft,
                fontFamily: font.sans,
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>
          <HoverButton
            onClick={flipPanel}
            title="Move panel to other side"
            style={{
              width: 30,
              height: 30,
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: `1px solid ${color.borderRow}`,
              borderRadius: 8,
              color: color.textFainter,
              cursor: "pointer",
            }}
            hoverStyle={{ borderColor: color.borderPopover, color: color.textDim }}
          >
            <FlipIcon size={14} stroke={1.4} />
          </HoverButton>
          <HoverButton
            title={repoPath ? "New review" : "Open repository"}
            onClick={() => (repoPath ? setNewReviewOpen(true) : void chooseRepo(openRepo))}
            style={{
              width: 30,
              height: 30,
              flex: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: `1px solid ${color.borderRow}`,
              borderRadius: 8,
              color: color.textFaint,
              cursor: "pointer",
            }}
            hoverStyle={{ borderColor: color.borderPopover, color: color.text }}
          >
            {repoPath ? <PlusIcon size={14} stroke={1.5} /> : <FolderIcon size={14} stroke={1.5} />}
          </HoverButton>
        </div>
      </div>

      {/* list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "9px 8px 14px" }}>
        {groups.length === 0 &&
          (reviews.length === 0 && !repoPath ? (
            <HoverButton
              onClick={() => void chooseRepo(openRepo)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "calc(100% - 16px)",
                margin: "10px 8px",
                padding: "9px 11px",
                background: "transparent",
                border: `1px dashed ${color.borderInput}`,
                borderRadius: 9,
                color: color.textFaint,
                cursor: "pointer",
                fontFamily: font.sans,
                fontSize: 12,
              }}
              hoverStyle={{ borderColor: color.borderPopover, color: color.text }}
            >
              <FolderIcon size={13} stroke={1.5} />
              Open repository…
            </HoverButton>
          ) : (
            <div style={{ padding: "16px 10px", fontSize: 12, color: color.textGhost }}>
              {reviews.length === 0 ? "No reviews yet." : "No matches."}
            </div>
          ))}
        {groups.map((g) => (
          <div key={g.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 8px 7px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".7px", color: color.textGhost }}>
                {g.label}
              </span>
              <span style={{ fontSize: 10, color: "var(--lk-lineNo)", fontFamily: font.mono }}>{g.items.length}</span>
              {g.live && (
                <span
                  style={{ width: 6, height: 6, borderRadius: "50%", background: color.teal, animation: "lkpulse 2s infinite" }}
                />
              )}
            </div>
            {g.items.map((r) => (
              <ReviewCard key={r.id} r={r} selected={r.id === selectedPR && view === "workspace"} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
