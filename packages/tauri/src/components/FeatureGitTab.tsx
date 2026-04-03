import { useState, useMemo, useCallback } from "react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { Button } from "@/components/ui/button";
import { SendIcon, Loader2Icon } from "lucide-react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { DiffViewer } from "./diff/DiffViewer";
import { useListDiffComments, useDeletePendingDiffComments } from "@/api/generated";
import { useQueryClient } from "@tanstack/react-query";
import { formatCommentsForAgent } from "@/lib/format-diff-comments";

interface FeatureGitTabProps {
  featureId: number;
  diffMode?: "worktree" | "branch";
  onStartReviewFixer?: (formattedComments: string) => void;
}

export function FeatureGitTab({ featureId, diffMode = "worktree", onStartReviewFixer }: FeatureGitTabProps) {
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const { data: comments = [] } = useListDiffComments(featureId);
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
    } finally {
      setSending(false);
    }
  }, [pendingComments, sending, featureId, deletePending, queryClient, onStartReviewFixer]);

  useGlobalShortcut("meta+enter", (e) => {
    e.preventDefault();
    void handleSendToAgent();
  });

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffViewer featureId={featureId} mode={diffMode} />
      </div>
      {pendingComments.length > 0 && (
        <div className="border-t px-4 py-3 flex justify-end">
          <ShortcutTooltip label={buttonLabel} keys={["cmd", "enter"]} above>
            <Button
              variant="outline"
              size="sm"
              disabled={sending}
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
        </div>
      )}
    </div>
  );
}
