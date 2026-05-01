import { memo, useCallback } from "react";
import { TerminalCwdWarning } from "./TerminalCwdWarning";
import type { TerminalLeaf } from "@/hooks/useTerminalState";

interface PaneSlotPlaceholderProps {
  leaf: TerminalLeaf;
  expectedCwd: string | null;
  registerPlaceholder: (id: string, el: HTMLDivElement | null) => void;
  onFocus: (paneId: string) => void;
  onRestart: (paneId: string) => void;
  onDismiss: (paneId: string) => void;
}

/**
 * Per-pane container that hosts the imperatively-appended xterm slot and
 * (optionally) a cwd-mismatch warning banner above it. The slot is appended
 * at the end of this element via `appendChild`, so React-rendered children
 * (the warning) stay above it naturally without fighting reconciliation.
 *
 * Memoized + paneId-arg callbacks so a sibling pane re-rendering doesn't
 * cascade through the whole tree.
 */
export const PaneSlotPlaceholder = memo(function PaneSlotPlaceholder({
  leaf,
  expectedCwd,
  registerPlaceholder,
  onFocus,
  onRestart,
  onDismiss,
}: PaneSlotPlaceholderProps) {
  const refCallback = useCallback(
    (el: HTMLDivElement | null) => registerPlaceholder(leaf.id, el),
    [registerPlaceholder, leaf.id],
  );
  const handleFocus = useCallback(() => onFocus(leaf.id), [onFocus, leaf.id]);
  const handleRestart = useCallback(() => onRestart(leaf.id), [onRestart, leaf.id]);
  const handleDismiss = useCallback(() => onDismiss(leaf.id), [onDismiss, leaf.id]);

  const warning =
    leaf.cwd && expectedCwd && leaf.cwd !== expectedCwd && !leaf.cwdWarningDismissed ? (
      <TerminalCwdWarning
        paneCwd={leaf.cwd}
        expectedCwd={expectedCwd}
        onRestart={handleRestart}
        onDismiss={handleDismiss}
      />
    ) : null;

  return (
    <div ref={refCallback} className="flex h-full w-full flex-col" onClick={handleFocus}>
      {warning}
    </div>
  );
});
