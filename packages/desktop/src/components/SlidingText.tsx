import { useState, useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Slides overflowing text horizontally so the user can read the full label
 * without truncation. Pauses at each end so the start and end of the text
 * are both readable, and fades the edges so characters dissolve in/out
 * instead of getting hard-cut by the container.
 *
 * No-ops (renders a plain truncated label) when the text fits — measured
 * with a ResizeObserver so the slide turns on/off as the column resizes.
 *
 * Like all CSS animations in the app, the slide is suppressed when the
 * global `data-animations="off"` kill-switch is active.
 */
export function SlidingText({
  text,
  className,
  pxPerSec = 60,
}: {
  text: string;
  className?: string;
  /** Slide speed in px/s. Lower is slower/easier to read; longer text runs
   * proportionally longer at the same speed. Defaults to a brisk 60. */
  pxPerSec?: number;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const diff = inner.scrollWidth - outer.clientWidth;
      setOverflow(diff > 1 ? diff : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [text]);

  // Speed-based duration so longer titles don't run faster than short
  // ones. Clamped to a 4s minimum so very small overflows don't whip back
  // and forth.
  const isSliding = overflow > 0;
  const duration = Math.max(4, overflow / pxPerSec + 4);

  const wrapperStyle: CSSProperties | undefined = isSliding
    ? {
        // Minimal fade at both edges — just enough to soften the hard cut
        // where glyphs enter/leave the container, without dimming any
        // readable portion of the text.
        maskImage:
          "linear-gradient(to right, transparent 0, black 2px, black calc(100% - 2px), transparent 100%)",
      }
    : undefined;

  const spanStyle: CSSProperties | undefined = isSliding
    ? {
        animation: `slide-text ${duration}s ease-in-out infinite alternate`,
        ["--slide-distance" as string]: `-${overflow}px`,
      }
    : undefined;

  return (
    <div
      ref={outerRef}
      className={cn("min-w-0 overflow-hidden", !isSliding && "truncate", className)}
      style={wrapperStyle}
    >
      <span
        ref={innerRef}
        className={cn("inline-block", isSliding ? "whitespace-nowrap" : "truncate")}
        style={spanStyle}
      >
        {text}
      </span>
    </div>
  );
}

// Inject the keyframes once. The long dwell at each end (0–25% and
// 75–100%) gives users time to actually read the start and end of the
// title before it scrolls.
if (typeof document !== "undefined" && !document.getElementById("slide-text-keyframes")) {
  const style = document.createElement("style");
  style.id = "slide-text-keyframes";
  style.textContent = `@keyframes slide-text { 0%, 25% { transform: translateX(0); } 75%, 100% { transform: translateX(var(--slide-distance)); } }`;
  document.head.appendChild(style);
}
