import type { ChangedFile, LineKind } from "@locke/core";

// Pure diff-layout builders ported from the design (buildUnified / buildSplit).
// They emit plain row data; DiffViewer computes styles, attaches comment
// threads, and wires the composer. The lineId scheme is preserved:
//   "n<newNo>" for context/added lines, "o<oldNo>" for deleted lines.

export interface UnifiedHunkRow {
  kind: "hunk";
  key: string;
  hunkText: string;
}

export interface UnifiedLineRow {
  kind: "line";
  key: string;
  lineKind: LineKind;
  oldNo: string;
  newNo: string;
  sign: string;
  code: string;
  lineId: string;
}

export type UnifiedRow = UnifiedHunkRow | UnifiedLineRow;

export function buildUnified(file: ChangedFile): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  file.hunks.forEach((h, hi) => {
    rows.push({ kind: "hunk", key: `h${hi}`, hunkText: h.hdr });
    h.lines.forEach((ln, li) => {
      const [t, o, nw, text] = ln;
      const sign = t === "add" ? "+" : t === "del" ? "-" : "";
      const lineId = t === "del" ? `o${o}` : `n${nw}`;
      rows.push({
        kind: "line",
        key: `${hi}-${li}`,
        lineKind: t,
        oldNo: o ? String(o) : "",
        newNo: nw ? String(nw) : "",
        sign,
        code: text,
        lineId,
      });
    });
  });
  return rows;
}

export interface SplitCell {
  empty: boolean;
  no: string;
  code: string;
  cellKind: LineKind | null;
}

export interface SplitHunkRow {
  kind: "hunk";
  key: string;
  hunkText: string;
}

export interface SplitPairRow {
  kind: "pair";
  key: string;
  left: SplitCell;
  right: SplitCell;
  lineId: string | null;
}

export type SplitRow = SplitHunkRow | SplitPairRow;

const cell = (no: number, code: string, kind: LineKind): SplitCell => ({
  empty: false,
  no: no ? String(no) : "",
  code,
  cellKind: kind,
});

const emptyCell = (): SplitCell => ({ empty: true, no: "", code: "", cellKind: null });

export function buildSplit(file: ChangedFile): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: SplitCell[] = [];
  let adds: Array<SplitCell & { lid?: string }> = [];
  let pairSeq = 0;

  const flush = () => {
    const m = Math.max(dels.length, adds.length);
    for (let i = 0; i < m; i++) {
      const right = adds[i];
      rows.push({
        kind: "pair",
        key: `p${pairSeq++}`,
        left: dels[i] || emptyCell(),
        right: right || emptyCell(),
        lineId: right ? right.lid ?? null : null,
      });
    }
    dels = [];
    adds = [];
  };

  file.hunks.forEach((h, hi) => {
    flush();
    rows.push({ kind: "hunk", key: `h${hi}`, hunkText: h.hdr });
    h.lines.forEach((ln) => {
      const [t, o, nw, text] = ln;
      if (t === "ctx") {
        flush();
        rows.push({
          kind: "pair",
          key: `p${pairSeq++}`,
          left: cell(o, text, "ctx"),
          right: cell(nw, text, "ctx"),
          lineId: `n${nw}`,
        });
      } else if (t === "del") {
        dels.push(cell(o, text, "del"));
      } else if (t === "add") {
        adds.push({ ...cell(nw, text, "add"), lid: `n${nw}` });
      }
    });
    flush();
  });

  return rows;
}
