import { useCallback, useRef } from "react";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import { shouldIgnoreGitShortcut } from "@/lib/shortcuts/git-shortcut-guards";
import {
  delegateGitNavigation,
  type GitNavigationAdapter,
  type GitNavigationAdapterRegistrar,
  type GitNavigationCommand,
} from "./gitNavigation";

function useGitCommand(
  id:
    | "git-next-item"
    | "git-previous-item"
    | "git-open-item"
    | "git-back"
    | "git-toggle-viewed"
    | "git-toggle-thread-picked"
    | "git-stage-file"
    | "git-reset-file"
    | "git-scroll-down"
    | "git-scroll-up"
    | "git-open-in-editor",
  command: GitNavigationCommand,
  adapterRef: { current: GitNavigationAdapter | null },
  enabled: boolean,
  allowRepeat: boolean,
  direction?: -1 | 1,
): void {
  useScopedGlobalShortcutById(
    id,
    (event) => {
      if ((!allowRepeat && event.repeat) || shouldIgnoreGitShortcut(event)) return;
      const adapter = adapterRef.current;
      const handled =
        direction == null
          ? delegateGitNavigation(adapter, command)
          : delegateGitNavigation(adapter, command, direction);
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    "git",
    { enabled },
  );
}

/** One Git-scoped controller; visible sub-tabs register their active adapter. */
export function useGitKeyboardController(enabled: boolean): GitNavigationAdapterRegistrar {
  const adapterRef = useRef<GitNavigationAdapter | null>(null);
  const register = useCallback<GitNavigationAdapterRegistrar>((adapter) => {
    adapterRef.current = adapter;
    return () => {
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
  }, []);

  useGitCommand("git-next-item", "moveSelection", adapterRef, enabled, true, 1);
  useGitCommand("git-previous-item", "moveSelection", adapterRef, enabled, true, -1);
  useGitCommand("git-open-item", "open", adapterRef, enabled, false);
  useGitCommand("git-back", "back", adapterRef, enabled, false);
  useGitCommand("git-toggle-viewed", "toggleViewed", adapterRef, enabled, false);
  useGitCommand("git-toggle-thread-picked", "togglePicked", adapterRef, enabled, false);
  useGitCommand("git-stage-file", "stage", adapterRef, enabled, false);
  useGitCommand("git-reset-file", "reset", adapterRef, enabled, false);
  useGitCommand("git-scroll-down", "scrollHalfPage", adapterRef, enabled, true, 1);
  useGitCommand("git-scroll-up", "scrollHalfPage", adapterRef, enabled, true, -1);
  useGitCommand("git-open-in-editor", "openInEditor", adapterRef, enabled, false);

  return register;
}
