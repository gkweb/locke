import type { CheckState, FileStatus, Review, ReviewStatus } from "@locke/core";

// Status / check / agent visual metadata, ported from the design's
// statusMeta / checkMeta and the inline agent-chip + file-status styling.

export interface StatusMeta {
  label: string;
  col: string;
  bg: string;
  bd: string;
}

const STATUS: Record<ReviewStatus, StatusMeta> = {
  ready: { label: "Ready for review", col: "#43c46b", bg: "rgba(67,196,107,.12)", bd: "rgba(67,196,107,.3)" },
  draft: { label: "Draft", col: "#f0b86e", bg: "rgba(240,184,110,.12)", bd: "rgba(240,184,110,.3)" },
  changes: { label: "Changes requested", col: "#f0616d", bg: "rgba(240,97,109,.12)", bd: "rgba(240,97,109,.3)" },
  merged: { label: "Merged", col: "#a78bff", bg: "rgba(167,139,255,.12)", bd: "rgba(167,139,255,.3)" },
  closed: { label: "Closed", col: "#7b8494", bg: "rgba(123,132,148,.12)", bd: "rgba(123,132,148,.3)" },
};

export const statusMeta = (s: ReviewStatus): StatusMeta => STATUS[s] ?? STATUS.ready;

export interface CheckMeta {
  col: string;
  label: string;
}

const CHECK: Record<CheckState, CheckMeta> = {
  pass: { col: "#43c46b", label: "All checks passed" },
  running: { col: "#5aa9ff", label: "Checks running" },
  fail: { col: "#f0616d", label: "Checks failing" },
};

export const checkMeta = (c: CheckState): CheckMeta => CHECK[c] ?? CHECK.pass;

/** Teal accents for agent authors, violet for humans. */
export function agentChipStyle(isAgent: boolean): React.CSSProperties {
  return {
    background: isAgent ? "rgba(63,208,192,0.12)" : "rgba(167,139,255,0.14)",
    color: isAgent ? "#3fd0c0" : "#c0a9ff",
    border: `1px solid ${isAgent ? "rgba(63,208,192,0.3)" : "rgba(167,139,255,0.32)"}`,
  };
}

export interface FileStatusMeta {
  col: string;
  bg: string;
}

export function fileStatusMeta(st: FileStatus): FileStatusMeta {
  if (st === "A") return { col: "#43c46b", bg: "rgba(67,196,107,.14)" };
  if (st === "M") return { col: "#f0b86e", bg: "rgba(240,184,110,.14)" };
  return { col: "#f0616d", bg: "rgba(240,97,109,.14)" };
}

/** "+27" / "−9" formatting (note the minus uses the design's U+2212). */
export const addStr = (n: number) => `+${n}`;
export const delStr = (n: number) => `−${n}`;

export const currentReview = (reviews: Review[], id: string): Review =>
  reviews.find((p) => p.id === id) ?? reviews[0];
