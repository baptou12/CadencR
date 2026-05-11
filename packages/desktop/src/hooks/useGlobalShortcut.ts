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

// Names that the *KeyboardEvent.code* uses, keyed by the short tokens callers
// pass into `useGlobalShortcut("meta+alt+left")` — and their `Arrow…` long
// form, so either spelling works. Without this mapping, "left" never matches
// `e.key === "ArrowLeft"`, which is exactly the bug that left CMD+OPT+Arrow
// silently dead in the terminal after we dropped react-hotkeys-hook for these
// shortcuts (react-hotkeys-hook normalises `left` → `ArrowLeft` internally).
const codeByKey: Record<string, string> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
};

function matchesShortcut(e: KeyboardEvent, parsed: ParsedShortcut): boolean {
  if (e.metaKey !== parsed.meta) return false;
  if (e.ctrlKey !== parsed.ctrl) return false;
  if (e.shiftKey !== parsed.shift) return false;
  if (e.altKey !== parsed.alt) return false;

  // Single letter — use e.code to avoid ctrl modifier mangling e.key
  if (/^[a-z]$/.test(parsed.key)) {
    return e.code === `Key${parsed.key.toUpperCase()}`;
  }

  // Aliased keys (brackets, arrows) — match via e.code so modifier mangling
  // and long/short spellings don't matter.
  if (codeByKey[parsed.key]) {
    return e.code === codeByKey[parsed.key];
  }

  return e.key.toLowerCase() === parsed.key.toLowerCase();
}

/**
 * Capture-phase keydown listener that fires before CodeMirror, xterm.js,
 * or any other embedded component can swallow the event.
 *
 * Use this instead of useHotkeys when the shortcut must work regardless
 * of which element has focus. The listener is attached for the component's
 * lifetime; toggling `enabled` flips a ref instead of detaching/re-attaching,
 * so consumers like `useScopedGlobalShortcut` can gate on rapidly-changing
 * state (active tab) without DOM churn.
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
    const parsed = parseShortcut(shortcut);
    const handler = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (matchesShortcut(e, parsed)) callbackRef.current(e);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [shortcut]);
}
