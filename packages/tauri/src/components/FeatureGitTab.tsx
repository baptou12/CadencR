import { useMemo } from "react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { Button } from "@/components/ui/button";
import { SendIcon, Loader2Icon } from "lucide-react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { DiffViewer } from "./diff/DiffViewer";
import { useListDiffComments } from "@/api/generated";
import { useSendPendingComments } from "@/hooks/useSendPendingComments";

interface FeatureGitTabProps {
  featureId: number;
  diffMode?: "worktree" | "branch";
  /**
   * Sends formatted comments to the current agent (ws-session case).
   * Mutually exclusive with `onStartReviewFixer`; if both are supplied the
   * fixer wins.
   */
  onSendComments?: (message: string) => void;
  /**
   * Starts the review-fixer agent with formatted comments (ws-feature case).
   */
  onStartReviewFixer?: (message: string) => void;
}

export function FeatureGitTab({
  featureId,
  diffMode = "worktree",
  onSendComments,
  onStartReviewFixer,
}: FeatureGitTabProps) {
  const { data: comments = [] } = useListDiffComments(featureId);
  const pendingComments = useMemo(
    () => comments.filter((c) => c.status === "pending"),
    [comments],
  );

  const onSend = onStartReviewFixer ?? onSendComments;
  const { send, sending, buttonLabel, disabled, shouldRender } = useSendPendingComments({
    featureId,
    pendingComments,
    onSend,
    verb: onStartReviewFixer ? "Fix" : "Send",
  });

  useGlobalShortcut("meta+enter", (e) => {
    e.preventDefault();
    void send();
  });

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffViewer featureId={featureId} mode={diffMode} />
      </div>
      {shouldRender && (
        <div className="border-t px-4 py-3 flex justify-end">
          <ShortcutTooltip label={buttonLabel} keys={["cmd", "enter"]} above>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void send()}
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
