import { useEffect, useState } from "react";
import type { Loop, LoopItem, LoopItemState, LoopStreamEvent } from "@locke/core";
import type { LoopTrailEntry } from "../../api/git.js";
import { useStore } from "../../state/store.js";
import { isTauri } from "../../api/git.js";
import { color, font, tint, agentKind, agentAccent } from "../../theme/tokens.js";
import { itemStateColor, itemStateMeta, loopSegments, baseName } from "../../lib/loops.js";
import { MOCK_LOOP_ITEMS, MOCK_LOOP_STREAM } from "../../lib/mockFleet.js";
import { AgentMark } from "../../components/AgentMark.js";
import {
  BranchIcon,
  CheckIcon,
  ChevronLeftIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  ReviewsIcon,
  BoardIcon,
  StreamIcon,
  GridIcon,
  FolderTreeIcon,
  SearchIcon,
  ActivityIcon,
  RefreshIcon,
} from "../../components/icons.js";
import { HoverButton } from "../../components/primitives.js";

// Loops · monitor — the live run. Header (state + progress + counts) over one of
// three layouts: Board (kanban by item state), Stream (event feed), Grid (tiles).

const SEG_ACTIVE = "#222c3c";
const MINIBAR_BG = "#11151d";

const BOARD_COLS: { st: LoopItemState; field: keyof Loop }[] = [
  { st: "queued", field: "queued" },
  { st: "running", field: "running" },
  { st: "review", field: "review" },
  { st: "done", field: "done" },
  { st: "failed", field: "failed" },
];

function agentChipStyle(initials: string): React.CSSProperties {
  const accent = agentAccent[agentKind(initials)];
  return { color: accent, background: tint(accent, "22"), border: `1px solid ${tint(accent, "55")}` };
}

function itemLine(it: LoopItem): { text: string; color: string } {
  if (it.status === "running") return { text: it.action ?? "", color: color.textDim };
  if (it.status === "review") return { text: it.note ?? "", color: "#caa46a" };
  if (it.status === "failed") return { text: it.note ?? "", color: "#ca9aa0" };
  if (it.status === "done") return { text: "migrated · tests pass", color: "#7b8494" };
  if (it.status === "blocked")
    return { text: it.blockedBy?.length ? `blocked by ${it.blockedBy.join(", ")}` : it.note ?? "blocked", color: color.violetLight };
  return { text: "queued", color: "#7b8494" };
}

