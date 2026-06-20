import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";

// App-global settings (the first non-repo-keyed state in Locke). Today it hosts
// agent enable/disable; reachable from the Titlebar gear with no repo open.
//
// Opt-out semantics: every detected agent is enabled unless its id is in the
// persisted `disabledAgents` set, so a newly-installed agent defaults on. These
// toggles are a surfacing preference for the copy-prompt handoff — Locke never
// launches an agent — so disabling one only hides it from the detected list.

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        flex: "none",
        width: 34,
        height: 19,
        borderRadius: 20,
        padding: 2,
        border: "none",
        background: on ? color.violet : "#262c38",
        display: "flex",
        justifyContent: on ? "flex-end" : "flex-start",
        cursor: "pointer",
        transition: "background .12s",
      }}
    >
      <span style={{ width: 15, height: 15, borderRadius: "50%", background: "#fff" }} />
    </button>
  );
}

export function SettingsModal() {
  const agents = useStore((s) => s.agents);
  const disabledAgents = useStore((s) => s.disabledAgents);
  const toggle = useStore((s) => s.toggleAgentEnabled);
  const close = useStore((s) => s.setSettingsOpen);

  return (
    <div
      onClick={() => close(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          background: color.panelBg,
          border: `1px solid ${color.borderPanel}`,
          borderRadius: 14,
          padding: 20,
          fontFamily: font.sans,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: color.textBright, marginBottom: 4 }}>Settings</div>
        <div style={{ fontSize: 12.5, color: color.textFainter, marginBottom: 18 }}>
          Coding agents detected on your <code style={{ fontFamily: font.mono }}>PATH</code>. Enabled agents are
          offered as targets for the copy-prompt handoff. Detection never runs the binaries.
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: color.textGhost, marginBottom: 10 }}>
          AGENTS
        </div>

        {agents.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.textFaint, padding: "8px 0" }}>
            No known agent CLIs found on your PATH.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {agents.map((a) => {
              const enabled = a.detected && !disabledAgents.includes(a.id);
              return (
                <div
                  key={a.id}
                  title={a.path ?? "Not installed"}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px" }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flex: "none",
                      background: a.detected ? color.green : "#3a414e",
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: a.detected ? color.text : color.textFaint }}>{a.name}</div>
                    <div style={{ fontSize: 10.5, fontFamily: font.mono, color: color.textGhost }}>
                      {a.detected ? a.cmd : "Not installed"}
                    </div>
                  </div>
                  {a.detected ? (
                    <Toggle on={enabled} onClick={() => toggle(a.id)} />
                  ) : (
                    <span style={{ fontSize: 11, color: color.textGhost }}>—</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
          <button
            onClick={() => close(false)}
            style={{
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              background: color.violet,
              border: `1px solid ${color.violet}`,
              padding: "8px 15px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
