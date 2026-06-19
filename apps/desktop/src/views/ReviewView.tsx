import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";
import { fileStatusMeta, addStr, delStr, currentReview } from "../lib/meta.js";
import { HoverButton, HoverDiv } from "../components/primitives.js";
import { DiffViewer } from "../components/DiffViewer.js";
import { VerdictBanner } from "../components/VerdictBanner.js";
import {
  ChevronLeftIcon,
  FileIcon,
  CommentIcon,
  CheckIcon,
  XIcon,
  UnifiedIcon,
  SplitIcon,
} from "../components/icons.js";

function Sidebar() {
  const files = useStore((s) => s.files);
  const threads = useStore((s) => s.threads);
  const selectedFile = useStore((s) => s.selectedFile);
  const viewed = useStore((s) => s.viewed);
  const selectFile = useStore((s) => s.selectFile);
  const goOverview = useStore((s) => s.goOverview);
  const setVerdict = useStore((s) => s.setVerdict);

  const viewedCount = Object.values(viewed).filter(Boolean).length;

  return (
    <div
      style={{
        width: 282,
        flex: "none",
        background: color.sidebarBg,
        borderRight: `1px solid ${color.borderSubtle}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${color.borderSubtle}` }}>
        <HoverButton
          onClick={goOverview}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: color.textFaint,
            fontFamily: font.sans,
            fontSize: 11.5,
            padding: 0,
            marginBottom: 12,
          }}
          hoverStyle={{ color: color.textMuted }}
        >
          <ChevronLeftIcon size={12} color="currentColor" />
          Overview
        </HoverButton>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: color.text }}>Files changed</span>
          <span style={{ fontSize: 11, color: color.textFainter }}>
            {viewedCount} / {files.length} viewed
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
        {files.map((f, i) => {
          const fs = fileStatusMeta(f.st);
          const cc = threads.filter((t) => t.file === f.path).length;
          const active = i === selectedFile;
          return (
            <HoverDiv
              key={f.path}
              onClick={() => selectFile(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 9px",
                border: "none",
                borderRadius: 7,
                cursor: "pointer",
                fontFamily: font.sans,
                textAlign: "left",
                marginBottom: 1,
                background: active ? color.rowActiveBg : "transparent",
                borderLeft: `2px solid ${active ? color.violet : "transparent"}`,
              }}
              hoverStyle={{ background: "#161b24" }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  flex: "none",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  border: "1px solid currentColor",
                  color: fs.col,
                  background: fs.bg,
                }}
              >
                {f.st}
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: color.textCode,
                    fontFamily: font.mono,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {f.name}
                </span>
                <span style={{ fontSize: 10, color: color.textGhost, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {f.dir}
                </span>
              </span>
              {cc > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, color: color.textFaint }}>
                  <CommentIcon size={11} color="#7b8494" />
                  {cc}
                </span>
              )}
              <span style={{ fontSize: 10, fontFamily: font.mono, color: color.green }}>{addStr(f.add)}</span>
              <span style={{ fontSize: 10, fontFamily: font.mono, color: color.red }}>{delStr(f.del)}</span>
            </HoverDiv>
          );
        })}
      </div>

      <div style={{ padding: "14px 16px", borderTop: `1px solid ${color.borderSubtle}` }}>
        <div style={{ fontSize: 11, color: color.textFainter, marginBottom: 10 }}>Finish your review</div>
        <div style={{ display: "flex", gap: 8 }}>
          <HoverButton
            onClick={() => setVerdict("approve")}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: 8,
              background: "rgba(67,196,107,.12)",
              border: "1px solid rgba(67,196,107,.34)",
              borderRadius: 8,
              color: color.green,
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
            hoverStyle={{ background: "rgba(67,196,107,.2)" }}
          >
            <CheckIcon size={13} color={color.green} />
            Approve
          </HoverButton>
          <HoverButton
            onClick={() => setVerdict("changes")}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: 8,
              background: "rgba(240,97,109,.1)",
              border: "1px solid rgba(240,97,109,.3)",
              borderRadius: 8,
              color: color.red,
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
            hoverStyle={{ background: "rgba(240,97,109,.18)" }}
          >
            <XIcon size={13} color={color.red} />
            Request
          </HoverButton>
        </div>
      </div>
    </div>
  );
}

function ModeToggle() {
  const diffMode = useStore((s) => s.diffMode);
  const setMode = useStore((s) => s.setMode);
  const tab = (active: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 11px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: font.sans,
    fontSize: 12,
    fontWeight: 500,
    background: active ? color.rowActiveBg : "transparent",
    color: active ? color.text : color.textFaint,
  });
  return (
    <div style={{ display: "flex", background: color.panelBg, border: "1px solid #232a35", borderRadius: 8, padding: 2 }}>
      <button onClick={() => setMode("unified")} style={tab(diffMode === "unified")}>
        <UnifiedIcon size={13} color="currentColor" />
        Unified
      </button>
      <button onClick={() => setMode("split")} style={tab(diffMode === "split")}>
        <SplitIcon size={13} color="currentColor" />
        Split
      </button>
    </div>
  );
}

function Main() {
  const files = useStore((s) => s.files);
  const selectedFile = useStore((s) => s.selectedFile);
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const file = files[selectedFile] ?? files[0];
  const pr = currentReview(reviews, selectedPR);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: color.appBg }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "13px 24px",
          borderBottom: `1px solid ${color.borderSubtle}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <FileIcon size={15} color={color.textFaint} style={{ flex: "none" }} />
          <span
            style={{
              fontSize: 13.5,
              color: color.text,
              fontFamily: font.mono,
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {file.path}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <ModeToggle />
        </div>
      </div>

      <VerdictBanner pr={pr} compact />

      <div style={{ flex: 1, overflow: "auto", padding: "18px 24px 60px" }}>
        <DiffViewer file={file} />
      </div>
    </div>
  );
}

export function ReviewView() {
  return (
    <>
      <Sidebar />
      <Main />
    </>
  );
}
