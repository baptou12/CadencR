/**
 * Caret-popover content for `GitActionButton`. Listed alongside the main
 * action so users can pick a non-primary action (e.g. push when there are
 * uncommitted changes) and see why each is disabled.
 */
import { type ComponentType, type ReactElement } from "react";
import { GitCommit, GitPullRequest, Upload } from "lucide-react";

import type { GitAction, GitActionState } from "./useGitAction";

export const ICONS: Record<GitAction, ComponentType<{ className?: string }>> = {
  commit: GitCommit,
  push: Upload,
  pr: GitPullRequest,
};

const ACTION_LABELS: Record<GitAction, string> = {
  commit: "Commit",
  push: "Push",
  pr: "Open compare",
};

interface GitActionPopoverProps {
  state: GitActionState;
  onPick: (action: GitAction) => void;
}

export function GitActionPopover({ state, onPick }: GitActionPopoverProps): ReactElement {
  const actions: GitAction[] = ["commit", "push", "pr"];
  return (
    <ul className="space-y-0.5">
      {actions.map((action) => {
        const Icon = ICONS[action];
        const reason = state.disabled[action];
        const label = action === "pr" ? state.compareLabel : ACTION_LABELS[action];
        return (
          <li key={action}>
            <button
              type="button"
              disabled={reason !== null}
              onClick={() => onPick(action)}
              title={reason ?? label}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="flex-1 whitespace-nowrap">{label}</span>
              {reason && (
                <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                  {reason}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
