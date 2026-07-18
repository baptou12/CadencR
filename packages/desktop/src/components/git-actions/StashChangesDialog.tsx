import { memo, useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { usePushStash, type GitOperationResponse } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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

/**
 * Controlled dialog seam consumed by the Git action picker integration owner.
 * Successful push relies on the confirmed WS invalidation path; this dialog
 * never writes stash query data optimistically.
 */
export const StashChangesDialog = memo(function StashChangesDialog({
  featureId,
  open,
  onOpenChange,
  onCompleted,
}: StashChangesDialogProps): ReactElement {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pushStash = usePushStash();

  useEffect(() => {
    if (open) return;
    setName("");
    setError(null);
  }, [open]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!pushStash.isPending) onOpenChange(nextOpen);
  };
  const handleNameChange = useCallback((nextName: string): void => setName(nextName), []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pushStash.isPending) return;
    setError(null);
    const trimmedName = name.trim();
    const submittedName = trimmedName.length > 0 ? trimmedName : null;

    let result: GitOperationResponse;
    try {
      result = await pushStash.mutateAsync({
        data: { feature_id: featureId, message: submittedName },
      });
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not stash tracked changes."));
      return;
    }
    if (result.outcome === "conflicts") {
      setError(
        `Stash creation unexpectedly reported conflicts: ${result.conflict_files.join(", ")}`,
      );
      return;
    }

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
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        aria-busy={pushStash.isPending}
      >
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Stash changes</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">Tracked files only.</span> Staged and
              unstaged tracked changes are included; untracked and ignored files stay in the
              worktree.
            </DialogDescription>
          </DialogHeader>

          <StashNameField
            name={name}
            error={error}
            pending={pushStash.isPending}
            onNameChange={handleNameChange}
          />

          <StashChangesDialogFooter pending={pushStash.isPending} onOpenChange={onOpenChange} />
        </form>
      </DialogContent>
    </Dialog>
  );
});

function StashChangesDialogFooter({
  pending,
  onOpenChange,
}: {
  pending: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  return (
    <DialogFooter>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {pending ? "Stashing…" : "Stash changes"}
      </Button>
    </DialogFooter>
  );
}

interface StashNameFieldProps {
  name: string;
  error: string | null;
  pending: boolean;
  onNameChange: (name: string) => void;
}

function StashNameField({ name, error, pending, onNameChange }: StashNameFieldProps): ReactElement {
  return (
    <>
      <div className="grid gap-1.5">
        <label htmlFor="stash-changes-name" className="text-sm font-medium">
          Name <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="stash-changes-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Use Git’s default description"
          autoFocus
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "stash-changes-error" : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to create an unnamed stash with Git’s default description.
        </p>
      </div>
      {error ? (
        <p id="stash-changes-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
