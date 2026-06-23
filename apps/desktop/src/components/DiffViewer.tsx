import { useState } from "react";
import type { ChangedFile, Thread } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";
import { buildUnified, buildSplit, type UnifiedLineRow } from "../lib/diff.js";
import { fullFilePath } from "../lib/mockFleet.js";
import { CodeText, HoverButton } from "./primitives.js";
import { FullFileIcon } from "./icons.js";
import { CommentThread } from "./CommentThread.js";

const ADD_BG = "rgba(67,196,107,0.10)";
const DEL_BG = "rgba(240,97,109,0.10)";
const HUNK_BG = "rgba(123,108,255,0.06)";

function HunkRow({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "4px 16px",
        background: HUNK_BG,
        borderTop: "1px solid #1a212b",
        borderBottom: "1px solid #1a212b",
        color: "#7c87ff",
        fontSize: 11.5,
      }}
    >
      {text}
    </div>
  );
}

/** One unified-diff line, with a hover-revealed "+" to start a comment. */
function UnifiedLine({ row, path }: { row: UnifiedLineRow; path: string }) {
  const [hover, setHover] = useState(false);
  const openComposer = useStore((s) => s.openComposer);
  const threads = useStore((s) => s.threads);
  const thread = threads.find((t) => t.file === path && t.lineId === row.lineId);
  const canComment = row.lineKind !== "del" && !thread;

  const bg = row.lineKind === "add" ? ADD_BG : row.lineKind === "del" ? DEL_BG : "transparent";
  const signColor = row.lineKind === "add" ? color.green : row.lineKind === "del" ? color.red : "transparent";

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "44px 44px 22px 1fr",
        background: bg,
        minHeight: 21,
        filter: hover ? "brightness(1.16)" : undefined,
      }}
    >
      <div style={{ textAlign: "right", paddingRight: 9, color: color.lineNo, userSelect: "none" }}>
        {row.oldNo}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingRight: 9,
          color: color.lineNo,
          userSelect: "none",
          position: "relative",
        }}
      >
        {canComment && hover && (
          <button
            onClick={() => openComposer(row.lineId)}
            title="Add comment"
            style={{
              position: "absolute",
              left: 2,
              width: 17,
              height: 17,
              border: "none",
              borderRadius: 4,
              background: color.violet,
              color: "#fff",
              fontSize: 13,
              lineHeight: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              fontFamily: font.sans,
            }}
          >
            +
          </button>
        )}
        {row.newNo}
      </div>
      <div style={{ color: signColor, textAlign: "center", userSelect: "none" }}>{row.sign}</div>
      <div style={{ paddingLeft: 8, whiteSpace: "pre", overflowX: "auto" }}>
        <CodeText text={row.code} />
      </div>
    </div>
  );
}

