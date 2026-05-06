import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface FileTreeConfirmPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  confirmLabel?: string;
  pending: boolean;
  onConfirm: () => void;
  /** Anchor element (typically the file-tree row). */
  children: ReactNode;
}

/**
 * Lightweight confirmation popover for destructive file-tree actions
 * (typically "Move to Trash"). Used instead of a full ConfirmDialog modal
 * per the user's UX requirement.
 */
export default function FileTreeConfirmPopover({
  open,
  onOpenChange,
  message,
  confirmLabel = "Confirm",
  pending,
  onConfirm,
  children,
}: FileTreeConfirmPopoverProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-64 p-3">
        <div className="flex flex-col gap-2">
          <p className="text-sm">{message}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onConfirm}
              disabled={pending}
            >
              {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
