import type { LoopDiffLine } from "@locke/core";
import { useStore } from "../../state/store.js";
import { isTauri } from "../../api/git.js";
import { color, font, tint } from "../../theme/tokens.js";
import { baseName } from "../../lib/loops.js";
import { MOCK_LOOP_DIFF, MOCK_LOOP_ITEMS, MOCK_LOOP_REVIEW_NOTE } from "../../lib/mockFleet.js";
import { BranchIcon, ChevronLeftIcon, CheckIcon, FileSimpleIcon, LoopsIcon } from "../../components/icons.js";
import { HoverButton } from "../../components/primitives.js";

// Loops · review — one paused item. Diff on the left, the loop's note + a
// re-queue composer on the right. Approve continues; Request changes re-queues.

const DIFF_GRID = "42px 20px 1fr";

export function LoopReview() {
  const loops = useStore((s) => s.loops);
  const selectedLoop = useStore((s) => s.selectedLoop);
  const loopReviewItem = useStore((s) => s.loopReviewItem);
  const loopReviewBack = useStore((s) => s.loopReviewBack);
  const resolveLoopReview = useStore((s) => s.resolveLoopReview);

  const storeItems = useStore((s) => (selectedLoop ? s.loopItems[selectedLoop] : undefined));
  const storeRecords = useStore((s) => (selectedLoop ? s.loopItemRecords[selectedLoop] : undefined));

  const loop = loops.find((l) => l.id === selectedLoop) ?? loops[0];
  const branch = loop?.branch ?? "";

  // Live session: resolve the item + its captured diff/note from the backend
  // records. Demo: the seeded mock review item.
  const realItem = (storeItems ?? []).find((i) => i.id === loopReviewItem);
  const realRecord = (storeRecords ?? []).find((r) => (realItem ? r.path === realItem.path : false));
  const item =
    (isTauri && realItem) ||
    MOCK_LOOP_ITEMS.find((i) => i.id === loopReviewItem) ||
    MOCK_LOOP_ITEMS.find((i) => i.status === "review") ||
    MOCK_LOOP_ITEMS[0];
  const diff: LoopDiffLine[] = isTauri ? (realRecord?.diff as LoopDiffLine[] | undefined) ?? [] : MOCK_LOOP_DIFF;
  const note = isTauri ? realRecord?.reason ?? realItem?.note ?? "" : MOCK_LOOP_REVIEW_NOTE;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* header */}
      <div style={{ flex: "none", padding: "16px 28px", borderBottom: `1px solid ${color.borderSubtle}`, background: color.titlebarBg }}>
        <HoverButton
          onClick={loopReviewBack}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, fontFamily: font.sans, fontSize: 12, padding: 0, marginBottom: 12 }}
          hoverStyle={{ color: color.textMuted }}
        >
          <ChevronLeftIcon size={13} stroke={1.5} />
          Back to loop
        </HoverButton>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 11px",
              borderRadius: 20,
              fontSize: 11.5,
              fontWeight: 600,
              color: color.amber,
              background: tint(color.amber, "1f"),
              border: `1px solid ${tint(color.amber, "66")}`,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", animation: "lkpulse 1.3s infinite" }} />
            Needs review
          </span>
          <span style={{ fontFamily: font.mono, fontSize: 13.5, color: color.textBright }}>{item.path}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: font.mono, fontSize: 11.5, color: color.greenText }}>
            <BranchIcon size={11} color="#7b8494" stroke={1.4} />
            {branch}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 9 }}>
            <HoverButton
              onClick={() => resolveLoopReview("request")}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", background: "transparent", border: `1px solid ${tint(color.red, "4d")}`, borderRadius: 9, color: color.red, fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              hoverStyle={{ background: tint(color.red, "16") }}
            >
              <LoopsIcon size={12} stroke={1.7} />
              Request changes &amp; re-queue
            </HoverButton>
            <HoverButton
              onClick={() => resolveLoopReview("approve")}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", background: color.teal, border: `1px solid ${color.teal}`, borderRadius: 9, color: "#06231f", fontFamily: font.sans, fontSize: 12.5, fontWeight: 700, cursor: "pointer", boxShadow: `0 2px 10px ${tint(color.teal, "40")}` }}
              hoverStyle={{ background: "#56ddcd" }}
            >
              <CheckIcon size={13} color="#06231f" stroke={2} />
              Approve &amp; continue
            </HoverButton>
          </div>
        </div>
      </div>

      {/* body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* diff */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 24px 40px" }}>
          <div style={{ border: `1px solid ${color.borderPanel}`, borderRadius: 12, overflow: "hidden", background: "#0c0f15" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "#0d1016", borderBottom: `1px solid ${color.borderRow}` }}>
              <FileSimpleIcon size={13} color={color.textFaint} stroke={1.3} />
              <span style={{ fontSize: 12.5, color: color.textDim, fontFamily: font.mono }}>{baseName(item.path)}</span>
              <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.green, marginLeft: "auto" }}>+8</span>
              <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.red }}>−9</span>
            </div>
            <div style={{ fontFamily: font.mono, fontSize: 12.5, lineHeight: "21px" }}>
              {diff.map((ln, i) => {
                if (ln.h) {
                  return (
                    <div key={i} style={{ padding: "4px 16px", background: tint(color.violet, "10"), borderTop: `1px solid ${color.borderRow}`, borderBottom: `1px solid ${color.borderRow}`, color: "#7c87ff", fontSize: 11.5 }}>
                      {ln.h}
                    </div>
                  );
                }
                if (ln.thread) {
                  return (
                    <div key={i} style={{ margin: "8px 14px", padding: "10px 13px", border: "1px solid #2a1f26", borderRadius: 9, background: tint(color.amber, "0d"), display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color.amber, flex: "none" }} />
                      <span style={{ fontSize: 11.5, color: "#caa46a" }}>Locke paused here — see its note on the right.</span>
                    </div>
                  );
                }
                const add = ln.t === "add";
                const del = ln.t === "del";
                return (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: DIFF_GRID,
                      background: add ? tint(color.green, "1a") : del ? tint(color.red, "1a") : "transparent",
                    }}
                  >
                    <div style={{ textAlign: "right", paddingRight: 9, color: color.lineNo, userSelect: "none" }}>{ln.no}</div>
                    <div style={{ textAlign: "center", userSelect: "none", color: add ? color.green : del ? color.red : color.lineNo }}>
                      {add ? "+" : del ? "−" : ""}
                    </div>
                    <div style={{ paddingLeft: 8, whiteSpace: "pre", overflowX: "auto", color: add ? "#bfe6c9" : del ? "#e6b3b8" : color.textDim }}>
                      {ln.c}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* feedback rail */}
        <div style={{ width: 340, flex: "none", borderLeft: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "18px 17px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost, marginBottom: 14 }}>FEEDBACK</div>
            <div style={{ display: "flex", gap: 10 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  flex: "none",
                  borderRadius: "50%",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: color.teal,
                  background: tint(color.teal, "24"),
                  border: `1px solid ${tint(color.teal, "57")}`,
                }}
              >
                CL
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: color.textSoft, marginBottom: 4 }}>Claude</div>
                <div style={{ fontSize: 12.5, color: color.textDim, lineHeight: 1.55 }}>{note}</div>
              </div>
            </div>
          </div>
          <div style={{ flex: "none", padding: "13px 16px", borderTop: `1px solid ${color.borderRowFaint2}` }}>
            <div style={{ border: `1px solid ${color.borderRow}`, borderRadius: 10, background: color.popoverBg, padding: "11px 12px", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: color.textGhost }}>Add feedback — Locke will fold it into the re-queued run…</span>
            </div>
            <HoverButton
              onClick={() => resolveLoopReview("request")}
              style={{ width: "100%", padding: 9, background: tint(color.amber, "1f"), border: `1px solid ${tint(color.amber, "66")}`, borderRadius: 9, color: color.amber, fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              hoverStyle={{ background: tint(color.amber, "33") }}
            >
              Send &amp; re-queue this item
            </HoverButton>
          </div>
        </div>
      </div>
    </div>
  );
}