function ItemCard({ it, paused, selected }: { it: LoopItem; paused: boolean; selected?: boolean }) {
  const col = itemStateColor[it.status] ?? color.textGhost;
  const line = itemLine(it);
  const openLoopReview = useStore((s) => s.openLoopReview);
  const openInspect = useStore((s) => s.openInspect);
  return (
    <div
      onClick={() => openInspect(it.id)}
      style={{
        border: `1px solid ${selected ? tint(col, "88") : color.borderRow}`,
        borderLeft: `2px solid ${col}`,
        borderRadius: 10,
        background: selected ? tint(col, "12") : color.panelBg,
        padding: "11px 12px",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            width: 18,
            height: 18,
            flex: "none",
            borderRadius: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...agentChipStyle(it.agent),
          }}
        >
          <AgentMark kind={agentKind(it.agent)} label={it.agent} px={11} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: font.mono,
            fontSize: 11.5,
            color: color.textCode,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {baseName(it.path)}
        </span>
        <span style={{ fontSize: 10, color: color.textGhost, fontFamily: font.mono, flex: "none" }}>{it.t}</span>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.4, color: line.color }}>{line.text}</div>
      {it.status === "running" && (
        <div style={{ marginTop: 9, height: 4, borderRadius: 3, background: MINIBAR_BG, overflow: "hidden" }}>
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${it.pct ?? 0}%`,
              background: col,
              animation: paused ? undefined : "lkpulse 1.6s infinite",
            }}
          />
        </div>
      )}
      {it.status === "review" && (
        <HoverButton
          onClick={(e) => {
            e.stopPropagation();
            openLoopReview(it.id);
          }}
          style={{
            marginTop: 9,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: 6,
            background: tint(color.amber, "1f"),
            border: `1px solid ${tint(color.amber, "66")}`,
            borderRadius: 7,
            color: color.amber,
            fontFamily: font.sans,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: "pointer",
          }}
          hoverStyle={{ background: tint(color.amber, "33") }}
        >
          <ReviewsIcon size={11} stroke={1.6} />
          Open review
        </HoverButton>
      )}
    </div>
  );
}

function LayoutToggle() {
  const monitorLayout = useStore((s) => s.monitorLayout);
  const setMonitorLayout = useStore((s) => s.setMonitorLayout);
  const opts = [
    { key: "board" as const, label: "Board", Icon: BoardIcon },
    { key: "waves" as const, label: "Waves", Icon: FolderTreeIcon },
    { key: "stream" as const, label: "Stream", Icon: StreamIcon },
    { key: "grid" as const, label: "Grid", Icon: GridIcon },
    { key: "inspect" as const, label: "Inspect", Icon: SearchIcon },
  ];
  return (
    <div
      style={{
        marginLeft: "auto",
        display: "flex",
        gap: 2,
        padding: 3,
        background: color.navPillBg,
        border: `1px solid ${color.borderRow}`,
        borderRadius: 9,
      }}
    >
      {opts.map((o) => {
        const active = monitorLayout === o.key;
        return (
          <button
            key={o.key}
            onClick={() => setMonitorLayout(o.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 11px",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: font.sans,
              fontSize: 11.5,
              fontWeight: 600,
              background: active ? SEG_ACTIVE : "transparent",
              color: active ? color.text : "#7b8494",
            }}
          >
            <o.Icon size={13} stroke={1.5} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function BoardLayout({ loop, paused, items }: { loop: Loop; paused: boolean; items: LoopItem[] }) {
  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, overflowX: "auto" }}>
      {BOARD_COLS.map((c) => {
        const its = items.filter((i) => i.status === c.st);
        const count = loop[c.field] as number;
        const more = Math.max(0, count - its.length);
        const m = itemStateMeta[c.st];
        return (
          <div
            key={c.st}
            style={{ width: 296, flex: "none", borderRight: `1px solid ${color.borderRowFaint3}`, display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "13px 16px 10px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".3px", color: m.color }}>{m.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: color.textFainter, fontFamily: font.mono }}>
                {count.toLocaleString()}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 11px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {its.map((it) => (
                <ItemCard key={it.id} it={it} paused={paused} />
              ))}
              {more > 0 && (
                <div
                  style={{
                    padding: 9,
                    textAlign: "center",
                    fontSize: 11,
                    color: color.textGhost,
                    border: `1px dashed ${color.borderRail}`,
                    borderRadius: 9,
                  }}
                >
                  + {more.toLocaleString()} more
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StreamLayout({ paused, items, stream }: { paused: boolean; items: LoopItem[]; stream: LoopStreamEvent[] }) {
  const running = items.filter((i) => i.status === "running");
  const glyphFor = (st: LoopItemState) => (st === "done" ? "✓" : st === "review" ? "❚❚" : st === "running" ? "◐" : st === "failed" ? "✕" : "·");
  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 26px 40px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost, marginBottom: 14 }}>
          LIVE STREAM
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {stream.map((ev, i) => (
            <div key={i} style={{ display: "flex", gap: 13, padding: "9px 0", borderBottom: `1px solid ${color.borderRowFaint}` }}>
              <span
                style={{
                  width: 18,
                  flex: "none",
                  textAlign: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  paddingTop: 1,
                  color: itemStateColor[ev.st],
                  animation: ev.st === "running" && !paused ? "lkspin 1.1s linear infinite" : undefined,
                }}
              >
                {glyphFor(ev.st)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: font.mono,
                    fontSize: 12,
                    color: color.textCode,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {ev.path}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.45, marginTop: 3, color: ev.st === "failed" ? "#ca9aa0" : color.textDim }}>
                  {ev.text}
                </div>
              </div>
              <span style={{ flex: "none", fontSize: 10.5, color: color.lineNo, fontFamily: font.mono, paddingTop: 2 }}>{ev.t}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ width: 300, flex: "none", borderLeft: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, overflowY: "auto", padding: "18px 17px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost }}>RUNNING NOW</span>
          <span style={{ fontSize: 11, color: color.teal, fontFamily: font.mono }}>{running.length}</span>
        </div>
        {running.map((it) => (
          <div key={it.id} style={{ marginBottom: 8 }}>
            <ItemCard it={it} paused={paused} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GridLayout({ loop, paused, items }: { loop: Loop; paused: boolean; items: LoopItem[] }) {
  const TILES = 196;
  const order: LoopItemState[] = ["done", "review", "running", "failed", "queued"];
  const tiles: LoopItemState[] = [];
  for (const st of order) {
    const n = Math.round(((loop[st as keyof Loop] as number) / loop.total) * TILES);
    for (let i = 0; i < n; i++) tiles.push(st);
  }
  while (tiles.length < TILES) tiles.push("queued");
  const tileBg = (st: LoopItemState) =>
    st === "queued" ? tint(itemStateColor[st], "2e") : st === "done" ? tint(color.green, "cc") : itemStateColor[st];

  const focus = items.find((i) => i.status === "running") ?? items[0];
  const legend: LoopItemState[] = ["done", "running", "review", "failed", "queued"];

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "20px 26px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost }}>
            ALL {loop.total.toLocaleString()} ITEMS
          </span>
          {legend.map((st) => (
            <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: color.textFaint }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: tileBg(st) }} />
              {itemStateMeta[st].label}
            </span>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 16px)", gap: 5 }}>
          {tiles.slice(0, TILES).map((st, i) => (
            <span
              key={i}
              title={st}
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                background: tileBg(st),
                animation: st === "running" && !paused ? "lkpulse 1.3s infinite" : undefined,
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ width: 300, flex: "none", borderLeft: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, overflowY: "auto", padding: "18px 17px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost, marginBottom: 14 }}>FOCUS</div>
        {focus && <ItemCard it={focus} paused={paused} />}
        <p style={{ margin: "16px 0 0", fontSize: 11, color: color.textGhost, lineHeight: 1.55 }}>
          The frontier — done items fill from the top-left, queued trail off at the end. Hover any tile to inspect.
        </p>
      </div>
    </div>
  );
}

// Dependency-ordered view: items grouped by their topological wave (foundation
// first), each wave sorted by priority. Read-only — curation is via manifest.json.
function WavesLayout({ paused, items }: { paused: boolean; items: LoopItem[] }) {
  const waves = [...new Set(items.map((i) => i.wave ?? 0))].sort((a, b) => a - b);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "18px 28px 28px" }}>
      {waves.map((w) => {
        const its = items.filter((i) => (i.wave ?? 0) === w).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        const done = its.filter((i) => i.status === "done").length;
        return (
          <div key={w} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".5px", color: color.textBright }}>WAVE {w}</span>
              <span style={{ fontSize: 11, color: color.textGhost, fontFamily: font.mono }}>
                {done}/{its.length} done
              </span>
              <span style={{ flex: 1, height: 1, background: color.borderSubtle }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
              {its.map((it) => (
                <ItemCard key={it.id} it={it} paused={paused} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// An item is "stalled" when it's running but no tool/text/stream event has landed in
// this long — purely a visual cue (no auto-kill); the human decides whether to act.
const STALL_MS = 90_000;

// Re-render every `ms` so live elapsed clocks tick and stall state re-evaluates.
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// Compact elapsed, e.g. "0:42", "12:07", "1:03:18".
function fmtElapsed(fromMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}

// Master/detail drill-in: pick an item on the left, inspect its live action, real
// elapsed, stall state and full tool trail on the right. Reachable from any layout
// (clicking a card) and via the layout toggle; the back-chevron restores the layout
// it was opened from so nothing is lost.
function InspectLayout({ loopId, items, paused }: { loopId: string; items: LoopItem[]; paused: boolean }) {
  const inspectItem = useStore((s) => s.inspectItem);
  const closeInspect = useStore((s) => s.closeInspect);
  const trail = useStore((s) => s.loopItemTrail[loopId]) ?? {};
  const activity = useStore((s) => s.loopItemActivity[loopId]) ?? {};
  const now = useNow(1000);

  // Surface live work first: running, then review/failed, then the rest.
  const rank: Record<string, number> = { running: 0, review: 1, failed: 2, blocked: 3, queued: 4, done: 5, excluded: 6 };
  const ordered = [...items].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.path.localeCompare(b.path));
  const sel = items.find((i) => i.id === inspectItem) ?? ordered[0];
  const selTrail: LoopTrailEntry[] = (sel && trail[sel.id]) ?? [];
  const lastAt = sel ? activity[sel.id] : undefined;
  const stalled = !!sel && sel.status === "running" && !paused && lastAt != null && now - lastAt > STALL_MS;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {/* master list */}
      <div style={{ width: 320, flex: "none", borderRight: `1px solid ${color.borderSubtle}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "14px 16px 10px" }}>
          <HoverButton
            onClick={closeInspect}
            title="Back to the previous layout"
            style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, fontFamily: font.sans, fontSize: 12, padding: 0 }}
            hoverStyle={{ color: color.textMuted }}
          >
            <ChevronLeftIcon size={13} stroke={1.5} />
            Back
          </HoverButton>
          <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, letterSpacing: ".6px", color: color.textGhost }}>
            {ordered.length} ITEMS
          </span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 11px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {ordered.map((it) => (
            <ItemCard key={it.id} it={it} paused={paused} selected={sel?.id === it.id} />
          ))}
        </div>
      </div>

      {/* detail */}
      {sel ? (
        <InspectDetail item={sel} trail={selTrail} startedAt={sel.startedAt} now={now} lastActivityAt={lastAt} stalled={stalled} paused={paused} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: color.textGhost, fontSize: 13 }}>
          Select an item to inspect.
        </div>
      )}
    </div>
  );
}

