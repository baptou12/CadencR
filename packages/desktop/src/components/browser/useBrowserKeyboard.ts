import { useCallback } from "react";

import { type BrowserShortcut } from "@/lib/desktop-bridge";
import { useBrowserShortcutRelay } from "@/hooks/useBrowserShortcutRelay";
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
    "browser-reload",
    (event) => {
      event.preventDefault();
      model.reload();
    },
    "browser",
    { enabled: hasTab },
  );
  // ⌘+/⌘- zoom the guest page. The same combos drive the global desktop zoom
  // (`useZoomHotkeys`), so stop propagation to keep the page zoom from also
  // resizing the whole IDE while the Browser tab is focused.
  useScopedGlobalShortcutById(
    "zoom-in",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      model.zoomIn();
    },
    "browser",
    { enabled: hasTab },
  );
  useScopedGlobalShortcutById(
    "zoom-out",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      model.zoomOut();
    },
    "browser",
    { enabled: hasTab },
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

  // Relay path (guest page focused): the main process forwards the chord.
  useBrowserShortcutRelay((shortcut: BrowserShortcut) => {
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
      case "reload":
        model.reload();
        break;
      case "zoom-in":
        model.zoomIn();
        break;
      case "zoom-out":
        model.zoomOut();
        break;
      case "add-comment":
        if (hasTab) addComment();
        break;
      case "devtools":
        if (hasTab) model.devTools();
        break;
    }
  });
}
