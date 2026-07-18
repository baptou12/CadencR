import { useGlobalShortcutById, useShortcut } from "@/hooks/useShortcut";
import { isInCodeMirrorEditor } from "@/lib/shortcuts/dom-targets";
import type { CommitActivity, GitActionState } from "./useGitAction";

interface GitActionShortcutOptions {
  state: GitActionState;
  commitActivity: CommitActivity;
  openCommit: () => void;
  openPush: () => void;
  openCompare: () => Promise<void>;
  openPopover: () => void;
}

export function useGitActionShortcuts(options: GitActionShortcutOptions): void {
  useShortcut("git-commit", (event) => {
    if (isInCodeMirrorEditor(event.target)) return;
    if (!options.commitActivity && options.state.disabled.commit !== null) return;
    event.preventDefault();
    options.openCommit();
  });
  useShortcut("git-push", (event) => {
    if (options.state.disabled.push !== null) return;
    event.preventDefault();
    options.openPush();
  });
  useShortcut("git-pr", (event) => {
    if (options.state.disabled.pr !== null) return;
    event.preventDefault();
    void options.openCompare();
  });
  useGlobalShortcutById("git-actions", (event) => {
    event.preventDefault();
    options.openPopover();
  });
}
