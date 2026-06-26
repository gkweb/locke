import { useEffect, useState } from "react";
import type { View } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { ChevronLeftIcon } from "../components/icons.js";
import { HoverButton } from "../components/primitives.js";

// The Integrations screen: Locke's outward connections. Today that's the Model
// Context Protocol (MCP) server, which exposes the local pull-request system to
// any MCP client (Claude Code, etc.) so agents can open PRs, read and reply to
// comments, and view history. Explicit, user-initiated install — Locke never
// auto-injects it. A live call log sits below for debugging what agents do.

const RETURN_LABEL: Record<string, string> = {
  activity: "Activity",
  reviews: "Reviews",
  runs: "Runs",
  agents: "Agents",
  files: "Files",
  workspace: "Review",
  extensions: "Extensions",
};

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function McpServerCard() {
  const status = useStore((s) => s.mcpStatus);
  const busy = useStore((s) => s.mcpBusy);
  const error = useStore((s) => s.mcpError);
  const installMcp = useStore((s) => s.installMcp);
  const uninstallMcp = useStore((s) => s.uninstallMcp);
  const [copied, setCopied] = useState(false);

  const installed = status?.installed ?? false;
  const claudeMissing = status != null && !status.claudeAvailable;
  const binaryMissing = status != null && !status.binaryAvailable;
  const canAct = !busy && !claudeMissing && !binaryMissing;

  const desc = installed
    ? "Connected to Claude Code. Agents can open PRs, read and reply to comments, and view history across PRs."
    : claudeMissing
      ? "Claude Code CLI not found. Install it, or copy the config below to register Locke in another MCP client."
      : binaryMissing
        ? "The locke-mcp server binary wasn't found in this build."
        : "Register the Locke MCP server in Claude Code so agents can open PRs, read and reply to comments, and view history.";

  const snippetText = status ? JSON.stringify(status.snippet, null, 2) : "";
  const copySnippet = () => {
    if (!snippetText) return;
    void navigator.clipboard?.writeText(snippetText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div
      style={{
        border: `1px solid ${color.borderRail}`,
        borderRadius: 12,
        background: color.panelBg,
        padding: "18px 18px 16px",
        marginBottom: 28,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: color.text }}>Locke MCP</span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".4px",
            padding: "2px 6px",
            borderRadius: 5,
            color: installed ? color.teal : color.textGhost,
            background: installed ? alpha.teal(0.12) : "#141821",
            border: `1px solid ${installed ? alpha.teal(0.3) : color.borderRow2}`,
          }}
        >
          {installed ? "INSTALLED" : "NOT INSTALLED"}
        </span>
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 12.5, color: color.textFaint, lineHeight: 1.5, maxWidth: 560 }}>
        {desc}
      </p>
      {error ? (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#e0795f", lineHeight: 1.45 }}>{error}</p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14 }}>
        <button
          onClick={installed ? uninstallMcp : installMcp}
          disabled={!canAct}
          style={{
            fontFamily: font.sans,
            fontSize: 12.5,
            fontWeight: 600,
            padding: "7px 14px",
            borderRadius: 8,
            cursor: canAct ? "pointer" : "not-allowed",
            color: installed ? color.textSoft : "#0a0c11",
            background: installed ? "transparent" : canAct ? color.teal : "#1c212b",
            border: `1px solid ${installed ? color.borderRow2 : "transparent"}`,
            opacity: canAct ? 1 : 0.6,
          }}
        >
          {busy ? "Working…" : installed ? "Remove" : "Add to Claude Code"}
        </button>
        <button
          onClick={copySnippet}
          disabled={!snippetText}
          style={{
            fontFamily: font.sans,
            fontSize: 12.5,
            fontWeight: 500,
            padding: "7px 12px",
            borderRadius: 8,
            cursor: snippetText ? "pointer" : "not-allowed",
            color: color.textFaint,
            background: "transparent",
            border: `1px solid ${color.borderRow2}`,
          }}
        >
          {copied ? "Copied" : "Copy config"}
        </button>
      </div>

      {status?.binaryPath ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".6px", color: color.textGhost, marginBottom: 6 }}>
            CONFIG FOR OTHER CLIENTS
          </div>
          <pre
            style={{
              margin: 0,
              padding: "11px 13px",
              borderRadius: 9,
              background: "#0b0d12",
              border: `1px solid ${color.borderRow2}`,
              color: color.textFaint,
              fontFamily: font.mono,
              fontSize: 11.5,
              lineHeight: 1.5,
              overflowX: "auto",
            }}
          >
            {snippetText}
          </pre>
          <div style={{ fontSize: 11, color: color.textFainter, marginTop: 7, lineHeight: 1.45, maxWidth: 560 }}>
            The server finds the target repo from the client's working directory — run your agent inside a repo and it
            operates on that repo. Set <span style={{ fontFamily: font.mono }}>LOCKE_REPO</span> to override, and{" "}
            <span style={{ fontFamily: font.mono }}>LOCKE_AGENT</span> to that agent's name (e.g. Codex) so its comments
            are labelled accordingly in Locke.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CliCard() {
  const status = useStore((s) => s.cliStatus);
  const busy = useStore((s) => s.cliBusy);
  const error = useStore((s) => s.cliError);
  const installCli = useStore((s) => s.installCli);
  const uninstallCli = useStore((s) => s.uninstallCli);

  const installed = status?.installed ?? false;

  return (
    <div
      style={{
        border: `1px solid ${color.borderRail}`,
        borderRadius: 12,
        background: color.panelBg,
        padding: "18px 18px 16px",
        marginBottom: 28,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: color.text }}>Command line</span>
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: ".4px",
            padding: "2px 6px",
            borderRadius: 5,
            color: installed ? color.teal : color.textGhost,
            background: installed ? alpha.teal(0.12) : "#141821",
            border: `1px solid ${installed ? alpha.teal(0.3) : color.borderRow2}`,
          }}
        >
          {installed ? "INSTALLED" : "NOT INSTALLED"}
        </span>
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 12.5, color: color.textFaint, lineHeight: 1.5, maxWidth: 560 }}>
        Install the{" "}
        <code style={{ fontFamily: font.mono, fontSize: "0.92em", color: color.textMuted }}>locke</code> command, then
        open any folder from your terminal — <code style={{ fontFamily: font.mono, fontSize: "0.92em", color: color.textMuted }}>locke .</code>{" "}
        or <code style={{ fontFamily: font.mono, fontSize: "0.92em", color: color.textMuted }}>locke ~/path/to/repo</code>{" "}
        — just like <code style={{ fontFamily: font.mono, fontSize: "0.92em", color: color.textMuted }}>code .</code>. If
        Locke is already open it switches to that repo.
      </p>
      {error ? <p style={{ margin: "8px 0 0", fontSize: 12, color: "#e0795f", lineHeight: 1.45 }}>{error}</p> : null}

      <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14 }}>
        <button
          onClick={installed ? uninstallCli : installCli}
          disabled={busy}
          style={{
            fontFamily: font.sans,
            fontSize: 12.5,
            fontWeight: 600,
            padding: "7px 14px",
            borderRadius: 8,
            cursor: busy ? "not-allowed" : "pointer",
            color: installed ? color.textSoft : "#0a0c11",
            background: installed ? "transparent" : busy ? "#1c212b" : color.teal,
            border: `1px solid ${installed ? color.borderRow2 : "transparent"}`,
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "Working…" : installed ? "Remove" : "Install “locke” command"}
        </button>
      </div>

      {installed && status?.path ? (
        <div style={{ fontSize: 11, color: color.textFainter, marginTop: 11, lineHeight: 1.5, maxWidth: 560 }}>
          Installed at <span style={{ fontFamily: font.mono, color: color.textFaint }}>{status.path}</span>. Make sure{" "}
          <span style={{ fontFamily: font.mono }}>~/.local/bin</span> is on your <span style={{ fontFamily: font.mono }}>PATH</span>.
        </div>
      ) : null}
    </div>
  );
}

