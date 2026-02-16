/**
 * Inline keyboard shortcut badge for buttons.
 * Accepts an array of key tokens: "cmd", "shift", "enter", or any letter/symbol.
 * Renders Lucide icons for modifier/special keys and text for letters.
 */
import { CommandIcon, CornerDownLeftIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";

const ICON_SIZE = "size-3";

const KEY_MAP: Record<string, ReactNode> = {
  cmd: <CommandIcon className={ICON_SIZE} />,
  shift: <ArrowUpIcon className={ICON_SIZE} />,
  enter: <CornerDownLeftIcon className={ICON_SIZE} />,
};

export function KbdShortcut({ keys }: { keys: string[] }) {
  return (
    <kbd className="ml-2 inline-flex items-center gap-0.5 rounded border border-current/20 bg-current/10 px-1.5 py-0.5 text-[10px] font-medium opacity-70">
      {keys.map((k, i) => {
        const icon = KEY_MAP[k.toLowerCase()];
        return icon ? <span key={i}>{icon}</span> : <span key={i}>{k}</span>;
      })}
    </kbd>
  );
}
