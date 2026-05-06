/**
 * Streaming bash terminal for the commit dialog.
 *
 * Re-uses the canonical {@link BashBlock} — the same component agent
 * `Bash` tool calls render with — so the commit experience matches the
 * rest of the app pixel-for-pixel:
 *  - Zinc chrome by default; full red palette on error (no custom border).
 *  - ANSI colors / bold / dim / underline parsed via `parseAnsi`.
 *  - "Show last N / Show all" truncation toggle.
 *
 * The pane is a thin adapter: it pulls the streamed buffer + lifecycle
 * flag from `useCommitOutputStore` via narrow selectors and feeds them
 * into `BashBlock`. No layout, no error chrome of its own — those are
 * the bash block's responsibility, end of story.
 */
import { memo, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { BashBlock } from "@/components/BashBlock";
import {
  selectCommitOutput,
  selectCommitRunning,
  useCommitOutputStore,
} from "@/stores/useCommitOutputStore";

interface CommitOutputPaneProps {
  featureId: number;
  /**
   * The mutation's `isPending`. We treat the pane as "running" if either
   * the HTTP request or the WS lifecycle says so — the WS may flip to
   * complete first, and the request may still be in flight when no WS
   * arrived (e.g. running offline).
   */
  isMutationPending: boolean;
  /** Whether the last completed commit failed. Switches `BashBlock` to error mode. */
  hasFailed: boolean;
}

export const CommitOutputPane = memo(function CommitOutputPane({
  featureId,
  isMutationPending,
  hasFailed,
}: CommitOutputPaneProps): ReactElement | null {
  // Narrow selectors: the pane re-renders only when the streamed buffer
  // or the running flag actually changes for *this* feature. Critical
  // for streaming UX — wider subscriptions would re-run parseAnsi on
  // unrelated store mutations.
  const text = useCommitOutputStore(selectCommitOutput(featureId));
  const wsRunning = useCommitOutputStore(selectCommitRunning(featureId));
  const running = isMutationPending || wsRunning;

  // Hide entirely until either the user submits or output starts flowing.
  if (!text && !running) return null;

  // We deliberately don't echo the full `git commit -m "<message>"` here:
  // the textarea above already shows the message verbatim, and reproducing
  // it inside the bash block's header reads as redundant noise — worse,
  // it grows the dialog horizontally for long messages. A short label
  // keeps the focus on the streamed output below.
  const command = "Committing…";

  // Hard invariant: the command is "in error" only once the underlying
  // process has exited. Until the HTTP mutation resolves and the WS lifecycle
  // is `complete`, we keep the block in its neutral chrome — even if the
  // streamed output already contains red ANSI lines from a failing tool
  // (eslint, vitest, …). Pre-commit tools routinely emit colored progress
  // and only the final exit status decides whether the *commit* itself
  // failed; flipping the block red mid-stream would lie about that.
  const isError = hasFailed && !running;

  return (
    <BashBlock
      command={command}
      content={text}
      running={running}
      isError={isError}
      // Cap the live body height: without this the dialog would grow
      // unbounded as the buffer streams in (matters during long
      // pre-commit hook runs). `max-h-64` matches the prior design.
      bodyExtraClassName="max-h-64 overflow-y-auto"
      runningFooter={
        <div className="mt-1 flex items-center gap-1.5 border-t border-zinc-800 pt-1 text-[11px] text-zinc-500">
          <Loader2 className="size-3 animate-spin" />
          Running — pre-commit hooks may take a few minutes.
        </div>
      }
    />
  );
});