function InspectDetail({
  item,
  trail,
  startedAt,
  now,
  lastActivityAt,
  stalled,
  paused,
}: {
  item: LoopItem;
  trail: LoopTrailEntry[];
  startedAt?: number;
  now: number;
  lastActivityAt?: number;
  stalled: boolean;
  paused: boolean;
}) {
  // Tolerate a status outside the monitor's own lifecycle (e.g. a "specced" record
  // left by the plan phase before the build item re-runs) — an unknown status must
  // degrade to a neutral chip, never crash the panel and black-screen the app.
  const col = itemStateColor[item.status] ?? color.textGhost;
  const meta = itemStateMeta[item.status] ?? { label: item.status, color: col };
  const line = itemLine(item);
  const requeueLoopItem = useStore((s) => s.requeueLoopItem);
  const nudgeLoopItem = useStore((s) => s.nudgeLoopItem);
  const running = item.status === "running";
  // Newest trail step at the top reads like a live feed.
  const steps = [...trail].reverse();
  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "20px 26px 40px" }}>
      {/* identity + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ width: 22, height: 22, flex: "none", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", ...agentChipStyle(item.agent) }}>
          <AgentMark kind={agentKind(item.agent)} label={item.agent} px={12} />
        </span>
        <span style={{ fontFamily: font.mono, fontSize: 14, color: color.textCode, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.path}
        </span>
        <span
          style={{
            marginLeft: "auto",
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 11px",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 600,
            color: col,
            background: tint(col, "1f"),
            border: `1px solid ${tint(col, "4d")}`,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: item.status === "running" && !paused ? "lkpulse 1.6s infinite" : undefined }} />
          {meta.label}
        </span>
      </div>

      {/* live action + elapsed + stall */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "12px 0 4px", flexWrap: "wrap" }}>
        {startedAt != null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: font.mono, fontSize: 12.5, color: color.textFaint }}>
            <ActivityIcon size={12} stroke={1.6} />
            {fmtElapsed(startedAt, now)} elapsed
          </span>
        )}
        {stalled && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              color: color.amber,
              background: tint(color.amber, "1f"),
              border: `1px solid ${tint(color.amber, "55")}`,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: "lkpulse 1.6s infinite" }} />
            {lastActivityAt != null ? `no activity ${fmtElapsed(lastActivityAt, now)}` : "no activity"}
          </span>
        )}
      </div>
      {line.text && <div style={{ fontSize: 12.5, lineHeight: 1.5, color: line.color, marginBottom: 14 }}>{line.text}</div>}

      {/* live controls — nudge a (possibly stuck) agent, or kill & retry it */}
      {running && (
        <div style={{ display: "flex", gap: 9, marginBottom: 20 }}>
          <HoverButton
            onClick={() =>
              nudgeLoopItem(item.id, "Are you still making progress? If you're stuck, say what's blocking you, then either continue or call loop_item_needs_review with the reason.")
            }
            title="Send the agent a follow-up message (best-effort — only lands while it's mid-turn)"
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", background: stalled ? tint(color.amber, "1f") : "transparent", border: `1px solid ${tint(color.amber, stalled ? "66" : "4d")}`, borderRadius: 8, color: color.amber, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            hoverStyle={{ background: tint(color.amber, "2e") }}
          >
            <RefreshIcon size={11} stroke={1.7} />
            Nudge agent
          </HoverButton>
          <HoverButton
            onClick={() => requeueLoopItem(item.id)}
            title="Kill this agent and re-queue the item to run again from scratch"
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 13px", background: "transparent", border: `1px solid ${tint(color.red, "4d")}`, borderRadius: 8, color: color.red, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            hoverStyle={{ background: tint(color.red, "16") }}
          >
            <StopIcon size={11} stroke={1.7} />
            Cancel &amp; re-queue
          </HoverButton>
        </div>
      )}

      {/* tool trail */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost, marginBottom: 12 }}>
        TOOL TRAIL
      </div>
      {steps.length === 0 ? (
        <div style={{ fontSize: 12, color: color.textGhost }}>No tool activity recorded yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: `1px solid ${color.borderRowFaint}` }}>
              <span style={{ flex: "none", width: 86, fontFamily: font.mono, fontSize: 11.5, fontWeight: 600, color: color.teal }}>{s.tool}</span>
              <span style={{ flex: 1, minWidth: 0, fontFamily: font.mono, fontSize: 11.5, color: color.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.target ?? ""}
              </span>
              <span style={{ flex: "none", fontSize: 10.5, color: color.lineNo, fontFamily: font.mono }}>{s.t}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LoopMonitor() {
  const loops = useStore((s) => s.loops);
  const selectedLoop = useStore((s) => s.selectedLoop);
  const monitorLayout = useStore((s) => s.monitorLayout);
  const loopPaused = useStore((s) => s.loopPaused);
  const loopToList = useStore((s) => s.loopToList);
  const togglePause = useStore((s) => s.togglePause);
  const stopLoop = useStore((s) => s.stopLoop);
  const reopenPlan = useStore((s) => s.reopenPlan);
  const reviewLoopChanges = useStore((s) => s.reviewLoopChanges);

  const storeItems = useStore((s) => (selectedLoop ? s.loopItems[selectedLoop] : undefined));
  const storeStream = useStore((s) => (selectedLoop ? s.loopStream[selectedLoop] : undefined));
  // Live session reads the backend-streamed slices; the plain-vite demo keeps the
  // seeded mock fleet so the design renders with no repo open.
  const items = isTauri ? storeItems ?? [] : MOCK_LOOP_ITEMS;
  const stream = isTauri ? storeStream ?? [] : MOCK_LOOP_STREAM;

  const loop = loops.find((l) => l.id === selectedLoop) ?? loops[0];
  if (!loop) return null;

  const seg = loopSegments(loop);
  // Status reflects the loop's actual lifecycle, not just the pause flag: a finished
  // run (`done`) reads "Complete"/"Needs review", a stopped run "Stopped" — and the
  // live controls (Pause/Stop) only make sense while it's actually running.
  const stopped = loop.state === "paused";
  const finished = loop.state === "done";
  const terminal = stopped || finished;
  const needsReview = finished && (loop.review > 0 || loop.failed > 0);
  const stateLabel = stopped ? "Stopped" : finished ? (needsReview ? "Needs review" : "Complete") : loopPaused ? "Paused" : "Building";
  const stateColor = stopped ? color.red : finished ? (needsReview ? color.amber : color.green) : loopPaused ? color.red : color.teal;
  const livePulse = !terminal && !loopPaused;
  const counts: { st: LoopItemState; n: number }[] = [
    { st: "done", n: loop.done },
    { st: "running", n: loop.running },
    { st: "review", n: loop.review },
    { st: "failed", n: loop.failed },
    { st: "queued", n: loop.queued },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* header */}
      <div style={{ flex: "none", padding: "16px 28px 0", borderBottom: `1px solid ${color.borderSubtle}`, background: color.titlebarBg }}>
        <HoverButton
          onClick={loopToList}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, fontFamily: font.sans, fontSize: 12, padding: 0, marginBottom: 12 }}
          hoverStyle={{ color: color.textMuted }}
        >
          <ChevronLeftIcon size={13} stroke={1.5} />
          Loops
        </HoverButton>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-.4px", color: color.textBright }}>{loop.title}</h1>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: font.mono, fontSize: 11.5, color: color.greenText }}>
            <BranchIcon size={11} color="#7b8494" stroke={1.4} />
            {loop.branch}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 11px",
              borderRadius: 20,
              fontSize: 11.5,
              fontWeight: 600,
              color: stateColor,
              background: tint(stateColor, "1f"),
              border: `1px solid ${tint(stateColor, "4d")}`,
            }}
          >
            {finished && !needsReview ? (
              <CheckIcon size={11} stroke={2} />
            ) : (
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: livePulse ? "lkpulse 1.6s infinite" : undefined }} />
            )}
            {stateLabel}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
            <HoverButton
              onClick={() => reopenPlan()}
              title="Halt this run and reopen its plan to review or re-run the specs"
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", background: "transparent", border: `1px solid ${tint(color.violet, "4d")}`, borderRadius: 8, color: color.violetLight, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              hoverStyle={{ background: tint(color.violet, "16") }}
            >
              <ChevronLeftIcon size={11} stroke={1.8} />
              Re-plan
            </HoverButton>
            {/* Pause/Stop only while the run is live — a finished or stopped loop
                offers Re-plan instead. */}
            {!terminal && (
              <>
                <HoverButton
                  onClick={togglePause}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", background: "transparent", border: `1px solid ${color.borderChip2}`, borderRadius: 8, color: color.textFaint, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  hoverStyle={{ borderColor: "var(--lk-borderInput)" }}
                >
                  {loopPaused ? <PlayIcon size={11} stroke={1.7} /> : <PauseIcon size={11} stroke={1.8} />}
                  {loopPaused ? "Resume" : "Pause"}
                </HoverButton>
                <HoverButton
                  onClick={stopLoop}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", background: "transparent", border: `1px solid ${tint(color.red, "4d")}`, borderRadius: 8, color: color.red, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  hoverStyle={{ background: tint(color.red, "16") }}
                >
                  <StopIcon size={11} stroke={1.8} />
                  Stop loop
                </HoverButton>
              </>
            )}
            {/* Finished run: open (or create) the review of the loop's aggregate
                output. Labels by the linked review id when one already exists. */}
            {finished && (
              <HoverButton
                onClick={() => void reviewLoopChanges(loop.id)}
                title="Open a review of this loop's changes"
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", background: color.violet, border: `1px solid ${color.violet}`, borderRadius: 8, color: "#fff", fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                hoverStyle={{ background: color.violetHover }}
              >
                <ReviewsIcon size={11} stroke={1.8} />
                {loop.pullId ? `Review #${loop.pullId}` : "Open review"}
              </HoverButton>
            )}
          </div>
        </div>

        {/* progress bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 15 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 8, borderRadius: 5, background: color.borderSubtle, overflow: "hidden", display: "flex" }}>
              <span style={{ height: "100%", width: `${seg.done}%`, background: color.green }} />
              <span style={{ height: "100%", width: `${seg.running}%`, background: color.teal }} />
              <span style={{ height: "100%", width: `${seg.review}%`, background: color.amber }} />
              <span style={{ height: "100%", width: `${seg.failed}%`, background: color.red }} />
            </div>
          </div>
          <span style={{ fontSize: 11.5, color: color.textFainter, fontFamily: font.mono, flex: "none" }}>{loop.rate}</span>
          <span style={{ fontSize: 11.5, color: color.textFainter, fontFamily: font.mono, flex: "none" }}>{loop.elapsed} elapsed</span>
        </div>

        {/* counts + layout toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 11 }}>
          {counts.map((c) => (
            <span key={c.st} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: color.textFaint }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: itemStateColor[c.st] }} />
              <span style={{ fontWeight: 700, fontFamily: font.mono, color: itemStateColor[c.st] }}>{c.n.toLocaleString()}</span>
              {itemStateMeta[c.st].label.toLowerCase()}
            </span>
          ))}
          <LayoutToggle />
        </div>
        <div style={{ height: 14 }} />
      </div>

      {monitorLayout === "board" && <BoardLayout loop={loop} paused={loopPaused} items={items} />}
      {monitorLayout === "waves" && <WavesLayout paused={loopPaused} items={items} />}
      {monitorLayout === "stream" && <StreamLayout paused={loopPaused} items={items} stream={stream} />}
      {monitorLayout === "grid" && <GridLayout loop={loop} paused={loopPaused} items={items} />}
      {monitorLayout === "inspect" && <InspectLayout loopId={loop.id} paused={loopPaused} items={items} />}
    </div>
  );
}
