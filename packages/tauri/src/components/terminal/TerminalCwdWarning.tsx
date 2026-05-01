import { memo } from "react";
import { AlertTriangle, RotateCw, X } from "lucide-react";

interface TerminalCwdWarningProps {
  /** Working directory the PTY was actually spawned in (stale). */
  paneCwd: string;
  /** Working directory the feature currently expects (e.g. fresh worktree). */
  expectedCwd: string;
  /** Kill the pane and respawn a new one in the expected cwd. */
  onRestart: () => void;
  /** Hide the warning without restarting. */
  onDismiss: () => void;
}

/**
 * Banner shown above a terminal pane whose PTY was spawned in a directory that
 * no longer matches the feature's expected working directory — typically when
 * a terminal was open before the user toggled "use worktree" on the first
 * prompt, leaving the existing shell pinned to the project root.
 */
export const TerminalCwdWarning = memo(function TerminalCwdWarning({
  paneCwd,
  expectedCwd,
  onRestart,
  onDismiss,
}: TerminalCwdWarningProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-[#3b4261] bg-[#24283b] px-3 py-1.5 text-[11px] text-[#c0caf5]"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#e0af68]" />
      <div className="min-w-0 flex-1 leading-tight">
        <div>
          <span className="font-medium text-[#e0af68]">Wrong working directory.</span> This terminal
          is still running in the project root, not the active worktree.
        </div>
        <div className="mt-0.5 truncate text-[#9aa5ce]" title={`${paneCwd} → ${expectedCwd}`}>
          <span className="text-[#7aa2f7]">now:</span> {paneCwd}{" "}
          <span className="text-[#7aa2f7]">expected:</span> {expectedCwd}
        </div>
      </div>
      <button
        type="button"
        onClick={onRestart}
        className="flex shrink-0 items-center gap-1 rounded bg-[#3b4261] px-2 py-0.5 text-[#c0caf5] transition-colors hover:bg-[#414868]"
      >
        <RotateCw className="size-3" />
        Restart here
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss warning"
        className="flex size-5 shrink-0 items-center justify-center rounded text-[#565f89] transition-colors hover:bg-[#292e42] hover:text-[#c0caf5]"
      >
        <X className="size-3" />
      </button>
    </div>
  );
});
