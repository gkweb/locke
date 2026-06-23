// Icon set ported from the design's inline SVGs. Stroke icons take `color`
// (currentColor by default) + `stroke`; fill icons take `color`.

interface IconProps {
  size?: number;
  color?: string;
  stroke?: number;
  style?: React.CSSProperties;
}

const strokeBase = (size: number, color: string, stroke: number, style?: React.CSSProperties) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none" as const,
  stroke: color,
  strokeWidth: stroke,
  style,
});

export const FileIcon = ({ size = 14, color = "currentColor", stroke = 1.3, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M3 2.5h7l2 2V13H3z" />
    <path d="M5 6h5M5 8.5h5" />
  </svg>
);

export const FileSimpleIcon = ({ size = 14, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M3 2.5h7l2 2V13H3z" />
  </svg>
);

export const BranchIcon = ({ size = 12, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <circle cx="4" cy="3.5" r="1.6" />
    <circle cx="4" cy="12.5" r="1.6" />
    <circle cx="12" cy="6" r="1.6" />
    <path d="M4 5v6M4 9.5c0-3 1.5-4 5-4" />
  </svg>
);

export const CheckCircleIcon = ({ size = 13, color = "currentColor", stroke = 1.6, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M5 8l2 2 4-4.5" />
  </svg>
);

export const XCircleIcon = ({ size = 13, color = "currentColor", stroke = 1.6, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M6 6l4 4M10 6l-4 4" />
  </svg>
);

export const SpinnerIcon = ({ size = 13, color = "currentColor", stroke = 1.6, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, { animation: "anvspin 1.1s linear infinite", ...style })}>
    <path d="M8 1.5a6.5 6.5 0 1 1-4.6 1.9" strokeLinecap="round" />
  </svg>
);

export const CommentIcon = ({ size = 13, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M2.5 3h11v7H6l-3.5 3V10H2.5z" />
  </svg>
);

export const ChatIcon = ({ size = 13, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, { strokeLinejoin: "round", ...style })}>
    <path d="M2 3h12v8H6.5L3 13.5V11H2z" />
  </svg>
);

export const ChevronRightIcon = ({ size = 13, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export const ChevronDownIcon = ({ size = 12, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M4 6.5l4 3 4-3" />
  </svg>
);

export const ChevronLeftIcon = ({ size = 13, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M10 3l-5 5 5 5" />
  </svg>
);

export const SearchIcon = ({ size = 14, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M11 11l3 3" />
  </svg>
);

export const CheckIcon = ({ size = 13, color = "currentColor", stroke = 1.8, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M3 8.5l3.2 3.5L13 5" />
  </svg>
);

export const XIcon = ({ size = 13, color = "currentColor", stroke = 1.8, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const ShieldIcon = ({ size = 13, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M8 1.5l5.5 3v4c0 3.2-2.4 5.3-5.5 6.5C4.9 13.8 2.5 11.7 2.5 8.5v-4z" />
  </svg>
);

export const ArrowRightIcon = ({ size = 13, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M4 8h8M9 5l3 3-3 3" />
  </svg>
);

export const PlayIcon = ({ size = 13, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M4 3l9 5-9 5z" />
  </svg>
);

export const GearIcon = ({ size = 14, color = "currentColor", stroke = 1.3, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.6v1.7M8 12.7v1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M1.6 8h1.7M12.7 8h1.7M3.5 12.5l1.2-1.2M11.3 4.7l1.2-1.2" />
  </svg>
);

export const InfoIcon = ({ size = 15, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 7.2v4M8 5.2v.01" />
  </svg>
);

export const CommitIcon = ({ size = 14, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 1.5v3.9M8 10.6v3.9" />
  </svg>
);

export const UnifiedIcon = ({ size = 13, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M2 4h12M2 8h12M2 12h12" />
  </svg>
);

export const SplitIcon = ({ size = 13, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M2 3h12v10H2zM8 3v10" />
  </svg>
);

// Sidebar / panel toggle: a rounded rect with a vertical divider near the left.
export const SidebarIcon = ({ size = 16, color = "currentColor", stroke = 1.4, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6.4 3v10" />
  </svg>
);

// Nav: Activity (pulse line).
export const ActivityIcon = ({ size = 16, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M1.5 9h3l2-5 3 9 2-4h3" />
  </svg>
);

// Nav: Reviews (document + check).
export const ReviewsIcon = ({ size = 16, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M3 2.5h7l2 2V13H3z" />
    <path d="M5.5 7l1.5 1.5L10 5.5" />
  </svg>
);

// Nav: Runs (play + list).
export const RunsIcon = ({ size = 16, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M3 3l5 3.5L3 10M8.5 11h4.5" />
  </svg>
);

// Nav: Agents (robot head).
export const AgentsIcon = ({ size = 16, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <rect x="3" y="4.5" width="10" height="8" rx="2" />
    <path d="M8 4.5V2.5M5.5 8h.01M10.5 8h.01M6 11h4" />
  </svg>
);

export const FolderIcon = ({ size = 11, color = "currentColor", stroke = 1.3, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
  </svg>
);

export const PlusIcon = ({ size = 14, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

// Double-chevron, for flipping the side panel left↔right.
export const FlipIcon = ({ size = 14, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M6 4L2 8l4 4M10 4l4 4-4 4" />
  </svg>
);

export const StopIcon = ({ size = 13, color = "currentColor", stroke = 1.5, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </svg>
);

export const PauseIcon = ({ size = 13, color = "currentColor", stroke = 1.6, style }: IconProps) => (
  <svg {...strokeBase(size, color, stroke, style)}>
    <path d="M6 3.5v9M10 3.5v9" />
  </svg>
);

// Fill icons.

// The Mission Control brand mark — interlocking links (violet + teal), one
// filled violet node. Colors are intrinsic to the mark, so it ignores `color`.
export const BrandMark = ({ size = 18, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={style}>
    <path d="M19 18v17a8 8 0 0 0 8 8h11" stroke="#7b6cff" strokeWidth={5} strokeLinecap="round" />
    <path d="M19 27c0-5 4-9 9-9h6" stroke="#3fd0c0" strokeWidth={5} strokeLinecap="round" />
    <circle cx="19" cy="18" r="7.5" fill="#0c0e13" stroke="#7b6cff" strokeWidth={5} />
    <circle cx="42" cy="18" r="7.5" fill="#0c0e13" stroke="#3fd0c0" strokeWidth={5} />
    <circle cx="42" cy="43" r="7.5" fill="#7b6cff" />
  </svg>
);

export const SparkleIcon = ({ size = 14, color = "#3fd0c0", style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color} style={style}>
    <path d="M8 1l1.6 4.2L14 6.4l-3.4 3 1 4.6L8 11.7 4.4 14l1-4.6L2 6.4l4.4-1.2z" />
  </svg>
);

export const LogoMark = ({ size = 13, color = "#8b7bff", style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={style}>
    <path
      d="M1.6 4.4h8.2v1.9H7.4c.25 1.45 1.2 2.55 2.7 3.05V11H3.4V9.35c1.4-.5 2.3-1.6 2.55-3.05H1.6z"
      fill={color}
    />
    <rect x="2.6" y="11.7" width="7.2" height="1.7" rx=".7" fill={color} />
  </svg>
);
