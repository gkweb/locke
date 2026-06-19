import { open } from "@tauri-apps/plugin-dialog";
import type { Review } from "@locke/core";
import { useStore } from "../state/store.js";
import { isTauri, repoBasename } from "../api/git.js";
import { color, font } from "../theme/tokens.js";
import { statusMeta, agentChipStyle, addStr, delStr } from "../lib/meta.js";
import { HoverButton, HoverDiv } from "../components/primitives.js";
import {
  FileSimpleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SearchIcon,
  BranchIcon,
  CheckCircleIcon,
  XCircleIcon,
  SpinnerIcon,
  CommentIcon,
  ShieldIcon,
} from "../components/icons.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "draft", label: "Draft" },
  { id: "changes", label: "Changes requested" },
] as const;

function Sidebar() {
  const reviews = useStore((s) => s.reviews);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const repoPath = useStore((s) => s.repoPath);
  const openRepo = useStore((s) => s.openRepo);
  const trackHistory = useStore((s) => s.trackHistory);
  const setTrackHistory = useStore((s) => s.setTrackHistory);

  const pickRepo = async () => {
    if (!isTauri) return;
    const dir = await open({ directory: true, multiple: false, title: "Open a git repository" });
    if (typeof dir === "string") await openRepo(dir);
  };

  return (
    <div
      style={{
        width: 248,
        flex: "none",
        background: color.sidebarBg,
        borderRight: `1px solid ${color.borderSubtle}`,
        display: "flex",
        flexDirection: "column",
        padding: "14px 12px",
      }}
    >
      <HoverButton
        onClick={pickRepo}
        title="Open a git repository"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "9px 11px",
          background: "#10131a",
          border: "1px solid #242a35",
          borderRadius: 9,
          cursor: "pointer",
          marginBottom: 18,
          fontFamily: font.sans,
        }}
        hoverStyle={{ borderColor: "#2e3645" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileSimpleIcon size={14} color={color.violetLogo} />
          <span style={{ fontSize: 12.5, color: color.text, fontWeight: 600 }}>{repoBasename(repoPath)}</span>
        </span>
        <ChevronDownIcon size={12} color={color.textFainter} />
      </HoverButton>

      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, padding: "0 8px 8px" }}>
        REVIEW QUEUE
      </div>
      {FILTERS.map((f) => {
        const count = f.id === "all" ? reviews.length : reviews.filter((p) => p.status === f.id).length;
        const active = filter === f.id;
        return (
          <HoverButton
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "7px 10px",
              border: "none",
              background: active ? "#12161d" : "transparent",
              borderRadius: 7,
              cursor: "pointer",
              fontFamily: font.sans,
              marginBottom: 1,
            }}
            hoverStyle={{ background: "#12161d" }}
          >
            <span style={{ fontSize: 12.5, color: color.textMuted }}>{f.label}</span>
            <span
              style={{
                fontSize: 11,
                color: color.textFainter,
                background: "#13161d",
                border: "1px solid #232a35",
                borderRadius: 20,
                padding: "0 7px",
                minWidth: 20,
                textAlign: "center",
              }}
            >
              {count}
            </span>
          </HoverButton>
        );
      })}

      <div style={{ height: 1, background: color.borderSubtle, margin: "16px 6px" }} />
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, padding: "0 8px 8px" }}>
        AGENTS
      </div>
      <AgentRow initials="CL" name="Claude" tint="teal" />
      <AgentRow initials="CX" name="Codex" tint="violet" />

      <div style={{ flex: 1 }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 11px",
          background: "#10131a",
          border: "1px solid #1c212b",
          borderRadius: 9,
          fontSize: 11,
          color: color.textFainter,
        }}
      >
        <ShieldIcon size={13} color={color.green} />
        Working on a local copy
      </div>
    </div>
  );
}

function AgentRow({ initials, name, tint }: { initials: string; name: string; tint: "teal" | "violet" }) {
  const isTeal = tint === "teal";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px" }}>
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          background: isTeal ? "rgba(63,208,192,.12)" : "rgba(167,139,255,.13)",
          border: `1px solid ${isTeal ? "rgba(63,208,192,.3)" : "rgba(167,139,255,.3)"}`,
          color: isTeal ? color.teal : color.violetSoft,
          fontSize: 10,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {initials}
      </span>
      <span style={{ fontSize: 12.5, color: color.textMuted, flex: 1 }}>{name}</span>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color.teal }} />
    </div>
  );
}

