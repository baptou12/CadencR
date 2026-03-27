import type { ReactNode } from "react";
import { KbdShortcut } from "@/components/KbdShortcut";

interface ShortcutTooltipProps {
  label: string;
  keys?: string[];
  children: ReactNode;
}

/**
 * CSS-only hover tooltip with optional keyboard shortcut badge.
 * Uses a 400ms delay via transition-delay to avoid flicker.
 */
export function ShortcutTooltip({ label, keys, children }: ShortcutTooltipProps) {
  return (
    <div className="group relative inline-flex">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-[#1e2030] px-2 py-1 text-xs text-[#c0caf5] shadow-lg border border-[#292e42] opacity-0 transition-opacity delay-[400ms] group-hover:opacity-100">
        <span>{label}</span>
        {keys && keys.length > 0 && <KbdShortcut keys={keys} size="sm" />}
      </div>
    </div>
  );
}
