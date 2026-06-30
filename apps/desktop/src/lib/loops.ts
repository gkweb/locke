import type {
  Loop,
  LoopItemState,
  LoopRisk,
  LoopSpec,
  LoopState,
  ManifestEntry,
  NodeOrigin,
  ResolverSpec,
  SpecStatus,
  WorkGraphNode,
} from "@locke/core";
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
  blocked: color.violetLight,
};

/** Per-item state → board-column label + accent. */
export const itemStateMeta: Record<LoopItemState, { label: string; color: string }> = {
  queued: { label: "Queued", color: color.textGhost },
  running: { label: "Running", color: color.teal },
  review: { label: "Needs review", color: color.amber },
  done: { label: "Done", color: color.green },
  failed: { label: "Failed", color: color.red },
  excluded: { label: "Excluded", color: color.textGhost },
  blocked: { label: "Blocked", color: color.violetLight },
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

const SPEC_STATUSES: SpecStatus[] = ["specced", "review", "speccing", "queued", "excluded"];

/** Derive the Plan view's per-item spec list from a loop's manifest rows. The
 *  strategist enriches the manifest (approach/detected/steps/tests/status); this
 *  maps it to the `LoopSpec` shape the Plan view renders (steps gain stable keys). */
export function manifestToSpecs(entries: ManifestEntry[]): LoopSpec[] {
  // Candidate-pool rows aren't per-item specs — they belong to the Work graph's
  // "Considered" view, not the spec list. Everything else (incl. excluded) maps.
  return entries
    .filter((e) => e.status !== "candidate")
    .map((e) => ({
    id: e.id || e.path,
    path: e.path,
    risk: (["low", "med", "high"].includes(e.risk ?? "") ? e.risk : "low") as LoopRisk,
    status: (SPEC_STATUSES.includes(e.status as SpecStatus) ? e.status : "queued") as SpecStatus,
    approach: e.approach ?? "",
    detected: e.detected ?? [],
    steps: (e.steps ?? []).map((text, i) => ({ k: String(i), text })),
    tests: e.tests ?? [],
    note: e.note ?? "",
  }));
}

/** Node provenance → short badge label + accent (Work-graph editor). */
export const originMeta: Record<NodeOrigin, { label: string; color: string }> = {
  resolver: { label: "From targets", color: color.textGhost },
  model: { label: "Model", color: color.violetLight },
  human: { label: "You", color: color.teal },
};

/** Normalize a manifest row's `origin` (legacy empty → "resolver"). */
export function nodeOrigin(e: ManifestEntry): NodeOrigin {
  return e.origin === "model" || e.origin === "human" ? e.origin : "resolver";
}

/** Topological wave levels for the manifest: 0 for nodes with no in-graph deps,
 *  else 1 + max(dep waves). Mirrors the Rust `compute_waves` so the editor can
 *  recompute live as the human edits edges (a pinned `wave > 0` is respected).
 *  Cycles resolve to 0 (the runner still gates on `requires`, so a cyclic edge
 *  just never satisfies → blocked). */
export function computeWaves(entries: ManifestEntry[]): Map<string, number> {
  const idOf = (e: ManifestEntry) => e.id || e.path;
  const known = new Set(entries.map(idOf));
  const wave = new Map<string, number>();
  for (let pass = 0; pass < entries.length; pass++) {
    let changed = false;
    for (const e of entries) {
      const id = idOf(e);
      const w = (e.requires ?? [])
        .filter((d) => known.has(d))
        .reduce((mx, d) => Math.max(mx, (wave.get(d) ?? 0) + 1), 0);
      if ((wave.get(id) ?? 0) !== w) {
        wave.set(id, w);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const e of entries) if (!wave.has(idOf(e))) wave.set(idOf(e), 0);
  return wave;
}

/** A row the strategist considered but didn't choose for the work set: still a
 *  candidate (surfaced by the scope hint, not yet decided) or explicitly excluded. */
export function isConsidered(e: { status?: string }): boolean {
  return e.status === "candidate" || e.status === "excluded";
}

/** Derive the Plan-view work-graph nodes from a loop's manifest rows. By default
 *  returns the DECIDED work set (included files + tasks); pass `showConsidered` to
 *  also surface the candidate pool and excluded rows (carrying the model's `reason`)
 *  so the human can see what it skipped and why. Normalizes origin, assigns each its
 *  (pinned or derived) wave, sorted by wave then descending priority — the run order. */
export function manifestToGraph(entries: ManifestEntry[], showConsidered = false): WorkGraphNode[] {
  const live = entries.filter((e) => (showConsidered ? true : !isConsidered(e)));
  const waves = computeWaves(live);
  const nodes: WorkGraphNode[] = live.map((e) => {
    const id = e.id || e.path;
    const isTask = e.kind === "task";
    return {
      id,
      kind: isTask ? "task" : "file",
      label: isTask ? e.title || id : e.path,
      requires: e.requires ?? [],
      priority: e.priority ?? 0,
      wave: e.wave && e.wave > 0 ? e.wave : (waves.get(id) ?? 0),
      origin: nodeOrigin(e),
      status: e.status ?? "",
      reason: e.reason,
    };
  });
  return nodes.sort((a, b) => a.wave - b.wave || b.priority - a.priority || a.label.localeCompare(b.label));
}

/** A short, human label for a resolver — shown as the loop's `pattern` and the
 *  builder chip. */
export function resolverSummary(r: ResolverSpec): string {
  switch (r.kind) {
    case "glob":
      return r.pattern;
    case "globs":
      return [...r.include, ...r.exclude.map((e) => `!${e}`)].join(" ");
    case "list":
      return `${r.paths.length} file${r.paths.length === 1 ? "" : "s"} (list)`;
    case "command":
      return `$ ${r.command}`;
    case "custom":
      return `custom:${r.id}`;
  }
}

/** True when a resolver has nothing to resolve yet (drives the builder's Start gate). */
export function resolverEmpty(r: ResolverSpec): boolean {
  switch (r.kind) {
    case "glob":
      return r.pattern.trim() === "";
    case "globs":
      return r.include.every((g) => g.trim() === "");
    case "list":
      return r.paths.length === 0;
    case "command":
      return r.command.trim() === "";
    case "custom":
      return r.id.trim() === "";
  }
}
