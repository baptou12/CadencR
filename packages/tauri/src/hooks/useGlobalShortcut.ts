import { useEffect, useRef } from "react";

interface GlobalShortcutOptions {
  /** When false, the listener is not attached. Default: true. */
  enabled?: boolean;
}

interface ParsedShortcut {
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  return {
    meta: parts.includes("meta"),
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key,
  };
}

function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  if (e.metaKey !== parsed.meta) return false;
  if (e.ctrlKey !== parsed.ctrl) return false;
  if (e.shiftKey !== parsed.shift) return false;
  if (e.altKey !== parsed.alt) return false;

  // Single letter — use e.code to avoid ctrl modifier mangling e.key
  if (/^[a-z]$/.test(parsed.key)) {
    return e.code === `Key${parsed.key.toUpperCase()}`;
  }

  return e.key.toLowerCase() === parsed.key.toLowerCase();
}

/**
 * Capture-phase keydown listener that fires before CodeMirror, xterm.js,
 * or any other embedded component can swallow the event.
 *
 * Use this instead of useHotkeys when the shortcut must work regardless
 * of which element has focus.
 */
export function useGlobalShortcut(
  shortcut: string,
  callback: (e: KeyboardEvent) => void,
  options?: GlobalShortcutOptions,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    const parsed = parseShortcut(shortcut);

    const handler = (e: KeyboardEvent) => {
      if (matchesShortcut(e, parsed)) {
        callbackRef.current(e);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [shortcut, enabled]);
}
