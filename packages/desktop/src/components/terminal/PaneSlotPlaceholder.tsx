import { memo, useCallback } from "react";
import { TerminalCwdWarning } from "./TerminalCwdWarning";
import { TerminalPaneContextMenu } from "./TerminalPaneContextMenu";
import { isCwdStale, type TerminalLeaf } from "@/hooks/terminal-tree";
import type { SplitOrientation } from "@/hooks/useTerminalState";

interface PaneSlotPlaceholderProps {
  leaf: TerminalLeaf;
  expectedCwd: string | null;
  /**
   * Whether the cwd-mismatch warning should be shown for this pane. Decided by
   * the parent: only busy shells (a command is running) warn — idle ones are
   * auto-switched to the new worktree instead, so they never reach here.
   */
  showWarning: boolean;
  registerPlaceholder: (id: string, el: HTMLDivElement | null) => void;
  onFocus: (paneId: string) => void;
  onSplit: (paneId: string, orientation: SplitOrientation) => void;
  onRestart: (paneId: string) => void;
  onDismiss: (paneId: string) => void;
  onClose: (paneId: string) => void;
  onCopy: (paneId: string) => void;
  onPaste: (paneId: string) => void;
}

/**
 * Per-pane container that hosts the imperatively-appended xterm slot and
 * (optionally) a cwd-mismatch warning banner *below* it.
 *
 * The xterm slot is appended via `appendChild` to a dedicated inner anchor
 * div that is always the first JSX child. The warning is rendered as a
 * subsequent JSX sibling, so the DOM order (slot first, warning last) is
 * deterministic regardless of whether the warning was already visible at
 * mount or appeared later once the PTY reported its cwd. Anchoring the
 * appendChild target to its own div is what guarantees this — appending
 * directly to the placeholder div used to interleave with the React-managed
 * warning, which is why the banner sometimes ended up above the terminal.
 *
 * Memoized + paneId-arg callbacks so a sibling pane re-rendering doesn't
 * cascade through the whole tree.
 */
export const PaneSlotPlaceholder = memo(function PaneSlotPlaceholder({
  leaf,
  expectedCwd,
  showWarning,
  registerPlaceholder,
  onFocus,
  onSplit,
  onRestart,
  onDismiss,
  onClose,
  onCopy,
  onPaste,
}: PaneSlotPlaceholderProps) {
  // The slot anchor is what receives the imperative appendChild from
  // TerminalPanel, not the outer div. This keeps the xterm slot above any
  // React-rendered siblings (e.g. the warning banner).
  const slotAnchorRef = useCallback(
    (el: HTMLDivElement | null) => registerPlaceholder(leaf.id, el),
    [registerPlaceholder, leaf.id],
  );
  const handleFocus = useCallback(() => onFocus(leaf.id), [onFocus, leaf.id]);
  const handleRestart = useCallback(() => onRestart(leaf.id), [onRestart, leaf.id]);
  const handleDismiss = useCallback(() => onDismiss(leaf.id), [onDismiss, leaf.id]);

  // The parent only flags a pane once it has confirmed the shell is busy, so the
  // banner never flashes for idle terminals we're about to auto-switch. Re-check
  // staleness (shared with the auto-switch hook) so a since-dismissed or
  // reconnected pane stops warning; the trailing checks narrow the display props.
  const warning =
    showWarning && isCwdStale(leaf, expectedCwd) && leaf.cwd && expectedCwd ? (
      <TerminalCwdWarning
        paneCwd={leaf.cwd}
        expectedCwd={expectedCwd}
        onRestart={handleRestart}
        onDismiss={handleDismiss}
      />
    ) : null;

  return (
    <TerminalPaneContextMenu
      paneId={leaf.id}
      canClose
      onOpen={onFocus}
      onSplit={onSplit}
      onClose={onClose}
      onCopy={onCopy}
      onPaste={onPaste}
    >
      <div className="flex h-full w-full flex-col" onClick={handleFocus}>
        <div ref={slotAnchorRef} className="flex min-h-0 flex-1 flex-col" />
        {warning}
      </div>
    </TerminalPaneContextMenu>
  );
});
