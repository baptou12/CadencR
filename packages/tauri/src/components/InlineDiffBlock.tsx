import { useMemo } from "react";
import { PencilIcon, FilePlusIcon } from "lucide-react";
import { toRelativePath } from "@/lib/utils";
import { ReadOnlyDiffView } from "@/components/editor/ReadOnlyDiffView";

interface InlineDiffBlockProps {
  filePath: string;
  oldContent: string;
  newContent: string;
  /** Base path to strip from filePath for display (e.g. project or worktree root) */
  basePath?: string;
  /** Tool name (Edit or Write) — shown as a label in the header */
  toolName?: string;
}

/** Count added/removed lines by simple line-by-line comparison. */
function countLineChanges(
  oldContent: string,
  newContent: string,
): { additions: number; deletions: number } {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const oldSet = new Map<string, number>();
  for (const line of oldLines) {
    oldSet.set(line, (oldSet.get(line) ?? 0) + 1);
  }
  for (const line of newLines) {
    const count = oldSet.get(line);
    if (count && count > 0) {
      oldSet.set(line, count - 1);
    }
  }
  // Lines remaining in oldSet are deletions
  let deletions = 0;
  for (const count of oldSet.values()) {
    deletions += count;
  }
  // Simple heuristic: additions = newLines.length - (oldLines.length - deletions)
  const additions = newLines.length - (oldLines.length - deletions);
  return { additions: Math.max(0, additions), deletions };
}

/**
 * Compact inline diff block for displaying file changes during agent execution.
 * Uses CodeMirror in read-only unified mode with the Cadencr theme.
 */
export function InlineDiffBlock({
  filePath,
  oldContent,
  newContent,
  basePath,
  toolName,
}: InlineDiffBlockProps) {
  const ToolIcon = toolName === "Write" ? FilePlusIcon : PencilIcon;
  const displayPath = useMemo(() => toRelativePath(filePath, basePath), [filePath, basePath]);

  const stats = useMemo(() => countLineChanges(oldContent, newContent), [oldContent, newContent]);

  if (oldContent === newContent) {
    return (
      <div className="rounded-lg border border-[#6272a4] bg-[#282a36] px-3 py-2 text-xs text-[#6272a4]">
        No changes
      </div>
    );
  }

  const { additions, deletions } = stats;

  return (
    <div className="overflow-hidden rounded-lg border border-[#6272a4] bg-[#282a36]">
      {/* Compact file header */}
      <div className="flex items-center gap-2 border-b border-[#6272a4] bg-[color-mix(in_srgb,var(--drac-cyan)_15%,#282a36)] px-3 py-1 text-xs">
        {toolName && (
          <>
            <ToolIcon className="size-3 shrink-0 text-[#8be9fd]" />
            <span className="font-medium text-[#8be9fd]">{toolName}</span>
          </>
        )}
        <span className="flex-1 truncate font-mono text-[#f8f8f2]" title={filePath}>
          {displayPath}
        </span>
        <span className="text-[#50fa7b]">+{additions}</span>
        <span className="text-[#ff5555]">-{deletions}</span>
      </div>

      {/* Diff content */}
      <ReadOnlyDiffView
        oldContent={oldContent}
        newContent={newContent}
        filePath={filePath}
        mode="unified"
        className="max-h-[500px] overflow-auto"
      />
    </div>
  );
}
