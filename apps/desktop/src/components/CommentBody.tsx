import { Fragment, type CSSProperties, type ReactNode } from "react";
import { color, font } from "../theme/tokens.js";

// Lightweight markdown for agent-authored bodies (comment replies, run-stream
// narration, and plan-review cards). Agents reply in markdown — headings, bullet
// lists, fenced/inline `code`, **bold**, *italic* — which would otherwise render as
// raw `#`/`*` markers run together on one line. Dependency-free; handles the common
// subset agents actually emit.

type Seg = { type: "code"; content: string } | { type: "text"; content: string };

// A fenced block: ```lang? then an optional separator then content up to ```.
// `\w*` stops the language token at the first space/newline, so it works whether
// the fence is on its own line or written inline (as agents sometimes do).
const FENCE = /```(\w*)[ \t]*\n?([\s\S]*?)```/g;
// Inline spans, tried left-to-right: `code`, then **bold**, then *italic*. Italic
// requires a non-space after the opening `*` (and is lazy) so it doesn't fire on
// arithmetic (`a * b`) or eat into bold.
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*\n]*?\*)/g;

const inlineCode = {
  fontFamily: font.mono,
  fontSize: "0.92em",
  background: "var(--lk-sidebarBg)",
  border: "1px solid var(--lk-borderChip)",
  borderRadius: 4,
  padding: "0.5px 4px",
  color: "var(--lk-textSoft)",
  wordBreak: "break-word" as const,
};

const codeBlock = {
  margin: "6px 0 4px",
  padding: "9px 11px",
  background: "var(--lk-sidebarBg)",
  border: "1px solid var(--lk-borderChip)",
  borderRadius: 7,
  overflowX: "auto" as const,
  fontFamily: font.mono,
  fontSize: 11.5,
  lineHeight: 1.5,
  color: "var(--lk-textSoft)",
  whiteSpace: "pre" as const,
};

const paraStyle: CSSProperties = { margin: "0 0 7px", lineHeight: 1.55 };
const ulStyle: CSSProperties = { margin: "4px 0 8px", paddingLeft: 18 };
const liStyle: CSSProperties = { margin: "3px 0", lineHeight: 1.5 };

function headingStyle(level: number): CSSProperties {
  if (level <= 1) return { fontSize: 14.5, fontWeight: 700, color: color.textBright, margin: "12px 0 6px", lineHeight: 1.4 };
  if (level === 2) return { fontSize: 13, fontWeight: 700, color: color.text, margin: "12px 0 5px", lineHeight: 1.4 };
  return { fontSize: 12.5, fontWeight: 600, color: color.textSoft, margin: "10px 0 4px", lineHeight: 1.4 };
}

function splitFences(body: string): Seg[] {
  const segs: Seg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(body))) {
    if (m.index > last) segs.push({ type: "text", content: body.slice(last, m.index) });
    segs.push({ type: "code", content: m[2].replace(/\n+$/, "") });
    last = m.index + m[0].length;
  }
  if (last < body.length) segs.push({ type: "text", content: body.slice(last) });
  return segs;
}

// Inline `code`, **bold**, and *italic* within a text run; everything else plain.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={key++} style={inlineCode}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={key++} style={{ color: color.text, fontWeight: 600 }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key++} style={{ fontStyle: "italic" }}>
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}

// Block-level: headings (`#`..`####`), bullet lists (`-`/`*`), and paragraphs
// (consecutive non-blank lines joined with soft breaks; blank lines separate).
function blocks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const lines = para;
    out.push(
      <p key={key++} style={paraStyle}>
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(l)}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const items = list;
    out.push(
      <ul key={key++} style={ulStyle}>
        {items.map((l, i) => (
          <li key={i} style={liStyle}>
            {inline(l)}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    const b = /^[-*]\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      flushList();
      out.push(
        <div key={key++} style={headingStyle(h[1].length)}>
          {inline(h[2])}
        </div>,
      );
    } else if (b) {
      flushPara();
      list.push(b[1]);
    } else if (t === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(raw.trimEnd());
    }
  }
  flushPara();
  flushList();
  return out;
}

export function CommentBody({ body, tone }: { body: string; tone?: string }) {
  const segs = splitFences(body.trim());
  return (
    <div style={{ fontSize: 12.8, lineHeight: 1.55, color: tone ?? color.textMuted, wordBreak: "break-word" }}>
      {segs.map((s, i) =>
        s.type === "code" ? (
          <pre key={i} style={codeBlock}>
            {s.content}
          </pre>
        ) : (
          <Fragment key={i}>{blocks(s.content)}</Fragment>
        ),
      )}
    </div>
  );
}
