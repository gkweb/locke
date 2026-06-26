import type { FileNode } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, tint } from "../theme/tokens.js";
import { lockeLang } from "../lib/lockeLang.js";
import { ChevronRightIcon, FolderIcon, FolderTreeIcon, FileSimpleIcon } from "../components/icons.js";
import { HoverButton } from "../components/primitives.js";

// The Files screen: a repo explorer (left) beside a syntax-highlighted full-file
// viewer (right), powered by the pluggable `lockeLang` host. Reached from the nav
// or via "see full file" on a review's diff (which sets a back-to-review pill).
// The tree + file contents come from the store — live git in a Tauri session,
// the seeded mock fleet under plain `vite`.

function flatten(nodes: FileNode[], expanded: Record<string, boolean>, out: FileNode[]): FileNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.t === "dir" && expanded[n.path] && n.children) flatten(n.children, expanded, out);
  }
  return out;
}

const extOf = (p: string) => (p.split(".").pop() || "").toLowerCase();

export function FilesView() {
  const filePath = useStore((s) => s.filePath);
  const expandedDirs = useStore((s) => s.expandedDirs);
  const toggleDir = useStore((s) => s.toggleDir);
  const selectFilePath = useStore((s) => s.selectFilePath);
  const fileFromReview = useStore((s) => s.fileFromReview);
  const backToReview = useStore((s) => s.backToReview);
  const fileTree = useStore((s) => s.fileTree);
  const fileContents = useStore((s) => s.fileContents);
  const repoPath = useStore((s) => s.repoPath);
  // Re-render the badges + viewer when a language is enabled/disabled.
  useStore((s) => s.langEnabled);

  const rows = flatten(fileTree, expandedDirs, []);

  // Repo name for the explorer header: the real backend keys off the loaded
  // path; the mock fleet has no repoPath but roots its tree at the repo dir.
  const repoName = repoPath
    ? repoPath.split("/").filter(Boolean).pop() ?? ""
    : fileTree[0]?.name ?? "";

  const content = fileContents[filePath] ?? "";
  const fileExt = extOf(filePath);
  const { lines } = lockeLang.highlight(content, fileExt);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {/* explorer */}
      <div
        style={{
          width: 248,
          flex: "none",
          borderRight: `1px solid ${color.borderSubtle}`,
          background: color.sidebarBg,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "11px 13px 10px",
            borderBottom: `1px solid ${color.borderRail2}`,
          }}
        >
          <FolderIcon size={13} color={color.textFainter} stroke={1.4} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".7px", color: color.textFaint }}>EXPLORER</span>
          {repoName && (
            <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--lk-lineNo)", fontFamily: font.mono }}>
              {repoName}
            </span>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "7px 6px 16px" }}>
          {rows.length === 0 && (
            <div style={{ padding: "16px 10px", fontSize: 12, color: color.textGhost, lineHeight: 1.5 }}>
              No files to show yet.
            </div>
          )}
          {rows.map((n) => {
            const indent = { paddingLeft: 8 + n.depth * 14, paddingRight: 8 };
            if (n.t === "dir") {
              const open = !!expandedDirs[n.path];
              return (
                <HoverButton
                  key={n.path}
                  onClick={() => toggleDir(n.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: font.sans,
                    borderRadius: 7,
                    height: 27,
                    ...indent,
                  }}
                  hoverStyle={{ background: color.rowHoverBg }}
                >
                  <ChevronRightIcon
                    size={11}
                    color={color.textFaint}
                    stroke={1.7}
                    style={{ flex: "none", transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}
                  />
                  <FolderTreeIcon size={14} color={color.textFainter} stroke={1.3} style={{ flex: "none" }} />
                  <span
                    style={{ fontSize: 12.5, color: color.textSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {n.name}
                  </span>
                </HoverButton>
              );
            }
            const ext = extOf(n.path);
            const plugin = lockeLang.list().find((p) => p.extensions.includes(ext)) ?? null;
            const accent = plugin ? plugin.accent : color.textFainter;
            const active = n.path === filePath;
            return (
              <HoverButton
                key={n.path}
                onClick={() => selectFilePath(n.path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: font.sans,
                  borderRadius: 7,
                  height: 27,
                  background: active ? "var(--lk-borderRowFaint2)" : "transparent",
                  ...indent,
                }}
                hoverStyle={active ? undefined : { background: color.rowHoverBg }}
              >
                <span
                  style={{
                    width: 17,
                    height: 17,
                    flex: "none",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 7.5,
                    fontWeight: 800,
                    letterSpacing: "-.3px",
                    background: `${tint(accent, "22")}`,
                    color: accent,
                  }}
                >
                  {plugin ? plugin.abbr : "··"}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12.5,
                    fontFamily: font.mono,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: active ? color.textBright : color.textDim,
                  }}
                >
                  {n.name}
                </span>
              </HoverButton>
            );
          })}
        </div>
      </div>

      {/* code viewer */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: color.appBg }}>
        {!filePath ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: 24,
              textAlign: "center",
              color: color.textGhost,
            }}
          >
            <FolderTreeIcon size={30} color={color.textFainter} stroke={1.2} />
            <div style={{ fontSize: 13.5, fontWeight: 600, color: color.textFaint }}>
              {fileTree.length === 0 ? "No repository open" : "No file selected"}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 320 }}>
              {fileTree.length === 0
                ? "Open a repository or folder to browse its files here."
                : "Pick a file from the explorer to view it."}
            </div>
          </div>
        ) : (
          <>
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 18px",
            height: 46,
            borderBottom: `1px solid ${color.borderSubtle}`,
            background: color.titlebarBg,
          }}
        >
          {fileFromReview && (
            <>
              <HoverButton
                onClick={backToReview}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 7,
                  background: "rgba(123,108,255,.1)",
                  border: "1px solid rgba(123,108,255,.3)",
                  color: color.violetLight,
                  fontFamily: font.sans,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  flex: "none",
                }}
                hoverStyle={{ background: "rgba(123,108,255,.16)" }}
              >
                <ChevronRightIcon size={12} stroke={1.7} style={{ transform: "rotate(180deg)" }} />#{fileFromReview.id}
              </HoverButton>
              <ChevronRightIcon size={11} color="#3a414e" stroke={1.6} style={{ flex: "none" }} />
            </>
          )}
          <FileSimpleIcon size={13} color={color.textFaint} stroke={1.3} style={{ flex: "none" }} />
          <span
            style={{ fontSize: 12.5, color: color.textDim, fontFamily: font.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {filePath}
          </span>
          <div style={{ flex: 1 }} />
          {fileFromReview && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: color.textFainter, whiteSpace: "nowrap", flex: "none" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.teal }} />
              full file · on <span style={{ fontFamily: font.mono, color: color.greenText }}>{fileFromReview.branch}</span>
            </span>
          )}
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "14px 0 50px" }}>
          {content === "" ? (
            <div style={{ padding: "0 24px", fontSize: 12.5, color: color.textGhost, fontFamily: font.mono }}>
              No preview available for this file.
            </div>
          ) : (
            lines.map((tokens, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "flex-start", fontFamily: font.mono, fontSize: 12.5, lineHeight: "21px", minHeight: 21 }}
              >
                <span style={{ width: 52, flex: "none", textAlign: "right", paddingRight: 16, color: "#39414f", userSelect: "none" }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, whiteSpace: "pre", paddingRight: 24 }}>
                  {tokens.map((t, j) => (
                    <span key={j} style={{ color: t.color }}>
                      {t.text}
                    </span>
                  ))}
                </span>
              </div>
            ))
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
