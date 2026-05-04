import { useMemo } from "react";
import { PencilIcon, FilePlusIcon } from "lucide-react";
import { toRelativePath } from "@/lib/utils";
import { ReadOnlyDiffView } from "@/components/editor/ReadOnlyDiffView";
import { NumStat } from "@/components/NumStat";

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
      <div className="rounded-lg border border-[var(--editor-border)] bg-[var(--editor-bg)] px-3 py-2 text-xs text-[var(--editor-comment)]">
        No changes
      </div>
    );
  }

  const { additions, deletions } = stats;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--editor-border)] bg-[var(--editor-bg)]">
      {/* Compact file header */}
      <div className="flex items-center gap-2 border-b border-[var(--editor-border)] bg-[color-mix(in_srgb,var(--editor-cyan)_15%,var(--editor-bg))] px-3 py-1 text-xs">
        {toolName && (
          <>
            <ToolIcon className="size-3 shrink-0 text-[var(--editor-cyan)]" />
            <span className="font-medium text-[var(--editor-cyan)]">{toolName}</span>
          </>
        )}
        <span className="flex-1 truncate font-mono text-[var(--editor-fg)]" title={filePath}>
          {displayPath}
        </span>
        <NumStat additions={additions} deletions={deletions} hideZero={false} />
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
