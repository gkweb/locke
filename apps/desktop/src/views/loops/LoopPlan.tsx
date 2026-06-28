import type { LoopSpec, SpecStatus } from "@locke/core";
import { useStore } from "../../state/store.js";
import { isTauri } from "../../api/git.js";
import { color, font, tint } from "../../theme/tokens.js";
import { riskColor, specStatusMeta, baseName, manifestToSpecs } from "../../lib/loops.js";
import {
  MOCK_LOOP_INTERVIEW,
  MOCK_LOOP_PENDING_Q,
  MOCK_LOOP_PENDING_CHIPS,
  MOCK_LOOP_SPEC_SUMMARY,
  MOCK_LOOP_ASSUMPTIONS,
  MOCK_LOOP_SPECS,
} from "../../lib/mockFleet.js";
import { BranchIcon, ChevronLeftIcon, CheckIcon, SendIcon, StopIcon, UnifiedIcon, InfoIcon, PlusIcon, XIcon } from "../../components/icons.js";
import { HoverButton } from "../../components/primitives.js";

// Loops · plan — Plan-mode before a build. A scope interview (left) drives a
// live dry-run spec (right); the Item-specs tab lets you tune each file's plan.

const FIELD = "#0c0f15";

const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost };
const microLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: ".7px", color: color.textGhost };

function avatarStyle(who: "agent" | "you"): React.CSSProperties {
  const accent = who === "agent" ? color.teal : color.violetLight;
  const base = who === "agent" ? color.teal : color.violet;
  return {
    width: 26,
    height: 26,
    flex: "none",
    borderRadius: "50%",
    fontSize: 9.5,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: accent,
    background: tint(base, "24"),
    border: `1px solid ${tint(base, "57")}`,
  };
}

