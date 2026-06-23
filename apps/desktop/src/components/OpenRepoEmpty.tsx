import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";
import { chooseRepo } from "../lib/repo.js";
import { FolderIcon, PlusIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";

// Centered empty state for the main area: prompts to open a repository when none
// is loaded, or to start a review when a repo is open but has no reviews yet.
export function OpenRepoEmpty() {
  const repoPath = useStore((s) => s.repoPath);
  const branches = useStore((s) => s.branches);
  const base = useStore((s) => s.base);
  const loading = useStore((s) => s.loading);
  const openRepo = useStore((s) => s.openRepo);
  const setNewReviewOpen = useStore((s) => s.setNewReviewOpen);
  const otherBranches = Math.max(0, branches.length - 1);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "80px 20px", textAlign: "center", background: color.appBg }}>
      <span style={{ width: 46, height: 46, borderRadius: 12, background: color.popoverBg, border: `1px solid ${color.borderChip2}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <FolderIcon size={20} color={color.violetLogo} stroke={1.4} />
      </span>

      {loading ? (
        <div style={{ fontSize: 14, color: color.textFaint }}>Loading…</div>
      ) : repoPath ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: color.text }}>No open reviews</div>
          <div style={{ fontSize: 13, color: color.textFainter, maxWidth: 400, lineHeight: 1.5 }}>
            {otherBranches > 0 ? (
              <>
                {otherBranches} other local branch{otherBranches === 1 ? "" : "es"} found, but none are ahead of{" "}
                <span style={{ fontFamily: font.mono, color: color.textFaint }}>{base}</span>. Start a{" "}
                <strong style={{ color: color.textMuted }}>New review</strong> to compare against a different base.
              </>
            ) : (
              <>
                Branches ahead of <span style={{ fontFamily: font.mono, color: color.textFaint }}>{base}</span> appear
                here. Commit on a branch, then start a review.
              </>
            )}
          </div>
          <HoverButton
            onClick={() => setNewReviewOpen(true)}
            style={ctaStyle}
            hoverStyle={{ background: color.violetHover }}
          >
            <PlusIcon size={13} color="#fff" stroke={1.6} />
            New review
          </HoverButton>
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: color.text }}>No repository open</div>
          <div style={{ fontSize: 13, color: color.textFainter, maxWidth: 380, lineHeight: 1.5 }}>
            Open a local git repository to review the branches your agents built.
          </div>
          <HoverButton onClick={() => void chooseRepo(openRepo)} style={ctaStyle} hoverStyle={{ background: color.violetHover }}>
            <FolderIcon size={13} color="#fff" stroke={1.5} />
            Open repository…
          </HoverButton>
        </>
      )}
    </div>
  );
}

const ctaStyle: React.CSSProperties = {
  marginTop: 4,
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 13,
  fontWeight: 600,
  color: "#fff",
  background: color.violet,
  border: `1px solid ${color.violet}`,
  borderRadius: 9,
  padding: "9px 16px",
  cursor: "pointer",
  fontFamily: font.sans,
};