function CallLog() {
  const log = useStore((s) => s.mcpLog);
  const loadMcpLog = useStore((s) => s.loadMcpLog);
  const clearMcpLog = useStore((s) => s.clearMcpLog);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".7px", color: color.textGhost }}>CALL LOG</span>
        <span style={{ fontSize: 11, color: color.textFainter, fontFamily: font.mono }}>{log.length}</span>
        <span style={{ flex: 1 }} />
        <HoverButton
          onClick={loadMcpLog}
          style={{
            fontFamily: font.sans,
            fontSize: 11.5,
            fontWeight: 500,
            padding: "5px 10px",
            borderRadius: 7,
            cursor: "pointer",
            color: color.textFaint,
            background: "transparent",
            border: `1px solid ${color.borderRow2}`,
          }}
          hoverStyle={{ borderColor: color.borderPopover, color: color.textSoft }}
        >
          Refresh
        </HoverButton>
        <HoverButton
          onClick={clearMcpLog}
          style={{
            fontFamily: font.sans,
            fontSize: 11.5,
            fontWeight: 500,
            padding: "5px 10px",
            borderRadius: 7,
            cursor: "pointer",
            color: color.textFaint,
            background: "transparent",
            border: `1px solid ${color.borderRow2}`,
          }}
          hoverStyle={{ borderColor: color.borderPopover, color: color.textSoft }}
        >
          Clear
        </HoverButton>
      </div>

      {log.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${color.borderRow2}`,
            borderRadius: 10,
            padding: "22px 16px",
            textAlign: "center",
            fontSize: 12.5,
            color: color.textFainter,
            lineHeight: 1.5,
          }}
        >
          No MCP calls recorded yet. When an agent uses Locke's tools, each call shows up here.
        </div>
      ) : (
        <div style={{ border: `1px solid ${color.borderRail}`, borderRadius: 11, overflow: "hidden" }}>
          {log.map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 11,
                padding: "9px 13px",
                background: i % 2 ? "transparent" : "#0e1117",
                borderTop: i === 0 ? "none" : `1px solid ${color.borderRail}`,
              }}
            >
              <span
                style={{
                  flex: "none",
                  width: 14,
                  fontSize: 12,
                  color: e.ok ? color.teal : "#e0795f",
                }}
                title={e.ok ? "ok" : e.error ?? "error"}
              >
                {e.ok ? "✓" : "✗"}
              </span>
              <span style={{ flex: "none", fontFamily: font.mono, fontSize: 12, color: color.text, minWidth: 150 }}>
                {e.tool}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: color.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.error ? <span style={{ color: "#e0795f" }}>{e.error}</span> : <span style={{ fontFamily: font.mono }}>{JSON.stringify(e.args)}</span>}
              </span>
              <span style={{ flex: "none", fontSize: 11, color: color.textFainter }} title={e.repo}>
                {e.agent} · {basename(e.repo)}
              </span>
              <span style={{ flex: "none", fontFamily: font.mono, fontSize: 11, color: color.textGhost }}>
                {e.time.replace("T", " ").replace("Z", "")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function IntegrationsView() {
  const intReturn = useStore((s) => s.intReturn);
  const backFromInt = useStore((s) => s.backFromInt);
  const loadMcpStatus = useStore((s) => s.loadMcpStatus);
  const loadMcpLog = useStore((s) => s.loadMcpLog);
  const loadCliStatus = useStore((s) => s.loadCliStatus);

  // Refresh MCP registration, CLI status, and the call log whenever the page opens.
  useEffect(() => {
    void loadMcpStatus();
    void loadMcpLog();
    void loadCliStatus();
  }, [loadMcpStatus, loadMcpLog, loadCliStatus]);

  const returnLabel = RETURN_LABEL[intReturn as View] ?? "Back";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 48px" }}>
      <HoverButton
        onClick={backFromInt}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: color.textFaint,
          fontFamily: font.sans,
          fontSize: 12,
          padding: 0,
          marginBottom: 14,
        }}
        hoverStyle={{ color: color.textMuted }}
      >
        <ChevronLeftIcon size={13} stroke={1.5} />
        {returnLabel}
      </HoverButton>

      <h1 style={{ margin: "0 0 4px", fontSize: 23, fontWeight: 700, letterSpacing: "-.5px", color: color.textBright }}>
        Integrations
      </h1>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: color.textFainter, maxWidth: 620 }}>
        Connect Locke to your agents over the Model Context Protocol, then watch what they do.
      </p>

      <div style={{ maxWidth: 760 }}>
        <McpServerCard />
        <CliCard />
        <CallLog />
      </div>
    </div>
  );
}
