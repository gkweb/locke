import type {
  Approval,
  ChangedFile,
  Check,
  FileNode,
  HistoryEntry,
  InterviewMsg,
  Loop,
  LoopDiffLine,
  LoopItem,
  LoopSpec,
  LoopStreamEvent,
  LoopTarget,
  Review,
  RunEvent,
  RunRow,
  SpecSummary,
  Thread,
} from "@locke/core";
import { isTauri, type AgentInfo } from "../api/git.js";

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

// ---- Files explorer (mock) -------------------------------------------------
// The repo file tree + sample file contents shown on the Files screen in mock
// mode. In a real Tauri session these come from the backend (a later phase); the
// front-end-now surface renders them here so the screen works in plain `vite`.

export const MOCK_FILE_TREE: FileNode[] = [
  {
    t: "dir",
    name: "payments-service",
    path: "payments-service",
    depth: 0,
    children: [
      {
        t: "dir",
        name: "src",
        path: "payments-service/src",
        depth: 1,
        children: [
          {
            t: "dir",
            name: "webhooks",
            path: "payments-service/src/webhooks",
            depth: 2,
            children: [
              { t: "file", name: "retryHandler.ts", path: "payments-service/src/webhooks/retryHandler.ts", depth: 3 },
              { t: "file", name: "idempotency.ts", path: "payments-service/src/webhooks/idempotency.ts", depth: 3 },
            ],
          },
          {
            t: "dir",
            name: "types",
            path: "payments-service/src/types",
            depth: 2,
            children: [{ t: "file", name: "stripe.d.ts", path: "payments-service/src/types/stripe.d.ts", depth: 3 }],
          },
          {
            t: "dir",
            name: "components",
            path: "payments-service/src/components",
            depth: 2,
            children: [
              { t: "file", name: "Checkout.vue", path: "payments-service/src/components/Checkout.vue", depth: 3 },
              { t: "file", name: "StatusBadge.svelte", path: "payments-service/src/components/StatusBadge.svelte", depth: 3 },
            ],
          },
          { t: "file", name: "dispatch.js", path: "payments-service/src/dispatch.js", depth: 2 },
          { t: "file", name: "server.php", path: "payments-service/src/server.php", depth: 2 },
        ],
      },
      {
        t: "dir",
        name: "public",
        path: "payments-service/public",
        depth: 1,
        children: [{ t: "file", name: "index.html", path: "payments-service/public/index.html", depth: 2 }],
      },
    ],
  },
];

