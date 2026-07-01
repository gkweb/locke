// Shared navigation config. The top action bar, the bottom action bar and the
// Settings "Navigation" section all render from this one list so they can never
// disagree about which destinations exist, their order, labels or icons. Each
// destination's placement (top / bottom / off) lives in the store as `navPlace`.

import type { ComponentType } from "react";
import type { NavKey } from "@locke/core";
import { ActivityIcon, LoopsIcon, ReviewsIcon, RunsIcon, FilesIcon, AgentsIcon } from "../components/icons.js";

interface IconProps {
  size?: number;
  color?: string;
  stroke?: number;
  style?: React.CSSProperties;
}

export interface NavItem {
  key: NavKey;
  label: string;
  Icon: ComponentType<IconProps>;
  /** Settings-popover glyph path (matches the design's small mono glyphs). */
  glyph: string;
  /** True when this destination only makes sense in Agent-control mode. */
  agentOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "activity", label: "Activity", Icon: ActivityIcon, glyph: "M1.5 9h3l2-5 3 9 2-4h3" },
  {
    key: "loops",
    label: "Loops",
    Icon: LoopsIcon,
    glyph: "M2.6 8a5.4 5.4 0 0 1 9.2-3.8M11.8 2v2.4h-2.4M13.4 8a5.4 5.4 0 0 1-9.2 3.8M4.2 14v-2.4h2.4",
  },
  { key: "reviews", label: "Reviews", Icon: ReviewsIcon, glyph: "M3 2.5h7l2 2V13H3z" },
  { key: "runs", label: "Runs", Icon: RunsIcon, glyph: "M3 3l5 3.5L3 10M8.5 11h4.5" },
  { key: "files", label: "Files", Icon: FilesIcon, glyph: "M2.5 3.5h3l1.2 1.5H13.5v7.5H2.5z" },
  { key: "agents", label: "Agents", Icon: AgentsIcon, glyph: "M3 4.5h10v8H3zM8 4.5V2.5", agentOnly: true },
];
