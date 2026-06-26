import type { Loop, LoopItemState, LoopRisk, LoopState, SpecStatus } from "@locke/core";
import { color } from "../theme/tokens.js";

// Shared Loops meta + math, kept beside lib/fleet.ts so every Loops surface
// (list, builder, plan, monitor, review) colors and buckets items identically.

/** A loop's lifecycle → pill label, accent, and whether it shows a live dot. */
export const loopStateMeta: Record<LoopState, { label: string; color: string; live: boolean }> = {
  draft: { label: "Draft", color: color.amber, live: false },
  planning: { label: "Planning", color: color.violetLight, live: true },
  building: { label: "Building", color: color.teal, live: true },
  paused: { label: "Paused", color: color.red, live: false },
  done: { label: "Done", color: color.green, live: false },
};

/** Per-item state → accent (board headers/dots, grid tiles, stream glyphs). */
export const itemStateColor: Record<LoopItemState, string> = {
  running: color.teal,
  review: color.amber,
  done: color.green,
  failed: color.red,
  queued: color.textGhost,
  excluded: color.textGhost,
};

/** Per-item state → board-column label + accent. */
export const itemStateMeta: Record<LoopItemState, { label: string; color: string }> = {
  queued: { label: "Queued", color: color.textGhost },
  running: { label: "Running", color: color.teal },
  review: { label: "Needs review", color: color.amber },
  done: { label: "Done", color: color.green },
  failed: { label: "Failed", color: color.red },
  excluded: { label: "Excluded", color: color.textGhost },
};

/** Target risk band → accent (audit pills, spec headers). */
export const riskColor: Record<LoopRisk, string> = {
  low: color.green,
  med: color.amber,
  high: color.red,
};

/** Plan-mode spec status → label + accent. */
export const specStatusMeta: Record<SpecStatus, { label: string; color: string }> = {
  specced: { label: "Specced", color: color.teal },
  review: { label: "Needs your call", color: color.amber },
  speccing: { label: "Speccing…", color: color.violetLight },
  queued: { label: "Queued", color: color.textGhost },
  excluded: { label: "Excluded", color: color.textGhost },
};

/** Width-% of each segment of a loop's progress bar, in render order. */
export function loopSegments(l: Loop): { done: number; running: number; review: number; failed: number } {
  const pc = (n: number) => (l.total ? (n / l.total) * 100 : 0);
  return { done: pc(l.done), running: pc(l.running), review: pc(l.review), failed: pc(l.failed) };
}

/** Mode chip ("Build" teal / "Plan" violet) styling for the list rows. */
export function modeChip(mode: "plan" | "build"): { label: string; color: string } {
  return mode === "build"
    ? { label: "Build", color: color.teal }
    : { label: "Plan", color: color.violetLight };
}

/** Last segment of a path, e.g. "Checkout.vue". */
export const baseName = (path: string): string => path.split("/").pop() ?? path;
