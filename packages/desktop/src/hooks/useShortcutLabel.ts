import { formatCombo, formatCompactCombo } from "@/lib/shortcuts/format";
import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import type { ShortcutId } from "@/lib/shortcuts/registry";

/** A registry shortcut's current binding as one label ("⌘↵", "Ctrl+R"), rebinds included. */
export function useShortcutLabel(id: ShortcutId): string {
  return formatCompactCombo(useResolvedShortcut(id).keys);
}

/** The same binding as separate key glyphs, for `KbdShortcut` / `ShortcutTooltip`. */
export function useShortcutKeys(id: ShortcutId): string[] {
  return formatCombo(useResolvedShortcut(id).keys);
}
