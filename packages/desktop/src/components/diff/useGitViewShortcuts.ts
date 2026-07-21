import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";
import { shouldIgnoreGitShortcut } from "@/lib/shortcuts/git-shortcut-guards";
import type { ShortcutId } from "@/lib/shortcuts/registry";
import type { GitViewMode } from "./GitTabToggle";

type GitViewShortcutId = Extract<
  ShortcutId,
  | "git-show-uncommitted"
  | "git-show-vs-target"
  | "git-show-commits"
  | "git-show-branches"
  | "git-show-stashes"
>;

function useGitViewCommand(
  id: GitViewShortcutId,
  view: GitViewMode,
  onChange: (view: GitViewMode) => void,
  enabled: boolean,
): void {
  useScopedGlobalShortcutById(
    id,
    (event) => {
      if (event.repeat || shouldIgnoreGitShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onChange(view);
    },
    "git",
    { enabled },
  );
}

/** Git-only direct view transitions; all commands share the mouse persistence path. */
export function useGitViewShortcuts(onChange: (view: GitViewMode) => void, enabled: boolean): void {
  useGitViewCommand("git-show-uncommitted", "uncommitted", onChange, enabled);
  useGitViewCommand("git-show-vs-target", "vs-target", onChange, enabled);
  useGitViewCommand("git-show-commits", "graph", onChange, enabled);
  useGitViewCommand("git-show-branches", "branches", onChange, enabled);
  useGitViewCommand("git-show-stashes", "stashes", onChange, enabled);
}