export const MOCK_FILE_CONTENTS: Record<string, string> = {
  "payments-service/src/webhooks/retryHandler.ts": `import { Redis } from "../store/redis";
import { idempotencyKey } from "./idempotency";
import type { WebhookEvent } from "../types/stripe";

const DUP = Symbol("duplicate");

export class RetryHandler {
  constructor(private store: Redis) {}

  // Process a single webhook exactly once, even under concurrent delivery.
  async handleEvent(event: WebhookEvent): Promise<void> {
    const key = idempotencyKey(event);
    const attempt = event.attempt ?? 0;

    const result = await this.store.transaction(async (tx) => {
      if (await tx.has(key)) return DUP;
      await tx.save(key, attempt + 1);
      return "ok";
    });

    if (result === DUP) {
      console.warn(\`Skipping duplicate webhook \${key}\`);
      return;
    }

    await this.dispatch(event);
  }
}`,
  "payments-service/src/webhooks/idempotency.ts": `import type { WebhookEvent } from "../types/stripe";

const PREFIX = "wh";

/* Stable key for a webhook so retries collapse to one. */
export function idempotencyKey(event: WebhookEvent): string {
  return \`\${PREFIX}:\${event.id}:\${event.type}\`;
}`,
  "payments-service/src/types/stripe.d.ts": `export interface WebhookEvent {
  id: string;
  type: "payment_intent.succeeded" | "charge.refunded";
  attempt?: number;
  created: number;
  data: Record<string, unknown>;
}

export type Handler = (event: WebhookEvent) => Promise<void>;`,
  "payments-service/src/components/Checkout.vue": `<script setup lang="ts">
import { ref, computed } from "vue";

const amount = ref(0);
const currency = ref("usd");
const label = computed(() => \`\${currency.value.toUpperCase()} \${amount.value}\`);
</script>

<template>
  <section class="checkout">
    <h2>Pay {{ label }}</h2>
    <button :disabled="amount <= 0" @click="$emit('pay')">
      Confirm payment
    </button>
  </section>
</template>`,
  "payments-service/src/components/StatusBadge.svelte": `<script>
  export let status = "pending";
  $: color = status === "paid" ? "green" : "amber";
</script>

<span class="badge {color}">
  {status}
</span>

<style>
  .badge { padding: 2px 8px; border-radius: 999px; }
</style>`,
  "payments-service/src/dispatch.js": `import { RetryHandler } from "./webhooks/retryHandler";

const handlers = new Map();

export function register(type, fn) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(fn);
}

export async function dispatch(event) {
  const fns = handlers.get(event.type) ?? [];
  for (const fn of fns) {
    await fn(event); // fan out to every subscriber
  }
  return fns.length;
}`,
  "payments-service/src/server.php": `<?php

namespace App\\Webhooks;

use App\\Store\\Redis;

class WebhookController
{
    private Redis $store;

    public function __construct(Redis $store)
    {
        $this->store = $store;
    }

    // Verify signature, then enqueue for processing.
    public function handle(array $payload): bool
    {
        $key = "wh:" . $payload['id'];

        if ($this->store->has($key)) {
            return false; # already processed
        }

        $this->store->save($key, time());
        return true;
    }
}`,
  "payments-service/public/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Payments Service</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <!-- mounted by the client bundle -->
    <div id="app"></div>
    <script type="module" src="/main.js"></script>
  </body>
</html>`,
};

/** Resolve a diff file's repo-relative path to a full-file path in the explorer,
 *  or null when no full-file preview exists (which keeps the "see full file"
 *  affordance hidden when there's nothing to show). In a live Tauri session the
 *  diff path is already the real repo-relative path, so it maps straight through
 *  (the backend reads it on demand). In mock mode the design's diff paths are
 *  repo-relative (`src/…`) while the tree is rooted at the service dir, so try
 *  both and gate on a seeded preview existing. */
export function fullFilePath(diffPath: string): string | null {
  if (isTauri) return diffPath;
  if (MOCK_FILE_CONTENTS[diffPath] !== undefined) return diffPath;
  const prefixed = `payments-service/${diffPath}`;
  if (MOCK_FILE_CONTENTS[prefixed] !== undefined) return prefixed;
  return null;
}

// ---- Loops (v2.0.0) demo data ---------------------------------------------
// The design's hero loop — a Vue 2.7 → Vue 3 migration across 1,000 components —
// plus a few sibling loops in other states. Static demo content (front-end-only
// phase); a real loop-runner replaces these later. Mirrors the .dc.html
// LOOPS()/LOOP_TARGETS()/LOOP_ITEMS()/ITEM_SPECS() and the monitor/plan/review seeds.

export const MOCK_LOOPS: Loop[] = [
  { id: "vue3", title: "Migrate Vue 2.7 components to Vue 3", branch: "chore/vue3-migration", base: "main", mode: "build", state: "building", pattern: "src/**/*.vue", total: 1000, done: 412, running: 6, review: 9, failed: 14, queued: 559, rate: "5.8 / min", elapsed: "1h 12m" },
  { id: "tsstrict", title: "Turn on strictNullChecks and fix the fallout", branch: "chore/ts-strict", base: "main", mode: "plan", state: "planning", pattern: "src/**/*.ts", total: 318, done: 0, running: 0, review: 0, failed: 0, queued: 318, rate: "—", elapsed: "planning" },
  { id: "testid", title: "Add data-testid to every interactive element", branch: "chore/testids", base: "main", mode: "plan", state: "draft", pattern: "src/**/*.vue", total: 0, done: 0, running: 0, review: 0, failed: 0, queued: 0, rate: "—", elapsed: "not started" },
  { id: "lifecycle", title: "Replace deprecated lifecycle hooks", branch: "chore/lifecycle", base: "main", mode: "build", state: "done", pattern: "src/**/*.vue", total: 64, done: 64, running: 0, review: 0, failed: 0, queued: 0, rate: "4.2 / min", elapsed: "15m" },
];

/** Builder audit rows — matched files Locke surfaces for the user's call. */
export const MOCK_LOOP_TARGETS: LoopTarget[] = [
  { path: "src/components/Checkout.vue", loc: 142, risk: "med", flags: ["Options API", "Vuex"], inc: true },
  { path: "src/components/forms/AddressForm.vue", loc: 264, risk: "high", flags: ["mixins", "filters", "$children"], inc: true },
  { path: "src/views/Dashboard.vue", loc: 312, risk: "high", flags: ["Vuex", "filters"], inc: true },
  { path: "src/components/RefundDialog.vue", loc: 208, risk: "high", flags: ["mixins", "$listeners"], inc: true },
  { path: "src/components/legacy/OldChart.vue", loc: 540, risk: "high", flags: ["mixins", "jQuery"], inc: false, reason: "uses jQuery — no clean Vue 3 path" },
  { path: "src/components/Money.vue", loc: 24, risk: "low", flags: ["filters"], inc: true },
  { path: "src/components/Spinner.vue", loc: 19, risk: "low", flags: [], inc: false, reason: "already on Vue 3 syntax" },
  { path: "src/components/PaymentMethodList.vue", loc: 181, risk: "med", flags: ["event bus"], inc: true },
  { path: "src/components/CardInput.vue", loc: 96, risk: "low", flags: ["filters"], inc: true },
  { path: "src/components/vendor/StripeFrame.vue", loc: 402, risk: "high", flags: ["3rd-party"], inc: false, reason: "vendored — excluded from repo lint" },
  { path: "src/components/Toast.vue", loc: 71, risk: "low", flags: ["event bus"], inc: true },
  { path: "src/components/forms/CountrySelect.vue", loc: 118, risk: "med", flags: ["Options API"], inc: true },
  { path: "src/components/Receipt.vue", loc: 156, risk: "med", flags: ["filters"], inc: true },
  { path: "src/components/InvoiceRow.vue", loc: 88, risk: "low", flags: ["Options API"], inc: true },
];

/** Files match / auto-included counts shown above the audit list. */
export const MOCK_LOOP_MATCHED = 1000;
export const MOCK_LOOP_AUTO_INCLUDED = 986;

/** Live loop items across all states (board cards, stream rail, grid focus). */
export const MOCK_LOOP_ITEMS: LoopItem[] = [
  { id: "i1", path: "src/components/forms/AddressForm.vue", status: "running", agent: "CL", action: "extracting formMixin → useForm()", pct: 62 },
  { id: "i2", path: "src/views/Dashboard.vue", status: "running", agent: "CX", action: "rewriting Vuex mapState as storeToRefs", pct: 31 },
  { id: "i3", path: "src/components/RefundDialog.vue", status: "running", agent: "CL", action: "replacing $listeners with defineEmits", pct: 78 },
  { id: "i4", path: "src/components/PaymentMethodList.vue", status: "running", agent: "CL", action: "converting to script setup", pct: 44 },
  { id: "i5", path: "src/components/Receipt.vue", status: "running", agent: "CX", action: "filters → formatters.ts", pct: 19 },
  { id: "i6", path: "src/components/forms/CountrySelect.vue", status: "running", agent: "CL", action: "running component tests", pct: 91 },
  { id: "r1", path: "src/components/Checkout.vue", status: "review", agent: "CL", note: "Vuex store split across cart.js / payment.js — confirm which owns currency", t: "2m" },
  { id: "r2", path: "src/components/CardInput.vue", status: "review", agent: "CL", note: "filter had a locale side-effect — verify formatter parity", t: "5m" },
  { id: "r3", path: "src/components/Money.vue", status: "review", agent: "CX", note: "rounding changed in 3 snapshot tests", t: "7m" },
  { id: "r4", path: "src/components/Toast.vue", status: "review", agent: "CL", note: "event bus → mitt: confirm a single shared instance", t: "11m" },
  { id: "d1", path: "src/components/InvoiceRow.vue", status: "done", agent: "CL", t: "just now" },
  { id: "d2", path: "src/components/StatusBadge.vue", status: "done", agent: "CL", t: "1m" },
  { id: "d3", path: "src/components/forms/FieldLabel.vue", status: "done", agent: "CX", t: "2m" },
  { id: "d4", path: "src/components/EmptyState.vue", status: "done", agent: "CL", t: "3m" },
  { id: "f1", path: "src/components/legacy/OldChart.vue", status: "failed", agent: "CL", note: "jQuery teardown has no Vue 3 equivalent", t: "4m" },
  { id: "f2", path: "src/components/DataTable.vue", status: "failed", agent: "CX", note: "render fn used h() with 2 deprecated args", t: "9m" },
  { id: "f3", path: "src/components/Calendar.vue", status: "failed", agent: "CL", note: "scoped-slot syntax not auto-convertible", t: "14m" },
  { id: "q1", path: "src/components/SettingsPanel.vue", status: "queued", agent: "CL", t: "—" },
  { id: "q2", path: "src/components/UserMenu.vue", status: "queued", agent: "CL", t: "—" },
  { id: "q3", path: "src/views/Reports.vue", status: "queued", agent: "CX", t: "—" },
  { id: "q4", path: "src/components/Sidebar.vue", status: "queued", agent: "CL", t: "—" },
];

const SS = "<script setup>";

/** Plan-mode per-item specs (Item-specs tab). */
export const MOCK_LOOP_SPECS: LoopSpec[] = [
  { id: "s1", path: "src/components/Checkout.vue", risk: "med", status: "review", approach: "script-setup", detected: ["Options API", "filters ×1", "Vuex getter ×1", "$emit ×1"], steps: [{ k: "a", text: `Convert to ${SS} with the Composition API` }, { k: "b", text: "Move the currency filter into formatters.ts and import it" }, { k: "c", text: "Replace Vuex getter currency with useCheckoutStore()" }, { k: "d", text: 'Swap this.$emit("pay") for defineEmits(["pay"])' }], tests: ["Checkout.spec.ts"], note: "Vuex store is split across cart.js and payment.js — confirm which module owns currency before this runs." },
  { id: "s2", path: "src/components/forms/AddressForm.vue", risk: "high", status: "review", approach: "script-setup", detected: ["mixins ×1", "filters ×2", "$children"], steps: [{ k: "a", text: "Extract formMixin.js into a shared useForm() composable" }, { k: "b", text: "Rewire this component to call useForm()" }, { k: "c", text: "Replace $children traversal with template refs" }, { k: "d", text: "Convert 2 filters to formatters.ts imports" }], tests: ["AddressForm.spec.ts"], note: "$children ordering drives tab focus — verify the ref array order matches." },
  { id: "s3", path: "src/components/StatusBadge.vue", risk: "low", status: "specced", approach: "script-setup", detected: ["Options API"], steps: [{ k: "a", text: `Convert to ${SS}` }, { k: "b", text: "Type the status prop with defineProps generics" }], tests: ["StatusBadge.spec.ts"], note: "" },
  { id: "s4", path: "src/components/Money.vue", risk: "low", status: "specced", approach: "options-api", detected: ["filters ×1"], steps: [{ k: "a", text: "Keep Options API — no external this-based refs" }, { k: "b", text: "Convert the money filter to a method" }], tests: ["Money.spec.ts"], note: "Tiny presentational component — Options API stays." },
  { id: "s5", path: "src/views/Dashboard.vue", risk: "high", status: "review", approach: "script-setup", detected: ["Vuex ×3", "filters ×1", "large template"], steps: [{ k: "a", text: `Convert to ${SS}` }, { k: "b", text: "Replace mapState / mapGetters with storeToRefs" }, { k: "c", text: "Move the date filter into formatters.ts" }], tests: ["Dashboard.spec.ts"], note: "Three Vuex modules touched — Pinia mapping needs your confirmation." },
  { id: "s6", path: "src/components/CardInput.vue", risk: "low", status: "specced", approach: "script-setup", detected: ["filters ×1"], steps: [{ k: "a", text: `Convert to ${SS}` }, { k: "b", text: "Move the card filter into formatters.ts" }], tests: ["CardInput.spec.ts"], note: "" },
  { id: "s7", path: "src/components/Toast.vue", risk: "low", status: "specced", approach: "script-setup", detected: ["event bus"], steps: [{ k: "a", text: `Convert to ${SS}` }, { k: "b", text: "Replace the global event bus with a shared mitt instance" }], tests: ["Toast.spec.ts"], note: "" },
  { id: "s8", path: "src/components/RefundDialog.vue", risk: "high", status: "speccing", approach: "script-setup", detected: ["mixins ×1", "$listeners"], steps: [{ k: "a", text: `Convert to ${SS}` }, { k: "b", text: "Replace $listeners with defineEmits" }], tests: ["RefundDialog.spec.ts"], note: "" },
  { id: "s9", path: "src/components/forms/CountrySelect.vue", risk: "med", status: "queued", approach: "script-setup", detected: ["Options API"], steps: [{ k: "a", text: `Convert to ${SS}` }], tests: ["CountrySelect.spec.ts"], note: "" },
  { id: "s10", path: "src/components/Receipt.vue", risk: "med", status: "queued", approach: "script-setup", detected: ["filters ×2"], steps: [{ k: "a", text: `Convert to ${SS}` }, { k: "b", text: "Move 2 filters into formatters.ts" }], tests: ["Receipt.spec.ts"], note: "" },
];

/** Plan-mode scope interview thread + the open question. */
export const MOCK_LOOP_INTERVIEW: InterviewMsg[] = [
  { role: "agent", text: "Before I plan a change across 1,000 components, a few decisions so the loop does the right thing everywhere." },
  { role: "agent", text: "Components on the Options API — convert them to script setup, or keep the Options API and only fix what breaks?" },
  { role: "you", text: "Convert to script setup where there are no external this-based refs. Keep Options API otherwise." },
  { role: "agent", text: "38 components import the shared mixin formMixin.js. Extract it once into a composable useForm() and rewrite every call site?" },
  { role: "you", text: "Yes — build useForm() first, then have the loop migrate each call site." },
];
export const MOCK_LOOP_PENDING_Q = "The deprecated filters option appears in 112 components — where should the new formatters live?";
export const MOCK_LOOP_PENDING_CHIPS = ["Shared formatters.ts", "Local methods", "Decide per component"];

/** Dry-run spec summary lines + assumptions (plan scope rail). */
export const MOCK_LOOP_SPEC_SUMMARY: SpecSummary[] = [
  { label: "Convert to script setup", detail: "612 components" },
  { label: "Keep Options API, fix breaks", detail: "388 components" },
  { label: "formMixin.js → useForm() composable", detail: "38 call sites" },
  { label: "filters → formatters", detail: "112 · awaiting your answer", pend: true },
  { label: "$children / $listeners → emits", detail: "47 components" },
  { label: "global event bus → mitt", detail: "23 components" },
];
export const MOCK_LOOP_ASSUMPTIONS: string[] = [
  "Template markup and style blocks are left byte-for-byte unchanged.",
  "A component is only marked done once its existing unit tests pass.",
  "Anything touching jQuery or a non-Vue global is sent to review, never auto-committed.",
];

/** Monitor Stream layout — live event feed (newest first). */
export const MOCK_LOOP_STREAM: LoopStreamEvent[] = [
  { st: "done", path: "src/components/InvoiceRow.vue", text: "migrated → script setup · 4 tests pass · committed a1f2", t: "12:41:08" },
  { st: "review", path: "src/components/Money.vue", text: "paused for review — rounding changed in 3 snapshot tests", t: "12:40:55" },
  { st: "running", path: "src/views/Dashboard.vue", text: "rewriting Vuex mapState as storeToRefs", t: "12:40:50" },
  { st: "done", path: "src/components/Spinner.vue", text: "skipped — already on Vue 3 syntax", t: "12:40:42" },
  { st: "failed", path: "src/components/legacy/OldChart.vue", text: "failed — jQuery teardown has no Vue 3 equivalent", t: "12:40:31" },
  { st: "running", path: "src/components/forms/AddressForm.vue", text: "extracting formMixin → useForm()", t: "12:40:20" },
  { st: "done", path: "src/components/CardInput.vue", text: "filters → formatters.ts · committed e91a", t: "12:40:04" },
  { st: "review", path: "src/components/Checkout.vue", text: "paused for review — Vuex store split across 2 modules", t: "12:39:48" },
  { st: "done", path: "src/components/Receipt.vue", text: "migrated · 6 tests pass · committed 7c30", t: "12:39:30" },
  { st: "done", path: "src/components/Toast.vue", text: "event bus → mitt · committed 4b8e", t: "12:39:12" },
  { st: "done", path: "src/components/StatusBadge.vue", text: "migrated · 2 tests pass · committed 9d11", t: "12:38:50" },
];

/** Loop-item review diff (Checkout.vue Options API → script setup). */
export const MOCK_LOOP_DIFF: LoopDiffLine[] = [
  { h: "@@ Checkout.vue · <script> block @@" },
  { t: "del", no: 1, c: "<script>" },
  { t: "del", no: 2, c: "export default {" },
  { t: "del", no: 3, c: "  props: { amount: Number }," },
  { t: "del", no: 4, c: "  computed: {" },
  { t: "del", no: 5, c: "    label() { return `${this.currency} ${this.amount}` }," },
  { t: "del", no: 6, c: "    currency() { return this.$store.getters.currency }" },
  { t: "del", no: 7, c: "  }," },
  { t: "del", no: 8, c: '  methods: { pay() { this.$emit("pay") } }' },
  { t: "del", no: 9, c: "}" },
  { t: "add", no: 1, c: "<script setup>" },
  { t: "add", no: 2, c: 'import { computed } from "vue"' },
  { t: "add", no: 3, c: 'import { useCheckoutStore } from "@/stores/checkout"' },
  { t: "add", no: 4, c: "const props = defineProps({ amount: Number })" },
  { t: "add", no: 5, c: 'const emit = defineEmits(["pay"])' },
  { t: "add", no: 6, c: "const store = useCheckoutStore()" },
  { t: "add", no: 7, c: "const label = computed(() => `${store.currency} ${props.amount}`)" },
  { t: "add", no: 8, c: 'function pay() { emit("pay") }' },
  { thread: true },
];

/** The loop's note in the review feedback rail (the user's replies append below). */
export const MOCK_LOOP_REVIEW_NOTE =
  "This component read currency from a Vuex getter. I mapped it to useCheckoutStore(), but that store is split across cart.js and payment.js — I wasn’t sure which module owns currency, so I paused before committing.";

/** The draft a "New loop" opens with (the design's Vue 3 example). */
export const MOCK_LOOP_DRAFT = {
  title: "Migrate Vue 2.7 components to Vue 3",
  branch: "chore/vue3-migration",
  base: "main",
  pattern: "src/**/*.vue",
  prompt:
    "Migrate each Vue 2.7 single-file component to Vue 3.x. Prefer <script setup> with the Composition API where the component has no external this-based refs; otherwise keep the Options API and only fix breaking changes. Convert the deprecated filters option, replace $children / $listeners with emits, and move the global event bus to mitt. Leave template markup and style blocks byte-for-byte unchanged. A component is only done once its existing unit tests pass.",
};
