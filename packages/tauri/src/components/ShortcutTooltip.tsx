import { type ReactNode, useState } from "react";
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
}

/** Tooltip shown on hover. Renders below the trigger by default. */
export function ShortcutTooltip({
  label,
  keys,
  children,
  alignRight,
  above,
  className,
}: ShortcutTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          className={cn(
            "pointer-events-none absolute z-50 whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg",
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
