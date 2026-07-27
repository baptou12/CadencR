import { PanelLeft, PanelLeftClose } from "lucide-react";
import type { ReactElement } from "react";
import { NumStat } from "@/components/NumStat";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import type { PrIndicatorTone } from "@/components/PrStatusIndicators";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCombo } from "@/lib/shortcuts/format";
import { useResolvedShortcut } from "@/lib/shortcuts/overrides";
import { GitTabToggle, type GitViewMode } from "./GitTabToggle";

export interface GitTabToolbarProps {
  viewMode: GitViewMode;
  onViewModeChange: (next: GitViewMode) => void;
  targetBranch: string | undefined;
  prLabel: string | undefined;
  prNumber: number | undefined;
  prTone: PrIndicatorTone;
  prAttention: boolean;
  uncommittedCount: number | undefined;
  conflictCount: number;
  /** Set while a view switch is being persisted; identifies which tab. */
  pendingViewMode: GitViewMode | null;
  /** List views drive their own per-row stats and have no file list. */
  isListView: boolean;
  fileListCollapsed: boolean;
  isFileListCollapseLoading: boolean;
  onToggleFileList: () => void;
  stats: { isLoading: boolean; isError: boolean; additions?: number; deletions?: number };
}

/** Width of the file-list toggle, reserved as an empty slot in list views so
 *  the tab strip doesn't shift sideways when you switch view. */
const TOGGLE_SLOT = "size-7 shrink-0";

/**
 * File-list toggle first, navigation next, diff size last — the toggle leads
 * because it sits directly above the sidebar it collapses.
 */
export function GitTabToolbar({
  viewMode,
  onViewModeChange,
  targetBranch,
  prLabel,
  prNumber,
  prTone,
  prAttention,
  uncommittedCount,
  conflictCount,
  pendingViewMode,
  isListView,
  fileListCollapsed,
  isFileListCollapseLoading,
  onToggleFileList,
  stats,
}: GitTabToolbarProps): ReactElement {
  // `@container`: the tab strip drops its inactive labels by the width of this
  // bar, not the window — the Git tab is routinely a narrow floating column
  // beside the agent stream, and the two have nothing to do with each other.
  return (
    <div className="@container flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      {isListView ? (
        <div className={TOGGLE_SLOT} aria-hidden data-slot="file-list-toggle-placeholder" />
      ) : (
        <FileListToggle
          collapsed={fileListCollapsed}
          loading={isFileListCollapseLoading}
          onToggle={onToggleFileList}
        />
      )}
      <GitTabToggle
        value={viewMode}
        onChange={onViewModeChange}
        targetBranch={targetBranch}
        prLabel={prLabel}
        prNumber={prNumber}
        prTone={prTone}
        prAttention={prAttention}
        uncommittedCount={uncommittedCount}
        conflictCount={conflictCount}
        pendingValue={pendingViewMode}
      />
      {!isListView && (
        <div className="ml-auto">
          <GitToolbarNumStat {...stats} />
        </div>
      )}
    </div>
  );
}

function FileListToggle({
  collapsed,
  loading,
  onToggle,
}: {
  collapsed: boolean;
  loading: boolean;
  onToggle: () => void;
}): ReactElement {
  const { keys } = useResolvedShortcut("diff-toggle-sidebar");
  const label = collapsed ? "Show file list" : "Hide file list";
  return (
    <ShortcutTooltip label={label} keys={formatCombo(keys)} alignLeft className="shrink-0">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onToggle}
        disabled={loading}
        aria-pressed={!collapsed}
        aria-label={label}
        className={cn(TOGGLE_SLOT, "text-muted-foreground")}
      >
        {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>
    </ShortcutTooltip>
  );
}

/**
 * The diff's size. Loading shows a skeleton at the number's own width rather
 * than the words "Loading stats…" — the line is two short numbers, and text
 * twice their length shifts the toggle beside it every time the watcher ticks.
 */
function GitToolbarNumStat({
  isLoading,
  isError,
  additions,
  deletions,
}: GitTabToolbarProps["stats"]): ReactElement {
  if (isLoading) {
    return (
      <Skeleton
        className="h-3.5 w-16 shrink-0 rounded"
        role="status"
        aria-label="Loading diff stats"
      />
    );
  }
  if (isError) {
    return <span className="shrink-0 text-xs text-destructive">Stats unavailable</span>;
  }
  return (
    <NumStat
      additions={additions}
      deletions={deletions}
      hideZero={false}
      className="shrink-0 text-[11.5px]"
    />
  );
}
