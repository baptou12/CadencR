import { matchesKeyboardEvent, parseHotkey } from "@tanstack/hotkeys";
import { useEffect, useRef } from "react";
import { expandCharacterHotkey } from "@/lib/shortcuts/character-hotkeys";

interface GlobalShortcutOptions {
  /** When false, the listener is not attached. Default: true. */
  enabled?: boolean;
}

function normalizeTanStackShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => part.trim())
    .join("+");
}

/**
 * Capture-phase keydown listener that fires before CodeMirror, xterm.js,
 * or any other embedded component can swallow the event.
 *
 * Use this instead of TanStack's React hook when the shortcut must work
 * before CodeMirror, xterm.js, or another embedded surface can stop
 * propagation. Matching still goes through `@tanstack/hotkeys`, so layout
 * behavior stays consistent with normal shortcuts.
 */
export function useGlobalShortcut(
  shortcut: string,
  callback: (e: KeyboardEvent) => void,
  options?: GlobalShortcutOptions,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const enabledRef = useRef(true);
  enabledRef.current = options?.enabled ?? true;

  useEffect(() => {
    const variants = expandCharacterHotkey(normalizeTanStackShortcut(shortcut)).map((variant) => ({
      ...variant,
      parsed: parseHotkey(variant.hotkey),
    }));
    const handler = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      const matches = variants.some((variant) => {
        if (variant.exactKey && e.key !== variant.exactKey) return false;
        return matchesKeyboardEvent(e, variant.parsed);
      });
      if (matches) callbackRef.current(e);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [shortcut]);
}
