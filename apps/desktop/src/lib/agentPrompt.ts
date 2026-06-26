import type { ChangedFile, Review, Thread } from "@locke/core";

/**
 * The slice of the store `buildAgentPrompt` reads. Kept narrow (rather than the
 * whole `LockeState`) so the builder stays a pure, easily-testable function.
 */
export interface AgentPromptInput {
  repoPath: string | null;
  selectedPR: string;
  reviews: Review[];
  files: ChangedFile[];
  threads: Thread[];
  /** "Plan first": ask the agent to investigate read-only and present a plan via
   *  ExitPlanMode before editing. Approving the plan transitions the same run into
   *  the build phase, where the instructions below are carried out. */
  planFirst?: boolean;
}

/** Open, actionable change-request threads — the builder's unit of work. */
export const openChangeRequests = (threads: Thread[]): Thread[] =>
  threads.filter((t) => !t.resolved && t.kind === "change_request");

/** Join a thread's messages into one block, attributing each line. */
function threadBody(thread: Thread): string {
  return thread.items
    .map((it) => `> ${it.author}: ${it.body.trim()}`)
    .join("\n");
}

/**
 * Serialize the open change requests on the selected review into a single
 * markdown instruction block for a coding agent. Pure: no store/IO access.
 *
 * The agent is told to work on the review's head branch in place — amend/commit
 * to it, then reply to each thread — so Locke live-refreshes the diff once it's
 * done. Returns "" when there's no selected review.
 */
export function buildAgentPrompt(state: AgentPromptInput): string {
  const review = state.reviews.find((r) => r.id === state.selectedPR);
  if (!review) return "";

  const requests = openChangeRequests(state.threads);
  const repo = state.repoPath ?? "(unknown — current working directory)";

  const lines: string[] = [];
  lines.push(`# Address review change requests: ${review.title}`);
  lines.push("");
  lines.push(`Repository: \`${repo}\``);
  lines.push(`Branch: \`${review.branch}\` (based on \`${review.base}\`)`);
  lines.push("");

  if (state.planFirst) {
    lines.push(
      "**Work in two phases.** First investigate the change requests below " +
        "read-only and present a concise plan for addressing them via the " +
        "`ExitPlanMode` tool — do not edit any files yet. Once the reviewer " +
        "approves the plan, carry it out following the instructions below.",
    );
    lines.push("");
    lines.push(
      "Don't use AskUserQuestion — interactive questions aren't available here. " +
        "If something is genuinely ambiguous, lay the options out in the plan itself " +
        "so the reviewer can decide when they approve it.",
    );
    lines.push("");
  }
  lines.push(
    `You are working on the branch \`${review.branch}\`. A reviewer has left ` +
      `${requests.length} change request${requests.length === 1 ? "" : "s"} on this pull ` +
      `request. Address every one of them, then amend/commit the work onto ` +
      `\`${review.branch}\` (do not open a new branch). Reply to each thread describing ` +
      `what you changed so the reviewer can verify.`,
  );
  lines.push("");

  lines.push("## Changed files");
  if (state.files.length === 0) {
    lines.push("_(none reported)_");
  } else {
    for (const f of state.files) lines.push(`- \`${f.path}\``);
  }
  lines.push("");

  lines.push("## Change requests");
  if (requests.length === 0) {
    lines.push("_(no open change requests)_");
  } else {
    requests.forEach((t, i) => {
      lines.push(`### ${i + 1}. \`${t.file}\` (${t.lineId})`);
      lines.push(threadBody(t));
      lines.push("");
    });
  }

  lines.push("## When done");
  lines.push(`1. Commit your changes onto \`${review.branch}\`.`);
  lines.push("2. Reply to each change-request thread above explaining your fix.");
  lines.push("3. Leave the branch checked out so Locke can refresh the diff.");

  return lines.join("\n");
}
