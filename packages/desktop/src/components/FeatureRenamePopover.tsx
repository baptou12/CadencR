import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUpdateFeatureTitle } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";

interface FeatureRenameFormProps {
  featureId: number;
  currentTitle: string;
  /** Called after a successful rename or when the user cancels. */
  onClose: () => void;
  /** Whether the parent popover is currently open. Used to reset the input. */
  open: boolean;
}

/**
 * Form body for the manual feature-rename popover. The mutation does not
 * touch React Query directly — the backend broadcasts `feature.updated` and
 * `session.feature.renamed` envelopes on success, and the ws-envelope handler
 * is the single source of truth for cache invalidation + the per-session
 * `featureTitle` slot (see no-optimistic-updates.md).
 */
export function FeatureRenameForm({
  featureId,
  currentTitle,
  onClose,
  open,
}: FeatureRenameFormProps): ReactElement {
  const [value, setValue] = useState(currentTitle);

  // Reset the input every time the popover opens so reopening after a cancel
  // shows the current title rather than a stale draft.
  useEffect(() => {
    if (open) setValue(currentTitle);
  }, [open, currentTitle]);

  const mutation = useUpdateFeatureTitle({
    mutation: {
      onSuccess: () => {
        toast.success("Feature renamed");
        onClose();
      },
      onError: (error) => {
        toast.error(apiErrorMessage(error, "Failed to rename feature"));
      },
    },
  });

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentTitle && !mutation.isPending;

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({ id: featureId, data: { title: trimmed } });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="text-xs font-medium text-muted-foreground">Rename feature</label>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Feature name"
        maxLength={120}
        disabled={mutation.isPending}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
