import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface EditorLeaveDialogState {
  cancel: () => void;
  dirtyCount: number;
  isSaving: boolean;
  open: boolean;
  saveAndSwitch: () => Promise<void>;
  switchWithoutSaving: () => void;
}

export function EditorLeaveDialog({ leave }: { leave: EditorLeaveDialogState }) {
  return (
    <Dialog
      open={leave.open}
      onOpenChange={(open) => {
        if (!open) leave.cancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsaved Changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes in {leave.dirtyCount} file
            {leave.dirtyCount !== 1 ? "s" : ""}. Switch tab anyway?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={leave.cancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={leave.switchWithoutSaving}>
            Switch Without Saving
          </Button>
          <Button onClick={() => void leave.saveAndSwitch()} disabled={leave.isSaving}>
            {leave.isSaving ? "Saving…" : "Save All & Switch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
