import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { KbdShortcut } from "@/components/KbdShortcut";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";

interface ShortcutTooltipProps {
  label: string;
  keys?: string[];
  children: ReactNode;
  /** Align tooltip to the right edge instead of centering */
  alignRight?: boolean;
  /** Align tooltip to the left edge instead of centering (useful when the trigger sits near the viewport's left edge) */
  alignLeft?: boolean;
  /** Show tooltip above the trigger instead of below */
  above?: boolean;
  /**
   * Render the bubble to the right of the trigger instead of below — used
   * for narrow vertical rails where the below-the-trigger area is too
   * cramped or overlaps neighboring panes. Mutually exclusive with
   * `above`/`alignLeft`/`alignRight`.
   */
  toRight?: boolean;
  /** Additional class name for the wrapper div */
  className?: string;
  /**
   * When true, the tooltip is force-hidden and ignores hover events.
   * After a `true → false` transition, the tooltip stays hidden until the
   * cursor actually leaves the trigger and re-enters — this avoids the
   * spurious flash that happens when a wrapped popover closes and the
   * cursor ends up over the trigger button (e.g. model picker selection).
   */
  disabled?: boolean;
}

interface TooltipPosition {
  top: number;
  left: number;
  /** Horizontal `transform: translateX(...)` to apply for the requested alignment. */
  translateX: string;
}

const GAP_PX = 6;

/**
 * Tooltip shown on hover. Rendered into a portal at `document.body` and
 * positioned with `position: fixed` from the trigger's bounding rect, so
 * ancestor `overflow: hidden|auto` chains (tab strips, card frames, pane
 * content) can never clip the bubble — historically the failure mode was
 * tooltips on tab triggers being invisible because `TabsList` sets
 * `overflow: auto` and unified-agent cards set `overflow: hidden`.
 */
export function ShortcutTooltip({
  label,
  keys,
  children,
  alignRight,
  alignLeft,
  above,
  toRight,
  className,
  disabled,
}: ShortcutTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const suppressUntilLeaveRef = useRef(false);
  // Touch devices synthesize a `mouseenter` on tap, which would pop this
  // hover tooltip open on every tab/button press. There's no hover intent on a
  // phone, so suppress the tooltip entirely there.
  const isMobile = useIsMobile();

  // While disabled, force-hide and arm a one-shot suppress so the synthetic
  // mouseenter fired when an overlay (popover) above the trigger unmounts
  // doesn't immediately re-open the tooltip — the user has to leave and
  // re-enter the trigger first.
  useEffect(() => {
    if (!disabled) return;
    setVisible(false);
    suppressUntilLeaveRef.current = true;
  }, [disabled]);

  // Position once on every visibility transition before paint, then keep it
  // glued to the trigger across scroll/resize while visible. `useLayoutEffect`
  // avoids the empty-paint flicker the previous mouseenter→setState path had.
  useLayoutEffect(() => {
    if (!visible) return undefined;
    const sync = (): void => {
      const trigger = wrapperRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      let next: TooltipPosition;
      if (toRight) {
        // Side-positioned: bubble to the right of the trigger, vertically
        // centered. `translateY(-50%)` on the bubble's own height.
        next = {
          top: rect.top + rect.height / 2,
          left: rect.right + GAP_PX,
          translateX: "0",
        };
      } else {
        const top = above ? rect.top - GAP_PX : rect.bottom + GAP_PX;
        if (alignRight) next = { top, left: rect.right, translateX: "-100%" };
        else if (alignLeft) next = { top, left: rect.left, translateX: "0" };
        else next = { top, left: rect.left + rect.width / 2, translateX: "-50%" };
      }
      setPosition((prev) =>
        prev != null &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.translateX === next.translateX
          ? prev
          : next,
      );
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [visible, above, alignLeft, alignRight, toRight]);

  function handleMouseEnter(): void {
    if (disabled || isMobile || suppressUntilLeaveRef.current) return;
    setVisible(true);
  }

  function handleMouseLeave(): void {
    suppressUntilLeaveRef.current = false;
    setVisible(false);
  }

  return (
    <div
      ref={wrapperRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && !disabled && position
        ? createPortal(
            <div
              style={{
                position: "fixed",
                top: position.top,
                left: position.left,
                transform: `translate(${position.translateX}, ${
                  toRight ? "-50%" : above ? "-100%" : "0"
                })`,
              }}
              className="pointer-events-none z-50 whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-lg"
              data-slot="hover-card-content"
            >
              <span>{label}</span>
              {keys?.length ? <KbdShortcut keys={keys} size="sm" /> : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
