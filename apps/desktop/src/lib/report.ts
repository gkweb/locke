import { logUiError } from "../api/git.js";

// Durable capture of critical exceptions so a crash can be diagnosed after the fact
// (console is lost on reload). Every path funnels through `reportError`, which logs to
// the console for live debugging AND appends a JSON line to the on-disk error log.

/** Build a context snapshot (current view/loop etc.) attached to each report. */
type Context = () => Record<string, unknown>;

let installed = false;

/** Record one critical exception. Never throws — logging must not cause a crash. */
export function reportError(kind: string, error: unknown, context?: Record<string, unknown>): void {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  try {
    console.error(`[locke] ${kind}:`, err, context ?? {});
  } catch {
    /* ignore */
  }
  try {
    const record = {
      ts: new Date().toISOString(),
      kind,
      message: err.message,
      stack: err.stack ?? null,
      ...(context ?? {}),
    };
    void logUiError(JSON.stringify(record)).catch(() => {});
  } catch {
    /* logging must never throw */
  }
}

/** Install global handlers for uncaught errors and unhandled promise rejections, so
 *  exceptions outside React's render path are captured too. Idempotent. */
export function installGlobalErrorCapture(context: Context): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => reportError("window.error", e.error ?? e.message, safeCtx(context)));
  window.addEventListener("unhandledrejection", (e) => reportError("unhandledrejection", e.reason, safeCtx(context)));
}

function safeCtx(context: Context): Record<string, unknown> {
  try {
    return context();
  } catch {
    return {};
  }
}
