import { useEffect, useState } from "react";
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
  { id: "closed", label: "Closed" },
] as const;

/** "All" hides closed reviews; every other tab matches its status exactly. */
function matchesFilter(status: Review["status"], filter: string): boolean {
  if (filter === "all") return status !== "closed";
  return status === filter;
}

/** Open the OS folder picker and load the chosen git repository. */
async function chooseRepo(openRepo: (path: string) => Promise<void>) {
  if (!isTauri) return;
  const dir = await open({ directory: true, multiple: false, title: "Open a git repository" });
  if (typeof dir === "string") await openRepo(dir);
}

function Sidebar() {
  const reviews = useStore((s) => s.reviews);
  const filter = useStore((s) => s.filter);
  const setFilter = useStore((s) => s.setFilter);
  const repoPath = useStore((s) => s.repoPath);
  const openRepo = useStore((s) => s.openRepo);
  const trackHistory = useStore((s) => s.trackHistory);
  const setTrackHistory = useStore((s) => s.setTrackHistory);
  const detectedAgents = useStore((s) => s.agents);

  const pickRepo = () => chooseRepo(openRepo);

  // Coding agents that authored open reviews (unique by name).
  const agents = Array.from(new Map(reviews.filter((r) => r.isAgent).map((r) => [r.agent, r])).values());

  // Agent CLIs found on PATH (read-only status; toggles arrive in a later phase).
  const installedAgents = detectedAgents.filter((a) => a.detected);

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
        const count = reviews.filter((p) => matchesFilter(p.status, f.id)).length;
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

      {agents.length > 0 && (
        <>
          <div style={{ height: 1, background: color.borderSubtle, margin: "16px 6px" }} />
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, padding: "0 8px 8px" }}>
            AGENTS
          </div>
          {agents.map((a) => (
            <AgentRow key={a.agent} initials={a.initials} name={a.agent} />
          ))}
        </>
      )}

      {installedAgents.length > 0 && (
        <>
          <div style={{ height: 1, background: color.borderSubtle, margin: "16px 6px" }} />
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, padding: "0 8px 8px" }}>
            DETECTED AGENTS
          </div>
          {installedAgents.map((a) => (
            <div
              key={a.id}
              title={a.version ?? undefined}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", minWidth: 0 }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color.green, flex: "none" }} />
              <span style={{ fontSize: 12, color: color.text, flex: "none" }}>{a.name}</span>
              {a.version && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontFamily: font.mono,
                    color: color.textGhost,
                    marginLeft: "auto",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.version}
                </span>
              )}
            </div>
          ))}
        </>
      )}

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

      {repoPath && (
        <button
          onClick={() => setTrackHistory(!trackHistory)}
          title={
            trackHistory
              ? ".locke/ review history is committed to git"
              : ".locke/ review history is gitignored (local only)"
          }
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            width: "100%",
            marginTop: 8,
            padding: "8px 11px",
            background: "transparent",
            border: "1px solid #1c212b",
            borderRadius: 9,
            cursor: "pointer",
            fontFamily: font.sans,
            textAlign: "left",
          }}
        >
          <span style={{ flex: 1, fontSize: 11, color: color.textFainter, lineHeight: 1.3 }}>
            Track review history in git
          </span>
          <span
            style={{
              flex: "none",
              width: 30,
              height: 17,
              borderRadius: 20,
              padding: 2,
              background: trackHistory ? color.violet : "#262c38",
              display: "flex",
              justifyContent: trackHistory ? "flex-end" : "flex-start",
              transition: "background .12s",
            }}
          >
            <span style={{ width: 13, height: 13, borderRadius: "50%", background: "#fff" }} />
          </span>
        </button>
      )}
    </div>
  );
}

