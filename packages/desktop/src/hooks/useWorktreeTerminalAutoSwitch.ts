import { useEffect, useRef, useState } from "react";
import { listTerminalSessions } from "@/api/generated";
import { isCwdStale, type TerminalLeaf } from "@/hooks/terminal-tree";

interface Params {
  featureId: number;
  /** Working directory the feature currently expects (worktree path or project root). */
  expectedCwd: string | null;
  leaves: TerminalLeaf[];
  /** Kill the pane's PTY and respawn a fresh one in the expected cwd. */
  onRestartPane: (paneId: string) => void;
}

/**
 * When the feature's expected cwd changes (typically a fresh worktree), each
 * open terminal pane pinned to the old directory is reconciled:
 *
 *  - **idle** shell (no foreground command) → auto-restart it in the new cwd,
 *    silently, so the user's terminals follow the worktree with no clicks.
 *  - **busy** shell (a command is running) → surface the "Restart here" warning
 *    instead, so we never kill a running command out from under the user.
 *
 * Returns the set of pane ids that should show the warning banner. If activity
 * can't be determined (backend error), the pane is treated as busy — we never
 * auto-kill a shell we're unsure about.
 */
export function useWorktreeTerminalAutoSwitch({
  featureId,
  expectedCwd,
  leaves,
  onRestartPane,
}: Params): Set<string> {
  const [warnPaneIds, setWarnPaneIds] = useState<Set<string>>(() => new Set());

  // Panes we've already decided about, keyed by `${paneId}:${expectedCwd}` so a
  // later worktree switch re-evaluates the same pane. Marked before the lookup
  // so overlapping effect runs don't fire duplicate activity queries.
  const decidedRef = useRef<Set<string>>(new Set());
  // Latest leaves, read when a lookup resolves so we act on the pane's current
  // state rather than the (possibly stale) snapshot captured when it started.
  const leavesRef = useRef(leaves);
  leavesRef.current = leaves;

  useEffect(() => {
    const key = (leaf: TerminalLeaf): string => `${leaf.id}:${expectedCwd}`;
    const pending = leaves.filter(
      (leaf) => isCwdStale(leaf, expectedCwd) && !decidedRef.current.has(key(leaf)),
    );
    if (pending.length === 0) return;
    for (const leaf of pending) decidedRef.current.add(key(leaf));

    void (async () => {
      let ok = true;
      let sessions: Awaited<ReturnType<typeof listTerminalSessions>> = [];
      try {
        sessions = await listTerminalSessions({ feature_id: featureId });
      } catch (err) {
        ok = false;
        console.warn("[terminal] foreground check failed; keeping cwd warning", err);
      }

      const busy: string[] = [];
      for (const leaf of pending) {
        // Re-read the pane: a restart swaps in a new id (so a stale entry is
        // simply gone), and a reconnect may have already moved it to the right
        // cwd. Only act while it's genuinely still stale.
        const current = leavesRef.current.find((l) => l.id === leaf.id);
        if (!current || !isCwdStale(current, expectedCwd)) continue;
        const session = sessions.find((s) => s.pty_id === current.ptyId);
        // Unknown activity (backend error, or shell already gone) → treat as
        // busy so we never silently kill a possibly-running command.
        if (!ok || (session?.foreground_active ?? true)) busy.push(current.id);
        else onRestartPane(current.id);
      }
      if (busy.length > 0) {
        setWarnPaneIds((prev) => {
          const next = new Set(prev);
          for (const id of busy) next.add(id);
          return next;
        });
      }
    })();
  }, [featureId, expectedCwd, leaves, onRestartPane]);

  return warnPaneIds;
}
