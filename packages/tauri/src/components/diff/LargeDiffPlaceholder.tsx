import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/diff-thresholds";

export type LargeDiffPlaceholderVariant = "large" | "binary";

interface LargeDiffPlaceholderProps {
  variant: LargeDiffPlaceholderVariant;
  /** Largest of the old/new byte sizes — what we use to size the placeholder copy. */
  sizeBytes: number;
  additions: number;
  deletions: number;
  /** Only used for `variant === "large"` — opt-in to render the actual diff. */
  onDisplay?: () => void;
}

/**
 * Inline placeholder shown for files we deliberately do not auto-render in
 * the diff viewer: huge files (would freeze CodeMirror's synchronous Myers
 * diff) and binary blobs (no useful textual diff to show).
 */
export function LargeDiffPlaceholder({
  variant,
  sizeBytes,
  additions,
  deletions,
  onDisplay,
}: LargeDiffPlaceholderProps) {
  const isBinary = variant === "binary";
  return (
    <div className="bg-muted/40 flex items-center justify-between rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant={isBinary ? "secondary" : "outline"}>
            {isBinary ? "Binary file" : "Large file"}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {formatBytes(sizeBytes)}
            {!isBinary && (
              <>
                {" · "}
                <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
                {" / "}
                <span className="text-rose-600 dark:text-rose-400">-{deletions}</span>
              </>
            )}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          {isBinary
            ? "No textual diff is available for binary files."
            : "Auto-display is disabled for large files to keep the UI responsive."}
        </p>
      </div>
      {!isBinary && onDisplay && (
        <Button variant="outline" size="sm" onClick={onDisplay}>
          Display diff
        </Button>
      )}
    </div>
  );
}
