import { memo, useMemo } from "react";
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
 * Segmented control for the Git tab — "Uncommitted", "vs <target>", "Commits",
 * "Branches", and "Stashes". Mounted next to the streaming agent area, so it must stay
 * cheap to render and stable across pushes from `useGitStatusStore`.
 */
export const GitTabToggle = memo(function GitTabToggle({
  value,
  onChange,
  targetBranch,
  prLabel = "PR",
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
        onClick={() => onChange("uncommitted")}
      />
      <ToggleButton
        active={value === "vs-target"}
        disabled={disabled}
        label={targetLabel}
        onClick={() => onChange("vs-target")}
      />
      <ToggleButton
        active={value === "pr"}
        attention={prAttention}
        disabled={disabled}
        label={prLabel}
        onClick={() => onChange("pr")}
      />
      <ToggleButton
        active={value === "graph"}
        disabled={disabled}
        label="Commits"
        onClick={() => onChange("graph")}
      />
      <ToggleButton
        active={value === "branches"}
        disabled={disabled}
        label="Branches"
        onClick={() => onChange("branches")}
      />
      <ToggleButton
        active={value === "stashes"}
        disabled={disabled}
        label="Stashes"
        onClick={() => onChange("stashes")}
      />
    </div>
  );
});

interface ToggleButtonProps {
  active: boolean;
  disabled: boolean;
  label: string;
  attention?: boolean;
  onClick: () => void;
}

function ToggleButton({ active, attention = false, disabled, label, onClick }: ToggleButtonProps) {
  return (
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
        {attention && <span className="size-1.5 rounded-full bg-[var(--acc-orange)]" aria-hidden />}
      </span>
    </button>
  );
}
