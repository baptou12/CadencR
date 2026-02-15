import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SendIcon, Loader2Icon } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { trpc } from "@/trpc";

interface DiffViewerModalProps {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DiffViewerModal({
  featureId,
  open,
  onOpenChange,
}: DiffViewerModalProps) {
  const [sending, setSending] = useState(false);

  const { data: comments = [] } = trpc.diffComments.list.useQuery(
    { featureId },
    { enabled: open },
  );
  const markAsSent = trpc.diffComments.markAsSent.useMutation();
  const utils = trpc.useUtils();

  const pendingComments = comments.filter((c) => c.status === "pending");

  const handleSendToAgent = async () => {
    if (pendingComments.length === 0) return;
    setSending(true);
    try {
      await markAsSent.mutateAsync({ featureId });
      await utils.diffComments.list.invalidate({ featureId });
      // The comments have been marked as sent. A future integration can
      // pick up sent comments and feed them to an agent session. For now
      // this completes the user-facing action.
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[95vw] sm:max-w-[95vw] flex-col gap-0 p-0"
        showCloseButton={true}
      >
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>Diff Viewer</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffViewer featureId={featureId} mode="worktree" />
        </div>

        <DialogFooter className="border-t px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pendingComments.length === 0 || sending}
            onClick={handleSendToAgent}
          >
            {sending ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <SendIcon className="mr-2 size-4" />
            )}
            Send {pendingComments.length} comment{pendingComments.length !== 1 ? "s" : ""} to agent
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
