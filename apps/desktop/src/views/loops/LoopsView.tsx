import { useStore } from "../../state/store.js";
import { color } from "../../theme/tokens.js";
import { LoopsList } from "./LoopsList.js";
import { LoopBuilder } from "./LoopBuilder.js";
import { LoopPlan } from "./LoopPlan.js";
import { LoopMonitor } from "./LoopMonitor.js";
import { LoopReview } from "./LoopReview.js";

// Loops (v2.0.0): run one task across many files. Five sub-screens switched on
// `loopView` — a full main-area takeover (each sub-view carries its own rails).
// List → Builder → Plan (interview + specs) → Monitor (board/stream/grid) →
// per-item Review. Front-end + mock for now; a real loop-runner plugs in later.

export function LoopsView() {
  const loopView = useStore((s) => s.loopView);
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: color.appBg,
      }}
    >
      {loopView === "list" && <LoopsList />}
      {loopView === "builder" && <LoopBuilder />}
      {loopView === "plan" && <LoopPlan />}
      {loopView === "monitor" && <LoopMonitor />}
      {loopView === "review" && <LoopReview />}
    </div>
  );
}
