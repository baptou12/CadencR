import type { ReactElement } from "react";
import { toast } from "sonner";
import { useKillTerminalSessions, type Feature } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { KillTerminalsOption } from "@/components/KillTerminalsOption";
import { useKillTerminalsState } from "@/components/use-kill-terminals-state";
import { deleteFeatureDialogTitle } from "@/lib/feature-archive-decision";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FeatureDeleteDialogProps {
  open: boolean;
  feature: Feature | undefined;
  onOpenChange: (open: boolean) => void;
  onDelete: (featureId: number) => void;
}

export function FeatureDeleteDialog({
  open,
  feature,
  onOpenChange,
  onDelete,
}: FeatureDeleteDialogProps): ReactElement {
  const killTerminals = useKillTerminalSessions();
  const killState = useKillTerminalsState(open, feature);

  const confirm = (): void => {
    if (!feature) return;
    const featureId = feature.id;
    onDelete(featureId);
    onOpenChange(false);
    if (!killState.killTerminals) return;
    const kill = killTerminals.mutateAsync({ params: { feature_id: featureId } });
    toast.promise(kill, {
      loading: "Killing terminals…",
      success: (res) => `Killed ${res.killed} terminal${res.killed === 1 ? "" : "s"}.`,
      error: (err) => apiErrorMessage(err, "Failed to kill terminals"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirm();
          } else if (event.key.toLowerCase() === "t") {
            event.preventDefault();
            killState.toggleKillTerminals();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{deleteFeatureDialogTitle(feature)}</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>

        {killState.liveTerminalCount > 0 && (
          <KillTerminalsOption
            count={killState.liveTerminalCount}
            checked={killState.killTerminals}
            onToggle={killState.toggleKillTerminals}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
