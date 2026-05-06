import { type ReactNode, useEffect, useRef, useState } from "react";
import { KbdShortcut } from "@/components/KbdShortcut";
import { cn } from "@/lib/utils";

interface ShortcutTooltipProps {
  label: string;
  keys?: string[];
  children: ReactNode;
  /** Align tooltip to the right edge instead of centering */
  alignRight?: boolean;
  /** Show tooltip above the trigger instead of below */
  above?: boolean;
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

/** Tooltip shown on hover. Renders below the trigger by default. */
export function ShortcutTooltip({
  label,
  keys,
  children,
  alignRight,
  above,
  className,
  disabled,
}: ShortcutTooltipProps) {
  const [visible, setVisible] = useState(false);
  const suppressUntilLeaveRef = useRef(false);
  const prevDisabledRef = useRef(disabled);

  useEffect(() => {
    const wasDisabled = prevDisabledRef.current;
    prevDisabledRef.current = disabled;
    if (disabled) {
      setVisible(false);
      return;
    }
    if (wasDisabled) {
      // Disabled just turned off — ignore the synthetic mouseenter that
      // fires when an overlay (popover) above the trigger unmounts.
      suppressUntilLeaveRef.current = true;
      setVisible(false);
    }
  }, [disabled]);

  function handleMouseEnter(): void {
    if (disabled) return;
    if (suppressUntilLeaveRef.current) return;
    setVisible(true);
  }

  function handleMouseLeave(): void {
    suppressUntilLeaveRef.current = false;
    setVisible(false);
  }

  return (
    <div
      className={cn("relative inline-flex", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible && !disabled && (
        <div
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-xs text-muted-foreground shadow-lg",
            above ? "bottom-full mb-1.5" : "top-full mt-1.5",
            alignRight ? "right-0" : "left-1/2 -translate-x-1/2",
          )}
        >
          <span>{label}</span>
          {keys?.length ? <KbdShortcut keys={keys} size="sm" /> : null}
        </div>
      )}
    </div>
  );
}
