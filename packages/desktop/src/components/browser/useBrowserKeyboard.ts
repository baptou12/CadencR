import { useCallback, useEffect, useRef } from "react";

import { desktopBridge, type BrowserShortcut } from "@/lib/desktop-bridge";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";

import type { BrowserWorkspaceModel } from "./useBrowserWorkspaceModel";

/**
 * Wire the browser-chrome chords. The scoped capture-phase hooks fire when the
 * Browser tab has renderer focus (toolbar, URL bar or empty area); the
 * `onBrowserShortcut` relay covers the case where the guest page itself holds
 * keyboard focus and the main process forwards the chord (see
 * `browser-tab-events.ts`). Both paths map to the same actions so a shortcut
 * works regardless of where focus currently sits.
 */
export function useBrowserKeyboard(model: BrowserWorkspaceModel, addComment: () => void): void {
  const hasTab = model.activeTab !== null;

  const switchTab = useCallback(
    (delta: number): void => {
      const { tabs } = model.state;
      if (tabs.length < 2) return;
      const index = tabs.findIndex((tab) => tab.id === model.activeTab?.id);
      if (index < 0) return;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      model.activateTab(next.id);
    },
    [model],
  );

  useScopedGlobalShortcutById(
    "browser-new-tab",
    (event) => {
      event.preventDefault();
      void model.newTab();
    },
    "browser",
  );
  useScopedGlobalShortcutById(
    "browser-close",
    (event) => {
      // No tab to close → let the global app-close fallback take ⌘W.
      if (!hasTab) return;
      event.preventDefault();
      model.closeActiveTab();
    },
    "browser",
  );
  useScopedGlobalShortcutById(
    "browser-prev-tab",
    (event) => {
      event.preventDefault();
      switchTab(-1);
    },
    "browser",
  );
  useScopedGlobalShortcutById(
    "browser-next-tab",
    (event) => {
      event.preventDefault();
      switchTab(1);
    },
    "browser",
  );
  useScopedGlobalShortcutById(
    "browser-focus-url",
    (event) => {
      event.preventDefault();
      model.focusUrlBar();
    },
    "browser",
  );
  useScopedGlobalShortcutById(
    "browser-add-comment",
    (event) => {
      event.preventDefault();
      addComment();
    },
    "browser",
    { enabled: hasTab },
  );
  useScopedGlobalShortcutById(
    "browser-devtools",
    (event) => {
      event.preventDefault();
      model.devTools();
    },
    "browser",
    { enabled: hasTab },
  );

  // Relay path (guest page focused). Subscribe once and read the latest
  // handler from a ref so the IPC listener isn't re-bound on every render.
  const handlerRef = useRef<(shortcut: BrowserShortcut) => void>(() => {});
  handlerRef.current = (shortcut) => {
    switch (shortcut) {
      case "new-tab":
        void model.newTab();
        break;
      case "close-tab":
        model.closeActiveTab();
        break;
      case "prev-tab":
        switchTab(-1);
        break;
      case "next-tab":
        switchTab(1);
        break;
      case "focus-url":
        model.focusUrlBar();
        break;
      case "add-comment":
        if (hasTab) addComment();
        break;
      case "devtools":
        if (hasTab) model.devTools();
        break;
    }
  };
  useEffect(() => desktopBridge.onBrowserShortcut((shortcut) => handlerRef.current(shortcut)), []);
}
