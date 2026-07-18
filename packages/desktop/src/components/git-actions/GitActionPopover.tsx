/**
 * Keyboard-first Git action picker for `GitActionButton`.
 */
import { type ComponentType, type ReactElement } from "react";
import {
  GitCommit,
  GitMerge,
  GitPullRequest,
  Loader2,
  Play,
  RefreshCw,
  Undo2,
  Upload,
} from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { CommitActivity, GitAction, GitActionState } from "./useGitAction";

export interface GitActionRegistration {
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Additive registration seam for action-picker entries. Phase 2B can add its
 * `stash` registration and ordering entry here, route it in `GitActionButton`,
 * and mount its controlled dialog in the sibling outlet without coupling them.
 */
export const GIT_ACTION_REGISTRATIONS: Readonly<Record<GitAction, GitActionRegistration>> = {
  commit: { label: "Commit", icon: GitCommit },
  update: { label: "Update", icon: RefreshCw },
  push: { label: "Push", icon: Upload },
  pr: { label: "Open compare", icon: GitPullRequest },
  merge: { label: "Merge", icon: GitMerge },
};

const GIT_ACTION_ORDER: readonly GitAction[] = ["commit", "update", "push", "pr", "merge"];

export function gitActionIcon(action: GitAction): ComponentType<{ className?: string }> {
  return GIT_ACTION_REGISTRATIONS[action].icon;
}

export interface GitUpdateRecoveryControls {
  pendingAction: "continue" | "abort" | null;
  error: string | null;
  onContinue: () => void;
  onAbort: () => void;
}

interface GitActionPopoverProps {
  state: GitActionState;
  commitActivity?: CommitActivity;
  onPick: (action: GitAction) => void;
  recoveryControls?: GitUpdateRecoveryControls | null;
}

export function GitActionPopover({
  state,
  commitActivity = null,
  onPick,
  recoveryControls = null,
}: GitActionPopoverProps): ReactElement {
  return (
    <Command>
      <CommandInput autoFocus placeholder="Search git actions…" />
      <CommandList>
        <CommandEmpty>No matching git action.</CommandEmpty>
        <CommandGroup>
          {GIT_ACTION_ORDER.map((action) => {
            const { label: registeredLabel, icon: Icon } = GIT_ACTION_REGISTRATIONS[action];
            const reason = action === "commit" && commitActivity ? null : state.disabled[action];
            const label =
              action === "commit" && commitActivity === "running"
                ? "View commit progress"
                : action === "commit" && commitActivity === "failed"
                  ? "View commit error"
                  : action === "pr"
                    ? state.compareLabel
                    : registeredLabel;
            return (
              <CommandItem
                key={action}
                value={`${label} ${action}`}
                disabled={reason !== null}
                onSelect={() => onPick(action)}
                title={reason ?? label}
                className="justify-between"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
                {reason && (
                  <span className="ml-3 max-w-[170px] truncate text-[10px] text-muted-foreground">
                    {reason}
                  </span>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>
        {state.recovery && recoveryControls && (
          <CommandGroup heading="Update recovery">
            <RecoveryCommand
              action="continue"
              disabledReason={state.recovery.continueDisabled}
              pendingAction={recoveryControls.pendingAction}
              onSelect={recoveryControls.onContinue}
            />
            <RecoveryCommand
              action="abort"
              disabledReason={state.recovery.abortDisabled}
              pendingAction={recoveryControls.pendingAction}
              onSelect={recoveryControls.onAbort}
            />
            {recoveryControls.error && (
              <div
                role="alert"
                className="px-2 py-1.5 text-xs text-destructive whitespace-pre-wrap"
              >
                {recoveryControls.error}
              </div>
            )}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

interface RecoveryCommandProps {
  action: "continue" | "abort";
  disabledReason: string | null;
  pendingAction: "continue" | "abort" | null;
  onSelect: () => void;
}

function RecoveryCommand({
  action,
  disabledReason,
  pendingAction,
  onSelect,
}: RecoveryCommandProps): ReactElement {
  const pending = pendingAction === action;
  const label = action === "continue" ? "Continue update" : "Abort update";
  const Icon = pending ? Loader2 : action === "continue" ? Play : Undo2;
  return (
    <CommandItem
      value={`${label} ${action}`}
      disabled={disabledReason !== null}
      onSelect={onSelect}
      title={disabledReason ?? label}
      className="justify-between"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={pending ? "size-3.5 shrink-0 animate-spin" : "size-3.5 shrink-0"} />
        <span>{label}</span>
      </span>
      {disabledReason && (
        <span className="ml-3 max-w-[170px] truncate text-[10px] text-muted-foreground">
          {disabledReason}
        </span>
      )}
    </CommandItem>
  );
}
