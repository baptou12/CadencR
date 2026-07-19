import { memo, useCallback, useRef, useState, type ReactElement, type RefObject } from "react";
import { ArchiveRestoreIcon, Loader2Icon, PackageOpenIcon, Trash2Icon } from "lucide-react";
import { NumStat } from "@/components/NumStat";
import type { StashEntry } from "@/api/generated";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeDate } from "./DiffFileTreeHelpers";
import { StashDropConfirmationDialog } from "./StashDropConfirmationDialog";
import type {
  StashConflictHandler,
  StashConflictOpenHandler,
  StashMutationOperation,
} from "./stash-contracts";
import type { StashMutationCoordinator } from "./useStashMutationCoordinator";
import { useStashMutations } from "./useStashMutations";

export const STASH_ROW_HEIGHT = 46;

export interface StashRowProps {
  featureId: number;
  stash: StashEntry;
  onOpen: (stash: StashEntry) => void;
  onConflicts?: StashConflictHandler;
  onOpenConflict?: StashConflictOpenHandler;
  onRefresh?: () => Promise<void>;
  coordinator?: StashMutationCoordinator;
}

export const StashRow = memo(function StashRow({
  featureId,
  stash,
  onOpen,
  onConflicts,
  onOpenConflict,
  onRefresh,
  coordinator,
}: StashRowProps): ReactElement {
  const [dropConfirmationOpen, setDropConfirmationOpen] = useState(false);
  const dropButtonRef = useRef<HTMLButtonElement | null>(null);
  const actions = useStashMutations({
    featureId,
    stash,
    onConflicts,
    onOpenConflict,
    onRefresh,
    coordinator,
  });
  const blockedReason = actions.pendingOperation ? null : (coordinator?.blockedReason ?? null);

  const handleOpen = useCallback((): void => onOpen(stash), [onOpen, stash]);
  const handleApply = useCallback((): void => void actions.apply(), [actions]);
  const handlePop = useCallback((): void => void actions.pop(), [actions]);
  const handleDropRequest = useCallback((): void => setDropConfirmationOpen(true), []);
  const handleDropOpenChange = useCallback((open: boolean): void => {
    setDropConfirmationOpen(open);
    if (!open) queueMicrotask(() => dropButtonRef.current?.focus());
  }, []);
  const handleDropConfirm = useCallback(async (): Promise<void> => {
    const completed = await actions.drop();
    if (completed) handleDropOpenChange(false);
  }, [actions, handleDropOpenChange]);
  const handleDropConfirmClick = useCallback(
    (): void => void handleDropConfirm(),
    [handleDropConfirm],
  );

  return (
    <div
      style={{ height: STASH_ROW_HEIGHT }}
      className="group flex w-full items-stretch transition-colors hover:bg-accent/60"
    >
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Open ${stash.ref_name}: ${stash.message}`}
        className="flex min-w-0 flex-1 items-center px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <StashRowDetails stash={stash} />
      </button>

      <StashRowActions
        stash={stash}
        pendingOperation={actions.pendingOperation}
        blockedReason={blockedReason}
        dropButtonRef={dropButtonRef}
        onApply={handleApply}
        onPop={handlePop}
        onDropRequest={handleDropRequest}
      />

      <span className="sr-only" aria-live="polite">
        {actions.pendingOperation ? `${actions.pendingOperation} stash in progress` : ""}
      </span>
      <StashDropConfirmationDialog
        open={dropConfirmationOpen}
        stash={stash}
        pending={actions.pendingOperation === "drop"}
        blocked={blockedReason !== null}
        onOpenChange={handleDropOpenChange}
        onConfirm={handleDropConfirmClick}
      />
    </div>
  );
});

interface StashRowActionsProps {
  stash: StashEntry;
  pendingOperation: StashMutationOperation | null;
  blockedReason: string | null;
  dropButtonRef: RefObject<HTMLButtonElement | null>;
  onApply: () => void;
  onPop: () => void;
  onDropRequest: () => void;
}

const StashRowActions = memo(function StashRowActions({
  stash,
  pendingOperation,
  blockedReason,
  dropButtonRef,
  onApply,
  onPop,
  onDropRequest,
}: StashRowActionsProps): ReactElement {
  return (
    <div
      role="group"
      aria-label={`Actions for ${stash.ref_name}: ${stash.message}`}
      className="mr-1 flex shrink-0 items-center gap-0.5"
    >
      <StashInlineAction
        operation="apply"
        stashRef={stash.ref_name}
        pendingOperation={pendingOperation}
        blockedReason={blockedReason}
        onClick={onApply}
      />
      <StashInlineAction
        operation="pop"
        stashRef={stash.ref_name}
        pendingOperation={pendingOperation}
        blockedReason={blockedReason}
        onClick={onPop}
      />
      <StashInlineAction
        buttonRef={dropButtonRef}
        operation="drop"
        stashRef={stash.ref_name}
        pendingOperation={pendingOperation}
        blockedReason={blockedReason}
        onClick={onDropRequest}
      />
    </div>
  );
});

interface StashInlineActionProps {
  operation: StashMutationOperation;
  stashRef: string;
  pendingOperation: StashMutationOperation | null;
  blockedReason: string | null;
  onClick: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

const ACTION_ICONS = {
  apply: ArchiveRestoreIcon,
  pop: PackageOpenIcon,
  drop: Trash2Icon,
} as const;

const ACTION_LABELS: Record<StashMutationOperation, string> = {
  apply: "Apply",
  pop: "Pop",
  drop: "Drop",
};

const ACTION_CLASS_NAMES: Record<StashMutationOperation, string> = {
  apply: "text-[var(--acc-green)] hover:bg-[var(--acc-green)]/15 hover:text-[var(--acc-green)]",
  pop: "text-[var(--acc-cyan)] hover:bg-[var(--acc-cyan)]/15 hover:text-[var(--acc-cyan)]",
  drop: "text-[var(--acc-red)] hover:bg-[var(--acc-red)]/15 hover:text-[var(--acc-red)]",
};

const StashInlineAction = memo(function StashInlineAction({
  operation,
  stashRef,
  pendingOperation,
  blockedReason,
  onClick,
  buttonRef,
}: StashInlineActionProps): ReactElement {
  const Icon = ACTION_ICONS[operation];
  const label = ACTION_LABELS[operation];
  const isPending = pendingOperation === operation;
  const disabled = pendingOperation !== null || blockedReason !== null;

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="xs"
      disabled={disabled}
      onClick={onClick}
      aria-label={isPending ? `${label} ${stashRef} in progress` : `${label} ${stashRef}`}
      title={blockedReason ?? `${label} ${stashRef}`}
      className={cn("h-7 px-1.5 text-[10px] disabled:opacity-40", ACTION_CLASS_NAMES[operation])}
    >
      {isPending ? <Loader2Icon className="size-3 animate-spin" /> : <Icon className="size-3" />}
      {label}
    </Button>
  );
});

const StashRowDetails = memo(function StashRowDetails({
  stash,
}: {
  stash: StashEntry;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-mono text-xs text-primary">{stash.ref_name}</span>
        <span className="min-w-0 truncate text-xs text-foreground">{stash.message}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="shrink-0">{formatRelativeDate(stash.date)}</span>
        <span aria-hidden>·</span>
        <span className="shrink-0">
          {stash.files_changed} {stash.files_changed === 1 ? "file" : "files"}
        </span>
        <NumStat
          additions={stash.additions}
          deletions={stash.deletions}
          className="shrink-0 text-[10px]"
        />
      </div>
    </div>
  );
});
