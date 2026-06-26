import { useState } from "react";
import { useStore } from "../state/store.js";
import { color, font, alpha } from "../theme/tokens.js";
import { TrashIcon } from "./icons.js";

// Destructive confirmation for permanently deleting a pull request. Mirrors the
// GitHub flow: the delete button stays disabled until the user types the literal
// word DELETE. Deleting drops the PR record + its comments but keeps the branch.

const CONFIRM_WORD = "DELETE";

export function DeletePullModal() {
  const pendingId = useStore((s) => s.deletePullPending);
  const reviews = useStore((s) => s.reviews);
  const close = useStore((s) => s.requestDeletePull);
  const deletePullRequest = useStore((s) => s.deletePullRequest);

  const review = reviews.find((r) => r.id === pendingId);
  const [typed, setTyped] = useState("");
  const valid = typed.trim().toUpperCase() === CONFIRM_WORD;

  const dismiss = () => close("");

  return (
    <div
      onClick={dismiss}
      style={{ position: "fixed", inset: 0, background: color.scrim, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, background: color.panelBg, border: `1px solid ${color.borderPanel}`, borderRadius: 14, padding: 20, fontFamily: font.sans }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
          <TrashIcon size={15} color={color.red} stroke={1.6} />
          <div style={{ fontSize: 15, fontWeight: 700, color: color.textBright }}>Delete pull request</div>
        </div>
        <div style={{ fontSize: 12.5, color: color.textFainter, marginBottom: 16, lineHeight: 1.5 }}>
          This permanently deletes pull request{" "}
          <span style={{ fontFamily: font.mono, color: color.text }}>#{pendingId}</span>
          {review ? (
            <>
              {" "}— <span style={{ color: color.text }}>{review.title}</span>
            </>
          ) : null}
          {" "}and its review comments. The{" "}
          <span style={{ fontFamily: font.mono, color: color.greenText }}>{review?.branch ?? "branch"}</span>{" "}
          branch is left untouched. This cannot be undone.
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".5px", color: color.textGhost }}>
            TYPE <span style={{ color: color.red }}>{CONFIRM_WORD}</span> TO CONFIRM
          </span>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) {
                close("");
                void deletePullRequest();
              }
            }}
            placeholder={CONFIRM_WORD}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: color.appBg,
              border: `1px solid ${valid ? alpha.red(0.5) : color.borderInput}`,
              borderRadius: 8,
              padding: "9px 11px",
              color: color.text,
              fontFamily: font.mono,
              fontSize: 12.5,
              outline: "none",
            }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 22 }}>
          <button
            onClick={dismiss}
            style={{ fontFamily: font.sans, fontSize: 12.5, color: "var(--lk-textDim)", background: "transparent", border: `1px solid ${color.borderInput}`, padding: "8px 15px", borderRadius: 8, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => {
              close("");
              void deletePullRequest();
            }}
            style={{
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#fff",
              background: valid ? color.red : "#3a2230",
              border: `1px solid ${valid ? color.red : "#3a2230"}`,
              padding: "8px 15px",
              borderRadius: 8,
              cursor: valid ? "pointer" : "not-allowed",
              opacity: valid ? 1 : 0.7,
            }}
          >
            Delete pull request
          </button>
        </div>
      </div>
    </div>
  );
}
