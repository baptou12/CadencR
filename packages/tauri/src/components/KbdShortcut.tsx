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
  shift: <ArrowUpIcon className={ICON_SIZE} />,
  enter: <CornerDownLeftIcon className={ICON_SIZE} />,
};

const KEY_MAP_SM: Record<string, ReactNode> = {
  cmd: <CommandIcon className={ICON_SIZE_SM} />,
  shift: <ArrowUpIcon className={ICON_SIZE_SM} />,
  enter: <CornerDownLeftIcon className={ICON_SIZE_SM} />,
};

export function KbdShortcut({ keys, size = "default" }: { keys: string[]; size?: "default" | "sm" }) {
  const map = size === "sm" ? KEY_MAP_SM : KEY_MAP;

  return (
    <kbd className={
      size === "sm"
        ? "ml-1 inline-flex items-center gap-px rounded border border-current/20 bg-current/10 px-1 py-px text-[8px] font-medium leading-none opacity-60 [&_svg]:!size-2"
        : "ml-2 inline-flex items-center gap-0.5 rounded border border-current/20 bg-current/10 px-1.5 py-0.5 text-[10px] font-medium leading-none opacity-70 [&_svg]:!size-2.5"
    }>
      {keys.map((k, i) => {
        const icon = map[k.toLowerCase()];
        return icon ? <span key={i} className="flex items-center">{icon}</span> : <span key={i} className="leading-none">{k}</span>;
      })}
    </kbd>
  );
}
