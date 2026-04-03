import { useState, useMemo, useCallback } from "react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SendIcon, Loader2Icon } from "lucide-react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { DiffViewer } from "./DiffViewer";
import { useListDiffComments, useDeletePendingDiffComments } from "@/api/generated";
import { useQueryClient } from "@tanstack/react-query";
import { formatCommentsForAgent } from "@/lib/format-diff-comments";

interface DiffViewerModalProps {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diffMode?: "worktree" | "branch";
  hideFooter?: boolean;
  onStartReviewFixer?: (formattedComments: string) => void;
}

export function DiffViewerModal({
  featureId,
  open,
  onOpenChange,
  diffMode = "worktree",
  hideFooter = false,
  onStartReviewFixer,
}: DiffViewerModalProps) {
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const { data: comments = [] } = useListDiffComments(featureId, { enabled: open });
  const deletePending = useDeletePendingDiffComments();

  const pendingComments = comments.filter((c) => c.status === "pending");

  const buttonLabel = useMemo(() => {
    const count = pendingComments.length;
    const noun = count !== 1 ? "comments" : "comment";
    if (onStartReviewFixer) return `Fix ${count} ${noun}`;
    return `Send ${count} ${noun}`;
  }, [pendingComments.length, onStartReviewFixer]);

  const handleSendToAgent = useCallback(async () => {
    if (pendingComments.length === 0 || sending) return;
    setSending(true);
    try {
      const message = formatCommentsForAgent(pendingComments);

      if (onStartReviewFixer) {
        await deletePending.mutateAsync({ featureId });
        onStartReviewFixer(message);
      }
      await queryClient.invalidateQueries({ queryKey: ["diff-comments", featureId] });

      onOpenChange(false);
    } finally {
      setSending(false);
    }
  }, [pendingComments, sending, featureId, deletePending, queryClient, onOpenChange, onStartReviewFixer]);

  useGlobalShortcut("meta+enter", (e) => {
    e.preventDefault();
    void handleSendToAgent();
  }, { enabled: open });

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
          <DiffViewer featureId={featureId} mode={diffMode} />
        </div>

        {!hideFooter && (
          <DialogFooter className="border-t px-4 py-3">
            <ShortcutTooltip label={buttonLabel} keys={["cmd", "enter"]}>
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
                {buttonLabel}
              </Button>
            </ShortcutTooltip>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
