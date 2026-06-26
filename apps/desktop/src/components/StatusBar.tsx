import type { View } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { chooseRepo } from "../lib/repo.js";
import { FolderIcon, BranchIcon, ShieldIcon, ChevronDownIcon, ChevronRightIcon, ExtensionsIcon } from "./icons.js";
import { HoverButton } from "./primitives.js";
import { NAV_ITEMS } from "../lib/nav.js";
import { lockeLang } from "../lib/lockeLang.js";

// Bottom action bar — a configurable secondary nav (destinations placed
// "bottom"), repo + branch context, live fleet counts (agent-mode only), a
// per-file language chip on the Files screen, and push state. Pill segments
// mirror the design.

const pill: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 9px",
  borderRadius: 7,
  background: color.popoverBg,
  border: `1px solid ${color.borderRow}`,
  fontFamily: font.mono,
};

// Abbreviate a home-dir path to ~ for display, matching the design.
function tildePath(p: string | null): string {
  if (!p) return "no repository";
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length).split("/").slice(1).join("/");
    return rest ? `~/${rest}` : "~";
  }
  return p;
}

function NavSeg({ active, title, onClick, children }: { active: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <HoverButton
      onClick={onClick}
      title={title}
      style={{
        width: 27,
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        background: active ? "var(--lk-borderRow2)" : "transparent",
        color: active ? color.text : "#7b8494",
      }}
      hoverStyle={active ? undefined : { background: "var(--lk-borderRowFaint)" }}
    >
      {children}
    </HoverButton>
  );
}

