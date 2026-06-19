import { useState, type ButtonHTMLAttributes, type HTMLAttributes } from "react";
import { highlight } from "../lib/highlight.js";

// React has no inline ":hover", so the design's `style-hover` becomes a JS
// hover-state merge. Two thin wrappers cover every hover surface in the UI.

type DivProps = HTMLAttributes<HTMLDivElement> & {
  hoverStyle?: React.CSSProperties;
};

export function HoverDiv({ style, hoverStyle, ...rest }: DivProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ ...style, ...(hover && hoverStyle ? hoverStyle : null) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
    />
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  hoverStyle?: React.CSSProperties;
};

export function HoverButton({ style, hoverStyle, ...rest }: BtnProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      style={{ ...style, ...(hover && hoverStyle ? hoverStyle : null) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
    />
  );
}

/** Renders syntax-highlighted source as a preformatted inline span. */
export function CodeText({ text }: { text: string }) {
  return (
    <span
      style={{ whiteSpace: "pre" }}
      dangerouslySetInnerHTML={{ __html: highlight(text && text.length ? text : " ") }}
    />
  );
}
