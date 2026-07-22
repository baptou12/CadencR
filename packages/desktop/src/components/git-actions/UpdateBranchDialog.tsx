import { useState, type ReactElement } from "react";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  useUpdateBranch,
  type GitStatusSnapshot,
  type UpdateBranchStrategy,
} from "@/api/generated";
import { KbdShortcut } from "@/components/KbdShortcut";
import { RadioCardGroup, type RadioCardOption } from "@/components/settings/RadioCardGroup";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api-errors";
import { describeGitUpdateConflictFiles } from "./gitUpdateMessages";
import { resolveGitUpdateSource, type GitUpdateSource } from "./useGitAction";
import { useDialogSubmitShortcut } from "./useDialogSubmitShortcut";
import { gitUpdateMutationKey } from "./useGitUpdatePending";

const ESC_KEYS: string[] = ["esc"];
const SUBMIT_KEYS: string[] = ["cmd", "enter"];

const STRATEGY_OPTIONS: readonly RadioCardOption<UpdateBranchStrategy>[] = [
  {
    value: "rebase",
    label: "Rebase",
    description: "Replay the current branch's commits on the selected update source.",
  },
  {
    value: "merge",
    label: "Merge",
    description: "Merge the selected update source into the current branch.",
  },
];

interface UpdateBranchDialogProps {
  featureId: number;
  open: boolean;
  snapshot: GitStatusSnapshot;
  disabledReason: string | null;
  onOpenChange: (open: boolean) => void;
}

export default function UpdateBranchDialog({
  featureId,
  open,
  snapshot,
  disabledReason,
  onOpenChange,
}: UpdateBranchDialogProps): ReactElement {
  const [strategy, setStrategy] = useState<UpdateBranchStrategy>("rebase");
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateBranch({
    mutation: { mutationKey: gitUpdateMutationKey(featureId) },
  });
  const submitting = update.isPending;
  const source = resolveGitUpdateSource(snapshot);

  async function handleUpdate(): Promise<void> {
    if (submitting || disabledReason) return;
    setError(null);
    try {
      const result = await update.mutateAsync({
        data: { feature_id: featureId, strategy },
      });
      if (result.outcome === "conflicts") {
        toast.warning("Update paused for conflicts", {
          description: describeGitUpdateConflictFiles(result.conflict_files),
        });
        onOpenChange(false);
        return;
      }
      toast.success(`Updated ${snapshot.current_branch} from ${source.branch}`);
      onOpenChange(false);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not update the current branch."));
    }
  }

  useDialogSubmitShortcut({
    open,
    enabled: !submitting && disabledReason === null,
    onSubmit: () => void handleUpdate(),
  });

  const handleOpenChange = (next: boolean): void => {
    if (submitting && !next) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={!submitting} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-5" />
            Update current branch
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <BranchDirection currentBranch={snapshot.current_branch} source={source} />
          <DivergenceCounts source={source} />

          <div className="space-y-2">
            <div className="text-sm font-medium">Update strategy</div>
            <RadioCardGroup<UpdateBranchStrategy>
              ariaLabel="Update strategy"
              value={strategy}
              onChange={setStrategy}
              options={STRATEGY_OPTIONS}
              layout="grid"
              disabled={submitting || disabledReason !== null}
            />
          </div>

          {error && <UpdateError message={error} />}
          {!submitting && disabledReason && <UpdateError message={disabledReason} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
            <KbdShortcut keys={ESC_KEYS} variant="hint" />
          </Button>
          <Button
            onClick={() => void handleUpdate()}
            disabled={submitting || disabledReason !== null}
            title={disabledReason ?? "Update current branch"}
          >
            {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {submitting ? "Updating…" : "Update branch"}
            <KbdShortcut keys={SUBMIT_KEYS} variant="hint" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BranchDirection({
  currentBranch,
  source,
}: {
  currentBranch: string;
  source: GitUpdateSource;
}): ReactElement {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2 font-mono text-sm">
        <code className="truncate" title={source.branch}>
          {source.branch}
        </code>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-label="updates" />
        <code className="truncate" title={currentBranch}>
          {currentBranch}
        </code>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Exact {source.kind} ref: <code>{source.branch}</code>
      </p>
    </div>
  );
}

function DivergenceCounts({ source }: { source: GitUpdateSource }): ReactElement {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-md border border-border p-3">
        <dt className="text-xs text-muted-foreground">Behind {source.kind}</dt>
        <dd className="mt-1 font-mono text-base">{source.behind}</dd>
      </div>
      <div className="rounded-md border border-border p-3">
        <dt className="text-xs text-muted-foreground">Ahead of {source.kind}</dt>
        <dd className="mt-1 font-mono text-base">{source.ahead}</dd>
      </div>
    </dl>
  );
}

function UpdateError({ message }: { message: string }): ReactElement {
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="whitespace-pre-wrap break-words">{message}</p>
    </div>
  );
}
