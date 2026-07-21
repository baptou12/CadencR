import { memo, type ReactElement } from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

interface GitDiffToolbarProps {
  diffMode: "unified" | "split";
  onDiffModeChange: (mode: "unified" | "split") => void;
  isPreferenceLoading: boolean;
  viewedCount?: number;
  fileCount?: number;
  isViewedPending?: boolean;
}

export const GitDiffToolbar = memo(function GitDiffToolbar({
  diffMode,
  onDiffModeChange,
  isPreferenceLoading,
  viewedCount,
  fileCount,
  isViewedPending = false,
}: GitDiffToolbarProps): ReactElement {
  const showViewedProgress = viewedCount != null && fileCount != null;
  return (
    <div
      role="toolbar"
      aria-label="Diff display"
      className="flex min-h-8 shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border bg-card/40 px-3 py-1"
    >
      {showViewedProgress && (
        <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {viewedCount}/{fileCount} viewed{isViewedPending ? " · Updating…" : ""}
        </span>
      )}
      <div className="inline-flex items-center rounded-md border border-border p-0.5">
        <ModeButton
          active={diffMode === "unified"}
          disabled={isPreferenceLoading}
          label="Unified"
          onClick={() => onDiffModeChange("unified")}
        />
        <ModeButton
          active={diffMode === "split"}
          disabled={isPreferenceLoading}
          label="Split"
          onClick={() => onDiffModeChange("split")}
        />
      </div>
      {isPreferenceLoading && (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2Icon className="size-3 animate-spin" aria-hidden /> Loading display…
        </span>
      )}
    </div>
  );
});

function ModeButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {label}
    </button>
  );
}
