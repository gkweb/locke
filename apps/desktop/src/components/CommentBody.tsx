import { Fragment, type ReactNode } from "react";
import { color, font } from "../theme/tokens.js";

// Lightweight markdown for comment bodies. Agents reply in markdown — fenced code
// blocks, inline `code`, **bold** — which would otherwise render as a
// run-together single line. Dependency-free; handles the common subset agents
// actually emit, and preserves newlines for everything else.

type Seg = { type: "code"; content: string } | { type: "text"; content: string };

// A fenced block: ```lang? then an optional separator then content up to ```.
// `\w*` stops the language token at the first space/newline, so it works whether
// the fence is on its own line or written inline (as agents sometimes do).
const FENCE = /```(\w*)[ \t]*\n?([\s\S]*?)```/g;
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;

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

// Inline `code` and **bold** within a text run; everything else is plain.
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
    } else {
      out.push(
        <strong key={key++} style={{ color: color.text, fontWeight: 600 }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return out;
}

export function CommentBody({ body }: { body: string }) {
  const segs = splitFences(body.trim());
  return (
    <div style={{ fontSize: 12.8, lineHeight: 1.55, color: color.textMuted, wordBreak: "break-word" }}>
      {segs.map((s, i) =>
        s.type === "code" ? (
          <pre key={i} style={codeBlock}>
            {s.content}
          </pre>
        ) : (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>
            {inline(s.content)}
          </span>
        ),
      )}
    </div>
  );
}
