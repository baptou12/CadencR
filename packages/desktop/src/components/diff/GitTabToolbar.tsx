import { Loader2Icon, PanelLeft, PanelLeftClose } from "lucide-react";
import type { ReactElement } from "react";
import { NumStat } from "@/components/NumStat";
import { GitTabToggle, type GitViewMode } from "./GitTabToggle";

export interface GitTabToolbarProps {
  viewMode: GitViewMode;
  onViewModeChange: (next: GitViewMode) => void;
  targetBranch: string | undefined;
  prLabel: string | undefined;
  prAttention: boolean;
  isSavingView: boolean;
  /** List views drive their own per-row stats and have no file list. */
  isListView: boolean;
  fileListCollapsed: boolean;
  isFileListCollapseLoading: boolean;
  onToggleFileList: () => void;
  stats: { isLoading: boolean; isError: boolean; additions?: number; deletions?: number };
}

export function GitTabToolbar({
  viewMode,
  onViewModeChange,
  targetBranch,
  prLabel,
  prAttention,
  isSavingView,
  isListView,
  fileListCollapsed,
  isFileListCollapseLoading,
  onToggleFileList,
  stats,
}: GitTabToolbarProps): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
      {!isListView && (
        <button
          type="button"
          onClick={onToggleFileList}
          disabled={isFileListCollapseLoading}
          aria-pressed={!fileListCollapsed}
          aria-label={fileListCollapsed ? "Expand file list" : "Collapse file list"}
          title={fileListCollapsed ? "Expand file list" : "Collapse file list"}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {fileListCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      )}
      <GitTabToggle
        value={viewMode}
        onChange={onViewModeChange}
        targetBranch={targetBranch}
        prLabel={prLabel}
        prAttention={prAttention}
        disabled={isSavingView}
      />
      {isSavingView && (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2Icon className="size-3 animate-spin" aria-hidden /> Saving view…
        </span>
      )}
      {!isListView && <GitToolbarNumStat {...stats} />}
    </div>
  );
}

function GitToolbarNumStat({
  isLoading,
  isError,
  additions,
  deletions,
}: GitTabToolbarProps["stats"]): ReactElement {
  if (isLoading) {
    return <span className="text-xs text-muted-foreground animate-pulse">Loading stats…</span>;
  }
  if (isError) {
    return <span className="text-xs text-destructive">Stats unavailable</span>;
  }
  return (
    <NumStat
      additions={additions}
      deletions={deletions}
      hideZero={false}
      className="text-xs shrink-0"
    />
  );
}
