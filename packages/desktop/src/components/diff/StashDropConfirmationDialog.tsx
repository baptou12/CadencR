import { memo, type ReactElement } from "react";
import { Loader2Icon } from "lucide-react";
import type { StashEntry } from "@/api/generated";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StashDropConfirmationDialogProps {
  open: boolean;
  stash: StashEntry;
  pending: boolean;
  blocked: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const StashDropConfirmationDialog = memo(function StashDropConfirmationDialog({
  open,
  stash,
  pending,
  blocked,
  onOpenChange,
  onConfirm,
}: StashDropConfirmationDialogProps): ReactElement {
  const handleOpenChange = (nextOpen: boolean): void => {
    if (!pending) onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm" aria-busy={pending}>
        <DialogHeader>
          <DialogTitle>Drop {stash.ref_name}?</DialogTitle>
          <DialogDescription>
            Permanently drop <span className="font-mono text-foreground">{stash.ref_name}</span>: “
            <span className="text-foreground">{stash.message}</span>”. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={pending || blocked}
            title={blocked ? "Another stash operation is in progress" : undefined}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {pending ? "Dropping…" : "Drop stash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
