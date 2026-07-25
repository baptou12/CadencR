import { memo, useMemo } from "react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import type { ShortcutId } from "@/lib/shortcuts/registry";
import { formatCombo } from "@/lib/shortcuts/format";
import { cn } from "@/lib/utils";

export type GitViewMode = "uncommitted" | "vs-target" | "pr" | "graph" | "branches" | "stashes";

interface GitTabToggleProps {
  value: GitViewMode;
  onChange: (value: GitViewMode) => void;
  /** Branch shown in the "vs <branch>" label; falls back to "vs target". */
  targetBranch?: string;
  prLabel?: string;
  prAttention?: boolean;
  disabled?: boolean;
}

/**
 * Segmented control for the Git tab — "Uncommitted", "vs <target>", the
 * proposal view, "Commits", "Branches", and "Stashes". Mounted next to the
 * streaming agent area, so it must stay cheap to render and stable across
 * pushes from `useGitStatusStore`.
 *
 * Every tab has a keyboard equivalent; the hover tooltip is where users
 * discover it, so each button reads its live binding from the shortcut
 * registry (override-aware) instead of hardcoding a combo.
 */
export const GitTabToggle = memo(function GitTabToggle({
  value,
  onChange,
  targetBranch,
  prLabel = "Pull request",
  prAttention = false,
  disabled = false,
}: GitTabToggleProps) {
  const targetLabel = useMemo(
    () => (targetBranch && targetBranch.trim() ? `vs ${targetBranch}` : "vs target"),
    [targetBranch],
  );

  return (
    <div
      role="tablist"
      aria-label="Git view mode"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-0.5"
    >
      <ToggleButton
        active={value === "uncommitted"}
        disabled={disabled}
        label="Uncommitted"
        hint="Working-tree changes"
        shortcutId="git-show-uncommitted"
        onClick={() => onChange("uncommitted")}
      />
      <ToggleButton
        active={value === "vs-target"}
        disabled={disabled}
        label={targetLabel}
        hint={`Diff against ${targetBranch?.trim() || "the target branch"}`}
        shortcutId="git-show-vs-target"
        onClick={() => onChange("vs-target")}
      />
      <ToggleButton
        active={value === "pr"}
        attention={prAttention}
        disabled={disabled}
        label={prLabel}
        hint={`${prLabel} status, checks, and comments`}
        shortcutId="git-show-pull-request"
        onClick={() => onChange("pr")}
      />
      <ToggleButton
        active={value === "graph"}
        disabled={disabled}
        label="Commits"
        hint="Commit history graph"
        shortcutId="git-show-commits"
        onClick={() => onChange("graph")}
      />
      <ToggleButton
        active={value === "branches"}
        disabled={disabled}
        label="Branches"
        hint="Local and remote branches"
        shortcutId="git-show-branches"
        onClick={() => onChange("branches")}
      />
      <ToggleButton
        active={value === "stashes"}
        disabled={disabled}
        label="Stashes"
        hint="Stashed changes"
        shortcutId="git-show-stashes"
        onClick={() => onChange("stashes")}
      />
    </div>
  );
});

interface ToggleButtonProps {
  active: boolean;
  disabled: boolean;
  label: string;
  /** Tooltip copy — says what the view shows, since the label is already visible. */
  hint: string;
  shortcutId: ShortcutId;
  attention?: boolean;
  onClick: () => void;
}

function ToggleButton({
  active,
  attention = false,
  disabled,
  label,
  hint,
  shortcutId,
  onClick,
}: ToggleButtonProps) {
  const { keys } = useResolvedShortcut(shortcutId);
  const combo = useMemo(() => formatCombo(keys), [keys]);
  return (
    <ShortcutTooltip label={hint} keys={combo} disabled={disabled}>
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "rounded px-2.5 py-1 text-xs font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {attention && (
            <span className="size-1.5 rounded-full bg-[var(--acc-orange)]" aria-hidden />
          )}
        </span>
      </button>
    </ShortcutTooltip>
  );
}
