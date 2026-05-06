import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function SlidingText({ text, className }: { text: string; className?: string }) {
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

  // Duration scales with overflow amount — roughly 1s per 50px
  const duration = Math.max(2, overflow / 50) * 2;

  return (
    <div ref={outerRef} className={cn("min-w-0 overflow-hidden", className)}>
      <span
        ref={innerRef}
        className="inline-block whitespace-nowrap"
        style={
          overflow > 0
            ? {
                animation: `slide-text ${duration}s ease-in-out infinite alternate`,
                ["--slide-distance" as string]: `-${overflow}px`,
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}

// Inject the keyframes once
if (typeof document !== "undefined" && !document.getElementById("slide-text-keyframes")) {
  const style = document.createElement("style");
  style.id = "slide-text-keyframes";
  style.textContent = `@keyframes slide-text { 0%, 15% { transform: translateX(0); } 85%, 100% { transform: translateX(var(--slide-distance)); } }`;
  document.head.appendChild(style);
}
