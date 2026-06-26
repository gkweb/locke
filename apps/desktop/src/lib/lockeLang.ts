// Locke — Language Extension Host (TS port of the design's locke-languages.js).
//
// A tiny pluggable syntax-highlighting registry. Each language is a plugin:
//
//   lockeLang.register({
//     id, name, extensions, contributor, version, accent, abbr,
//     block: ["/*", "*/"],             // optional multi-line comment delimiters
//     grammar: [ { type, match }, ... ] // ordered token rules (regex source strings)
//   });
//
// The host compiles each rule to a sticky regex and tokenizes a document line by
// line, first-match-wins. Token `type`s resolve to colors via the theme, so a
// plugin never hard-codes colors — it just classifies text. Drop a `register()`
// call into the app (or contribute a plugin file) and the file browser picks the
// language up automatically.
//
// This is the front-end-now language host: it ships the six built-in plugins the
// design demonstrates and powers the Files viewer + Extensions screen. It is a
// pure module (no DOM), so the same code can later back a real editor surface.

/** A single ordered token rule: classify `match` (regex source) as `type`. */
export interface GrammarRule {
  type: string;
  match: string;
}

/** A language plugin definition passed to `register()`. */
export interface LangDef {
  id: string;
  name: string;
  extensions: string[];
  abbr?: string;
  accent?: string;
  contributor?: string;
  version?: string;
  /** Multi-line comment delimiters, e.g. ["/*", "*​/"]. */
  block?: [string, string];
  grammar?: GrammarRule[];
  enabled?: boolean;
}

/** Public, serializable view of a registered plugin (for the Extensions list). */
export interface LangInfo {
  id: string;
  name: string;
  extensions: string[];
  contributor: string;
  version: string;
  accent: string;
  abbr: string;
  enabled: boolean;
  ruleCount: number;
  snippet: string;
}

/** One coloured run of text within a highlighted line. */
export interface Token {
  text: string;
  color: string;
}

/** The active plugin's identity, returned alongside highlighted lines. */
export interface HighlightPlugin {
  id: string;
  name: string;
  version: string;
  contributor: string;
  accent: string;
  abbr: string;
  extensions: string[];
}

export interface HighlightResult {
  plugin: HighlightPlugin | null;
  lines: Token[][];
}

interface CompiledRule {
  type: string;
  re: RegExp;
}

interface Plugin extends Required<Omit<LangDef, "block" | "grammar">> {
  block?: [string, string];
  grammar: GrammarRule[];
  snippet: string;
  _rules: CompiledRule[];
}

// Muted, low-contrast theme — highlighting is a gentle hint, not a rainbow.
const theme: Record<string, string> = {
  keyword: "#9990bd",
  string: "#8ba776",
  comment: "#4f5765",
  number: "#b39a74",
  function: "#7e8fb0",
  constant: "#b39a74",
  type: "#6ea79f",
  tag: "#b08389",
  attr: "#b09c74",
  operator: "#79818f",
  punct: "var(--lk-textFainter)",
  property: "#7e8fb0",
  interp: "#6ea79f",
  variable: "#b08b95",
  plain: "var(--lk-textDim)",
};

const plugins: Plugin[] = [];

function compile(p: Plugin): Plugin {
  p._rules = (p.grammar || []).map((g) => ({ type: g.type, re: new RegExp(g.match, "y") }));
  return p;
}

function buildSnippet(p: { id: string; name: string; extensions: string[]; contributor: string; block?: [string, string]; grammar?: GrammarRule[] }): string {
  return (
    "lockeLang.register({\n" +
    '  id: "' + p.id + '",\n' +
    '  name: "' + p.name + '",\n' +
    "  extensions: " + JSON.stringify(p.extensions) + ",\n" +
    '  contributor: "' + p.contributor + '",\n' +
    (p.block ? "  block: " + JSON.stringify(p.block) + ",\n" : "") +
    "  grammar: [ /* " + (p.grammar ? p.grammar.length : 0) + " token rules */ ]\n" +
    "});"
  );
}