export function StatusBar() {
  const repoPath = useStore((s) => s.repoPath);
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const base = useStore((s) => s.base);
  const agentMode = useStore((s) => s.agentMode);
  const pending = useStore((s) => s.pending);
  const toggleApprovals = useStore((s) => s.toggleApprovals);
  const pushed = useStore((s) => s.pushed);
  const openRepo = useStore((s) => s.openRepo);
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const navPlace = useStore((s) => s.navPlace);
  const filePath = useStore((s) => s.filePath);
  const langMenuOpen = useStore((s) => s.langMenuOpen);
  const toggleLangMenu = useStore((s) => s.toggleLangMenu);
  const goExtensions = useStore((s) => s.goExtensions);
  // Subscribe so the language chip re-evaluates when a plugin is toggled.
  const langEnabled = useStore((s) => s.langEnabled);

  const selected = reviews.find((r) => r.id === selectedPR);
  const branch = selected?.branch ?? base;
  const working = reviews.filter((r) => r.runState === "running" || r.runState === "awaiting").length;
  const awaiting = pending.length;

  const navActive = (v: View) => view === v || (v === "reviews" && view === "workspace");
  const botItems = NAV_ITEMS.filter((item) => (!item.agentOnly || agentMode) && navPlace[item.key] === "bottom");

  // Files-screen language chip: the enabled plugin handling the open file's ext.
  const fileExt = (filePath.split(".").pop() || "").toLowerCase();
  const lang = view === "files" ? lockeLang.list().find((p) => langEnabled[p.id] && p.extensions.includes(fileExt)) ?? null : null;

  return (
    <div
      style={{
        height: 34,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 11px",
        background: color.titlebarBg,
        borderTop: `1px solid ${color.borderSubtle}`,
        fontSize: 11,
        position: "relative",
        zIndex: 30,
      }}
    >
      {botItems.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              gap: 2,
              padding: 2,
              background: color.navPillBg,
              border: `1px solid ${color.borderRow2}`,
              borderRadius: 8,
              flex: "none",
            }}
          >
            {botItems.map((item) => (
              <NavSeg key={item.key} active={navActive(item.key)} title={item.label} onClick={() => go(item.key)}>
                <item.Icon size={14} stroke={1.5} />
              </NavSeg>
            ))}
          </div>
          <span style={{ width: 1, height: 16, background: color.borderRow, flex: "none" }} />
        </>
      )}

      {repoPath ? (
        <span style={{ ...pill, color: color.textFaint }}>
          <FolderIcon size={11} color={color.textFainter} stroke={1.3} />
          {tildePath(repoPath)}
        </span>
      ) : (
        <HoverButton
          onClick={() => void chooseRepo(openRepo)}
          title="Open a git repository"
          style={{ ...pill, color: color.textFaint, cursor: "pointer" }}
          hoverStyle={{ borderColor: color.borderPopover, color: color.textSoft }}
        >
          <FolderIcon size={11} color={color.textFainter} stroke={1.3} />
          open repository…
        </HoverButton>
      )}
      <span style={{ ...pill, color: color.greenText }}>
        <BranchIcon size={11} color="#7b8494" stroke={1.4} />
        {branch}
      </span>

      {agentMode && working > 0 && (
        <span style={{ ...pill, color: color.teal }}>
          <span
            style={{ width: 6, height: 6, borderRadius: "50%", background: color.teal, animation: "lkpulse 2s infinite" }}
          />
          {working} {working === 1 ? "agent" : "agents"} working
        </span>
      )}

      {agentMode && awaiting > 0 && (
        <HoverButton
          onClick={toggleApprovals}
          style={{
            ...pill,
            color: color.amber,
            background: alpha.amber(0.1),
            border: `1px solid ${alpha.amber(0.3)}`,
            cursor: "pointer",
          }}
          hoverStyle={{ background: alpha.amber(0.16) }}
        >
          <span
            style={{ width: 6, height: 6, borderRadius: "50%", background: color.amber, animation: "lkpulse 1.4s infinite" }}
          />
          {awaiting} awaiting you
        </HoverButton>
      )}

      <div style={{ flex: 1 }} />

      {view === "files" && (
        <span style={{ position: "relative" }}>
          <HoverButton
            onClick={toggleLangMenu}
            title="File language"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 9px",
              borderRadius: 7,
              background: langMenuOpen ? color.popoverBg : "transparent",
              border: "none",
              fontFamily: font.sans,
              fontSize: 11,
              color: langMenuOpen ? color.textSoft : color.textFaint,
              cursor: "pointer",
            }}
            hoverStyle={{ background: color.popoverBg, color: color.textSoft }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: lang ? "var(--lk-textFainter)" : "var(--lk-lineNo)" }} />
            {lang ? lang.name : "Plain text"}
            <ChevronDownIcon
              size={9}
              stroke={1.8}
              style={{ transform: langMenuOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
            />
          </HoverButton>
          {langMenuOpen && (
            <div
              style={{
                position: "absolute",
                bottom: "calc(100% + 9px)",
                right: 0,
                width: 270,
                background: color.popoverBg,
                border: `1px solid ${color.borderPopover}`,
                borderRadius: 12,
                boxShadow: "0 18px 50px -14px rgba(0,0,0,.72)",
                overflow: "hidden",
                zIndex: 70,
              }}
            >
              {lang ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 14px", borderBottom: `1px solid ${color.borderRail}` }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        flex: "none",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9.5,
                        fontWeight: 800,
                        letterSpacing: "-.3px",
                        background: "var(--lk-borderRail)",
                        color: color.textDim,
                        border: "1px solid var(--lk-borderPopover)",
                      }}
                    >
                      {lang.abbr}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: color.text }}>{lang.name}</div>
                      <div style={{ fontSize: 11, color: color.textFainter, fontFamily: font.mono, marginTop: 2 }}>
                        v{lang.version} · {lang.contributor}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: "11px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: color.textFainter }}>Extensions</span>
                      <span style={{ color: color.textSoft, fontFamily: font.mono }}>.{lang.extensions.join("  .")}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: color.textFainter }}>Token rules</span>
                      <span style={{ color: color.textSoft, fontFamily: font.mono }}>{lang.ruleCount}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: color.textFainter }}>Status</span>
                      <span style={{ color: color.green, display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.green }} />
                        enabled
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding: "14px 14px 12px" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: color.text, marginBottom: 4 }}>Plain text</div>
                  <div style={{ fontSize: 11.5, color: color.textFainter, lineHeight: 1.5 }}>
                    No enabled extension handles <span style={{ fontFamily: font.mono, color: color.textFaint }}>.{fileExt}</span> files.
                  </div>
                </div>
              )}
              <HoverButton
                onClick={goExtensions}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "11px 14px",
                  background: color.panelHeaderBg,
                  border: "none",
                  borderTop: `1px solid ${color.borderRail}`,
                  color: color.violetLight,
                  fontFamily: font.sans,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                hoverStyle={{ background: color.panelBg }}
              >
                <ExtensionsIcon size={13} stroke={1.4} />
                Manage language extensions
                <ChevronRightIcon size={11} stroke={1.7} style={{ marginLeft: "auto" }} />
              </HoverButton>
            </div>
          )}
        </span>
      )}

      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", fontFamily: font.mono, color: color.textFainter }}>
        <ShieldIcon size={11} color={color.green} stroke={1.3} />
        {pushed ? "pushed to origin" : "nothing pushed yet"}
      </span>
      <span style={{ fontFamily: font.mono, color: "var(--lk-lineNo)" }}>Locke · local</span>
    </div>
  );
}
