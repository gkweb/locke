// Design tokens lifted from the Locke design. As of v1.4 the values are CSS
// custom properties (`--lk-*`) set per active theme by `theme/themes.ts`, so the
// whole app re-skins live without re-rendering. Component call sites are unchanged
// — they still read `color.appBg`; it just resolves to `var(--lk-appBg)` now.
// `alpha`/`tint` build translucent fills with `color-mix` so they compose with the
// variable colors. A handful of one-off semantic literals (traffic lights, warm
// gradient tones, status-pill text) stay inline in components, as in the source.

const v = (name: string) => `var(--lk-${name})`;

export const color = {
  // Surfaces (darkest → lightest)
  appBg: v("appBg"),
  titlebarBg: v("titlebarBg"),
  sidebarBg: v("sidebarBg"),
  panelBg: v("panelBg"),
  panelHeaderBg: v("panelHeaderBg"),
  inputBg: v("inputBg"),
  popoverBg: v("popoverBg"),
  navPillBg: v("navPillBg"),
  terminalBg: v("terminalBg"),
  borderPopover: v("borderPopover"),
  borderRail: v("borderRail"),
  chipBg: v("chipBg"),
  rowActiveBg: v("rowActiveBg"),
  rowHoverBg: v("rowHoverBg"),

  // Borders
  borderSubtle: v("borderSubtle"),
  borderPanel: v("borderPanel"),
  borderRow: v("borderRow"),
  borderRowFaint: v("borderRowFaint"),
  borderRowFaint2: v("borderRowFaint2"),
  borderRowFaint3: v("borderRowFaint3"),
  borderRail2: v("borderRail2"),
  borderInput: v("borderInput"),
  borderChip: v("borderChip"),
  borderChip2: v("borderChip2"),
  borderRow2: v("borderRow2"),

  // Text
  textBright: v("textBright"),
  text: v("text"),
  textCode: v("textCode"),
  textSoft: v("textSoft"),
  textMuted: v("textMuted"),
  textDim: v("textDim"),
  textFaint: v("textFaint"),
  textFainter: v("textFainter"),
  textGhost: v("textGhost"),
  lineNo: v("lineNo"),

  // Brand / accents
  violet: v("violet"),
  violetHover: v("violetHover"),
  violetLogo: v("violetLogo"),
  violetLight: v("violetLight"),
  violetSoft: v("violetSoft"),

  // Semantic
  teal: v("teal"),
  green: v("green"),
  greenText: v("greenText"),
  red: v("red"),
  amber: v("amber"),
  blue: v("blue"),
  blueRun: v("blueRun"),
  approved: v("approved"),
  codex: v("codex"),
  // Scrim behind modals — darker on light themes for contrast.
  scrim: v("scrim"),
} as const;

// Syntax highlighter palette (matches the design's hl()).
export const syntax = {
  kw: v("syn-kw"),
  str: v("syn-str"),
  com: v("syn-com"),
  num: v("syn-num"),
  fn: v("syn-fn"),
  type: v("syn-type"),
  punct: v("syn-punct"),
  id: v("syn-id"),
} as const;

export const font = {
  sans: "'Geist Sans', system-ui, sans-serif",
  mono: "'Geist Mono', ui-monospace, monospace",
} as const;

// Translucent accent fills. `color-mix` keeps these working with the CSS-variable
// colors (a plain rgba() can't reference a var's channels). `a` is 0–1 opacity.
const mix = (c: string, a: number) => `color-mix(in srgb, ${c} ${Math.round(a * 1000) / 10}%, transparent)`;
export const alpha = {
  teal: (a: number) => mix(color.teal, a),
  green: (a: number) => mix(color.green, a),
  red: (a: number) => mix(color.red, a),
  amber: (a: number) => mix(color.amber, a),
  blue: (a: number) => mix(color.blue, a),
  violet: (a: number) => mix(color.violet, a),
  violetAlt: (a: number) => mix(color.violetLight, a),
} as const;

// The design's pill convention: `color:{c}; background:{c}1f; border:1px solid {c}4d`.
// `tint(c, "1f")` previously appended a 2-digit hex alpha; now it produces an
// equivalent translucent mix so it composes with variable colors (and `c` may be a
// `var(--lk-*)` reference). The alpha argument stays the familiar 2-digit hex.
export const tint = (c: string, alphaHex: string): string => mix(c, parseInt(alphaHex, 16) / 255);

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
