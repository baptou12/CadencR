import { PLATFORM_IS_MAC } from "./format";
import { useShortcutOverridesStore } from "./overrides";
import { getRegistryShortcut } from "./resolve";
import type { ShortcutId } from "./registry";

/**
 * A keydown that the bound handler for `id` will match: the user's override or
 * the registry default, with `mod` as Cmd on macOS and Ctrl elsewhere. Lets a
 * menu trigger an action owned by a screen it cannot reach. Only letter combos
 * are synthesizable; anything else returns `null`.
 */
export function keyboardEventInitForShortcut(
  id: ShortcutId,
  isMac = PLATFORM_IS_MAC,
): KeyboardEventInit | null {
  const keys =
    useShortcutOverridesStore.getState().overrides[id]?.keys ?? getRegistryShortcut(id).keys;
  const letter = keys.find((key) => /^[a-z]$/i.test(key));
  if (!letter) return null;
  const shiftKey = keys.includes("shift");
  return {
    key: shiftKey ? letter.toUpperCase() : letter.toLowerCase(),
    code: `Key${letter.toUpperCase()}`,
    metaKey: keys.includes("mod") && isMac,
    ctrlKey: (keys.includes("mod") && !isMac) || keys.includes("ctrl"),
    altKey: keys.includes("alt"),
    shiftKey,
  };
}

/**
 * Fire `id`'s shortcut as if the user pressed it. Dispatched on `document`:
 * the form-aware hotkey engine listens there, and the capture phase still runs
 * window listeners (a window-targeted event would never reach `document`).
 * Returns `false` when the binding cannot be synthesized.
 */
export function dispatchShortcut(id: ShortcutId, isMac = PLATFORM_IS_MAC): boolean {
  const init = keyboardEventInitForShortcut(id, isMac);
  if (!init) return false;
  document.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
  return true;
}
