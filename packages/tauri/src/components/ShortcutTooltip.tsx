import { type ReactNode, useState, useRef, useCallback } from "react";
import { KbdShortcut } from "@/components/KbdShortcut";

interface ShortcutTooltipProps {
  label: string;
  keys?: string[];
  children: ReactNode;
  /** Align tooltip to the right edge instead of centering */
  alignRight?: boolean;
}

const SHOW_DELAY = 400;

/**
 * Hover tooltip with a show delay. Renders below the trigger.
 * Uses a timer so the tooltip only appears after hovering for 400ms.
 */
export function ShortcutTooltip({ label, keys, children, alignRight }: ShortcutTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(false);
  }, []);

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div className={`pointer-events-none absolute top-full z-50 mt-1.5 whitespace-nowrap rounded bg-[#1e2030] px-2 py-1 text-xs text-[#c0caf5] shadow-lg border border-[#292e42] ${alignRight ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
          <span>{label}</span>
          {keys && keys.length > 0 && <KbdShortcut keys={keys} size="sm" />}
        </div>
      )}
    </div>
  );
}
