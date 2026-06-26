import type { ChangedFile, WorkspaceTab } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font, alpha, runStateMeta } from "../theme/tokens.js";
import { reviewKind, reviewAccent, reviewStatusMeta } from "../lib/fleet.js";
import { fullFilePath } from "../lib/mockFleet.js";
import { AgentMark } from "../components/AgentMark.js";
import { DiffViewer } from "../components/DiffViewer.js";
import { RunTab } from "../components/RunTab.js";
import {
  ChevronLeftIcon,
  ArrowRightIcon,
  PlayIcon,
  CheckIcon,
  CheckCircleIcon,
  SpinnerIcon,
  XCircleIcon,
  FileSimpleIcon,
  FullFileIcon,
  TrashIcon,
  SidebarIcon,
} from "../components/icons.js";
import { HoverButton, HoverDiv } from "../components/primitives.js";

const stColor = (st: ChangedFile["st"]) => (st === "A" ? color.green : st === "M" ? color.amber : color.red);

function FilesRail() {
  const files = useStore((s) => s.files);
  const selectedFile = useStore((s) => s.selectedFile);
  const selectFile = useStore((s) => s.selectFile);
  const threads = useStore((s) => s.threads);
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const openFullFile = useStore((s) => s.openFullFile);
  const filesRailWidth = useStore((s) => s.filesRailWidth);
  const setFilesRailWidth = useStore((s) => s.setFilesRailWidth);
  const review = reviews.find((r) => r.id === selectedPR);
  const flagged = (path: string) => threads.some((t) => t.file === path && t.kind === "change_request" && !t.resolved);

  // Drag-resize: record the starting pointer + width, translate movement into a
  // width delta (rail is left-docked, so a rightward drag widens it).
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = filesRailWidth;
    const onMove = (ev: MouseEvent) => setFilesRailWidth(startWidth + (ev.clientX - startX));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div style={{ position: "relative", width: filesRailWidth, flex: "none", borderRight: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, overflowY: "auto", padding: "12px 9px" }}>
      <span
        onMouseDown={startResize}
        title="Drag to resize"
        style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 7, cursor: "col-resize", zIndex: 6 }}
      />
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".8px", color: color.textGhost, padding: "0 8px 9px" }}>
        FILES CHANGED
      </div>
      {files.length === 0 && <div style={{ padding: "8px", fontSize: 12, color: color.textGhost }}>No files.</div>}
      {files.map((file, i) => {
        const active = i === selectedFile;
        const c = stColor(file.st);
        return (
          <HoverDiv
            key={file.path}
            onClick={() => selectFile(i)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 9px",
              borderRadius: 7,
              cursor: "pointer",
              background: active ? color.rowActiveBg : "transparent",
              borderLeft: `2px solid ${active ? color.violet : "transparent"}`,
            }}
            hoverStyle={active ? undefined : { background: color.rowHoverBg }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                flex: "none",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontWeight: 700,
                color: c,
                background: `${c}22`,
                border: "1px solid currentColor",
              }}
            >
              {file.st}
            </span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.textCode, fontFamily: font.mono, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {file.name}
            </span>
            {flagged(file.path) && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.red, flex: "none" }} />}
            {fullFilePath(file.path) && (
              <HoverButton
                onClick={(e) => {
                  e.stopPropagation();
                  const full = fullFilePath(file.path);
                  if (full) openFullFile(full, review ? { id: review.id, branch: review.branch } : undefined);
                }}
                title="See full file"
                style={{
                  width: 21,
                  height: 21,
                  flex: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  borderRadius: 5,
                  color: color.textGhost,
                  cursor: "pointer",
                }}
                hoverStyle={{ background: "#1b2230", color: color.textDim }}
              >
                <FullFileIcon size={12} stroke={1.4} />
              </HoverButton>
            )}
          </HoverDiv>
        );
      })}
    </div>
  );
}

