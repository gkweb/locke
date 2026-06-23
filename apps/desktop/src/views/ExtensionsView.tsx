import type { View } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";
import { lockeLang, ADD_LANG_SNIPPET } from "../lib/lockeLang.js";
import { ChevronLeftIcon, ChevronDownIcon, PlusIcon } from "../components/icons.js";
import { HoverButton } from "../components/primitives.js";

// The Extensions screen: the language-plugin directory. Each grammar is a
// `lockeLang.register()` call — list them, expand to see the registration
// snippet, toggle enablement (mirrored into the host so the Files viewer reacts),
// and show the "Add a language" example. Reached from Settings or the Files
// language chip.

const RETURN_LABEL: Record<string, string> = {
  activity: "Activity",
  reviews: "Reviews",
  runs: "Runs",
  agents: "Agents",
  files: "Files",
  workspace: "Review",
};

function Toggle({ on, accent, onClick }: { on: boolean; accent: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        width: 40,
        height: 22,
        flex: "none",
        borderRadius: 13,
        position: "relative",
        cursor: "pointer",
        transition: "background .15s",
        background: on ? accent : "#2a3140",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
        }}
      />
    </span>
  );
}

export function ExtensionsView() {
  const extReturn = useStore((s) => s.extReturn);
  const backFromExt = useStore((s) => s.backFromExt);
  const langExpanded = useStore((s) => s.langExpanded);
  const setLangExpanded = useStore((s) => s.setLangExpanded);
  const addLangOpen = useStore((s) => s.addLangOpen);
  const toggleAddLang = useStore((s) => s.toggleAddLang);
  const setLangEnabled = useStore((s) => s.setLangEnabled);
  const langEnabled = useStore((s) => s.langEnabled);

  const plugins = lockeLang.list();
  const returnLabel = RETURN_LABEL[extReturn as View] ?? "Back";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 48px" }}>
      <HoverButton
        onClick={backFromExt}
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
        Extensions
      </h1>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: color.textFainter, maxWidth: 620 }}>
        Grammars and tools Locke loads. Everything here is pluggable — contributors register their own with a single{" "}
        <span style={{ fontFamily: font.mono, color: color.textFaint }}>register()</span> call.
      </p>

      <div style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 13 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".7px", color: color.textGhost }}>LANGUAGES</span>
          <span style={{ fontSize: 11, color: color.textFainter, fontFamily: font.mono }}>{plugins.length}</span>
        </div>

        {plugins.map((p) => {
          const enabled = langEnabled[p.id] ?? p.enabled;
          const expanded = langExpanded === p.id;
          return (
            <div
              key={p.id}
              style={{
                border: `1px solid ${color.borderRail}`,
                borderRadius: 12,
                background: color.panelBg,
                marginBottom: 10,
                overflow: "hidden",
                opacity: enabled ? 1 : 0.6,
              }}
            >
              <button
                onClick={() => setLangExpanded(p.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  width: "100%",
                  textAlign: "left",
                  padding: "14px 16px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: font.sans,
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    flex: "none",
                    borderRadius: 9,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "-.3px",
                    background: `${p.accent}22`,
                    color: p.accent,
                    border: `1px solid ${p.accent}55`,
                  }}
                >
                  {p.abbr}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: color.text }}>{p.name}</span>
                    <span style={{ fontSize: 10.5, color: color.textGhost, fontFamily: font.mono }}>v{p.version}</span>
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: color.textFainter, fontFamily: font.mono, marginTop: 3 }}>
                    .{p.extensions.join("  .")} · {p.contributor} · {p.ruleCount} token rules
                  </span>
                </span>
                <ChevronDownIcon
                  size={14}
                  color={color.textGhost}
                  stroke={1.6}
                  style={{ flex: "none", transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                />
                <Toggle
                  on={enabled}
                  accent={p.accent}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLangEnabled(p.id, !enabled);
                  }}
                />
              </button>
              {expanded && (
                <div style={{ padding: "0 16px 15px" }}>
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: font.mono,
                      fontSize: 11,
                      lineHeight: 1.6,
                      color: color.textFaint,
                      background: color.terminalBg,
                      border: `1px solid ${color.borderRail2}`,
                      borderRadius: 9,
                      padding: "13px 14px",
                      whiteSpace: "pre-wrap",
                      overflowX: "auto",
                    }}
                  >
                    {p.snippet}
                  </pre>
                </div>
              )}
            </div>
          );
        })}

        {/* add a language */}
        <HoverButton
          onClick={toggleAddLang}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            width: "100%",
            textAlign: "left",
            padding: "14px 16px",
            border: `1px dashed ${color.borderPopover}`,
            borderRadius: 12,
            background: addLangOpen ? color.panelBg : "transparent",
            cursor: "pointer",
            fontFamily: font.sans,
            marginTop: 4,
          }}
          hoverStyle={{ borderColor: "#3a414e", background: color.panelBg }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              flex: "none",
              borderRadius: 9,
              background: "rgba(123,108,255,.12)",
              border: "1px solid rgba(123,108,255,.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: color.violetLight,
            }}
          >
            <PlusIcon size={15} stroke={1.6} />
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: color.text }}>Add a language</span>
            <span style={{ display: "block", fontSize: 11.5, color: color.textFainter, marginTop: 2 }}>
              Register your own grammar plugin
            </span>
          </span>
          <ChevronDownIcon
            size={14}
            color={color.textGhost}
            stroke={1.6}
            style={{ transform: addLangOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
          />
        </HoverButton>
        {addLangOpen && (
          <div style={{ marginTop: 10, border: `1px solid ${color.borderRail}`, borderRadius: 12, background: color.panelBg, overflow: "hidden" }}>
            <div style={{ padding: "13px 15px", borderBottom: `1px solid ${color.borderRail2}`, fontSize: 12, color: color.textFaint, lineHeight: 1.55 }}>
              A plugin is one <span style={{ fontFamily: font.mono, color: color.violetLight }}>lockeLang.register()</span> call. Token{" "}
              <span style={{ fontFamily: font.mono, color: color.textSoft }}>type</span>s resolve to theme colors — you only classify
              text, never hard-code color.
            </div>
            <pre
              style={{
                margin: 0,
                fontFamily: font.mono,
                fontSize: 11,
                lineHeight: 1.65,
                color: "#9aa3b2",
                background: color.terminalBg,
                padding: "14px 15px",
                whiteSpace: "pre-wrap",
                overflowX: "auto",
              }}
            >
              {ADD_LANG_SNIPPET}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
