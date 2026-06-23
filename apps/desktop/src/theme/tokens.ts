// Design tokens lifted from the Locke design. Inline-style ports reference these
// for the recurring values; one-off literals stay inline (as in the source) to
// keep the port faithful without over-abstracting.

export const color = {
  // Surfaces (darkest → lightest)
  appBg: "#0a0c11",
  titlebarBg: "#0c0e13",
  sidebarBg: "#0b0d12",
  panelBg: "#0e1117",
  panelHeaderBg: "#0c0f15",
  inputBg: "#0a0c11",
  // Mission Control surfaces
  popoverBg: "#10131a", // popovers, pills, action-bar/side-panel inputs
  navPillBg: "#090b0f", // segmented nav container
  terminalBg: "#06070a", // run-tab mock terminal
  borderPopover: "#2a3140", // popover/tray outline
  borderRail: "#1c2330", // popover dividers, rails
  chipBg: "#12161d",
  rowActiveBg: "#1b2230",
  rowHoverBg: "#11151d",

  // Borders
  borderSubtle: "#1a1f29",
  borderPanel: "#1f2733",
  borderRow: "#1a212b",
  borderRowFaint: "#131820",
  borderRowFaint2: "#19202b", // card/table section dividers
  borderRowFaint3: "#141a22", // table row dividers
  borderRail2: "#161c25", // run-stream sub-blocks, terminal, rail insets
  borderInput: "#2c333f",
  borderChip: "#232a35",
  borderChip2: "#242a35", // action-bar approvals/settings button outline
  borderRow2: "#181d26", // nav-pill / faint card outline

  // Text
  textBright: "#f3f5f8",
  text: "#e7eaf0",
  textCode: "#dbe0e9",
  textSoft: "#cdd3de",
  textMuted: "#bcc4d2",
  textDim: "#aeb6c4",
  textFaint: "#8b94a6",
  textFainter: "#6b7484",
  textGhost: "#5f6878",
  lineNo: "#465062",

  // Brand / accents
  violet: "#7b6cff",
  violetHover: "#8b7dff",
  violetLogo: "#8b7bff",
  violetLight: "#b3a8ff",
  violetSoft: "#c0a9ff",

  // Semantic
  teal: "#3fd0c0", // agent (Claude) / sparkle / active dot
  green: "#43c46b", // additions / pass / verified
  greenText: "#a5e08a", // head branch / added code
  red: "#f0616d", // deletions / fail / request changes
  amber: "#f0b86e", // draft / numbers
  blue: "#82aaff", // base branch / info
  blueRun: "#5aa9ff", // running spinner
  approved: "#a78bff", // approved verdict pill
  codex: "#c0a9ff", // Codex agent accent
} as const;

// Syntax highlighter palette (matches the design's hl()).
export const syntax = {
  kw: "#ff7b9c",
  str: "#a5e08a",
  com: "#5e6878",
  num: "#f0b86e",
  fn: "#82aaff",
  type: "#5cd0e6",
  punct: "#7f8a9e",
  id: "#cdd3de",
} as const;

export const font = {
  sans: "'Geist Sans', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
} as const;

// rgba helpers for the design's translucent accent fills.
export const alpha = {
  teal: (a: number) => `rgba(63,208,192,${a})`,
  green: (a: number) => `rgba(67,196,107,${a})`,
  red: (a: number) => `rgba(240,97,109,${a})`,
  amber: (a: number) => `rgba(240,184,110,${a})`,
  blue: (a: number) => `rgba(130,170,255,${a})`,
  violet: (a: number) => `rgba(123,108,255,${a})`,
  violetAlt: (a: number) => `rgba(167,139,255,${a})`,
} as const;

// The design's pill convention: `color:{c}; background:{c}1f; border:1px solid {c}4d`.
// `tint(hex, "1f")` appends a 2-digit hex alpha to a 6-digit hex color.
export const tint = (hex: string, alphaHex: string): string => `${hex}${alphaHex}`;

/** Status → label + accent. Covers the design's fleet statuses and the real
 *  `ReviewStatus` lifecycle values so both the queue and the workspace agree. */
export const statusMeta: Record<string, { label: string; color: string }> = {
  ready: { label: "Ready for review", color: color.green },
  changes: { label: "Changes requested", color: color.red },
  running: { label: "Agent running", color: color.teal },
  draft: { label: "Draft", color: color.amber },
  approved: { label: "Approved", color: color.approved },
  merged: { label: "Merged", color: color.violet },
  closed: { label: "Closed", color: color.textGhost },
};

/** Agent-run state → accent (Idle/Running/Awaiting/Done/Failed). */
export const runStateMeta: Record<string, { label: string; color: string }> = {
  idle: { label: "Idle", color: color.textFainter },
  running: { label: "Running", color: color.teal },
  awaiting: { label: "Awaiting permission", color: color.amber },
  done: { label: "Done", color: color.green },
  failed: { label: "Failed", color: color.red },
};

/** Per-agent identity accent, keyed by the AgentMark `kind`. */
export const agentAccent: Record<"claude" | "codex" | "human", string> = {
  claude: color.teal,
  codex: color.codex,
  human: color.violetLight,
};

/** Per-agent accent keyed by CLI id (Agents screen chips). Falls back to violet. */
export const agentIdAccent: Record<string, string> = {
  claude: color.teal,
  codex: color.codex,
  aider: color.blue,
  cursor: color.amber,
  gemini: color.blue,
};

/** Map a two-letter author initial to an AgentMark `kind` (matches the design's
 *  `agentKind`: CX→codex, MA/human→human, everything else→claude). */
export function agentKind(initials: string): "claude" | "codex" | "human" {
  if (initials === "CX") return "codex";
  if (initials === "MA") return "human";
  return "claude";
}
