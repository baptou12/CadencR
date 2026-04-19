import { type ReactNode, useState, useRef, useCallback } from "react";
import { KbdShortcut } from "@/components/KbdShortcut";

interface ShortcutTooltipProps {
  label: string;
  keys?: string[];
  children: ReactNode;
  /** Show tooltip on keyboard focus in addition to hover */
  showOnFocus?: boolean;
  /** Align tooltip to the right edge instead of centering */
  alignRight?: boolean;
  /** Show tooltip above the trigger instead of below */
  above?: boolean;
  /** Additional class name for the wrapper div */
  className?: string;
}

const SHOW_DELAY = 400;

/**
 * Hover tooltip with a show delay. Renders below the trigger.
 * Uses a timer so the tooltip only appears after hovering for 400ms.
 */
export function ShortcutTooltip({ label, keys, children, showOnFocus = false, alignRight, above, className }: ShortcutTooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY);
  }, []);

  const showImmediately = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(false);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={showOnFocus ? showImmediately : undefined}
      onBlur={(event) => {
        if (!showOnFocus) return;
        if (wrapperRef.current?.contains(event.relatedTarget as Node | null)) return;
        hide();
      }}
    >
      {children}
      {visible && (
        <div className={`pointer-events-none absolute z-50 whitespace-nowrap rounded bg-[#1e2030] px-2 py-1 text-xs text-[#c0caf5] shadow-lg border border-[#292e42] ${above ? "bottom-full mb-1.5" : "top-full mt-1.5"} ${alignRight ? "right-0" : "left-1/2 -translate-x-1/2"}`}>
          <span>{label}</span>
          {keys && keys.length > 0 && <KbdShortcut keys={keys} size="sm" />}
        </div>
      )}
    </div>
  );
}
