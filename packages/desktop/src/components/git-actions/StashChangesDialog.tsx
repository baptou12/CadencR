import { useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactElement,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import {
  getListStashesQueryKey,
  useGetUncommittedFiles,
  usePushStash,
  type GitOperationResponse,
  type UncommittedFile,
} from "@/api/generated";
import {
  useStashMutationCoordinator,
  type StashMutationLease,
} from "@/components/diff/useStashMutationCoordinator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api-errors";
import { StashChangesDialogBody, type StashDialogViewModel } from "./StashChangesDialogBody";
import { useStashDialogShortcuts } from "./useStashDialogShortcuts";

export interface StashChangesDialogResult {
  outcome: "completed";
  featureId: number;
  name: string | null;
}

export type StashChangesDialogCompleteHandler = (result: StashChangesDialogResult) => void;

export interface StashChangesDialogProps {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: StashChangesDialogCompleteHandler;
}

/** Controlled stash-push dialog. Backend/query state remains authoritative. */
const StashChangesDialog = memo(function StashChangesDialog({
  featureId,
  open,
  onOpenChange,
  onCompleted,
}: StashChangesDialogProps): ReactElement {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const filesQuery = useGetUncommittedFiles(
    { feature_id: featureId },
    { query: { enabled: open } },
  );
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const submission = useStashPushSubmission({
    featureId,
    files,
    filesReady: !filesQuery.isLoading && !filesQuery.isError,
    open,
    onOpenChange,
    onCompleted,
  });
  useStashDialogShortcuts({
    canSubmit: submission.canSubmit,
    enabled: open && !submission.pending,
    nameInputRef,
    onConfirm: submission.handleConfirm,
    onToggle: submission.handleToggleUntracked,
  });

  return (
    <Dialog open={open} onOpenChange={submission.handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] gap-0 overflow-hidden p-0 shadow-xl !w-[min(92vw,46rem)] !max-w-[min(92vw,46rem)] sm:!max-w-[min(92vw,46rem)]"
        aria-busy={submission.pending}
      >
        <form onSubmit={submission.handleSubmit} className="grid min-h-0">
          <DialogHeader className="border-b border-border/70 bg-card/40 px-6 py-5">
            <div className="flex items-start gap-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Archive aria-hidden="true" className="size-4" />
              </div>
              <div className="min-w-0 space-y-1">
                <DialogTitle>Stash changes</DialogTitle>
                <DialogDescription>
                  Save your current work without committing it. Ignored files always stay in the
                  worktree.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <StashChangesDialogBody
            submission={submission}
            files={files}
            loading={filesQuery.isLoading}
            error={filesQuery.isError ? filesQuery.error : null}
            nameInputRef={nameInputRef}
            onOpenChange={onOpenChange}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
});

interface StashPushSubmissionOptions extends StashChangesDialogProps {
  files: UncommittedFile[];
  filesReady: boolean;
}

interface StashPushSubmissionController extends StashDialogViewModel {
  handleConfirm: () => Promise<void>;
  handleOpenChange: (open: boolean) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

function useStashPushSubmission({
  featureId,
  files,
  filesReady,
  open,
  onOpenChange,
  onCompleted,
}: StashPushSubmissionOptions): StashPushSubmissionController {
  const {
    name,
    includeUntracked,
    error,
    submitting,
    setName,
    setIncludeUntracked,
    setError,
    setSubmitting,
  } = useStashFormState(open);
  const leaseRef = useRef<StashMutationLease | null>(null);
  const { mutateAsync: pushStash, isPending: pushStashPending } = usePushStash();
  const coordinator = useStashMutationCoordinator(featureId);
  const refreshStashes = useRefreshStashes(featureId);
  const pending = submitting || pushStashPending;
  const blockedReason = leaseRef.current ? null : coordinator.blockedReason;
  const hasStashable = useHasStashableChanges(files, includeUntracked);
  const canSubmit = filesReady && hasStashable && !pending && !blockedReason;

  const handleNameChange = useCallback((nextName: string): void => setName(nextName), []);
  const handleToggleUntracked = useCallback((): void => {
    if (!pending) setIncludeUntracked((current) => !current);
  }, [pending]);
  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      if (!pending) onOpenChange(nextOpen);
    },
    [onOpenChange, pending],
  );
  const handleConfirm = useCallback(async (): Promise<void> => {
    await submitStashPush({
      canSubmit,
      coordinator,
      featureId,
      includeUntracked,
      leaseRef,
      name,
      onCompleted,
      onOpenChange,
      pushStash,
      refreshStashes,
      setError,
      setSubmitting,
    });
  }, [
    canSubmit,
    coordinator,
    featureId,
    includeUntracked,
    name,
    onCompleted,
    onOpenChange,
    pushStash,
    refreshStashes,
  ]);
  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      await handleConfirm();
    },
    [handleConfirm],
  );

  return useMemo(
    () => ({
      name,
      includeUntracked,
      error,
      blockedReason,
      pending,
      canSubmit,
      handleNameChange,
      handleToggleUntracked,
      handleConfirm,
      handleOpenChange,
      handleSubmit,
    }),
    [
      blockedReason,
      canSubmit,
      error,
      handleNameChange,
      handleConfirm,
      handleOpenChange,
      handleSubmit,
      handleToggleUntracked,
      includeUntracked,
      name,
      pending,
    ],
  );
}

