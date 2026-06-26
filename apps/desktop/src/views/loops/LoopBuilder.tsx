import { useEffect, useState } from "react";
import { useStore } from "../../state/store.js";
import { color, font, alpha, tint } from "../../theme/tokens.js";
import { riskColor } from "../../lib/loops.js";
import { BranchIcon, ChevronDownIcon, ChevronLeftIcon, CheckIcon, PlanDocIcon, PlayIcon } from "../../components/icons.js";
import { HoverButton } from "../../components/primitives.js";

// Loops · builder — seed branch, task prompt, Plan/Build mode, then audit which
// matched targets are in scope. A summary rail tallies scope + estimates.

const FIELD = "#0c0f15";

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".8px",
  color: color.textGhost,
  marginBottom: 10,
};

// A bare input that inherits the surrounding container's chrome (the field
// border/background lives on the wrapper), so inputs read like the design's
// static text rather than browser-default boxes.
const bareInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "transparent",
  border: "none",
  outline: "none",
  padding: 0,
  fontFamily: font.sans,
};

// Suggest a git-legal seed branch from the loop title (until the user edits the
// branch). The runner creates this branch fresh off base, so a new name is the
// happy path.
function slugBranch(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug ? `loops/${slug}` : "";
}

// A pragmatic subset of git's ref rules — enough to catch the names that would
// make `git worktree add -b` fail.
const isValidBranch = (b: string): boolean =>
  b !== "" &&
  !/[\s~^:?*[\]\\]/.test(b) &&
  !b.includes("..") &&
  !b.startsWith("/") &&
  !b.endsWith("/") &&
  !b.endsWith(".");

