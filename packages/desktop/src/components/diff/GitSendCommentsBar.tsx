import { Loader2Icon, SendIcon } from "lucide-react";
import { useMemo, type ReactElement } from "react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { Button } from "@/components/ui/button";
import { formatCombo } from "@/lib/shortcuts/format";
import { useResolvedShortcut } from "@/lib/shortcuts/overrides";

export interface GitSendCommentsBarProps {
  /** Local draft comments. Omitted when there are none to send. */
  drafts?: { label: string; disabled: boolean; sending: boolean; onSend: () => void };
  /** Unresolved review threads pulled from the forge. */
  reviews?: {
    selectedCount: number;
    totalCount: number;
    disabled: boolean;
    onSend: () => void;
  };
}

/**
 * The one place the Git tab hands work to the agent. Local drafts and the
 * forge's unresolved review threads stay separate buttons on purpose: they are
 * different bodies of feedback with different provenance, and a developer
 * usually wants to send exactly one of them.
 */
export function GitSendCommentsBar({
  drafts,
  reviews,
}: GitSendCommentsBarProps): ReactElement | null {
  const reviewShortcut = useResolvedShortcut("diff-send-review-comments");
  const draftShortcut = useResolvedShortcut("diff-send-comments");
  const reviewKeys = useMemo(() => formatCombo(reviewShortcut.keys), [reviewShortcut.keys]);
  const draftKeys = useMemo(() => formatCombo(draftShortcut.keys), [draftShortcut.keys]);
  if (!drafts && !reviews) return null;
  return (
    <div className="flex min-h-14 items-center justify-end gap-2 border-t bg-card/30 px-4 py-3">
      {reviews && (
        <>
          <span className="mr-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {reviews.selectedCount} of {reviews.totalCount}{" "}
            {reviews.totalCount === 1 ? "thread" : "threads"} picked for the agent
          </span>
          <ShortcutTooltip label="Send picked threads to the agent" keys={reviewKeys} above>
            <span className="inline-flex">
              <Button size="sm" disabled={reviews.disabled} onClick={reviews.onSend}>
                <SendIcon className="mr-2 size-4" aria-hidden />
                Send {reviews.selectedCount} {reviews.selectedCount === 1 ? "thread" : "threads"}
              </Button>
            </span>
          </ShortcutTooltip>
        </>
      )}
      {drafts && (
        <ShortcutTooltip label={drafts.label} keys={draftKeys} above>
          <Button variant="outline" size="sm" disabled={drafts.disabled} onClick={drafts.onSend}>
            {drafts.sending ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden />
            ) : (
              <SendIcon className="mr-2 size-4" aria-hidden />
            )}
            {drafts.label}
          </Button>
        </ShortcutTooltip>
      )}
    </div>
  );
}
