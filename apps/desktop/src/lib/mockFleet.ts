import type { Approval, ChangedFile, Check, HistoryEntry, Review, RunEvent, RunRow, Thread } from "@locke/core";
import type { AgentInfo } from "../api/git.js";

// The design's `payments-service` fleet, seeded in mock mode (plain `vite`, no
// Tauri bridge) so Locke matches the design out of the box. In a real Tauri
// session `openRepo` replaces these with live git data. Mirrors the .dc.html
// REVIEWS()/pending/runRows/agents.

export const MOCK_REVIEWS: Review[] = [
  {
    id: "142",
    title: "Add idempotency keys to webhook retry handler",
    branch: "agent/webhook-idempotency",
    base: "main",
    agent: "Claude",
    model: "Sonnet 4.5",
    isAgent: true,
    initials: "CL",
    status: "changes",
    files: 4,
    add: 31,
    del: 9,
    comments: 1,
    checks: "pass",
    time: "8 min ago",
    runId: "run #R7",
    runState: "awaiting",
    lastAction: "wants to run `npm test -- webhooks`",
    elapsed: "0:41",
  },
  {
    id: "139",
    title: "Fix race condition in payment reconciliation job",
    branch: "agent/recon-lock",
    base: "main",
    agent: "Claude",
    model: "Sonnet 4.5",
    isAgent: true,
    initials: "CL",
    status: "changes",
    files: 6,
    add: 52,
    del: 41,
    comments: 1,
    checks: "pass",
    time: "2 hours ago",
    runId: "run #R6",
    runState: "awaiting",
    lastAction: "wants to run `git commit`",
    elapsed: "0:08",
  },
  {
    id: "137",
    title: "Update Stripe SDK to v14 and adjust types",
    branch: "agent/stripe-v14",
    base: "main",
    agent: "Codex",
    model: "gpt-5",
    isAgent: true,
    initials: "CX",
    status: "draft",
    files: 9,
    add: 88,
    del: 150,
    comments: 0,
    checks: "running",
    time: "just now",
    runId: "run #R8",
    runState: "running",
    lastAction: "editing src/types/stripe.d.ts (+12)",
    elapsed: "1:12",
  },
  {
    id: "138",
    title: "Add structured logging to the dispatch worker",
    branch: "agent/dispatch-logs",
    base: "main",
    agent: "Claude",
    model: "Sonnet 4.5",
    isAgent: true,
    initials: "CL",
    status: "ready",
    files: 5,
    add: 46,
    del: 12,
    comments: 0,
    checks: "pass",
    time: "25 min ago",
    runId: "run #R5",
    runState: "done",
  },
  {
    id: "134",
    title: "Refactor: extract email templates into MJML",
    branch: "feat/mjml-emails",
    base: "main",
    agent: "maya",
    model: null,
    isAgent: false,
    initials: "MA",
    status: "ready",
    files: 18,
    add: 320,
    del: 210,
    comments: 0,
    checks: "pass",
    time: "2 days ago",
  },
];

export const MOCK_PENDING: Approval[] = [
  {
    id: "a1",
    reviewId: "142",
    runId: "run #R7",
    agent: "Claude",
    initials: "CL",
    branch: "agent/webhook-idempotency",
    cmd: "npm test -- webhooks",
    tool: "npm",
    why: "Run the webhook test suite to confirm the atomic dedupe holds under concurrent delivery.",
    scope: "sandboxed · repo dir only",
  },
  {
    id: "a2",
    reviewId: "139",
    runId: "run #R6",
    agent: "Claude",
    initials: "CL",
    branch: "agent/recon-lock",
    cmd: 'git commit -m "Add advisory lock to recon job"',
    tool: "git",
    why: "Commit the reconciliation lock fix.",
    scope: "local repo",
  },
];

export const MOCK_RUN_ROWS: RunRow[] = [
  { runId: "#R8", initials: "CX", agent: "Codex", branch: "agent/stripe-v14", state: "running", duration: "1:12", rev: "137" },
  { runId: "#R7", initials: "CL", agent: "Claude", branch: "agent/webhook-idempotency", state: "awaiting", duration: "0:41", rev: "142" },
  { runId: "#R6", initials: "CL", agent: "Claude", branch: "agent/recon-lock", state: "awaiting", duration: "0:08", rev: "139" },
  { runId: "#R5", initials: "CL", agent: "Claude", branch: "agent/dispatch-logs", state: "done", duration: "1:46", rev: "138" },
  { runId: "#R4", initials: "CL", agent: "Claude", branch: "agent/webhook-idempotency", state: "done", duration: "2:03", rev: "142" },
  { runId: "#R3", initials: "CX", agent: "Codex", branch: "agent/stripe-v14", state: "failed", duration: "0:52", rev: "137" },
];

// Detected agent CLIs for mock mode (real mode probes PATH). aider/cursor are
// seeded as opted-out via MOCK_DISABLED so they render disabled.
export const MOCK_AGENTS: AgentInfo[] = [
  { id: "claude", name: "Claude Code", cmd: "claude", detected: true, path: "/usr/local/bin/claude", version: "v1.2.0" },
  { id: "codex", name: "Codex CLI", cmd: "codex", detected: true, path: "/opt/homebrew/bin/codex", version: "v0.9.4" },
  { id: "aider", name: "Aider", cmd: "aider", detected: true, path: "/usr/local/bin/aider", version: "v0.51" },
  { id: "cursor", name: "Cursor Agent", cmd: "cursor-agent", detected: true, path: "/usr/local/bin/cursor-agent", version: "v0.42" },
];

export const MOCK_DISABLED: string[] = ["aider", "cursor"];

