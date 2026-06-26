import { useEffect, useState } from "react";
import { useStore } from "../state/store.js";
import { color, font } from "../theme/tokens.js";

// Create a review by comparing a head branch against a base. Ported from the old
// ListView; reads branches/base from the store and calls createReview.

const COMBO_LIMIT = 50;

function BranchCombobox({
  value,
  onChange,
  branches,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  branches: string[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setQuery(value), [value]);

  const q = query.trim().toLowerCase();
  const all = q ? branches.filter((b) => b.toLowerCase().includes(q)) : branches;
  const matches = all.slice(0, COMBO_LIMIT);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: color.appBg,
          border: `1px solid ${color.borderInput}`,
          borderRadius: 8,
          padding: "9px 11px",
          color: color.text,
          fontFamily: font.mono,
          fontSize: 12.5,
          outline: "none",
        }}
      />
      {open && matches.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 220,
            overflowY: "auto",
            background: color.panelHeaderBg,
            border: `1px solid ${color.borderInput}`,
            borderRadius: 8,
            zIndex: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
          }}
        >
          {matches.map((b) => (
            <button
              key={b}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(b);
                setQuery(b);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 11px",
                border: "none",
                background: b === value ? color.rowActiveBg : "transparent",
                color: color.textCode,
                fontFamily: font.mono,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {b}
            </button>
          ))}
          {all.length > matches.length && (
            <div style={{ padding: "6px 11px", fontSize: 11, color: color.textGhost, fontFamily: font.sans }}>
              {all.length - matches.length} more — keep typing to narrow
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NewReviewModal() {
  const branches = useStore((s) => s.branches);
  const defaultBase = useStore((s) => s.base);
  const createReview = useStore((s) => s.createReview);
  const close = useStore((s) => s.setNewReviewOpen);

  const [head, setHead] = useState("");
  const [base, setBase] = useState(branches.includes(defaultBase) ? defaultBase : "");
  const valid = branches.includes(head) && branches.includes(base) && head !== base;

  return (
    <div
      onClick={() => close(false)}
      style={{ position: "fixed", inset: 0, background: color.scrim, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, background: color.panelBg, border: `1px solid ${color.borderPanel}`, borderRadius: 14, padding: 20, fontFamily: font.sans }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: color.textBright, marginBottom: 4 }}>New review</div>
        <div style={{ fontSize: 12.5, color: color.textFainter, marginBottom: 18 }}>
          Review a branch against a base. Only branches with commits ahead of the base can be reviewed.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: color.textGhost }}>COMPARE (HEAD)</span>
            <BranchCombobox value={head} onChange={setHead} branches={branches} placeholder="Search branches…" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: color.textGhost }}>INTO (BASE)</span>
            <BranchCombobox value={base} onChange={setBase} branches={branches} placeholder="Search branches…" />
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button
            onClick={() => close(false)}
            style={{ fontFamily: font.sans, fontSize: 12.5, color: "var(--lk-textDim)", background: "transparent", border: `1px solid ${color.borderInput}`, padding: "8px 15px", borderRadius: 8, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => {
              close(false);
              void createReview(head, base);
            }}
            style={{
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              background: valid ? color.violet : "var(--lk-borderPopover)",
              border: `1px solid ${valid ? color.violet : "var(--lk-borderPopover)"}`,
              padding: "8px 15px",
              borderRadius: 8,
              cursor: valid ? "pointer" : "not-allowed",
              opacity: valid ? 1 : 0.7,
            }}
          >
            Create review
          </button>
        </div>
      </div>
    </div>
  );
}
