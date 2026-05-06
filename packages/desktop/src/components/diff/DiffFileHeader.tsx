import type { ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { NumStat } from "@/components/NumStat";
import { Checkbox } from "@/components/ui/checkbox";

interface DiffFileHeaderProps {
  displayName: string;
  additions: number;
  deletions: number;
  isCollapsed: boolean;
  isFocused: boolean;
  isFileViewed: boolean;
  showViewedCheckbox: boolean;
  onToggle: () => void;
  onMarkViewed: () => void;
  onUnmarkViewed: () => void;
}

/** Sticky file header row with collapse toggle, stats, and viewed checkbox. */
export function DiffFileHeader({
  displayName,
  additions,
  deletions,
  isCollapsed,
  isFocused,
  isFileViewed,
  showViewedCheckbox,
  onToggle,
  onMarkViewed,
  onUnmarkViewed,
}: DiffFileHeaderProps): ReactElement {
  return (
    <div
      className={`group/header sticky top-0 z-10 flex w-full items-center gap-2 bg-sidebar px-4 py-2.5 text-sm text-foreground hover:bg-accent ${isFocused ? "ring-1 ring-inset ring-primary bg-accent" : ""}`}
    >
      <CopyButton
        text={displayName}
        hoverClass="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
        sizeClass="h-3.5 w-3.5"
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onToggle}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{displayName}</span>
      </button>
      <NumStat
        additions={additions}
        deletions={deletions}
        hideZero={false}
        className="text-xs shrink-0"
      />
      {showViewedCheckbox && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-2 shrink-0">
          <Checkbox
            checked={isFileViewed}
            onCheckedChange={(checked: boolean | "indeterminate"): void => {
              if (checked) onMarkViewed();
              else onUnmarkViewed();
            }}
            className="h-3.5 w-3.5 cursor-pointer"
          />
          <span
            className="cursor-pointer select-none"
            onClick={(): void => {
              if (isFileViewed) onUnmarkViewed();
              else onMarkViewed();
            }}
          >
            Viewed
          </span>
        </div>
      )}
    </div>
  );
}
