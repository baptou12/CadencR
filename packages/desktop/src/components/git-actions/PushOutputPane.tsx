/**
 * Streaming bash terminal for the push dialog.
 *
 * Mirror of `CommitOutputPane`: the same `BashBlock`-backed adapter, just
 * pulling its buffer + lifecycle from `usePushOutputStore` via narrow
 * selectors. Kept separate from the commit pane so each surface owns its
 * own running/error semantics — push doesn't have the same "pre-commit
 * hooks may take minutes" footer copy, and the empty-state command label
 * differs ("Pushing…" vs "Committing…").
 */
import { memo, type ReactElement } from "react";
import { BashBlock } from "@/components/BashBlock";
import {
  selectPushOutput,
  selectPushRunning,
  usePushOutputStore,
} from "@/stores/usePushOutputStore";

interface PushOutputPaneProps {
  featureId: number;
  /**
   * The mutation's `isPending`. We treat the pane as "running" if either
   * the HTTP request or the WS lifecycle says so — the WS may flip to
   * complete first, and the request may still be in flight when no WS
   * arrived (e.g. running offline).
   */
  isMutationPending: boolean;
  /** Whether the last completed push failed. Switches `BashBlock` to error mode. */
  hasFailed: boolean;
}

export const PushOutputPane = memo(function PushOutputPane({
  featureId,
  isMutationPending,
  hasFailed,
}: PushOutputPaneProps): ReactElement | null {
  const text = usePushOutputStore(selectPushOutput(featureId));
  const wsRunning = usePushOutputStore(selectPushRunning(featureId));
  const running = isMutationPending || wsRunning;

  if (!text && !running) return null;

  // Same invariant as the commit pane: the block is "in error" only after
  // the push has actually exited. ssh prints red lines mid-handshake
  // (host-key warnings, deprecated-cipher notices) that don't mean the
  // push failed — flipping the chrome to red while still running would
  // misrepresent a successful push.
  const isError = hasFailed && !running;

  return (
    <BashBlock
      command="Pushing…"
      content={text}
      running={running}
      isError={isError}
      bodyExtraClassName="max-h-64 overflow-y-auto"
    />
  );
});
