import type { Review } from "@locke/core";
import { agentAccent, agentKind, statusMeta, color } from "../theme/tokens.js";

// Shared fleet-grouping + agent-identity helpers used across the side panel and
// the Activity/Reviews screens, so they bucket and accent reviews identically.

export type FleetGroup = "changes" | "running" | "ready" | "recent";

/** Which side-panel / fleet bucket a review belongs to. A live run wins over the
 *  review's lifecycle status (a running agent is "in progress" regardless of the
 *  review's ready/changes state). */
export function fleetGroup(r: Review): FleetGroup {
  if (r.runState === "running" || r.runState === "awaiting") return "running";
  if (r.status === "changes") return "changes";
  if (r.status === "ready") return "ready";
  return "recent"; // draft / merged / closed
}

/** AgentMark kind for a review (from its author initials). */
export const reviewKind = (r: Review): "claude" | "codex" | "human" => agentKind(r.initials);

/** Identity accent for a review's agent chip. */
export const reviewAccent = (r: Review): string => agentAccent[reviewKind(r)];

/** Display status pill for a review — a live "Agent running" wins over the
 *  lifecycle status; otherwise the review's status. (Awaiting is surfaced via the
 *  in-flight card / side-panel grouping, not the list pill, matching the design.) */
export function reviewStatusMeta(r: Review): { label: string; color: string } {
  if (r.runState === "running") return { label: "Agent running", color: color.teal };
  return statusMeta[r.status] ?? { label: r.status, color: color.textGhost };
}