function Composer({ path }: { path: string }) {
  const draft = useStore((s) => s.draft);
  const setDraft = useStore((s) => s.setDraft);
  const submitComment = useStore((s) => s.submitComment);
  const cancelComposer = useStore((s) => s.cancelComposer);
  void path;
  return (
    <div
      style={{
        margin: "4px 14px 10px",
        border: "1px solid #2c2640",
        borderRadius: 10,
        background: "#10111c",
        overflow: "hidden",
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 13px",
          borderBottom: "1px solid #1c1b2b",
          background: "#13131f",
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "rgba(123,108,255,.16)",
            border: "1px solid rgba(123,108,255,.34)",
            color: color.violetLight,
            fontSize: 9.5,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          YO
        </span>
        <span style={{ fontSize: 12, color: color.textDim }}>New comment</span>
      </div>
      <div style={{ padding: "11px 13px" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave a review comment… markdown supported"
          style={{
            width: "100%",
            boxSizing: "border-box",
            minHeight: 70,
            resize: "vertical",
            background: color.appBg,
            border: "1px solid #2c333f",
            borderRadius: 8,
            padding: "9px 11px",
            color: color.text,
            fontFamily: font.sans,
            fontSize: 13,
            lineHeight: 1.5,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 9 }}>
          <button
            onClick={cancelComposer}
            style={{
              fontFamily: font.sans,
              fontSize: 12.5,
              color: "#aab2c0",
              background: "transparent",
              border: "1px solid #2c333f",
              padding: "7px 14px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={submitComment}
            style={{
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              background: color.violet,
              border: `1px solid ${color.violet}`,
              padding: "7px 15px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Add comment
          </button>
        </div>
      </div>
    </div>
  );
}

const splitNumStyle = (empty: boolean): React.CSSProperties => ({
  textAlign: "right",
  padding: "0 8px",
  color: empty ? undefined : "#4d5667",
  userSelect: "none",
});

const splitCellBg = (kind: string | null) =>
  kind === "add" ? ADD_BG : kind === "del" ? DEL_BG : "transparent";

export function DiffViewer({ file }: { file: ChangedFile }) {
  const diffMode = useStore((s) => s.diffMode);
  const composerLine = useStore((s) => s.composerLine);
  const threads = useStore((s) => s.threads);
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const openFullFile = useStore((s) => s.openFullFile);
  const path = file.path;
  const threadAt = (lineId: string): Thread | undefined =>
    threads.find((t) => t.file === path && t.lineId === lineId);

  // Offer "see full file" only when the explorer carries a full-file preview.
  const review = reviews.find((r) => r.id === selectedPR);
  const fullPath = fullFilePath(path);

  return (
    <div style={{ border: `1px solid ${color.borderPanel}`, borderRadius: 12, overflow: "hidden", background: color.panelHeaderBg }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 14px",
          background: "#0d1016",
          borderBottom: "1px solid #1a212b",
        }}
      >
        <span style={{ fontSize: 12.5, color: color.textDim, fontFamily: font.mono }}>{path}</span>
        <div style={{ flex: 1 }} />
        {fullPath && (
          <HoverButton
            onClick={() => openFullFile(fullPath, review ? { id: review.id, branch: review.branch } : undefined)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 7,
              background: "transparent",
              border: `1px solid ${color.borderChip2}`,
              color: color.textFaint,
              fontFamily: font.sans,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
            hoverStyle={{ borderColor: "#2e3645", color: color.textSoft }}
          >
            <FullFileIcon size={12} stroke={1.4} />
            See full file
          </HoverButton>
        )}
        <span style={{ fontSize: 11, color: color.textGhost }}>Hover a line and click + to comment</span>
      </div>

      {diffMode === "unified" ? (
        <div style={{ fontFamily: font.mono, fontSize: 12.5, lineHeight: "21px" }}>
          {buildUnified(file).map((row) => {
            if (row.kind === "hunk") return <HunkRow key={row.key} text={row.hunkText} />;
            const thread = threadAt(row.lineId);
            return (
              <div key={row.key}>
                <UnifiedLine row={row} path={path} />
                {thread && <CommentThread thread={thread} />}
                {composerLine === row.lineId && <Composer path={path} />}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontFamily: font.mono, fontSize: 12.5, lineHeight: "21px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              borderBottom: "1px solid #1a212b",
              background: "#0d1016",
            }}
          >
            <div style={{ padding: "6px 14px", fontSize: 11, color: color.textFainter, borderRight: "1px solid #1a212b", fontFamily: font.sans }}>
              Original
            </div>
            <div style={{ padding: "6px 14px", fontSize: 11, color: color.textFainter, fontFamily: font.sans }}>
              Proposed by agent
            </div>
          </div>
          {buildSplit(file).map((row) => {
            if (row.kind === "hunk") return <HunkRow key={row.key} text={row.hunkText} />;
            const thread = row.lineId ? threadAt(row.lineId) : undefined;
            return (
              <div key={row.key}>
                <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 40px 1fr" }}>
                  <div style={splitNumStyle(row.left.empty)}>{row.left.no}</div>
                  <div
                    style={{
                      whiteSpace: "pre",
                      overflowX: "auto",
                      padding: "0 12px",
                      borderRight: "1px solid #161c25",
                      background: row.left.empty ? "#0c0e13" : splitCellBg(row.left.cellKind),
                    }}
                  >
                    {!row.left.empty && <CodeText text={row.left.code} />}
                  </div>
                  <div style={splitNumStyle(row.right.empty)}>{row.right.no}</div>
                  <div
                    style={{
                      whiteSpace: "pre",
                      overflowX: "auto",
                      padding: "0 12px",
                      background: row.right.empty ? "#0c0e13" : splitCellBg(row.right.cellKind),
                    }}
                  >
                    {!row.right.empty && <CodeText text={row.right.code} />}
                  </div>
                </div>
                {thread && (
                  <div style={{ borderTop: "1px solid #161c25" }}>
                    <CommentThread thread={thread} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
