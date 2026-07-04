import type { RefObject } from "react";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import type { SplitOrientation } from "@/hooks/useTerminalState";
import type { XTermInstanceHandle } from "./XTermInstance";

interface UseTerminalPaneShortcutsParams {
  hotkeysEnabled: boolean;
  resolvedActivePaneId: string | null;
  paneRefs: RefObject<Map<string, XTermInstanceHandle>>;
  onSplit: (orientation: SplitOrientation) => void;
  onNavigate: (direction: "left" | "right" | "up" | "down") => void;
  onClose: (paneId: string) => void;
}

/**
 * Registers all terminal-pane keyboard shortcuts (split, navigate, clear,
 * delete-line, close), scoped to the terminal tab so they don't fire from
 * another tab.
 *
 * We use the *global* capture-phase variant rather than `useHotkeys` so the
 * shortcuts still fire while xterm's textarea has focus — bubble-phase hotkeys
 * can be swallowed by xterm before they reach app handlers.
 */
export function useTerminalPaneShortcuts({
  hotkeysEnabled,
  resolvedActivePaneId,
  paneRefs,
  onSplit,
  onNavigate,
  onClose,
}: UseTerminalPaneShortcutsParams): void {
  const opts = { enabled: hotkeysEnabled };

  useScopedGlobalShortcutById(
    "terminal-split-h",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSplit("horizontal");
    },
    "terminal",
    opts,
  );

  useScopedGlobalShortcutById(
    "terminal-split-v",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSplit("vertical");
    },
    "terminal",
    opts,
  );

  // One capture-phase listener per arrow direction so xterm doesn't swallow the
  // keys while its textarea is focused.
  useScopedGlobalShortcutById(
    "terminal-nav-pane-left",
    (e) => {
      e.preventDefault();
      onNavigate("left");
    },
    "terminal",
    opts,
  );
  useScopedGlobalShortcutById(
    "terminal-nav-pane-right",
    (e) => {
      e.preventDefault();
      onNavigate("right");
    },
    "terminal",
    opts,
  );
  useScopedGlobalShortcutById(
    "terminal-nav-pane-up",
    (e) => {
      e.preventDefault();
      onNavigate("up");
    },
    "terminal",
    opts,
  );
  useScopedGlobalShortcutById(
    "terminal-nav-pane-down",
    (e) => {
      e.preventDefault();
      onNavigate("down");
    },
    "terminal",
    opts,
  );

  useScopedGlobalShortcutById(
    "terminal-clear",
    (e) => {
      if (!resolvedActivePaneId) return;
      e.preventDefault();
      e.stopPropagation();
      paneRefs.current.get(resolvedActivePaneId)?.clearScreen();
    },
    "terminal",
    opts,
  );

  useScopedGlobalShortcutById(
    "terminal-delete-line",
    (e) => {
      if (!resolvedActivePaneId) return;
      e.preventDefault();
      e.stopPropagation();
      paneRefs.current.get(resolvedActivePaneId)?.clearInput();
    },
    "terminal",
    opts,
  );

  // CMD+W: kill the active split's PTY. Scoped to the terminal tab.
  //
  // We only `preventDefault` + `stopPropagation` when there *is* a pane to
  // close — otherwise we let the event fall through to `useAppClose`'s global
  // meta+w (hooks/useAppClose.ts), which is the user-visible "no terminals
  // left, close the app" behaviour. Stopping propagation matters: without it,
  // `useAppClose` would *also* run and request a window close while the user
  // only intended to kill one split.
  useScopedGlobalShortcutById(
    "terminal-close",
    (e) => {
      if (!resolvedActivePaneId) return;
      e.preventDefault();
      e.stopPropagation();
      onClose(resolvedActivePaneId);
    },
    "terminal",
    opts,
  );
}
