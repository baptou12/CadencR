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
  /** Class for the toggle button */
  toggleClassName?: string;
  /** Class for the body/content area */
  bodyClassName?: string;
  /** Class for the truncation indicator */
  truncationClassName?: string;
}

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
}: CollapsibleBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const needsCollapse = totalCount > visibleCount;
  const hiddenCount = totalCount - visibleCount;

  return (
    <div className={cn("my-1 rounded-md border overflow-hidden", className)}>
      <div className={cn("flex items-center gap-2 px-3 py-1.5 text-xs", headerClassName)}>
        {header}
        {needsCollapse && (
          <button
            type="button"
            className={cn("shrink-0", toggleClassName)}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? `Show last ${visibleCount}` : `Show all ${totalCount}`}
          </button>
        )}
      </div>
      <div className={bodyClassName}>
        {!showAll && needsCollapse && (
          <div className={cn("text-xs", truncationClassName)}>
            ... ({hiddenCount} {unit} above)
          </div>
        )}
        {children({ showAll: showAll || !needsCollapse })}
      </div>
    </div>
  );
}
