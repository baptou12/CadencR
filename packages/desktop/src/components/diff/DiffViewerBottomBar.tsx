interface DiffViewerBottomBarProps {
  viewedCount: number;
  fileCount: number;
  diffMode: "unified" | "split";
  onDiffModeChange: (mode: "unified" | "split") => void;
}

export function DiffViewerBottomBar({
  viewedCount,
  fileCount,
  diffMode,
  onDiffModeChange,
}: DiffViewerBottomBarProps) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
      <span>
        <kbd className="rounded bg-accent px-1 py-0.5 text-foreground">⌃J</kbd> next
      </span>
      <span>
        <kbd className="rounded bg-accent px-1 py-0.5 text-foreground">⌃K</kbd> prev
      </span>
      <span>
        <kbd className="rounded bg-accent px-1 py-0.5 text-foreground">⌃L</kbd> expand
      </span>
      <span>
        <kbd className="rounded bg-accent px-1 py-0.5 text-foreground">⌃H</kbd> viewed
      </span>
      <span>
        <kbd className="rounded bg-accent px-1 py-0.5 text-foreground">⌃D</kbd>/
        <kbd className="rounded bg-accent px-1 py-0.5 text-foreground">⌃U</kbd> scroll
      </span>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {viewedCount}/{fileCount} viewed
        </span>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <button
            className={`rounded px-2 py-0.5 text-xs ${diffMode === "split" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            onClick={() => onDiffModeChange("split")}
          >
            Split
          </button>
          <button
            className={`rounded px-2 py-0.5 text-xs ${diffMode === "unified" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            onClick={() => onDiffModeChange("unified")}
          >
            Unified
          </button>
        </div>
      </div>
    </div>
  );
}