// ---- workspace mock data (the design details review #142) ----

const f = (path: string, st: ChangedFile["st"], add: number, del: number, hunks: ChangedFile["hunks"]): ChangedFile => {
  const slash = path.lastIndexOf("/");
  return { path, dir: path.slice(0, slash + 1), name: path.slice(slash + 1), st, add, del, hunks };
};

const FILES_142: ChangedFile[] = [
  f("src/webhooks/retryHandler.ts", "M", 10, 6, [
    {
      hdr: "@@ -14,15 +14,22 @@ async handleEvent(event: WebhookEvent)",
      lines: [
        ["ctx", 14, 14, "  async handleEvent(event: WebhookEvent): Promise<void> {"],
        ["ctx", 15, 15, "    const key = idempotencyKey(event);"],
        ["del", 16, 0, "    if (await this.store.has(key)) {"],
        ["del", 17, 0, "      return;"],
        ["del", 18, 0, "    }"],
        ["add", 0, 16, "    await this.store.transaction(async (tx) => {"],
        ["add", 0, 17, "      if (await tx.has(key)) return DUP;"],
        ["add", 0, 18, "      await tx.save(key, attempt + 1);"],
        ["add", 0, 19, "    });"],
        ["ctx", 19, 20, "    await this.dispatch(event);"],
      ],
    },
  ]),
  f("src/webhooks/idempotency.ts", "A", 14, 0, [
    {
      hdr: "@@ -0,0 +1,4 @@",
      lines: [
        ["add", 0, 1, "export function idempotencyKey(e: WebhookEvent): string {"],
        ["add", 0, 2, "  return `${e.type}:${e.id}`;"],
        ["add", 0, 3, "}"],
      ],
    },
  ]),
  f("src/webhooks/webhook.ts", "M", 4, 2, [
    {
      hdr: "@@ -8,6 +8,8 @@",
      lines: [
        ["ctx", 8, 8, "import { idempotencyKey } from './idempotency';"],
        ["del", 9, 0, "// TODO: dedupe retries"],
        ["add", 0, 9, "const DUP = Symbol('duplicate');"],
      ],
    },
  ]),
  f("tests/webhooks/retry.test.ts", "M", 12, 1, [
    {
      hdr: "@@ -40,6 +40,17 @@ describe('retry handler')",
      lines: [
        ["ctx", 40, 40, "  it('handles concurrent delivery exactly once', async () => {"],
        ["add", 0, 41, "    await Promise.all([fire(evt), fire(evt)]);"],
        ["add", 0, 42, "    expect(store.save).toHaveBeenCalledTimes(1);"],
        ["ctx", 41, 43, "  });"],
      ],
    },
  ]),
];

const THREADS_142: Thread[] = [
  {
    id: 1,
    file: "src/webhooks/retryHandler.ts",
    lineId: "n19",
    resolved: false,
    kind: "change_request",
    items: [
      {
        author: "You",
        initials: "YO",
        isAgent: false,
        roleLabel: "AUTHOR",
        time: "8 min ago",
        body: "`store.has` then `store.save` isn't atomic — two webhooks delivered in parallel can both pass the check before either saves. Wrap it in a single transaction.",
      },
      {
        author: "Claude",
        initials: "CL",
        isAgent: true,
        time: "just now",
        body: "Good catch — wrapped both calls in a Redis MULTI transaction and added a concurrent-delivery test. Re-running the suite now.",
      },
    ],
  },
];

const HISTORY_142: HistoryEntry[] = [
  { runId: "run #R7", title: "Address review change requests", time: "just now", duration: "live", state: "awaiting", artifacts: ["log.txt", "diff.patch", "test-output"] },
  { runId: "run #R4", title: "Initial implementation of idempotency keys", time: "19 min ago", duration: "2:03", state: "done", artifacts: ["log.txt", "diff.patch", "test-output"] },
  { runId: "run #R2", title: "Scaffold webhook types", time: "24 min ago", duration: "0:38", state: "done", artifacts: ["log.txt", "diff.patch"] },
];

export const MOCK_CHECKS: Check[] = [
  { label: "eslint", detail: "0 problems", status: "pass" },
  { label: "tsc --noEmit", detail: "no type errors", status: "pass" },
  { label: "vitest run", detail: "142 passed in 3.1s", status: "pass" },
  { label: "build", detail: "bundle ok", status: "pass" },
];

// The opening run-stream events for #142 (the hero flow appends to these as you
// allow/deny the scripted permissions).
const RUN_EVENTS_142: RunEvent[] = [
  { key: "e1", kind: "msg", text: "Addressing 2 change requests from your review on retryHandler.ts.", time: "0:00" },
  { key: "e2", kind: "read", text: "Read src/webhooks/retryHandler.ts", time: "0:03" },
  {
    key: "e3",
    kind: "edit",
    text: "Edited retryHandler.ts",
    sub: "+ wrapped store.has / store.save in a single Redis MULTI transaction\n+ key is computed once and reused for both calls",
    time: "0:21",
  },
];

/** Per-review workspace data, keyed by review id. Only #142 is detailed in the
 *  design; other reviews open with an empty diff in mock mode. */
export const MOCK_FILES_BY_ID: Record<string, ChangedFile[]> = { "142": FILES_142 };
export const MOCK_THREADS_BY_ID: Record<string, Thread[]> = { "142": THREADS_142 };
export const MOCK_HISTORY_BY_ID: Record<string, HistoryEntry[]> = { "142": HISTORY_142 };
export const MOCK_RUN_EVENTS_BY_ID: Record<string, RunEvent[]> = { "142": RUN_EVENTS_142 };