function AgentRow({ initials, name }: { initials: string; name: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px" }}>
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          background: "rgba(63,208,192,.12)",
          border: "1px solid rgba(63,208,192,.3)",
          color: color.teal,
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
  const repoPath = useStore((s) => s.repoPath);
  const base = useStore((s) => s.base);
  const branches = useStore((s) => s.branches);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const openRepo = useStore((s) => s.openRepo);
  const createReview = useStore((s) => s.createReview);
  const [modalOpen, setModalOpen] = useState(false);
  const filtered = reviews.filter((p) => matchesFilter(p.status, filter));
  const openCount = reviews.filter((p) => p.status !== "closed" && p.status !== "merged").length;

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
              {openCount} open
            </span>
          </div>
          <p style={{ margin: "7px 0 0", fontSize: 13, color: color.textFainter }}>
            Review what your agents built locally before it reaches{" "}
            <span style={{ fontFamily: font.mono, color: color.textFaint }}>origin/{base}</span>.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {repoPath && (
            <HoverButton
              onClick={() => setModalOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                color: "#fff",
                background: color.violet,
                border: `1px solid ${color.violet}`,
                borderRadius: 9,
                padding: "8px 13px",
                cursor: "pointer",
                fontFamily: font.sans,
              }}
              hoverStyle={{ background: color.violetHover }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
              New review
            </HoverButton>
          )}
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
      </div>
      {modalOpen && (
        <NewReviewModal
          branches={branches}
          defaultBase={base}
          onClose={() => setModalOpen(false)}
          onCreate={async (head, b) => {
            setModalOpen(false);
            await createReview(head, b);
          }}
        />
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 30px 30px" }}>
        {error && (
          <div
            style={{
              display: "flex",
              gap: 9,
              padding: "11px 14px",
              marginBottom: 14,
              background: "rgba(240,97,109,.08)",
              border: "1px solid rgba(240,97,109,.3)",
              borderRadius: 10,
              fontSize: 12.5,
              color: "#f0959d",
            }}
          >
            {error}
          </div>
        )}
        {filtered.length > 0 ? (
          filtered.map((pr) => <PRCard key={pr.id} pr={pr} />)
        ) : (
          <EmptyState
            repoOpen={!!repoPath}
            base={base}
            branchCount={branches.length}
            loading={loading}
            onOpen={() => chooseRepo(openRepo)}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState({
  repoOpen,
  base,
  branchCount,
  loading,
  onOpen,
}: {
  repoOpen: boolean;
  base: string;
  branchCount: number;
  loading: boolean;
  onOpen: () => void;
}) {
  // branchCount includes the base itself; "other" branches are the candidates.
  const otherBranches = Math.max(0, branchCount - 1);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "80px 20px",
        textAlign: "center",
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 12,
          background: "#10131a",
          border: "1px solid #242a35",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <FileSimpleIcon size={20} color={color.violetLogo} />
      </span>
      {loading ? (
        <div style={{ fontSize: 14, color: color.textFaint }}>Loading…</div>
      ) : repoOpen ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: color.text }}>No open reviews</div>
          <div style={{ fontSize: 13, color: color.textFainter, maxWidth: 380, lineHeight: 1.5 }}>
            {otherBranches > 0 ? (
              <>
                {otherBranches} other local branch{otherBranches === 1 ? "" : "es"} found, but none are ahead of{" "}
                <span style={{ fontFamily: font.mono, color: color.textFaint }}>{base}</span>. Use{" "}
                <strong style={{ color: color.textMuted }}>New review</strong> to compare against a different base.
              </>
            ) : (
              <>
                Branches ahead of <span style={{ fontFamily: font.mono, color: color.textFaint }}>{base}</span> will
                appear here. Create a branch and commit on it to start a review.
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: color.text }}>No repository open</div>
          <div style={{ fontSize: 13, color: color.textFainter, maxWidth: 360, lineHeight: 1.5 }}>
            Open a local git repository to review the branches your agents built.
          </div>
          <HoverButton
            onClick={onOpen}
            style={{
              marginTop: 4,
              fontSize: 13,
              fontWeight: 600,
              color: "#fff",
              background: color.violet,
              border: `1px solid ${color.violet}`,
              borderRadius: 9,
              padding: "9px 16px",
              cursor: "pointer",
              fontFamily: font.sans,
            }}
            hoverStyle={{ background: color.violetHover }}
          >
            Open repository…
          </HoverButton>
        </>
      )}
    </div>
  );
}

const COMBO_LIMIT = 50;

/** Type-to-filter branch picker — renders only the top matches so repos with
 *  thousands of branches stay responsive. */
function BranchCombobox({
  value,
  onChange,
  branches,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  branches: string[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setQuery(value), [value]);

  const q = query.trim().toLowerCase();
  const all = q ? branches.filter((b) => b.toLowerCase().includes(q)) : branches;
  const matches = all.slice(0, COMBO_LIMIT);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: color.appBg,
          border: "1px solid #2c333f",
          borderRadius: 8,
          padding: "9px 11px",
          color: color.text,
          fontFamily: font.mono,
          fontSize: 12.5,
          outline: "none",
        }}
      />
      {open && matches.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: "auto",
            background: "#0c0f15",
            border: "1px solid #2c333f",
            borderRadius: 8,
            zIndex: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          }}
        >
          {matches.map((b) => (
            <button
              key={b}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(b);
                setQuery(b);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 11px",
                border: "none",
                background: b === value ? "#1b2230" : "transparent",
                color: color.textCode,
                fontFamily: font.mono,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {b}
            </button>
          ))}
          {all.length > matches.length && (
            <div style={{ padding: "6px 11px", fontSize: 11, color: color.textGhost, fontFamily: font.sans }}>
              {all.length - matches.length} more — keep typing to narrow
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewReviewModal({
  branches,
  defaultBase,
  onClose,
  onCreate,
}: {
  branches: string[];
  defaultBase: string;
  onClose: () => void;
  onCreate: (head: string, base: string) => void;
}) {
  const [head, setHead] = useState("");
  const [base, setBase] = useState(branches.includes(defaultBase) ? defaultBase : "");
  const valid = branches.includes(head) && branches.includes(base) && head !== base;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          background: color.panelBg,
          border: `1px solid ${color.borderPanel}`,
          borderRadius: 14,
          padding: 20,
          fontFamily: font.sans,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: color.textBright, marginBottom: 4 }}>New review</div>
        <div style={{ fontSize: 12.5, color: color.textFainter, marginBottom: 18 }}>
          Review a branch against a base. Only branches with commits ahead of the base can be reviewed.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: color.textGhost }}>
              COMPARE (HEAD)
            </span>
            <BranchCombobox value={head} onChange={setHead} branches={branches} placeholder="Search branches…" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: color.textGhost }}>
              INTO (BASE)
            </span>
            <BranchCombobox value={base} onChange={setBase} branches={branches} placeholder="Search branches…" />
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: font.sans,
              fontSize: 12.5,
              color: "#aab2c0",
              background: "transparent",
              border: "1px solid #2c333f",
              padding: "8px 15px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => onCreate(head, base)}
            style={{
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              background: valid ? color.violet : "#2a2740",
              border: `1px solid ${valid ? color.violet : "#2a2740"}`,
              padding: "8px 15px",
              borderRadius: 8,
              cursor: valid ? "pointer" : "not-allowed",
              opacity: valid ? 1 : 0.7,
            }}
          >
            Create review
          </button>
        </div>
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
