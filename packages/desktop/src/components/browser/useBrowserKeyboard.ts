import { useCallback } from "react";

import { type BrowserShortcut } from "@/lib/desktop-bridge";
import { useBrowserShortcutRelay } from "@/hooks/useBrowserShortcutRelay";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";

import type { BrowserWorkspaceModel } from "./useBrowserWorkspaceModel";

function useBrowserNavigationShortcuts(
  model: BrowserWorkspaceModel,
  hasTab: boolean,
  switchTab: (delta: number) => void,
): void {
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
}

function useBrowserPageShortcuts(
  model: BrowserWorkspaceModel,
  hasTab: boolean,
  addComment: () => void,
): void {
  const actionOptions = { enabled: hasTab };
  useScopedGlobalShortcutById(
    "browser-reload",
    (event) => {
      event.preventDefault();
      model.reload();
    },
    "browser",
    actionOptions,
  );
  useScopedGlobalShortcutById(
    "zoom-in",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      model.zoomIn();
    },
    "browser",
    actionOptions,
  );
  useScopedGlobalShortcutById(
    "zoom-out",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      model.zoomOut();
    },
    "browser",
    actionOptions,
  );
  useScopedGlobalShortcutById(
    "browser-add-comment",
    (event) => {
      event.preventDefault();
      addComment();
    },
    "browser",
    actionOptions,
  );
  useScopedGlobalShortcutById(
    "browser-devtools",
    (event) => {
      event.preventDefault();
      model.devTools();
    },
    "browser",
    actionOptions,
  );
}

function useBrowserGuestShortcutRelay(
  model: BrowserWorkspaceModel,
  hasTab: boolean,
  switchTab: (delta: number) => void,
  addComment: () => void,
): void {
  useBrowserShortcutRelay((shortcut: BrowserShortcut) => {
    const actions: Partial<Record<BrowserShortcut, () => void>> = {
      "new-tab": () => void model.newTab(),
      "close-tab": () => model.closeActiveTab(),
      "prev-tab": () => switchTab(-1),
      "next-tab": () => switchTab(1),
      "focus-url": () => model.focusUrlBar(),
      reload: () => model.reload(),
      "zoom-in": () => model.zoomIn(),
      "zoom-out": () => model.zoomOut(),
      "add-comment": () => {
        if (hasTab) addComment();
      },
      devtools: () => {
        if (hasTab) model.devTools();
      },
    };
    actions[shortcut]?.();
  });
}

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

  useBrowserNavigationShortcuts(model, hasTab, switchTab);
  useBrowserPageShortcuts(model, hasTab, addComment);
  useBrowserGuestShortcutRelay(model, hasTab, switchTab, addComment);
}