function PlanScope() {
  const setPlanTab = useStore((s) => s.setPlanTab);
  const approveLoopPlan = useStore((s) => s.approveLoopPlan);
  const planMeta = useStore((s) => s.loopPlanMeta);
  const manifest = useStore((s) => s.loopManifest);
  const specCount = useStore((s) => (s.loops.find((l) => l.id === s.selectedLoop)?.total ?? 318));

  // Real plan data comes from the strategist's scope pass; plain-vite keeps the
  // scripted mock. The interactive interview is a later phase, so in Tauri the
  // scope column is a read-only transcript of the plan the strategist drafted.
  const summary = isTauri ? planMeta?.summary ?? [] : MOCK_LOOP_SPEC_SUMMARY;
  const assumptions = isTauri ? planMeta?.assumptions ?? [] : MOCK_LOOP_ASSUMPTIONS;
  const planning = isTauri && summary.length === 0 && assumptions.length === 0;
  const realCount = isTauri ? manifest.length : specCount;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {/* interview */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 26px" }}>
          <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, ...sectionLabel }}>
              <UnifiedIcon size={13} color={color.textGhost} stroke={1.5} />
              {isTauri ? "SCOPE" : "SCOPE INTERVIEW"}
            </div>
            {isTauri ? (
              <div style={{ display: "flex", gap: 11 }}>
                <span style={avatarStyle("agent")}>CL</span>
                <div style={{ flex: 1, minWidth: 0, borderRadius: 12, padding: "12px 14px", background: color.panelBg, border: `1px solid ${color.borderRail}` }}>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: color.textSoft }}>
                    {planning
                      ? "Reading the codebase and drafting a plan across the set — assumptions and the dry-run spec will appear on the right as I go."
                      : "I drafted a plan across the set. Review the dry-run spec and assumptions on the right, tune any per-item spec, then approve to start the build."}
                  </div>
                </div>
              </div>
            ) : (
              MOCK_LOOP_INTERVIEW.map((m, i) => (
              <div key={i} style={{ display: "flex", gap: 11 }}>
                <span style={avatarStyle(m.role)}>{m.role === "agent" ? "CL" : "YO"}</span>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    borderRadius: 12,
                    padding: "12px 14px",
                    background: m.role === "agent" ? color.panelBg : "#12101c",
                    border: `1px solid ${m.role === "agent" ? color.borderRail : "#241f33"}`,
                  }}
                >
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: color.textSoft }}>{m.text}</div>
                </div>
              </div>
            ))
            )}
            {/* pending question — mock-only (the interactive interview is a later phase) */}
            {!isTauri && (
              <div style={{ display: "flex", gap: 11 }}>
                <span style={avatarStyle("agent")}>CL</span>
                <div style={{ flex: 1, minWidth: 0, borderRadius: 12, padding: "13px 15px", background: color.panelBg, border: `1px solid ${tint(color.teal, "57")}` }}>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: color.text, marginBottom: 12 }}>{MOCK_LOOP_PENDING_Q}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {MOCK_LOOP_PENDING_CHIPS.map((c) => (
                      <span
                        key={c}
                        style={{
                          padding: "6px 13px",
                          background: tint(color.teal, "1a"),
                          border: `1px solid ${tint(color.teal, "57")}`,
                          borderRadius: 20,
                          color: color.teal,
                          fontFamily: font.sans,
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* reply box — interactive interview is a later phase; disabled in Tauri */}
        <div style={{ flex: "none", padding: "14px 26px", borderTop: `1px solid ${color.borderSubtle}`, background: color.titlebarBg }}>
          <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, height: 42, padding: "0 6px 0 15px", background: color.popoverBg, border: `1px solid ${color.borderRow}`, borderRadius: 11, opacity: isTauri ? 0.5 : 1 }}>
            <span style={{ flex: 1, fontSize: 12.5, color: color.textGhost }}>
              {isTauri ? "Replying to refine the plan is coming soon — tune per-item specs for now." : "Reply, or add a constraint of your own…"}
            </span>
            <span style={{ width: 30, height: 30, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: color.violet, borderRadius: 8, color: "#fff" }}>
              <SendIcon size={14} color="#fff" stroke={1.8} />
            </span>
          </div>
        </div>
      </div>

      {/* dry-run spec rail */}
      <div style={{ width: 340, flex: "none", borderLeft: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 17px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={sectionLabel}>DRY-RUN SPEC</span>
            <span style={{ fontSize: 10, color: color.teal, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: color.teal, animation: "lkpulse 1.6s infinite" }} />
              updating
            </span>
          </div>
          <p style={{ margin: "0 0 16px", fontSize: 11.5, color: color.textFainter, lineHeight: 1.55 }}>
            What the loop will do across the set, as the strategist sees it.
          </p>
          {summary.length === 0 && (
            <p style={{ margin: "0 0 16px", fontSize: 11.5, color: color.textGhost, lineHeight: 1.55 }}>
              {planning ? "Drafting the dry-run spec…" : "No dry-run summary was produced."}
            </p>
          )}
          {summary.map((sp, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "9px 0", borderBottom: `1px solid ${color.borderRowFaint3}` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", marginTop: 5, background: sp.pend ? color.amber : color.teal }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: color.textSoft, lineHeight: 1.4 }}>{sp.label}</span>
              <span style={{ fontSize: 10.5, fontFamily: font.mono, flex: "none", textAlign: "right", color: sp.pend ? color.amber : color.textFaint }}>
                {sp.detail}
              </span>
            </div>
          ))}
          {assumptions.length > 0 && <div style={{ ...microLabel, margin: "20px 0 10px" }}>ASSUMPTIONS</div>}
          {assumptions.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 9 }}>
              <CheckIcon size={12} color={color.textGhost} stroke={1.6} style={{ flex: "none", marginTop: 2 }} />
              <span style={{ fontSize: 11.5, color: color.textFaint, lineHeight: 1.5 }}>{a}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: "none", padding: "14px 16px", borderTop: `1px solid ${color.borderRowFaint2}` }}>
          <HoverButton
            onClick={() => approveLoopPlan()}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 11, background: color.violet, border: `1px solid ${color.violet}`, borderRadius: 9, color: "#fff", fontFamily: font.sans, fontSize: 13, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 12px rgba(123,108,255,.3)" }}
            hoverStyle={{ background: color.violetHover }}
          >
            <CheckIcon size={14} color="#fff" stroke={1.8} />
            Approve plan → start build
          </HoverButton>
          <HoverButton
            onClick={() => setPlanTab("specs")}
            style={{ width: "100%", marginTop: 9, padding: 9, background: "transparent", border: `1px solid ${color.borderChip2}`, borderRadius: 9, color: color.textMuted, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            hoverStyle={{ borderColor: "var(--lk-borderInput)", color: color.textSoft }}
          >
            Review {realCount.toLocaleString()} per-item specs →
          </HoverButton>
          <p style={{ margin: "9px 0 0", fontSize: 10.5, color: color.textGhost, textAlign: "center" }}>
            {planning ? "Still speccing — you can start anyway and Locke will fill gaps in-loop." : "Review the per-item specs, or approve to start the build."}
          </p>
        </div>
      </div>
    </div>
  );
}

function PlanSpecs() {
  const selectedSpec = useStore((s) => s.selectedSpec);
  const specApproach = useStore((s) => s.specApproach);
  const specSteps = useStore((s) => s.specSteps);
  const specStatus = useStore((s) => s.specStatus);
  const selectSpec = useStore((s) => s.selectSpec);
  const setSpecApproach = useStore((s) => s.setSpecApproach);
  const toggleSpecStep = useStore((s) => s.toggleSpecStep);
  const acceptSpec = useStore((s) => s.acceptSpec);
  const excludeSpec = useStore((s) => s.excludeSpec);
  const approveLoopPlan = useStore((s) => s.approveLoopPlan);
  const loopManifest = useStore((s) => s.loopManifest);
  const selectedLoop = useStore((s) => s.selectedLoop);
  // Select an existing ref or undefined — NEVER a fresh `[]` inside the selector, or
  // zustand v5 re-renders forever (and crashes the view). Default outside.
  const liveItems = useStore((s) => (selectedLoop ? s.loopItems[selectedLoop] : undefined));
  const stopLoopItem = useStore((s) => s.stopLoopItem);

  // Real specs come from the strategist's manifest; plain-vite keeps the mock set.
  const specs = isTauri ? manifestToSpecs(loopManifest) : MOCK_LOOP_SPECS;
  const effStatus = (sp: LoopSpec): SpecStatus => specStatus[sp.id] ?? sp.status;
  // Live per-item action line ("analysing <path>"), keyed by path, from loop:item.
  const liveAction = new Map((liveItems ?? []).map((it) => [it.path, it.action]));
  const speccingNow = specs.filter((sp) => effStatus(sp) === "speccing");
  const sel: LoopSpec | undefined = specs.find((x) => x.id === selectedSpec) ?? specs[0];
  const cnt = (st: SpecStatus) => specs.filter((sp) => effStatus(sp) === st).length;
  const total = specs.length;
  const specced = cnt("specced");
  const pct = total ? Math.round((specced / total) * 100) : 0;

  if (!sel) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: color.textGhost, fontSize: 13 }}>
        The strategist hasn't produced any specs yet.
      </div>
    );
  }
  const approach = specApproach[sel.id] ?? sel.approach;

  const approachBtn = (key: string, title: string, sub: string, accent: string) => {
    const active = approach === key;
    return (
      <button
        onClick={() => setSpecApproach(sel.id, key)}
        style={{
          flex: 1,
          textAlign: "left",
          padding: "11px 13px",
          borderRadius: 10,
          cursor: "pointer",
          fontFamily: font.sans,
          color: active ? accent : color.textFaint,
          background: active ? tint(accent, "24") : FIELD,
          border: `1px solid ${active ? tint(accent, "66") : color.borderRow}`,
        }}
      >
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 10.5, opacity: 0.8, marginTop: 2 }}>{sub}</span>
      </button>
    );
  };

  const detailStatus = specStatusMeta[effStatus(sel)];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* spec list */}
        <div style={{ width: 316, flex: "none", borderRight: `1px solid ${color.borderSubtle}`, background: color.sidebarBg, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: "none", padding: "14px 16px 13px", borderBottom: `1px solid ${color.borderRail2}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={sectionLabel}>PER-ITEM SPECS</span>
              <span style={{ fontSize: 10.5, color: color.textFainter, fontFamily: font.mono }}>{pct}%</span>
            </div>
            <div style={{ height: 5, borderRadius: 4, background: color.borderSubtle, overflow: "hidden", marginBottom: 6 }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: color.teal }} />
            </div>
            <div style={{ fontSize: 10.5, color: color.textFainter, fontFamily: font.mono }}>
              {specced.toLocaleString()} of {total.toLocaleString()} items specced
            </div>
          </div>
          {speccingNow.length > 0 && (
            <div style={{ flex: "none", padding: "10px 14px", borderBottom: `1px solid ${color.borderRail2}`, background: tint(color.violet, "12") }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.violetLight, animation: "lkpulse 1.2s infinite" }} />
                <span style={{ ...microLabel, color: color.violetLight }}>
                  SPECCING {speccingNow.length > 1 ? `· ${speccingNow.length}` : ""}
                </span>
              </div>
              {speccingNow.slice(0, 4).map((sp) => (
                <div key={sp.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                  <button
                    onClick={() => selectSpec(sp.id)}
                    style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: font.mono }}
                  >
                    <span style={{ fontSize: 11.5, color: color.textCode }}>{baseName(sp.path)}</span>
                    <span style={{ fontSize: 10.5, color: color.textFainter, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {liveAction.get(sp.path) ?? "analysing…"}
                    </span>
                  </button>
                  {isTauri && (
                    <HoverButton
                      onClick={() => stopLoopItem(sp.path)}
                      title="Stop speccing this item (stays in scope, unspecced; the run continues)"
                      style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: "transparent", border: `1px solid ${tint(color.red, "3a")}`, color: color.red, cursor: "pointer" }}
                      hoverStyle={{ background: tint(color.red, "1a") }}
                    >
                      <XIcon size={11} stroke={1.9} />
                    </HoverButton>
                  )}
                </div>
              ))}
              {speccingNow.length > 4 && (
                <span style={{ fontSize: 10.5, color: color.textGhost }}>+{speccingNow.length - 4} more</span>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 14px" }}>
            {specs.map((sp) => {
              const st = effStatus(sp);
              const m = specStatusMeta[st];
              const active = sp.id === selectedSpec;
              const excluded = st === "excluded";
              return (
                <button
                  key={sp.id}
                  onClick={() => selectSpec(sp.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 10px",
                    borderRadius: 9,
                    cursor: "pointer",
                    fontFamily: font.sans,
                    marginBottom: 3,
                    background: active ? "#161d2a" : "transparent",
                    border: `1px solid ${active ? "#2a3344" : "transparent"}`,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: m.color, animation: st === "speccing" ? "lkpulse 1.2s infinite" : undefined }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: font.mono,
                      fontSize: 11.5,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: excluded ? color.textGhost : color.textCode,
                      textDecoration: excluded ? "line-through" : undefined,
                    }}
                  >
                    {baseName(sp.path)}
                  </span>
                  <span style={{ fontSize: 10, flex: "none", color: m.color }}>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* spec detail */}
        <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 28px 30px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 20 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: font.mono, fontSize: 14, color: color.textBright }}>{sel.path}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".4px",
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: 6,
                    color: riskColor[sel.risk],
                    background: tint(riskColor[sel.risk], "1a"),
                    border: `1px solid ${tint(riskColor[sel.risk], "3a")}`,
                  }}
                >
                  {sel.risk}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, fontSize: 11.5 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: font.mono, color: color.greenText }}>
                  <BranchIcon size={11} color="#7b8494" stroke={1.4} />
                  {useStore.getState().loops.find((l) => l.id === useStore.getState().selectedLoop)?.branch ?? ""}
                </span>
                <span style={{ color: "#3a414e" }}>·</span>
                <span style={{ fontWeight: 600, color: detailStatus.color }}>{detailStatus.label}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flex: "none" }}>
              <HoverButton
                onClick={() => excludeSpec(sel.id)}
                style={{ padding: "7px 12px", background: "transparent", border: `1px solid ${color.borderChip2}`, borderRadius: 8, color: color.textMuted, fontFamily: font.sans, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                hoverStyle={{ borderColor: "var(--lk-borderInput)" }}
              >
                Exclude item
              </HoverButton>
              <HoverButton
                onClick={() => acceptSpec(sel.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: tint(color.teal, "1f"), border: `1px solid ${tint(color.teal, "66")}`, borderRadius: 8, color: color.teal, fontFamily: font.sans, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                hoverStyle={{ background: tint(color.teal, "33") }}
              >
                <CheckIcon size={12} stroke={1.9} />
                Accept spec
              </HoverButton>
            </div>
          </div>

          <div style={{ ...microLabel, marginBottom: 9 }}>WHAT LOCKE DETECTED</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 22 }}>
            {sel.detected.map((d) => (
              <span key={d} style={{ fontSize: 11, color: color.textFaint, background: color.panelBg, border: `1px solid ${color.borderRail}`, borderRadius: 7, padding: "4px 10px", fontFamily: font.mono }}>
                {d}
              </span>
            ))}
          </div>

          <div style={{ ...microLabel, marginBottom: 9 }}>APPROACH</div>
          <div style={{ display: "flex", gap: 9, marginBottom: 22, maxWidth: 520 }}>
            {approachBtn("script-setup", "script setup", "Composition API, single-file", color.teal)}
            {approachBtn("options-api", "Options API", "Keep structure, fix breaks only", color.violetLight)}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
            <span style={microLabel}>PLANNED EDITS</span>
            <span style={{ fontSize: 10.5, color: color.textFainter }}>toggle any step the loop should skip on this item</span>
          </div>
          <div style={{ maxWidth: 640, marginBottom: 22 }}>
            {sel.steps.map((st) => {
              const on = specSteps[sel.id]?.[st.k] ?? true;
              return (
                <button
                  key={st.k}
                  onClick={() => toggleSpecStep(sel.id, st.k)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 11, width: "100%", textAlign: "left", padding: "11px 13px", border: `1px solid ${color.borderRow}`, borderRadius: 10, background: FIELD, marginBottom: 7, cursor: "pointer", fontFamily: font.sans }}
                >
                  <span style={{ width: 18, height: 18, flex: "none", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1, background: on ? color.violet : "transparent", border: `1px solid ${on ? color.violet : "#39414f"}` }}>
                    <CheckIcon size={11} color="#fff" stroke={2.1} style={{ opacity: on ? 1 : 0 }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5, color: on ? color.textSoft : color.textGhost, textDecoration: on ? undefined : "line-through" }}>
                    {st.text}
                  </span>
                </button>
              );
            })}
            <button style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 13px", border: `1px dashed ${color.borderChip2}`, borderRadius: 10, background: "transparent", color: color.textFainter, fontFamily: font.sans, fontSize: 12, cursor: "pointer" }}>
              <PlusIcon size={13} stroke={1.6} />
              Add a step for this item
            </button>
          </div>

          <div style={{ ...microLabel, marginBottom: 9 }}>PER-ITEM INSTRUCTION</div>
          <div style={{ maxWidth: 640, border: `1px solid ${color.borderRow}`, borderRadius: 10, background: FIELD, padding: "12px 13px", marginBottom: 22 }}>
            {sel.note && (
              <div style={{ display: "flex", gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${color.borderRail2}` }}>
                <InfoIcon size={13} color={color.amber} stroke={1.6} style={{ flex: "none", marginTop: 2 }} />
                <span style={{ fontSize: 12, color: "#caa46a", lineHeight: 1.55 }}>{sel.note}</span>
              </div>
            )}
            <span style={{ fontSize: 12, color: color.textGhost }}>Add an instruction just for this item…</span>
          </div>

          <div style={{ ...microLabel, marginBottom: 9 }}>TESTS THAT MUST PASS</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {sel.tests.map((t) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: color.textFaint, background: color.panelBg, border: `1px solid ${color.borderRail}`, borderRadius: 7, padding: "4px 10px", fontFamily: font.mono }}>
                <CheckIcon size={11} color={color.green} stroke={1.6} />
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* footer */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "13px 26px", borderTop: `1px solid ${color.borderSubtle}`, background: color.titlebarBg }}>
        <span style={{ fontSize: 12, color: color.textFaint }}>
          {cnt("specced")} specced · {cnt("review")} need your call · {cnt("queued")} queued in this view — tweak any before you start
        </span>
        <HoverButton
          onClick={() => approveLoopPlan()}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: color.violet, border: `1px solid ${color.violet}`, borderRadius: 9, color: "#fff", fontFamily: font.sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 12px rgba(123,108,255,.3)" }}
          hoverStyle={{ background: color.violetHover }}
        >
          <CheckIcon size={14} color="#fff" stroke={1.8} />
          Approve all specs → start build
        </HoverButton>
      </div>
    </div>
  );
}