export function register(def: LangDef): Plugin {
  const base = {
    enabled: true,
    version: "1.0.0",
    contributor: "core",
    accent: "var(--lk-violet)",
    abbr: "?",
  };
  const merged = { ...base, ...def } as Plugin;
  merged.extensions = (def.extensions || []).map((e) => String(e).replace(/^\./, "").toLowerCase());
  merged.grammar = def.grammar || [];
  merged.snippet = buildSnippet(merged);
  compile(merged);
  const i = plugins.findIndex((x) => x.id === merged.id);
  if (i >= 0) plugins[i] = merged;
  else plugins.push(merged);
  return merged;
}

export function find(ext: string): Plugin | null {
  const e = String(ext || "").replace(/^\./, "").toLowerCase();
  return plugins.find((p) => p.enabled && p.extensions.indexOf(e) >= 0) || null;
}

export function setEnabled(id: string, on: boolean): void {
  const p = plugins.find((x) => x.id === id);
  if (p) p.enabled = !!on;
}

export function list(): LangInfo[] {
  return plugins.map((p) => ({
    id: p.id,
    name: p.name,
    extensions: p.extensions.slice(),
    contributor: p.contributor,
    version: p.version,
    accent: p.accent,
    abbr: p.abbr,
    enabled: p.enabled,
    ruleCount: (p.grammar || []).length,
    snippet: p.snippet,
  }));
}

function color(type: string): string {
  return theme[type] || theme.plain;
}

interface BlockState {
  inBlock: boolean;
}

function tokenizeLine(line: string, p: Plugin, state: BlockState): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const n = line.length;
  const bo = p.block ? p.block[0] : null;
  const bc = p.block ? p.block[1] : null;

  function push(type: string, text: string): void {
    if (!text) return;
    const c = color(type);
    const last = tokens[tokens.length - 1];
    if (last && last.color === c) last.text += text;
    else tokens.push({ text, color: c });
  }

  let guard = 0;
  while (pos < n && guard++ < 5000) {
    if (state.inBlock) {
      const end = bc ? line.indexOf(bc, pos) : -1;
      if (end === -1) {
        push("comment", line.slice(pos));
        pos = n;
      } else {
        push("comment", line.slice(pos, end + bc!.length));
        pos = end + bc!.length;
        state.inBlock = false;
      }
      continue;
    }
    if (bo && line.substr(pos, bo.length) === bo) {
      const e2 = bc ? line.indexOf(bc, pos + bo.length) : -1;
      if (e2 === -1) {
        push("comment", line.slice(pos));
        pos = n;
        state.inBlock = true;
      } else {
        push("comment", line.slice(pos, e2 + bc!.length));
        pos = e2 + bc!.length;
      }
      continue;
    }
    let matched = false;
    for (let i = 0; i < p._rules.length; i++) {
      const r = p._rules[i];
      r.re.lastIndex = pos;
      const m = r.re.exec(line);
      if (m && m[0]) {
        push(r.type, m[0]);
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      push("plain", line[pos]);
      pos++;
    }
  }
  return tokens;
}

function plainLines(code: string): Token[][] {
  return String(code)
    .split("\n")
    .map((ln) => [{ text: ln, color: theme.plain }]);
}

export function highlight(code: string, ext: string): HighlightResult {
  const p = find(ext);
  if (!p) return { plugin: null, lines: plainLines(code) };
  const state: BlockState = { inBlock: false };
  const lines = String(code)
    .split("\n")
    .map((ln) => tokenizeLine(ln, p, state));
  return {
    plugin: {
      id: p.id,
      name: p.name,
      version: p.version,
      contributor: p.contributor,
      accent: p.accent,
      abbr: p.abbr,
      extensions: p.extensions.slice(),
    },
    lines,
  };
}

