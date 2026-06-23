import { useStore } from "../state/store.js";
import { color, font, agentIdAccent } from "../theme/tokens.js";

// The agents directory — CLIs detected on PATH, with per-agent enable toggles.
// Real data: detection + the opt-out set come from the store (agents.json).
// Replaces the old SettingsModal agent list.

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        width: 42,
        height: 24,
        borderRadius: 14,
        border: "none",
        cursor: "pointer",
        position: "relative",
        flex: "none",
        transition: "background .15s",
        background: on ? color.green : "#2a3140",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
        }}
      />
    </button>
  );
}

export function AgentsView() {
  const agents = useStore((s) => s.agents);
  const disabledAgents = useStore((s) => s.disabledAgents);
  const toggle = useStore((s) => s.toggleAgentEnabled);

  return (
    <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "26px 32px 40px", background: color.appBg }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 23, fontWeight: 700, letterSpacing: "-.5px", color: color.textBright }}>
        Agents
      </h1>
      <p style={{ margin: "0 0 22px", fontSize: 13, color: color.textFainter }}>
        CLIs detected on your <span style={{ fontFamily: font.mono, color: color.textFaint }}>PATH</span>. Enable the ones
        Locke may run; disabled agents are remembered.
      </p>

      <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 11 }}>
        {agents.length === 0 ? (
          <div style={{ fontSize: 12.5, color: color.textGhost }}>No known agent CLIs found on your PATH.</div>
        ) : (
          agents.map((a) => {
            const accent = agentIdAccent[a.id] ?? color.violet;
            const enabled = a.detected && !disabledAgents.includes(a.id);
            return (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "15px 18px",
                  border: `1px solid ${color.borderPanel}`,
                  borderRadius: 13,
                  background: color.panelBg,
                }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    flex: "none",
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    color: accent,
                    background: `${accent}22`,
                    border: `1px solid ${accent}55`,
                  }}
                >
                  {(a.name.match(/\b\w/g)?.slice(0, 2).join("") ?? a.id.slice(0, 2)).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: a.detected ? color.text : color.textFaint }}>
                      {a.name}
                    </span>
                    {a.version && (
                      <span style={{ fontSize: 10.5, color: color.textGhost, fontFamily: font.mono }}>{a.version}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11.5, color: color.textFainter, fontFamily: font.mono, marginTop: 3 }}>
                    {a.detected ? a.path ?? a.cmd : "Not installed"}
                  </div>
                </div>
                {enabled && (
                  <span style={{ fontSize: 11, color: color.green, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: color.green }} />
                    enabled
                  </span>
                )}
                {a.detected ? (
                  <Switch on={enabled} onClick={() => toggle(a.id)} />
                ) : (
                  <span style={{ fontSize: 11, color: color.textGhost }}>—</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