function PRCard({ pr }: { pr: Review }) {
  const openPR = useStore((s) => s.openPR);
  const sm = statusMeta(pr.status);
  const checkCol = pr.checks === "pass" ? color.green : pr.checks === "fail" ? color.red : color.blueRun;

  return (
    <HoverDiv
      onClick={() => openPR(pr.id)}
      style={{
        display: "flex",
        gap: 15,
        padding: "17px 19px",
        border: "1px solid #1c212b",
        borderRadius: 13,
        background: color.panelBg,
        marginBottom: 12,
        cursor: "pointer",
        transition: "border-color .12s, background .12s",
      }}
      hoverStyle={{ borderColor: "#2e3645", background: "#11151d" }}
    >
      <span style={{ width: 9, height: 9, borderRadius: "50%", marginTop: 5, flex: "none", background: sm.col }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: "#eef1f5", letterSpacing: "-.2px" }}>{pr.title}</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            flexWrap: "wrap",
            fontSize: 11.5,
            color: color.textFainter,
          }}
        >
          <span style={{ fontFamily: font.mono, color: "#7b8494" }}>#{pr.id}</span>
          <span style={{ color: "#3a414e" }}>·</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <BranchIcon size={11} color={color.greenText} />
            <span style={{ fontFamily: font.mono, color: color.textFaint }}>{pr.branch}</span>
          </span>
          <span style={{ color: "#3a414e" }}>→</span>
          <span style={{ fontFamily: font.mono, color: color.blue }}>{pr.base}</span>
          <span style={{ color: "#3a414e" }}>·</span>
          <span>opened {pr.time} by</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "1px 8px 1px 3px",
              borderRadius: 20,
              ...agentChipStyle(pr.isAgent),
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: color.panelBg,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8.5,
                fontWeight: 700,
              }}
            >
              {pr.initials}
            </span>
            {pr.agent}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", color: checkCol }}>
          {pr.checks === "pass" && <CheckCircleIcon size={13} color="currentColor" />}
          {pr.checks === "running" && <SpinnerIcon size={13} color="currentColor" />}
          {pr.checks === "fail" && <XCircleIcon size={13} color="currentColor" />}
        </span>
        {pr.comments > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#7b8494" }}>
            <CommentIcon size={13} color="#7b8494" />
            {pr.comments}
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: font.mono, fontSize: 11.5 }}>
          <span style={{ color: color.green }}>{addStr(pr.add)}</span>
          <span style={{ color: color.red }}>{delStr(pr.del)}</span>
        </span>
        <ChevronRightIcon size={15} color="#454d5b" />
      </div>
    </HoverDiv>
  );
}

function Main() {
  const reviews = useStore((s) => s.reviews);
  const filter = useStore((s) => s.filter);
  const filtered = reviews.filter((p) => filter === "all" || p.status === filter);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: color.appBg }}>
      <div
        style={{
          padding: "24px 30px 18px",
          borderBottom: `1px solid ${color.borderSubtle}`,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-.4px", color: color.textBright }}>
              Pull Requests
            </h1>
            <span
              style={{
                fontSize: 12,
                color: color.textFaint,
                background: "#12161d",
                border: "1px solid #232a35",
                borderRadius: 20,
                padding: "2px 10px",
              }}
            >
              {reviews.length} open
            </span>
          </div>
          <p style={{ margin: "7px 0 0", fontSize: 13, color: color.textFainter }}>
            Review what your agents built locally before it reaches{" "}
            <span style={{ fontFamily: font.mono, color: color.textFaint }}>origin/main</span>.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: color.panelBg,
            border: "1px solid #232a35",
            borderRadius: 9,
            padding: "7px 11px",
            width: 240,
          }}
        >
          <SearchIcon size={14} color={color.textGhost} />
          <span style={{ fontSize: 12.5, color: color.textGhost }}>Search pull requests</span>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 30px 30px" }}>
        {filtered.map((pr) => (
          <PRCard key={pr.id} pr={pr} />
        ))}
      </div>
    </div>
  );
}

export function ListView() {
  return (
    <>
      <Sidebar />
      <Main />
    </>
  );
}