function ModeButton({
  active,
  accent,
  icon,
  title,
  desc,
  recommended,
  onClick,
}: {
  active: boolean;
  accent: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  recommended?: boolean;
  onClick: () => void;
}) {
  const activeBorder = accent === color.teal ? alpha.teal(0.4) : alpha.violet(0.45);
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        textAlign: "left",
        padding: "13px 14px",
        borderRadius: 11,
        cursor: "pointer",
        fontFamily: font.sans,
        background: active ? tint(accent, "24") : FIELD,
        border: `1px solid ${active ? activeBorder : color.borderRow}`,
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          flex: "none",
          borderRadius: 8,
          background: tint(accent, "1f"),
          border: `1px solid ${tint(accent, "55")}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: accent,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, color: color.text }}>
          {title}
          {recommended && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".4px",
                color: color.violetLight,
                background: alpha.violet(0.14),
                border: `1px solid ${alpha.violet(0.34)}`,
                borderRadius: 5,
                padding: "1px 6px",
              }}
            >
              RECOMMENDED
            </span>
          )}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: color.textFaint, lineHeight: 1.45, marginTop: 3 }}>
          {desc}
        </span>
      </span>
      <CheckIcon size={15} color={accent} stroke={1.9} style={{ flex: "none", marginTop: 2, opacity: active ? 1 : 0 }} />
    </button>
  );
}

export function LoopBuilder() {
  const draftTitle = useStore((s) => s.draftTitle);
  const draftBranch = useStore((s) => s.draftBranch);
  const draftBase = useStore((s) => s.draftBase);
  const draftPrompt = useStore((s) => s.draftPrompt);
  const draftPattern = useStore((s) => s.draftPattern);
  const draftMode = useStore((s) => s.draftMode);
  const targetSel = useStore((s) => s.targetSel);
  const loopTargets = useStore((s) => s.loopTargets);
  const loopMatched = useStore((s) => s.loopMatched);
  const loopAutoIncluded = useStore((s) => s.loopAutoIncluded);
  const repoBranches = useStore((s) => s.repoBranches);
  const setDraftMode = useStore((s) => s.setDraftMode);
  const setDraftTitle = useStore((s) => s.setDraftTitle);
  const setDraftBranch = useStore((s) => s.setDraftBranch);
  const setDraftBase = useStore((s) => s.setDraftBase);
  const setDraftPattern = useStore((s) => s.setDraftPattern);
  const setDraftPrompt = useStore((s) => s.setDraftPrompt);
  const toggleTarget = useStore((s) => s.toggleTarget);
  const startLoop = useStore((s) => s.startLoop);
  const loopToList = useStore((s) => s.loopToList);
  const loadLoopTargets = useStore((s) => s.loadLoopTargets);
  const loadRepoBranches = useStore((s) => s.loadRepoBranches);

  // Until the user edits the seed branch, keep suggesting one from the title.
  const [branchTouched, setBranchTouched] = useState(false);

  // Load the open repo's branches once for the base picker.
  useEffect(() => {
    void loadRepoBranches();
  }, [loadRepoBranches]);

  // Re-match the pattern (debounced) as the user types it. `loadLoopTargets`
  // reads the latest draft pattern and no-ops in mock mode.
  useEffect(() => {
    const id = setTimeout(() => void loadLoopTargets(), 300);
    return () => clearTimeout(id);
  }, [draftPattern, loadLoopTargets]);

  const branch = draftBranch.trim();
  const branchValid = isValidBranch(branch);
  const branchExists = branchValid && repoBranches.includes(branch);

  const canStart =
    draftTitle.trim() !== "" && branchValid && draftPrompt.trim() !== "" && draftPattern.trim() !== "";

  const targets = loopTargets.map((t) => ({
    ...t,
    included: Object.prototype.hasOwnProperty.call(targetSel, t.path) ? targetSel[t.path] : t.inc,
  }));
  const flaggedIncluded = targets.filter((t) => t.included).length;
  const selected = loopAutoIncluded + flaggedIncluded;
  const excluded = loopMatched - selected;
  const estMin = Math.round(selected / 5.8);
  const estTime = `${Math.floor(estMin / 60)}h ${estMin % 60}m`;
  const estTokens = `~${((selected * 2.9) / 1000).toFixed(1)}M`;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      {/* main column */}
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "22px 30px 40px" }}>
        <HoverButton
          onClick={loopToList}
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
          Loops
        </HoverButton>
        <input
          value={draftTitle}
          onChange={(e) => {
            setDraftTitle(e.target.value);
            // Keep the seed branch in step with the title until the user edits it.
            if (!branchTouched) setDraftBranch(slugBranch(e.target.value));
          }}
          placeholder="Name this loop"
          style={{
            ...bareInput,
            width: "100%",
            margin: "0 0 22px",
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: "-.4px",
            color: color.textBright,
          }}
        />

        {/* seed branch */}
        <div style={label}>SEED BRANCH</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 38,
              padding: "0 13px",
              background: FIELD,
              border: `1px solid ${color.borderRow}`,
              borderRadius: 9,
            }}
          >
            <BranchIcon size={13} color="#7b8494" stroke={1.4} />
            <input
              value={draftBranch}
              onChange={(e) => {
                setBranchTouched(true);
                setDraftBranch(e.target.value);
              }}
              placeholder="loops/your-branch"
              style={{ ...bareInput, fontFamily: font.mono, fontSize: 12.5, color: color.greenText }}
            />
          </div>
          <span style={{ fontSize: 11.5, color: color.textFainter, display: "flex", alignItems: "center", gap: 6 }}>
            branches off
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select
                value={draftBase}
                onChange={(e) => setDraftBase(e.target.value)}
                style={{
                  appearance: "none",
                  WebkitAppearance: "none",
                  background: FIELD,
                  border: `1px solid ${color.borderRow}`,
                  borderRadius: 7,
                  color: color.blue,
                  fontFamily: font.mono,
                  fontSize: 11.5,
                  padding: "3px 22px 3px 9px",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {/* Keep the current base selectable even if the branch list is still loading. */}
                {(repoBranches.includes(draftBase) ? repoBranches : [draftBase, ...repoBranches]).map((b) => (
                  <option key={b} value={b} style={{ background: FIELD, color: color.text }}>
                    {b}
                  </option>
                ))}
              </select>
              <ChevronDownIcon
                size={12}
                color={color.textGhost}
                stroke={1.6}
                style={{ position: "absolute", right: 7, pointerEvents: "none" }}
              />
            </span>
          </span>
        </div>
        <p style={{ margin: "0 0 6px", fontSize: 11.5, color: color.textGhost }}>
          Each item runs on its own worktree cut from this branch, then commits back to it.
        </p>
        <p style={{ margin: "0 0 22px", fontSize: 11.5, minHeight: 16 }}>
          {branch === "" ? (
            <span style={{ color: color.textGhost }} />
          ) : !branchValid ? (
            <span style={{ color: color.red }}>Not a valid branch name.</span>
          ) : branchExists ? (
            <span style={{ color: color.amber }}>
              <span style={{ fontFamily: font.mono }}>{branch}</span> already exists — the loop would reuse it
              (and fails if it's currently checked out). Use a new name for a clean run.
            </span>
          ) : (
            <span style={{ color: color.green }}>
              New branch — created from <span style={{ fontFamily: font.mono }}>{draftBase}</span>.
            </span>
          )}
        </p>

        {/* task prompt */}
        <div style={label}>TASK PROMPT</div>
        <div
          style={{
            position: "relative",
            background: FIELD,
            border: `1px solid ${color.borderRow}`,
            borderRadius: 11,
            padding: "14px 15px",
            marginBottom: 22,
          }}
        >
          <textarea
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            placeholder="Describe the task to run on every matched file. Be explicit about boundaries (touch only the matched file), what counts as done, and which checks must pass."
            rows={5}
            style={{
              ...bareInput,
              width: "100%",
              resize: "vertical",
              fontSize: 13,
              lineHeight: 1.65,
              color: color.textSoft,
            }}
          />
        </div>

        {/* mode */}
        <div style={label}>START IN</div>
        <div style={{ display: "flex", gap: 11, marginBottom: 26 }}>
          <ModeButton
            active={draftMode === "plan"}
            accent={color.violetLight}
            icon={<PlanDocIcon size={16} color={color.violetLight} stroke={1.5} />}
            title="Plan mode"
            desc="Interview to clarify scope, then a dry-run spec across every item. You approve before anything is written."
            recommended
            onClick={() => setDraftMode("plan")}
          />
          <ModeButton
            active={draftMode === "build"}
            accent={color.teal}
            icon={<PlayIcon size={16} color={color.teal} stroke={1.5} />}
            title="Build mode"
            desc="Skip planning and start executing now. Best when the task is mechanical and you trust the prompt."
            onClick={() => setDraftMode("build")}
          />
        </div>

        {/* targets */}
        <div style={{ ...label, marginBottom: 5 }}>AUDIT &amp; SELECT TARGETS</div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            fontSize: 11.5,
            color: color.textFainter,
            flexWrap: "wrap",
          }}
        >
          <input
            value={draftPattern}
            onChange={(e) => setDraftPattern(e.target.value)}
            placeholder="src/**/*.ts"
            style={{
              width: 220,
              padding: "4px 9px",
              borderRadius: 7,
              background: color.popoverBg,
              border: `1px solid ${color.borderRow}`,
              fontFamily: font.mono,
              fontSize: 11.5,
              color: color.textSoft,
              outline: "none",
            }}
          />
          <span style={{ fontFamily: font.mono, color: color.textFaint }}>{loopMatched.toLocaleString()} files match</span>
          <span style={{ color: "#3a414e" }}>·</span>
          <span style={{ color: color.green }}>{loopAutoIncluded.toLocaleString()} auto-included</span>
          <span style={{ color: "#3a414e" }}>·</span>
          <span style={{ color: color.amber }}>{targets.length} flagged for your call</span>
        </div>

        {targets.map((t) => (
          <button
            key={t.path}
            onClick={() => toggleTarget(t.path, !t.included)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              textAlign: "left",
              padding: "11px 13px",
              border: `1px solid ${color.borderRow}`,
              borderRadius: 10,
              background: FIELD,
              marginBottom: 7,
              cursor: "pointer",
              fontFamily: font.sans,
              opacity: t.included ? 1 : 0.48,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                flex: "none",
                borderRadius: 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: t.included ? color.violet : "transparent",
                border: `1px solid ${t.included ? color.violet : "#39414f"}`,
              }}
            >
              <CheckIcon size={11} color="#fff" stroke={2.1} style={{ opacity: t.included ? 1 : 0 }} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 12,
                  color: color.textCode,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {t.path}
              </span>
              {t.reason && <span style={{ fontSize: 10.5, color: color.textFainter }}>excluded · {t.reason}</span>}
            </span>
            {t.flags.length > 0 && (
              <span style={{ display: "flex", gap: 5, flex: "none" }}>
                {t.flags.map((f) => (
                  <span
                    key={f}
                    style={{
                      fontSize: 10,
                      color: color.textFaint,
                      background: color.rowHoverBg,
                      border: `1px solid ${color.borderChip}`,
                      borderRadius: 5,
                      padding: "2px 7px",
                      fontFamily: font.mono,
                    }}
                  >
                    {f}
                  </span>
                ))}
              </span>
            )}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".4px",
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: 6,
                flex: "none",
                color: riskColor[t.risk],
                background: tint(riskColor[t.risk], "1a"),
                border: `1px solid ${tint(riskColor[t.risk], "3a")}`,
              }}
            >
              {t.risk}
            </span>
            <span style={{ fontFamily: font.mono, fontSize: 10.5, color: color.textGhost, flex: "none", width: 52, textAlign: "right" }}>
              {t.loc} loc
            </span>
          </button>
        ))}
      </div>

      {/* summary rail */}
      <div
        style={{
          width: 280,
          flex: "none",
          borderLeft: `1px solid ${color.borderSubtle}`,
          background: color.sidebarBg,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 17px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".8px", color: color.textGhost, marginBottom: 14 }}>
            THIS LOOP
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: color.textBright, letterSpacing: "-1px" }}>
              {selected.toLocaleString()}
            </span>
            <span style={{ fontSize: 13, color: color.textFainter }}>/ {loopMatched.toLocaleString()}</span>
          </div>
          <div style={{ fontSize: 11.5, color: color.textFaint, marginBottom: 20 }}>
            targets in scope · {excluded.toLocaleString()} excluded
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "15px 0",
              borderTop: `1px solid ${color.borderRowFaint2}`,
              borderBottom: `1px solid ${color.borderRowFaint2}`,
              marginBottom: 18,
            }}
          >
            {[
              ["Est. agent time", estTime],
              ["Est. tokens", estTokens],
              ["Concurrency", "6 agents"],
            ].map(([k, val]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: color.textFainter }}>{k}</span>
                <span style={{ color: color.textSoft, fontFamily: font.mono }}>{val}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 11.5, color: color.textGhost, lineHeight: 1.55 }}>
            Locke runs items in parallel, commits what passes its checks, and routes anything uncertain to review.
          </p>
        </div>
        <div
          style={{
            flex: "none",
            padding: "14px 16px",
            borderTop: `1px solid ${color.borderRowFaint2}`,
            display: "flex",
            flexDirection: "column",
            gap: 9,
          }}
        >
          <HoverButton
            onClick={canStart ? startLoop : () => {}}
            title={canStart ? undefined : "Add a title, seed branch, task prompt, and a file pattern first."}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 11,
              background: color.violet,
              border: `1px solid ${color.violet}`,
              borderRadius: 9,
              color: "#fff",
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 600,
              cursor: canStart ? "pointer" : "not-allowed",
              opacity: canStart ? 1 : 0.45,
              boxShadow: "0 2px 12px rgba(123,108,255,.3)",
            }}
            hoverStyle={canStart ? { background: color.violetHover } : {}}
          >
            <PlayIcon size={14} color="#fff" stroke={1.7} />
            {draftMode === "plan" ? "Start plan run" : "Start build"}
          </HoverButton>
          <HoverButton
            onClick={loopToList}
            style={{
              width: "100%",
              padding: 9,
              background: "transparent",
              border: `1px solid ${color.borderChip2}`,
              borderRadius: 9,
              color: color.textFaint,
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
            hoverStyle={{ borderColor: "var(--lk-borderInput)", color: color.textSoft }}
          >
            Cancel
          </HoverButton>
        </div>
      </div>
    </div>
  );
}
