import { syntax } from "../theme/tokens.js";

// Lightweight TS-aware syntax highlighter, ported from the design's hl().
// Returns an HTML string of <span> tokens; render via CodeText (below).

const KW = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "await",
  "async", "import", "from", "export", "class", "extends", "new", "try", "catch", "throw",
  "typeof", "interface", "type", "enum", "public", "private", "readonly", "void", "null",
  "undefined", "true", "false", "this", "in", "of", "as", "default", "case", "switch",
  "break", "continue", "do", "yield", "static", "get", "set", "implements", "namespace",
  "string", "number", "boolean", "Promise", "Record", "Math",
]);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function highlight(code: string): string {
  let out = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    // line comment — rest of line
    if (ch === "/" && code[i + 1] === "/") {
      out += `<span style="color:${syntax.com};font-style:italic">${esc(code.slice(i))}</span>`;
      break;
    }
    // strings (", ', `)
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === "\\") j++;
        j++;
      }
      j++;
      out += `<span style="color:${syntax.str}">${esc(code.slice(i, Math.min(j, n)))}</span>`;
      i = Math.min(j, n);
      continue;
    }
    // numbers (not part of an identifier)
    if (/[0-9]/.test(ch) && !/[A-Za-z_$]/.test(code[i - 1] || "")) {
      let j = i;
      while (j < n && /[0-9._a-fxA-FoXb]/.test(code[j])) j++;
      out += `<span style="color:${syntax.num}">${esc(code.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    // identifiers / keywords / types / function calls
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      const w = code.slice(i, j);
      let col: string;
      if (KW.has(w)) col = /^[A-Z]/.test(w) ? syntax.type : syntax.kw;
      else if (/^[A-Z]/.test(w)) col = syntax.type;
      else if (code[j] === "(") col = syntax.fn;
      else col = syntax.id;
      out += `<span style="color:${col}">${esc(w)}</span>`;
      i = j;
      continue;
    }
    // punctuation
    if ("{}()[].,;:=+-*/%<>!&|?".indexOf(ch) >= 0) {
      out += `<span style="color:${syntax.punct}">${esc(ch)}</span>`;
      i++;
      continue;
    }
    out += esc(ch);
    i++;
  }
  return out;
}
