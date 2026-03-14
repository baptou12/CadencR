import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SendIcon, Loader2Icon } from "lucide-react";
import { KbdShortcut } from "@/components/KbdShortcut";
import { DiffViewer } from "./DiffViewer";
import { trpc } from "@/trpc";
import { useListDiffComments, useMarkDiffCommentsSent, useDeletePendingDiffComments } from "@/api/generated";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";

export interface ExecuteAgentState {
  subprocessId: string;
  status: string;
  pendingQuestions: AgentQuestion[] | null;
}

interface DiffViewerModalProps {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executeState?: ExecuteAgentState;
  diffMode?: "worktree" | "branch";
  hideFooter?: boolean;
  onStartReviewFixer?: (formattedComments: string) => void;
}

function formatCommentsForAgent(
  comments: { file_path: string; line_number: number; content: string }[],
): string {
  const grouped = new Map<string, { line_number: number; content: string }[]>();
  for (const c of comments) {
    const list = grouped.get(c.file_path) ?? [];
    list.push({ line_number: c.line_number, content: c.content });
    grouped.set(c.file_path, list);
  }
  const parts: string[] = [];
  for (const [filePath, items] of grouped) {
    parts.push(`## ${filePath}`);
    for (const item of items) {
      parts.push(`- Line ${item.line_number}: ${item.content}`);
    }
  }
  return parts.join("\n");
}

export function DiffViewerModal({
  featureId,
  open,
  onOpenChange,
  executeState,
  diffMode = "worktree",
  hideFooter = false,
  onStartReviewFixer,
}: DiffViewerModalProps) {
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const { data: comments = [] } = useListDiffComments(featureId, { enabled: open });
  const markAsSent = useMarkDiffCommentsSent();
  const deletePending = useDeletePendingDiffComments();
  const sendMessage = trpc.agents.sendMessage.useMutation();
  const submitAnswers = trpc.agents.submitAnswers.useMutation();

  const pendingComments = comments.filter((c) => c.status === "pending");

  const hasPendingQuestions = !!(
    executeState?.pendingQuestions && executeState.pendingQuestions.length > 0
  );
  const isAgentRunning = (executeState?.status === "running" || executeState?.status === "completed") && !hasPendingQuestions;

  const buttonLabel = useMemo(() => {
    const count = pendingComments.length;
    const noun = count !== 1 ? "comments" : "comment";
    if (hasPendingQuestions) return `Request changes with ${count} ${noun}`;
    if (isAgentRunning) return `Send ${count} ${noun} to agent`;
    if (onStartReviewFixer) return `Fix ${count} ${noun}`;
    return `Send ${count} ${noun}`;
  }, [pendingComments.length, hasPendingQuestions, isAgentRunning, onStartReviewFixer]);

  const handleSendToAgent = useCallback(async () => {
    if (pendingComments.length === 0 || sending) return;
    setSending(true);
    try {
      const message = formatCommentsForAgent(pendingComments);
      const deliveredToAgent = isAgentRunning || hasPendingQuestions;

      if (deliveredToAgent) {
        await deletePending.mutateAsync({ featureId });
      } else if (onStartReviewFixer) {
        await deletePending.mutateAsync({ featureId });
        onStartReviewFixer(message);
      } else {
        await markAsSent.mutateAsync({ featureId });
      }
      await queryClient.invalidateQueries({ queryKey: ["diff-comments", featureId] });

      if (isAgentRunning && executeState?.subprocessId) {
        await sendMessage.mutateAsync({
          id: executeState.subprocessId,
          message,
        });
      } else if (hasPendingQuestions && executeState?.subprocessId) {
        const questions = executeState.pendingQuestions!;
        const answers: Record<string, string> = {};
        // Answer each pending question with "Request changes" + the comments
        for (const q of questions) {
          answers[q.question] = `Request changes\n\n${message}`;
        }
        await submitAnswers.mutateAsync({
          subprocessId: executeState.subprocessId,
          answers,
        });
      }

      onOpenChange(false);
    } finally {
      setSending(false);
    }
  }, [pendingComments, sending, featureId, isAgentRunning, hasPendingQuestions, executeState, deletePending, markAsSent, queryClient, sendMessage, submitAnswers, onOpenChange, onStartReviewFixer]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        void handleSendToAgent();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, handleSendToAgent]);

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
              <KbdShortcut keys={["cmd", "enter"]} />
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