export function LoopPlan() {
  const loops = useStore((s) => s.loops);
  const selectedLoop = useStore((s) => s.selectedLoop);
  const planTab = useStore((s) => s.planTab);
  const setPlanTab = useStore((s) => s.setPlanTab);
  const loopToList = useStore((s) => s.loopToList);
  const stopLoop = useStore((s) => s.stopLoop);
  const manifestLen = useStore((s) => s.loopManifest.length);

  const loop = loops.find((l) => l.id === selectedLoop) ?? loops[0];
  const title = loop?.title ?? "Loop";
  const count = isTauri ? loop?.total || manifestLen : loop?.total || 318;

  const tabBtn = (key: "scope" | "specs", label: string, badge?: string) => {
    const active = planTab === key;
    return (
      <button
        onClick={() => setPlanTab(key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: font.sans,
          fontSize: 11.5,
          fontWeight: 600,
          background: active ? "#222c3c" : "transparent",
          color: active ? color.text : "#7b8494",
        }}
      >
        {label}
        {badge && (
          <span style={{ fontSize: 10, color: color.textFainter, background: color.chipBg, border: `1px solid ${color.borderChip}`, borderRadius: 20, padding: "0 6px" }}>
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* header strip */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "14px 28px", borderBottom: `1px solid ${color.borderSubtle}`, background: color.titlebarBg }}>
        <HoverButton
          onClick={loopToList}
          style={{ display: "flex", alignItems: "center", background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, padding: 0, flex: "none" }}
          hoverStyle={{ color: color.textMuted }}
        >
          <ChevronLeftIcon size={13} stroke={1.5} />
        </HoverButton>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".5px", color: color.violetLight, background: tint(color.violet, "24"), border: `1px solid ${tint(color.violet, "57")}`, borderRadius: 6, padding: "3px 9px", flex: "none" }}>
          PLAN MODE
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: color.textBright, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <span style={{ fontSize: 12, color: color.textFainter, flex: "none" }}>· planning {count.toLocaleString()} targets</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
          <div style={{ display: "flex", gap: 2, padding: 3, background: color.navPillBg, border: `1px solid ${color.borderRow}`, borderRadius: 9 }}>
            {tabBtn("scope", "Scope")}
            {tabBtn("specs", "Item specs", count.toLocaleString())}
          </div>
          <HoverButton
            onClick={stopLoop}
            style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", background: "transparent", border: `1px solid ${tint(color.red, "4d")}`, borderRadius: 8, color: color.red, fontFamily: font.sans, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            hoverStyle={{ background: tint(color.red, "16") }}
          >
            <StopIcon size={11} stroke={1.8} />
            Stop plan
          </HoverButton>
        </div>
      </div>

      {planTab === "scope" ? <PlanScope /> : <PlanSpecs />}
    </div>
  );
}
