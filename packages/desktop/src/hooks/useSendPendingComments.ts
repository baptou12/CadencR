import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDeletePendingDiffComments, getListDiffCommentsQueryKey } from "@/api/generated";
import { formatCommentsForAgent } from "@/lib/format-diff-comments";

/**
 * Minimal shape of a diff comment the hook cares about.
 * Matches the subset consumed by `formatCommentsForAgent`.
 */
export interface PendingDiffComment {
  file_path: string;
  line_number: number;
  content: string;
}

export interface UseSendPendingCommentsParams {
  featureId: number;
  pendingComments: ReadonlyArray<PendingDiffComment>;
  /**
   * Receives the formatted comment message. If omitted, the hook is inert
   * and `shouldRender` stays `false`.
   */
  onSend?: (message: string) => void;
  /** Runs after a successful dispatch (e.g. close a modal). */
  onAfterSend?: () => void;
  /** Verb used in the button label. Defaults to "Send". */
  verb?: "Send" | "Fix";
}

export interface UseSendPendingCommentsResult {
  send: () => Promise<void>;
  sending: boolean;
  buttonLabel: string;
  disabled: boolean;
  /** Callers should render the button iff this is true. */
  shouldRender: boolean;
}

/**
 * Shared logic for the "send comments" button used by diff-review surfaces.
 * Formats pending comments, waits for the backend to confirm deletion, then
 * dispatches the caller-supplied callback.
 */
export function useSendPendingComments(
  params: UseSendPendingCommentsParams,
): UseSendPendingCommentsResult {
  const { featureId, pendingComments, onSend, onAfterSend, verb = "Send" } = params;
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();
  const deletePending = useDeletePendingDiffComments();

  const count = pendingComments.length;
  const shouldRender = !!onSend && count > 0;
  const disabled = sending || count === 0 || !onSend;
  const buttonLabel = `${verb} ${count} ${count === 1 ? "comment" : "comments"}`;

  const send = useCallback(async () => {
    if (disabled || !onSend) return;
    setSending(true);
    try {
      const message = formatCommentsForAgent(pendingComments);
      await deletePending.mutateAsync({ featureId });
      onSend(message);
      onAfterSend?.();
      await queryClient.invalidateQueries({ queryKey: getListDiffCommentsQueryKey(featureId) });
    } catch (err) {
      console.error("Failed to send pending comments", err);
      toast.error("Failed to send comments");
    } finally {
      setSending(false);
    }
  }, [disabled, onSend, onAfterSend, pendingComments, deletePending, featureId, queryClient]);

  return useMemo<UseSendPendingCommentsResult>(
    () => ({ send, sending, buttonLabel, disabled, shouldRender }),
    [send, sending, buttonLabel, disabled, shouldRender],
  );
}
