import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface CollapsibleBlockProps {
  /** Total number of items in the list */
  totalCount: number;
  /** Number of items to show when collapsed (shows last N) */
  visibleCount: number;
  /** Unit label for the truncation indicator (e.g. "lines", "actions") */
  unit: string;
  /** Header content (icons, labels, etc.) — placed before the toggle button */
  header: ReactNode;
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
  children,
  className,
  headerClassName,
  toggleClassName,
  bodyClassName,
  truncationClassName,
  bodyHidden = false,
}: CollapsibleBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const needsCollapse = totalCount > visibleCount;
  const hiddenCount = totalCount - visibleCount;

  return (
    <div className={cn("my-1 rounded-md border overflow-hidden", className)}>
      <div className={cn("flex items-center gap-2 px-3 py-1.5 text-xs", headerClassName)}>
        {header}
        {!bodyHidden && needsCollapse && (
          <button
            type="button"
            className={cn("shrink-0", toggleClassName)}
            onClick={() => setShowAll((prev) => !prev)}
          >
            {showAll ? `Show last ${visibleCount}` : `Show all ${totalCount}`}
          </button>
        )}
      </div>
      {!bodyHidden && (
        <div className={bodyClassName}>
          {!showAll && needsCollapse && (
            <div className={cn("text-xs", truncationClassName)}>
              ... ({hiddenCount} {unit} above)
            </div>
          )}
          {children({ showAll: showAll || !needsCollapse })}
        </div>
      )}
    </div>
  );
}
