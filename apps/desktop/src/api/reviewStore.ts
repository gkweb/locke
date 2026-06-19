import { invoke } from "@tauri-apps/api/core";
import type { ReviewStatus, Thread, Verdict } from "@locke/core";
import { isTauri, type CheckSpec } from "./git.js";

// Per-review state git can't hold — comment threads, the reviewer's verdict,
// status, and which files were marked viewed — persisted by the Rust side to
// files under `<repo>/.locke/`, so review history lives in the repo and can be
// committed. No-ops in mock mode (no Tauri bridge).

export interface PersistedReview {
  threads: Thread[];
  verdict: Verdict | null;
  status: ReviewStatus;
  viewed: Record<number, boolean>;
  nextThreadId: number;
}

export async function loadPersistedReview(repo: string, branch: string): Promise<PersistedReview | null> {
  if (!isTauri) return null;
  return (await invoke<PersistedReview | null>("read_review_state", { repo, branch })) ?? null;
}

export async function savePersistedReview(repo: string, branch: string, data: PersistedReview): Promise<void> {
  if (!isTauri) return;
  await invoke("write_review_state", { repo, branch, data });
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