function DiffTab() {
  const files = useStore((s) => s.files);
  const selectedFile = useStore((s) => s.selectedFile);
  const filesRailOpen = useStore((s) => s.filesRailOpen);
  const file = files[selectedFile];
  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {filesRailOpen && <FilesRail />}
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 24px 50px" }}>
        {file ? (
          <DiffViewer file={file} />
        ) : (
          <div style={{ fontSize: 13, color: color.textGhost }}>No diff to show for this review.</div>
        )}
      </div>
    </div>
  );
}

function ChecksTab() {
  const liveChecks = useStore((s) => s.liveChecks);
  const runTests = useStore((s) => s.runTests);
  const testsRunning = useStore((s) => s.testsRunning);
  const allPass = liveChecks.length > 0 && liveChecks.every((c) => c.status === "pass");

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px 40px" }}>
      <div style={{ maxWidth: 760, border: `1px solid ${color.borderPanel}`, borderRadius: 13, overflow: "hidden", background: color.panelBg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 16px", borderBottom: `1px solid ${color.borderRow}`, background: color.panelHeaderBg }}>
          <CheckCircleIcon size={15} color={allPass ? color.green : color.textFaint} stroke={1.6} />
          <span style={{ fontSize: 13, fontWeight: 600, color: color.textSoft }}>
            {liveChecks.length === 0 ? "No checks run yet" : allPass ? "All checks passed locally" : "Checks finished"}
          </span>
          <HoverButton
            onClick={runTests}
            style={{ marginLeft: "auto", fontSize: 11.5, color: color.textFaint, background: "transparent", border: `1px solid ${color.borderPopover}`, borderRadius: 7, padding: "5px 11px", cursor: "pointer", fontFamily: font.sans }}
            hoverStyle={{ color: color.textSoft, borderColor: "#37404f" }}
          >
            {testsRunning ? "Running…" : "Re-run"}
          </HoverButton>
        </div>
        {liveChecks.length === 0 ? (
          <div style={{ padding: "16px", fontSize: 12.5, color: color.textGhost }}>Hit Re-run to execute this repo's checks.</div>
        ) : (
          liveChecks.map((c) => {
            const ico =
              c.status === "pass" ? (
                <CheckCircleIcon size={14} color={color.green} stroke={1.7} />
              ) : c.status === "running" ? (
                <SpinnerIcon size={14} color={color.teal} stroke={1.7} />
              ) : (
                <XCircleIcon size={14} color={color.red} stroke={1.7} />
              );
            const detailColor = c.status === "pass" ? color.green : c.status === "fail" ? color.red : color.textFaint;
            return (
              <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: `1px solid ${color.borderRowFaint}` }}>
                {ico}
                <span style={{ fontSize: 13, color: color.textCode, fontFamily: font.mono, flex: 1 }}>{c.label}</span>
                <span style={{ fontSize: 12, color: detailColor }}>{c.detail}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function HistoryTab() {
  const history = useStore((s) => s.history);
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px 40px" }}>
      <div style={{ maxWidth: 820 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost, marginBottom: 16 }}>
          RUN HISTORY · THIS REVIEW
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.textGhost }}>No runs recorded for this review yet.</div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 26 }}>
            <div style={{ position: "absolute", left: 8, top: 6, bottom: 18, width: 1.5, background: color.borderRail }} />
            {history.map((h) => {
              const m = runStateMeta[h.state];
              return (
                <div key={h.runId} style={{ position: "relative", marginBottom: 14 }}>
                  <span style={{ position: "absolute", left: -24, top: 16, width: 13, height: 13, borderRadius: "50%", border: `2px solid ${color.appBg}`, background: m.color }} />
                  <div style={{ border: `1px solid ${color.borderPanel}`, borderRadius: 12, background: color.panelBg, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px" }}>
                      <span style={{ width: 22, height: 22, flex: "none", borderRadius: 6, background: alpha.teal(0.12), border: `1px solid ${alpha.teal(0.3)}`, color: color.teal, fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        CL
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: color.textCode, fontWeight: 600 }}>{h.title}</div>
                        <div style={{ fontSize: 11, color: color.textFainter, marginTop: 2, fontFamily: font.mono }}>
                          {h.runId} · {h.time} · {h.duration}
                        </div>
                      </div>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: m.color }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                        {m.label === "Awaiting permission" ? "Awaiting you" : m.label}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 7, padding: "0 16px 13px", flexWrap: "wrap" }}>
                      {h.artifacts.map((art) => (
                        <span key={art} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: color.textFaint, background: color.panelHeaderBg, border: `1px solid ${color.borderRail}`, borderRadius: 7, padding: "4px 10px", fontFamily: font.mono }}>
                          <FileSimpleIcon size={10} color="currentColor" stroke={1.4} />
                          {art}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, accent, onClick, children }: { active: boolean; accent?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "10px 15px",
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? accent ?? color.violet : "transparent"}`,
        cursor: "pointer",
        fontFamily: font.sans,
        fontSize: 13,
        fontWeight: 600,
        color: active ? color.textBright : color.textFaint,
      }}
    >
      {children}
    </button>
  );
}

const badge: React.CSSProperties = {
  fontSize: 11,
  color: color.textFainter,
  background: "#13161d",
  border: `1px solid ${color.borderChip}`,
  borderRadius: 20,
  padding: "0 7px",
};

export function WorkspaceView() {
  const reviews = useStore((s) => s.reviews);
  const selectedPR = useStore((s) => s.selectedPR);
  const workspaceTab = useStore((s) => s.workspaceTab);
  const setWorkspaceTab = useStore((s) => s.setWorkspaceTab);
  const startRun = useStore((s) => s.startRun);
  const agentMode = useStore((s) => s.agentMode);
  const go = useStore((s) => s.go);
  const files = useStore((s) => s.files);
  const threads = useStore((s) => s.threads);
  const history = useStore((s) => s.history);
  const approveAndPush = useStore((s) => s.approveAndPush);
  const setVerdict = useStore((s) => s.setVerdict);
  const requestDeletePull = useStore((s) => s.requestDeletePull);
  const pending = useStore((s) => s.pending);
  const agents = useStore((s) => s.agents);
  const disabledAgents = useStore((s) => s.disabledAgents);
  const filesRailOpen = useStore((s) => s.filesRailOpen);
  const toggleFilesRail = useStore((s) => s.toggleFilesRail);

  const review = reviews.find((r) => r.id === selectedPR) ?? reviews[0];
  if (!review) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: color.textGhost, fontSize: 13 }}>
        No review selected.
      </div>
    );
  }

  const kind = reviewKind(review);
  const accent = reviewAccent(review);
  const sm = reviewStatusMeta(review);
  const flagCount = threads.filter((t) => t.kind === "change_request" && !t.resolved).length;
  const awaiting = agentMode && pending.some((p) => p.reviewId === review.id);
  const runActive = agentMode && review.runState === "running";
  // The agent loop only has work when there are open change requests to action,
  // there's an enabled agent to run, and no run is already in flight.
  const hasAgent = agents.some((a) => a.detected && !disabledAgents.includes(a.id));
  const canRunAgent = agentMode && hasAgent && flagCount > 0 && !awaiting && !runActive;
  // In reviews-only mode the Run tab is hidden; redirect a stale run tab to diff.
  const effTab: WorkspaceTab = !agentMode && workspaceTab === "run" ? "diff" : workspaceTab;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* header */}
      <div style={{ flex: "none", padding: "16px 28px 0", borderBottom: `1px solid ${color.borderSubtle}` }}>
        <HoverButton
          onClick={() => go("activity")}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, fontFamily: font.sans, fontSize: 12, padding: 0, marginBottom: 13 }}
          hoverStyle={{ color: color.textMuted }}
        >
          <ChevronLeftIcon size={13} color="currentColor" stroke={1.5} />
          Activity
        </HoverButton>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: color.textFainter, fontFamily: font.mono, marginBottom: 6 }}>#{review.id}</div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-.4px", color: color.textBright, lineHeight: 1.25 }}>
              {review.title}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 11, flexWrap: "wrap", fontSize: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 20, fontWeight: 600, color: sm.color, background: `${sm.color}1f`, border: `1px solid ${sm.color}4d` }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
                {sm.label}
              </span>
              <span style={{ fontFamily: font.mono, color: color.greenText }}>{review.branch}</span>
              <ArrowRightIcon size={13} color={color.textGhost} stroke={1.4} />
              <span style={{ fontFamily: font.mono, color: color.blue }}>{review.base}</span>
              <span style={{ color: "#3a414e" }}>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px 2px 4px", borderRadius: 20, color: accent, background: `${accent}22`, border: `1px solid ${accent}55` }}>
                <AgentMark kind={kind} label={review.initials} px={13} />
                {review.model ?? "human"}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
            {canRunAgent && (
              <HoverButton
                onClick={() => void startRun()}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 13px", background: alpha.teal(0.1), border: `1px solid ${alpha.teal(0.34)}`, borderRadius: 9, color: color.teal, fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                hoverStyle={{ background: alpha.teal(0.16) }}
              >
                <PlayIcon size={13} color="currentColor" stroke={1.5} />
                Run agent
              </HoverButton>
            )}
            <HoverButton
              onClick={() => requestDeletePull(review.id)}
              title="Delete pull request"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "9px 11px", background: "transparent", border: "1px solid #38303a", borderRadius: 9, color: color.textFaint, fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              hoverStyle={{ background: alpha.red(0.08), color: color.red, borderColor: "#4a2230" }}
            >
              <TrashIcon size={14} color="currentColor" stroke={1.5} />
            </HoverButton>
            <HoverButton
              onClick={() => setVerdict("changes")}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 13px", background: "transparent", border: "1px solid #38303a", borderRadius: 9, color: color.red, fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              hoverStyle={{ background: alpha.red(0.08) }}
            >
              Request changes
            </HoverButton>
            <HoverButton
              onClick={approveAndPush}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", background: color.violet, border: `1px solid ${color.violet}`, borderRadius: 9, color: "#fff", fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 10px rgba(123,108,255,.25)" }}
              hoverStyle={{ background: color.violetHover }}
            >
              <CheckIcon size={13} color="#fff" stroke={1.8} />
              Approve &amp; push
            </HoverButton>
          </div>
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 2, marginTop: 18 }}>
          <TabButton active={effTab === "diff"} onClick={() => setWorkspaceTab("diff")}>
            Diff <span style={badge}>{files.length}</span>
            {flagCount > 0 && (
              <span style={{ fontSize: 10, color: color.red, background: alpha.red(0.12), border: `1px solid ${alpha.red(0.3)}`, borderRadius: 20, padding: "0 6px", fontWeight: 700 }}>
                {flagCount} flagged
              </span>
            )}
          </TabButton>
          {agentMode && (
            <TabButton active={effTab === "run"} accent={color.teal} onClick={() => setWorkspaceTab("run")}>
              Run
              {awaiting && <span style={{ width: 7, height: 7, borderRadius: "50%", background: color.amber, animation: "lkpulse 1.2s infinite" }} />}
              {!awaiting && runActive && <span style={{ width: 7, height: 7, borderRadius: "50%", background: color.teal, animation: "lkpulse 1.6s infinite" }} />}
            </TabButton>
          )}
          <TabButton active={effTab === "checks"} onClick={() => setWorkspaceTab("checks")}>
            Checks <CheckIcon size={12} color={color.green} stroke={1.7} />
          </TabButton>
          <TabButton active={effTab === "history"} onClick={() => setWorkspaceTab("history")}>
            History <span style={badge}>{history.length}</span>
          </TabButton>
          {effTab === "diff" && (
            <HoverButton
              onClick={toggleFilesRail}
              title={filesRailOpen ? "Hide files changed" : "Show files changed"}
              style={{
                marginLeft: "auto",
                alignSelf: "center",
                width: 30,
                height: 30,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                background: filesRailOpen ? "#161b24" : "transparent",
                color: filesRailOpen ? color.textSoft : color.textFaint,
              }}
              hoverStyle={{ background: "#14181f" }}
            >
              <SidebarIcon size={16} stroke={1.4} />
            </HoverButton>
          )}
        </div>
      </div>

      {/* body */}
      {effTab === "diff" && <DiffTab />}
      {effTab === "run" && <RunTab review={review} />}
      {effTab === "checks" && <ChecksTab />}
      {effTab === "history" && <HistoryTab />}
    </div>
  );
}
