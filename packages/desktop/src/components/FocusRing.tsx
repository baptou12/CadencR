import { useEffect, useRef, useCallback, useState } from "react";

const IMPORTANT_SELECTOR = [
  "[data-nav-item]",
  "[data-focus-ring]",
  "[data-permission-area] button",
  "[data-question-area] button",
  "[data-question-area] input",
].join(", ");

function isImportant(el: Element): boolean {
  return el.matches(IMPORTANT_SELECTOR);
}

export function FocusRing() {
  const ringRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<Element | null>(null);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number>(0);

  const updatePosition = useCallback(() => {
    const ring = ringRef.current;
    const target = targetRef.current;
    if (!ring || !target) return;

    const rect = target.getBoundingClientRect();
    const offset = 3;
    ring.style.top = `${rect.top - offset}px`;
    ring.style.left = `${rect.left - offset}px`;
    ring.style.width = `${rect.width + offset * 2}px`;
    ring.style.height = `${rect.height + offset * 2}px`;
  }, []);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element;
      if (el && isImportant(el)) {
        targetRef.current = el;
        updatePosition();
        setVisible(true);
      }
    };

    const onFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as Element | null;
      if (!related || !isImportant(related)) {
        setVisible(false);
        targetRef.current = null;
      }
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [updatePosition]);

  // Keep position updated on scroll/resize
  useEffect(() => {
    const tick = () => {
      if (targetRef.current && visible) {
        updatePosition();
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    // Use ResizeObserver to track target size changes
    const ro = new ResizeObserver(() => {
      if (targetRef.current && visible) updatePosition();
    });

    const onScroll = () => {
      if (targetRef.current && visible) updatePosition();
    };

    rafRef.current = requestAnimationFrame(tick);
    document.addEventListener("scroll", onScroll, true);

    // Observe target when visible
    if (targetRef.current) ro.observe(targetRef.current);

    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener("scroll", onScroll, true);
      ro.disconnect();
    };
  }, [visible, updatePosition]);

  return (
    <div
      ref={ringRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        pointerEvents: "none",
        zIndex: 9999,
        border: "2px solid oklch(0.707 0.165 254.624)",
        borderRadius: 6,
        opacity: visible ? 1 : 0,
        transition:
          "top 150ms ease-out, left 150ms ease-out, width 150ms ease-out, height 150ms ease-out, opacity 150ms ease-out",
      }}
    />
  );
}