// ---- shared rule fragments -------------------------------------------------
const jsCore: GrammarRule[] = [
  { type: "comment", match: "\\/\\/.*" },
  { type: "string", match: '"(?:[^"\\\\]|\\\\.)*"' },
  { type: "string", match: "'(?:[^'\\\\]|\\\\.)*'" },
  { type: "string", match: "`(?:[^`\\\\]|\\\\.)*`" },
  { type: "number", match: "\\b0x[0-9a-fA-F]+\\b" },
  { type: "number", match: "\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b" },
  {
    type: "keyword",
    match:
      "\\b(?:const|let|var|function|return|if|else|for|while|do|class|extends|implements|new|await|async|import|export|from|default|typeof|instanceof|in|of|try|catch|finally|throw|switch|case|break|continue|this|super|yield|void|delete|public|private|protected|readonly|static|get|set|as|type|interface|enum|namespace|declare|keyof|abstract|override)\\b",
  },
  { type: "constant", match: "\\b(?:true|false|null|undefined|NaN|Infinity)\\b" },
  { type: "function", match: "[A-Za-z_$][\\w$]*(?=\\s*\\()" },
  { type: "type", match: "\\b[A-Z][A-Za-z0-9_]*\\b" },
  { type: "property", match: "(?<=\\.)[A-Za-z_$][\\w$]*" },
  { type: "operator", match: "[+\\-*/%=<>!&|^~?]+" },
  { type: "punct", match: "[{}()\\[\\];,.:]" },
  { type: "plain", match: "[A-Za-z_$][\\w$]*" },
  { type: "plain", match: "\\s+" },
];

const markupCore: GrammarRule[] = [
  { type: "tag", match: "<\\/?[A-Za-z][\\w:-]*" },
  { type: "string", match: '"(?:[^"\\\\]|\\\\.)*"' },
  { type: "string", match: "'(?:[^'\\\\]|\\\\.)*'" },
];

// ---- built-in language plugins --------------------------------------------
register({
  id: "typescript",
  name: "TypeScript",
  extensions: ["ts", "tsx"],
  abbr: "TS",
  accent: "var(--lk-blue)",
  contributor: "core",
  block: ["/*", "*/"],
  grammar: jsCore,
});

register({
  id: "javascript",
  name: "JavaScript",
  extensions: ["js", "jsx", "mjs"],
  abbr: "JS",
  accent: "#e8c14a",
  contributor: "core",
  block: ["/*", "*/"],
  grammar: jsCore,
});

register({
  id: "html",
  name: "HTML",
  extensions: ["html", "htm"],
  abbr: "HT",
  accent: "#f0824d",
  contributor: "core",
  block: ["<!--", "-->"],
  grammar: [
    { type: "tag", match: "<!DOCTYPE[^>]*>" },
    { type: "tag", match: "<\\/?[A-Za-z][\\w:-]*" },
    { type: "string", match: '"[^"]*"' },
    { type: "string", match: "'[^']*'" },
    { type: "attr", match: "[A-Za-z_:][\\w:.\\-]*(?=\\s*=)" },
    { type: "operator", match: "\\/?>|=" },
    { type: "plain", match: "\\s+" },
    { type: "plain", match: "[^<>\\s]+" },
  ],
});

register({
  id: "php",
  name: "PHP",
  extensions: ["php"],
  abbr: "PHP",
  accent: "var(--lk-violetLight)",
  contributor: "core",
  block: ["/*", "*/"],
  grammar: [
    { type: "comment", match: "(?:\\/\\/|#).*" },
    { type: "tag", match: "<\\?php|<\\?=|\\?>" },
    { type: "string", match: '"(?:[^"\\\\]|\\\\.)*"' },
    { type: "string", match: "'(?:[^'\\\\]|\\\\.)*'" },
    { type: "variable", match: "\\$[A-Za-z_]\\w*" },
    { type: "number", match: "\\b\\d[\\d_]*(?:\\.\\d+)?\\b" },
    {
      type: "keyword",
      match:
        "\\b(?:function|return|if|else|elseif|foreach|for|while|as|use|namespace|class|public|private|protected|static|const|new|echo|print|require|require_once|include|include_once|array|fn|match|try|catch|finally|throw|extends|implements|interface|abstract|final|global|instanceof)\\b",
    },
    { type: "constant", match: "\\b(?:true|false|null|TRUE|FALSE|NULL)\\b" },
    { type: "function", match: "[A-Za-z_]\\w*(?=\\s*\\()" },
    { type: "property", match: "(?<=->)[A-Za-z_]\\w*" },
    { type: "type", match: "\\b[A-Z]\\w*\\b" },
    { type: "operator", match: "->|=>|[+\\-*/%=<>!&|^.?:]+" },
    { type: "punct", match: "[{}()\\[\\];,]" },
    { type: "plain", match: "[A-Za-z_]\\w*" },
    { type: "plain", match: "\\s+" },
  ],
});

