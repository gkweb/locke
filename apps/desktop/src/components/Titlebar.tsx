import { getCurrentWindow } from "@tauri-apps/api/window";
import { color, font } from "../theme/tokens.js";
import { useStore } from "../state/store.js";
import { repoBasename } from "../api/git.js";
import { FileIcon, BranchIcon, LogoMark } from "./icons.js";

// Window controls are no-ops when running outside a Tauri shell (e.g. plain
// `vite` for quick UI checks), so the bar never throws in a browser.
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const win = () => (inTauri ? getCurrentWindow() : null);

const dot = (bg: string, title: string, onClick: () => void): React.ReactNode => (
  <button
    title={title}
    onClick={onClick}
    style={{
      width: 12,
      height: 12,
      borderRadius: "50%",
      background: bg,
      border: "none",
      padding: 0,
      cursor: "pointer",
    }}
  />
);

export function Titlebar() {
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const repoPath = useStore((s) => s.repoPath);
  const repoName = repoBasename(repoPath);
  const pr = reviews.find((p) => p.id === selectedPR) ?? reviews[0];

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 40,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 16px",
        background: color.titlebarBg,
        borderBottom: `1px solid ${color.borderSubtle}`,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {dot("#ff5f57", "close", () => win()?.close())}
        {dot("#febc2e", "minimize", () => win()?.minimize())}
        {dot("#28c840", "zoom", () => win()?.toggleMaximize())}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: 6 }}>
        <span
          style={{
            width: 21,
            height: 21,
            borderRadius: 6,
            background: "#16121f",
            border: "1px solid #2a2440",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <LogoMark size={13} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.2px" }}>Locke</span>
        <span
          style={{
            fontSize: 9.5,
            color: color.textFainter,
            border: `1px solid ${color.borderChip}`,
            borderRadius: 5,
            padding: "1px 5px",
            letterSpacing: ".5px",
            fontWeight: 600,
          }}
        >
          LOCAL
        </span>
      </div>

      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 9,
          fontSize: 12,
          color: color.textFaint,
        }}
      >
        {repoPath && (
          <>
            <FileIcon size={13} color={color.textFainter} />
            <span style={{ color: "#aab2c0", fontWeight: 500 }}>{repoName}</span>
            {pr?.branch && (
              <>
                <span style={{ color: "#3a414e" }}>/</span>
                <BranchIcon size={12} color={color.textFainter} />
                <span style={{ fontFamily: font.mono, fontSize: 11.5, color: color.textFaint }}>
                  {pr.branch}
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
