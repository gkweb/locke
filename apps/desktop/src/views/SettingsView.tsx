import type { View } from "@locke/core";
import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";
import { THEMES, THEME_IDS, type ThemeId } from "../theme/themes.js";
import { ChevronLeftIcon, CheckIcon } from "../components/icons.js";
import { HoverButton, HoverDiv } from "../components/primitives.js";

// The full-screen Settings destination (v1.4). Currently home to the theme
// picker; the popover keeps the quick mode/nav toggles. New sections slot in as
// additional blocks below.

const RETURN_LABEL: Record<string, string> = {
  activity: "Activity",
  reviews: "Reviews",
  runs: "Runs",
  agents: "Agents",
  files: "Files",
  workspace: "Review",
  extensions: "Extensions",
  integrations: "Integrations",
};

// A miniature app preview painted directly from a theme's palette, so each swatch
// shows the real surfaces/accents rather than a generic color chip.
function ThemePreview({ id }: { id: ThemeId }) {
  const v = THEMES[id].vars;
  return (
    <div style={{ height: 76, borderRadius: 8, overflow: "hidden", border: `1px solid ${v.borderPanel}`, display: "flex", background: v.appBg }}>
      {/* mini sidebar */}
      <div style={{ width: 34, flex: "none", background: v.sidebarBg, borderRight: `1px solid ${v.borderSubtle}`, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ height: 5, borderRadius: 3, background: v.violet }} />
        <span style={{ height: 5, borderRadius: 3, background: v.borderInput }} />
        <span style={{ height: 5, borderRadius: 3, background: v.borderInput }} />
      </div>
      {/* mini main */}
      <div style={{ flex: 1, minWidth: 0, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ height: 6, width: "60%", borderRadius: 3, background: v.textBright }} />
        <span style={{ height: 5, width: "85%", borderRadius: 3, background: v.textFaint }} />
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          <span style={{ width: 16, height: 8, borderRadius: 4, background: v.teal }} />
          <span style={{ width: 16, height: 8, borderRadius: 4, background: v.green }} />
          <span style={{ width: 16, height: 8, borderRadius: 4, background: v.amber }} />
          <span style={{ width: 16, height: 8, borderRadius: 4, background: v.red }} />
        </div>
      </div>
    </div>
  );
}

function ThemeSection() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: color.textBright }}>Theme</h2>
      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: color.textFainter }}>
        Re-skins the whole app instantly. Your choice is saved across sessions.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {THEME_IDS.map((id) => {
          const active = id === theme;
          return (
            <HoverDiv
              key={id}
              onClick={() => setTheme(id)}
              style={{
                padding: 9,
                borderRadius: 11,
                cursor: "pointer",
                background: color.panelBg,
                border: `1px solid ${active ? color.violet : color.borderPanel}`,
                boxShadow: active ? `0 0 0 1px ${color.violet}` : "none",
              }}
              hoverStyle={active ? undefined : { borderColor: color.borderInput }}
            >
              <ThemePreview id={id} />
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, padding: "0 2px" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: color.textSoft, flex: 1 }}>{THEMES[id].label}</span>
                {active && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: color.violet }}>
                    <CheckIcon size={12} color="currentColor" stroke={2} />
                    Active
                  </span>
                )}
              </div>
            </HoverDiv>
          );
        })}
      </div>
    </section>
  );
}

export function SettingsView() {
  const settingsReturn = useStore((s) => s.settingsReturn);
  const backFromSettings = useStore((s) => s.backFromSettings);
  const returnLabel = RETURN_LABEL[settingsReturn as View] ?? "Back";

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 48px" }}>
      <HoverButton
        onClick={backFromSettings}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, fontFamily: font.sans, fontSize: 12, padding: 0, marginBottom: 14 }}
        hoverStyle={{ color: color.textMuted }}
      >
        <ChevronLeftIcon size={13} stroke={1.5} />
        {returnLabel}
      </HoverButton>

      <h1 style={{ margin: "0 0 4px", fontSize: 23, fontWeight: 700, letterSpacing: "-.5px", color: color.textBright }}>
        Settings
      </h1>
      <p style={{ margin: "0 0 24px", fontSize: 13, color: color.textFainter, maxWidth: 620 }}>
        Personalize how Locke looks and behaves.
      </p>

      <div style={{ maxWidth: 760 }}>
        <ThemeSection />
      </div>
    </div>
  );
}
