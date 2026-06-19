import type { Review } from "@locke/core";
import { useStore } from "../state/store.js";
import { CheckCircleIcon } from "./icons.js";

// Shown once the reviewer has set a verdict. `compact` is the review-pane
// variant (thinner, bottom-bordered); default is the overview card variant.
export function VerdictBanner({ pr, compact = false }: { pr: Review; compact?: boolean }) {
  const verdict = useStore((s) => s.verdict);
  if (!verdict) return null;

  const isApprove = verdict === "approve";
  const col = isApprove ? "#43c46b" : "#f0616d";
  const bg = isApprove ? "rgba(67,196,107,0.1)" : "rgba(240,97,109,0.1)";
  const bd = isApprove ? "rgba(67,196,107,0.3)" : "rgba(240,97,109,0.3)";
  const text = isApprove
    ? `You approved these changes. Ready to push to ${pr.base}.`
    : "You requested changes. The agent will be notified to revise.";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 10 : 11,
        padding: compact ? "11px 24px" : "13px 16px",
        borderRadius: compact ? 0 : 11,
        fontSize: compact ? 12.5 : 13,
        fontWeight: 500,
        color: col,
        background: bg,
        border: compact ? "none" : `1px solid ${bd}`,
        borderBottom: compact ? "1px solid #1a1f29" : undefined,
      }}
    >
      {isApprove && (
        <span style={{ color: col, display: "inline-flex" }}>
          <CheckCircleIcon size={compact ? 15 : 16} color="currentColor" stroke={1.8} />
        </span>
      )}
      {text}
    </div>
  );
}
