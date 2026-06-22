import { invoke } from "@tauri-apps/api/core";
import type { Thread } from "@locke/core";
import { isTauri, type CheckSpec } from "./git.js";

// Per-PR comment state git can't hold — comment threads (the payload future
// agents read and respond to) plus the per-file viewed flags — persisted by the
// Rust side to `<repo>/.locke/comments/<id>.json`, keyed by the pull request's
// numeric id. Pull-request metadata (status/verdict) lives separately in the
// registry (see api/pulls.ts). No-ops in mock mode (no Tauri bridge).

export interface CommentsFile {
  threads: Thread[];
  nextThreadId: number;
  viewed: Record<number, boolean>;
}

export async function loadComments(repo: string, id: number): Promise<CommentsFile | null> {
  if (!isTauri) return null;
  return (await invoke<CommentsFile | null>("read_comments", { repo, id })) ?? null;
}

export async function saveComments(repo: string, id: number, data: CommentsFile): Promise<void> {
  if (!isTauri) return;
  await invoke("write_comments", { repo, id, data });
}

// Per-repo check overrides. When set, these replace auto-detection so you can
// pin exact commands instead of relying on script-name heuristics.
export async function loadCheckOverrides(repo: string): Promise<CheckSpec[] | null> {
  if (!isTauri) return null;
  return (await invoke<CheckSpec[] | null>("read_check_overrides", { repo })) ?? null;
}

export async function saveCheckOverrides(repo: string, checks: CheckSpec[]): Promise<void> {
  if (!isTauri) return;
  await invoke("write_check_overrides", { repo, data: checks });
}

export async function clearCheckOverrides(repo: string): Promise<void> {
  if (!isTauri) return;
  await invoke("clear_check_overrides", { repo });
}

// Persist a generated agent prompt to `<repo>/.locke/requests/<id>.md` — a
// durable, diffable record of what was asked, beyond the clipboard copy.
// No-op in mock mode.
export async function writeAgentPrompt(repo: string, id: number, content: string): Promise<void> {
  if (!isTauri) return;
  await invoke("write_agent_prompt", { repo, id, content });
}
