import { useState } from "react";
import type { Loop } from "@locke/core";
import { useStore } from "../../state/store.js";
import { color, font, tint } from "../../theme/tokens.js";
import { loopStateMeta, loopSegments, modeChip } from "../../lib/loops.js";
import { BranchIcon, ChevronRightIcon, LoopsIcon, PlusIcon, TrashIcon } from "../../components/icons.js";
import { HoverButton, HoverDiv } from "../../components/primitives.js";

// Loops · list — every loop, by lifecycle, with a live progress bar + state pill.

const SEP = "#3a414e";

function LoopCard({ loop, onOpen }: { loop: Loop; onOpen: () => void }) {
  const deleteLoop = useStore((s) => s.deleteLoop);
  const [confirming, setConfirming] = useState(false);
  const sm = loopStateMeta[loop.state];
  const mc = modeChip(loop.mode);
  const seg = loopSegments(loop);
  const pct = loop.total ? Math.round((loop.done / loop.total) * 100) : 0;
  const hasProgress = loop.total > 0 && loop.state !== "draft";

  return (
    <HoverDiv
      onClick={onOpen}
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        padding: "16px 18px",
        border: `1px solid ${color.borderRow}`,
        borderRadius: 13,
        background: color.panelBg,
        marginBottom: 12,
        cursor: "pointer",
      }}
      hoverStyle={{ borderColor: "var(--lk-borderInput)", background: color.rowHoverBg }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          flex: "none",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: sm.color,
          background: tint(sm.color, "1a"),
          border: `1px solid ${tint(sm.color, "40")}`,
        }}
      >
        <LoopsIcon size={19} stroke={1.5} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: color.textBright, letterSpacing: "-.2px" }}>
          {loop.title}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 7,
            flexWrap: "wrap",
            fontSize: 11.5,
            color: color.textFainter,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: font.mono, color: color.greenText }}>
            <BranchIcon size={11} color="#7b8494" stroke={1.4} />
            {loop.branch}
          </span>
          <span style={{ color: SEP }}>·</span>
          <span
            style={{
              padding: "1px 8px",
              borderRadius: 6,
              fontWeight: 600,
              color: mc.color,
              background: tint(mc.color, "1f"),
              border: `1px solid ${tint(mc.color, "4d")}`,
            }}
          >
            {mc.label}
          </span>
          <span style={{ color: SEP }}>·</span>
          <span style={{ fontFamily: font.mono }}>
            {loop.total ? `${loop.total.toLocaleString()} targets` : "no targets yet"}
          </span>
        </div>
      </div>

      {hasProgress && (
        <div style={{ width: 200, flex: "none" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 10.5,
              color: color.textFainter,
              fontFamily: font.mono,
              marginBottom: 5,
            }}
          >
            <span>
              {loop.done.toLocaleString()} / {loop.total.toLocaleString()}
            </span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: color.borderSubtle, overflow: "hidden", display: "flex" }}>
            <span style={{ height: "100%", width: `${seg.done}%`, background: color.green }} />
            <span style={{ height: "100%", width: `${seg.running}%`, background: color.teal }} />
            <span style={{ height: "100%", width: `${seg.failed}%`, background: color.red }} />
          </div>
        </div>
      )}

      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 11px",
          borderRadius: 20,
          fontSize: 11.5,
          fontWeight: 600,
          flex: "none",
          color: sm.color,
          background: tint(sm.color, "1f"),
          border: `1px solid ${tint(sm.color, "4d")}`,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "currentColor",
            animation: sm.live ? "lkpulse 1.6s infinite" : undefined,
          }}
        />
        {sm.label}
      </span>

      {confirming ? (
        <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }} onClick={(e) => e.stopPropagation()}>
          <HoverButton
            onClick={(e) => {
              e.stopPropagation();
              deleteLoop(loop.id);
            }}
            style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${tint(color.red, "55")}`, background: tint(color.red, "1f"), color: color.red, fontFamily: font.sans, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
            hoverStyle={{ background: tint(color.red, "33") }}
          >
            Delete
          </HoverButton>
          <HoverButton
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
            style={{ padding: "5px 10px", borderRadius: 7, border: `1px solid ${color.borderChip2}`, background: "transparent", color: color.textFaint, fontFamily: font.sans, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
            hoverStyle={{ borderColor: "var(--lk-borderInput)" }}
          >
            Cancel
          </HoverButton>
        </span>
      ) : (
        <HoverButton
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(true);
          }}
          title="Delete loop (removes Locke tracking; git is untouched)"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flex: "none", borderRadius: 8, border: "none", background: "transparent", color: color.textGhost, cursor: "pointer" }}
          hoverStyle={{ background: tint(color.red, "1a"), color: color.red }}
        >
          <TrashIcon size={14} stroke={1.5} />
        </HoverButton>
      )}

      <ChevronRightIcon size={15} color="var(--lk-lineNo)" stroke={1.5} />
    </HoverDiv>
  );
}

export function LoopsList() {
  const loops = useStore((s) => s.loops);
  const openLoop = useStore((s) => s.openLoop);
  const newLoop = useStore((s) => s.newLoop);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "26px 32px 44px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, marginBottom: 5 }}>
        <h1 style={{ margin: 0, fontSize: 23, fontWeight: 700, letterSpacing: "-.5px", color: color.textBright }}>Loops</h1>
        <HoverButton
          onClick={newLoop}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 15px",
            background: color.violet,
            border: `1px solid ${color.violet}`,
            borderRadius: 9,
            color: "#fff",
            fontFamily: font.sans,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 10px rgba(123,108,255,.25)",
          }}
          hoverStyle={{ background: color.violetHover }}
        >
          <PlusIcon size={14} color="#fff" stroke={1.7} />
          New loop
        </HoverButton>
      </div>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: color.textFainter, maxWidth: 660 }}>
        Run one task across hundreds of files. Locke plans the change, you audit which targets are in scope, then it
        iterates — committing what passes and pausing for review wherever it's unsure.
      </p>

      {loops.length === 0 ? (
        <div style={{ fontSize: 12.5, color: color.textGhost }}>No loops yet — start one with “New loop”.</div>
      ) : (
        loops.map((l) => <LoopCard key={l.id} loop={l} onOpen={() => openLoop(l.id)} />)
      )}
    </div>
  );
}
