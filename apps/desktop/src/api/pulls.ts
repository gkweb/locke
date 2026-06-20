import { invoke } from "@tauri-apps/api/core";
import type { PullRecord, PullStore } from "@locke/core";
import { isTauri } from "./git.js";

// The explicit pull-request registry, persisted by the Rust side to
// `<repo>/.locke/pulls.json`. Pull requests are opt-in: a branch only appears in
// the queue once a PR is created for it. Ids are allocated by a monotonic
// counter in the store so they're never reused. No-ops in mock mode (no bridge).

const EMPTY: PullStore = { nextId: 1, pulls: [] };

export async function readPulls(repo: string): Promise<PullStore> {
  if (!isTauri) return EMPTY;
  return (await invoke<PullStore>("read_pulls", { repo })) ?? EMPTY;
}

export interface NewPull {
  branch: string;
  base: string;
  title: string;
  author: string;
  isAgent: boolean;
}

export async function createPull(repo: string, p: NewPull): Promise<PullRecord> {
  return invoke<PullRecord>("create_pull", {
    repo,
    branch: p.branch,
    base: p.base,
    title: p.title,
    author: p.author,
    isAgent: p.isAgent,
  });
}

export async function updatePull(repo: string, pull: PullRecord): Promise<void> {
  if (!isTauri) return;
  await invoke("update_pull", { repo, pull });
}

export async function deletePull(repo: string, id: number): Promise<void> {
  if (!isTauri) return;
  await invoke("delete_pull", { repo, id });
}