register({
  id: "vue",
  name: "Vue SFC",
  extensions: ["vue"],
  abbr: "VUE",
  accent: "var(--lk-green)",
  contributor: "@vuejs",
  version: "1.1.0",
  block: ["/*", "*/"],
  grammar: [{ type: "interp", match: "\\{\\{[^}]*\\}\\}" }].concat(markupCore, [
    { type: "attr", match: "[@:#]?[A-Za-z_][\\w:.\\-]*(?=\\s*=)" },
    { type: "comment", match: "\\/\\/.*" },
    { type: "number", match: "\\b\\d[\\d_]*(?:\\.\\d+)?\\b" },
    {
      type: "keyword",
      match:
        "\\b(?:const|let|var|function|return|if|else|for|import|export|from|default|computed|ref|reactive|defineProps|defineEmits|setup|lang|new|await|async|typeof|class|extends)\\b",
    },
    { type: "constant", match: "\\b(?:true|false|null|undefined)\\b" },
    { type: "function", match: "[A-Za-z_$][\\w$]*(?=\\s*\\()" },
    { type: "type", match: "\\b[A-Z][A-Za-z0-9_]*\\b" },
    { type: "property", match: "(?<=\\.)[A-Za-z_$][\\w$]*" },
    { type: "operator", match: "=>|\\/?>|[+\\-*/%=<>!&|^~?.:@]+" },
    { type: "punct", match: "[{}()\\[\\];,]" },
    { type: "plain", match: "[A-Za-z_$][\\w$]*" },
    { type: "plain", match: "\\s+" },
    { type: "plain", match: "[^<>\\s{}]+" },
  ]),
});

register({
  id: "svelte",
  name: "Svelte",
  extensions: ["svelte"],
  abbr: "SV",
  accent: "#ff5a3c",
  contributor: "@sveltejs",
  version: "2.0.0",
  block: ["/*", "*/"],
  grammar: [{ type: "interp", match: "\\{[a-zA-Z_$#/][^{}]*\\}" }].concat(markupCore, [
    { type: "attr", match: "[A-Za-z_:][\\w:.\\-]*(?=\\s*=)" },
    { type: "comment", match: "\\/\\/.*" },
    { type: "number", match: "\\b\\d[\\d_]*(?:\\.\\d+)?\\b" },
    {
      type: "keyword",
      match: "\\b(?:const|let|var|function|return|if|else|for|import|export|from|default|new|await|async|typeof|class|extends|each)\\b",
    },
    { type: "constant", match: "\\b(?:true|false|null|undefined)\\b" },
    { type: "operator", match: "\\$:|=>|\\/?>|[+\\-*/%=<>!&|^~?.:@]+" },
    { type: "function", match: "[A-Za-z_$][\\w$]*(?=\\s*\\()" },
    { type: "type", match: "\\b[A-Z][A-Za-z0-9_]*\\b" },
    { type: "punct", match: "[{}()\\[\\];,]" },
    { type: "plain", match: "[A-Za-z_$][\\w$]*" },
    { type: "plain", match: "\\s+" },
    { type: "plain", match: "[^<>\\s{}]+" },
  ]),
});

/** The "Add a language" example shown on the Extensions screen. */
export const ADD_LANG_SNIPPET =
  "lockeLang.register({\n" +
  '  id: "rust",\n' +
  '  name: "Rust",\n' +
  '  extensions: ["rs"],\n' +
  '  contributor: "@you",\n' +
  '  block: ["/*", "*/"],\n' +
  "  grammar: [\n" +
  '    { type: "keyword",  match: "\\\\b(fn|let|mut|pub|use)\\\\b" },\n' +
  '    { type: "type",     match: "\\\\b[A-Z]\\\\w*" },\n' +
  '    { type: "function", match: "\\\\w+(?=\\\\()" },\n' +
  '    { type: "string",   match: stringRule }\n' +
  "  ]\n" +
  "});";

export const lockeLang = { theme, register, find, setEnabled, list, highlight };