interface SubmitStashPushOptions {
  canSubmit: boolean;
  coordinator: ReturnType<typeof useStashMutationCoordinator>;
  featureId: number;
  includeUntracked: boolean;
  leaseRef: { current: StashMutationLease | null };
  name: string;
  onCompleted?: StashChangesDialogCompleteHandler;
  onOpenChange: (open: boolean) => void;
  pushStash: ReturnType<typeof usePushStash>["mutateAsync"];
  refreshStashes: () => Promise<void>;
  setError: (error: string | null) => void;
  setSubmitting: (submitting: boolean) => void;
}

async function submitStashPush(options: SubmitStashPushOptions): Promise<void> {
  if (!options.canSubmit) return;
  options.setError(null);
  const lease = options.coordinator.tryAcquire({ kind: "push" });
  if (!lease) {
    options.setError(
      options.coordinator.getBlockedReason() ?? "Another stash operation is in progress",
    );
    return;
  }
  options.leaseRef.current = lease;
  options.setSubmitting(true);
  const submittedName = options.name.trim() || null;
  let result: GitOperationResponse | null = null;
  try {
    result = await options.pushStash({
      data: {
        feature_id: options.featureId,
        message: submittedName,
        include_untracked: options.includeUntracked,
      },
    });
    if (result.outcome === "completed") await options.refreshStashes();
  } catch (caught) {
    options.setError(apiErrorMessage(caught, "Could not stash changes."));
  } finally {
    options.leaseRef.current = null;
    options.coordinator.release(lease);
    options.setSubmitting(false);
  }
  handleStashResult({
    result,
    featureId: options.featureId,
    submittedName,
    onOpenChange: options.onOpenChange,
    onCompleted: options.onCompleted,
    setError: options.setError,
  });
}

interface StashFormState {
  name: string;
  includeUntracked: boolean;
  error: string | null;
  submitting: boolean;
  setName: Dispatch<SetStateAction<string>>;
  setIncludeUntracked: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
}

function useStashFormState(open: boolean): StashFormState {
  const [name, setName] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (open) return;
    setName("");
    setIncludeUntracked(false);
    setError(null);
  }, [open]);
  return useMemo(
    () => ({
      name,
      includeUntracked,
      error,
      submitting,
      setName,
      setIncludeUntracked,
      setError,
      setSubmitting,
    }),
    [error, includeUntracked, name, submitting],
  );
}

function useRefreshStashes(featureId: number): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async (): Promise<void> => {
    try {
      await queryClient.invalidateQueries({
        queryKey: getListStashesQueryKey({ feature_id: featureId }),
        exact: true,
      });
    } catch (caught) {
      toast.error("Stashed changes, but could not refresh the stash list", {
        description: apiErrorMessage(caught, "The stash list may be stale."),
      });
    }
  }, [featureId, queryClient]);
}

function useHasStashableChanges(files: UncommittedFile[], includeUntracked: boolean): boolean {
  return useMemo(
    () => files.some((file) => file.status !== "untracked" || includeUntracked),
    [files, includeUntracked],
  );
}

function handleStashResult({
  result,
  setError,
  ...completion
}: {
  result: GitOperationResponse | null;
  featureId: number;
  submittedName: string | null;
  onOpenChange: (open: boolean) => void;
  onCompleted?: StashChangesDialogCompleteHandler;
  setError: (error: string) => void;
}): void {
  if (!result) return;
  if (result.outcome === "conflicts") {
    setError(`Stash creation unexpectedly reported conflicts: ${result.conflict_files.join(", ")}`);
    return;
  }
  completeStashPush(completion);
}

function completeStashPush({
  featureId,
  submittedName,
  onOpenChange,
  onCompleted,
}: {
  featureId: number;
  submittedName: string | null;
  onOpenChange: (open: boolean) => void;
  onCompleted?: StashChangesDialogCompleteHandler;
}): void {
  const completed: StashChangesDialogResult = {
    outcome: "completed",
    featureId,
    name: submittedName,
  };
  toast.success(submittedName ? `Stashed changes as “${submittedName}”` : "Stashed changes");
  onOpenChange(false);
  try {
    onCompleted?.(completed);
  } catch (caught) {
    toast.error("Stashed changes, but the follow-up action failed", {
      description: apiErrorMessage(caught, "Could not complete the follow-up action."),
    });
  }
}

export default StashChangesDialog;
