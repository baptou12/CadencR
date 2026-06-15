import { useEffect, useRef } from "react";

import { desktopBridge, type BrowserShortcut } from "@/lib/desktop-bridge";

/**
 * Subscribe to main-process browser shortcut relays — the chords fired when the
 * native guest page (a WebContentsView) holds keyboard focus and the renderer's
 * own listeners never see the keydown (see `browser-tab-events.ts`).
 *
 * The handler is read from a ref so the IPC listener is bound exactly once and
 * never re-bound, while still calling the latest closure over fresh render state.
 */
export function useBrowserShortcutRelay(handler: (shortcut: BrowserShortcut) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => desktopBridge.onBrowserShortcut((shortcut) => handlerRef.current(shortcut)), []);
}
