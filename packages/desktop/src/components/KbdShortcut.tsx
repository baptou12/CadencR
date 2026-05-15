/**
 * Inline keyboard shortcut badge for buttons.
 * Accepts an array of key tokens: "cmd", "shift", "enter", or any letter/symbol.
 * Renders Lucide icons for modifier/special keys and text for letters.
 */
import { CommandIcon, CornerDownLeftIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";

const ICON_SIZE = "size-2.5";
const ICON_SIZE_SM = "size-2";

const KEY_MAP: Record<string, ReactNode> = {
  cmd: <CommandIcon className={ICON_SIZE} />,
  ctrl: <span className="leading-none">⌃</span>,
  shift: <ArrowUpIcon className={ICON_SIZE} />,
  enter: <CornerDownLeftIcon className={ICON_SIZE} />,
};

const KEY_MAP_SM: Record<string, ReactNode> = {
  cmd: <CommandIcon className={ICON_SIZE_SM} />,
  ctrl: <span className="leading-none">⌃</span>,
  shift: <ArrowUpIcon className={ICON_SIZE_SM} />,
  enter: <CornerDownLeftIcon className={ICON_SIZE_SM} />,
};

const VARIANT_CLASSES = {
  inline:
    "ml-2 inline-flex items-center gap-0.5 rounded border border-current/20 bg-current/10 px-2 py-1 text-[10px] font-medium leading-none text-current [&_svg]:!size-2.5",
  "inline-sm":
    "ml-1 inline-flex items-center gap-px rounded border border-current/20 bg-current/10 px-1.5 py-0.5 text-[8px] font-medium leading-none text-current [&_svg]:!size-2",
  square:
    "mr-1.5 inline-flex size-6 items-center justify-center rounded border border-border bg-card text-[10px] text-foreground",
  modal:
    "inline-flex items-center justify-center rounded border border-border bg-card px-2 py-1 text-[11px] font-mono font-medium text-foreground shadow-sm min-w-[24px]",
  hint: "inline-flex items-center justify-center gap-px rounded border border-current/25 bg-transparent px-1 py-0.5 text-[10px] font-mono font-medium leading-none text-current [&_svg]:!size-2.5",
} as const;

type Variant = keyof typeof VARIANT_CLASSES;

interface KbdShortcutProps {
  keys: string[];
  size?: "default" | "sm";
  variant?: Variant;
}

export function KbdShortcut({ keys, size = "default", variant }: KbdShortcutProps) {
  const resolvedVariant = variant ?? (size === "sm" ? "inline-sm" : "inline");
  const map = size === "sm" ? KEY_MAP_SM : KEY_MAP;

  return (
    <kbd className={VARIANT_CLASSES[resolvedVariant]}>
      {keys.map((k, i) => {
        const icon = map[k.toLowerCase()];
        return icon ? (
          <span key={i} className="flex items-center">
            {icon}
          </span>
        ) : (
          <span key={i} className="leading-none">
            {k}
          </span>
        );
      })}
    </kbd>
  );
}
