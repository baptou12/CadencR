import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

interface CollapsibleBlockProps {
  /** Total number of items in the list */
  totalCount: number;
  /** Number of items to show when collapsed (shows last N) */
  visibleCount: number;
  /** Unit label for the truncation indicator (e.g. "lines", "actions") */
  unit: string;
  /** Header content (icons, labels, etc.) — placed before the toggle button */
  header: ReactNode;
  /**
   * Optional header slot rendered *after* the inner "Show last N / Show all N"
   * toggle, so callers can place their own controls (e.g. a fold chevron) at
   * the very end of the header bar without putting them ahead of the toggle.
   */
  headerTrailing?: ReactNode;
  /** Render the visible slice of items */
  children: (range: { showAll: boolean }) => ReactNode;
  /** Class for the outer wrapper */
  className?: string;
  /** Class for the header bar */
  headerClassName?: string;
  /** Class for the inner "Show last N / Show all N" toggle button */
  toggleClassName?: string;
  /** Class for the body/content area */
  bodyClassName?: string;
  /** Class for the truncation indicator */
  truncationClassName?: string;
  /**
   * Outer body fold. When true, the body is not rendered at all — only the
   * header remains. Used by the auto-collapse verbosity mode and by callers
   * that own their own outer toggle.
   */
  bodyHidden?: boolean;
  /**
   * Click handler for the entire header row. When provided, clicking anywhere
   * on the header (except inner buttons that `stopPropagation`) fires this.
   * Used to mirror the collapse toggle so the whole row is a click target,
   * matching the behavior of other tool blocks.
   */
  onHeaderClick?: () => void;
}

/**
 * Two collapse axes — one shows the last N / all N lines (controlled by an
 * inline button that only appears when `totalCount > visibleCount`), the
 * other completely hides the body (`bodyHidden`). Callers can drive either,
 * neither, or both.
 */
export function CollapsibleBlock({
  totalCount,
  visibleCount,
  unit,
  header,
  headerTrailing,
  children,
  className,
  headerClassName,
  toggleClassName,
  bodyClassName,
  truncationClassName,
  bodyHidden = false,
  onHeaderClick,
}: CollapsibleBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const needsCollapse = totalCount > visibleCount;
  const hiddenCount = totalCount - visibleCount;

  return (
    <div className={cn("my-1 rounded-md border overflow-hidden", className)}>
      <div
        onClick={onHeaderClick}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-xs",
          onHeaderClick && "cursor-pointer",
          headerClassName,
        )}
      >
        {header}
        {!bodyHidden && needsCollapse && (
          <button
            type="button"
            className={cn("shrink-0", toggleClassName)}
            onClick={(e) => {
              e.stopPropagation();
              setShowAll((prev) => !prev);
            }}
          >
            {showAll ? `Show last ${visibleCount}` : `Show all ${totalCount}`}
          </button>
        )}
        {headerTrailing}
      </div>
      <CollapsibleSection open={!bodyHidden}>
        <div className={bodyClassName}>
          {!showAll && needsCollapse && (
            <div className={cn("text-xs", truncationClassName)}>
              ... ({hiddenCount} {unit} above)
            </div>
          )}
          {children({ showAll: showAll || !needsCollapse })}
        </div>
      </CollapsibleSection>
    </div>
  );
}
