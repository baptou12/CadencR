import type { ReactElement } from "react";
import { InlineDiffBlock } from "@/components/InlineDiffBlock";
import { extractInlineDiffPreviews, normalizeToolName } from "@/lib/tool-adapter";

interface InlineDiffPreview {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * Renders the inline diff(s) produced by a file-change tool call (Edit,
 * Write, NotebookEdit, ApplyPatch). Extracted from `AgentBlock` to keep that
 * file under the 400-line budget. `expanded` / `onExpandedChange` are
 * forwarded to every emitted `InlineDiffBlock` so a single verbosity-driven
 * fold state covers all diffs of one tool call.
 */
export function renderFileChangeBlocks(
  toolName: string | undefined,
  toolArgs: string | undefined,
  basePath: string | undefined,
  expanded: boolean | undefined,
  onExpandedChange: ((next: boolean) => void) | undefined,
): ReactElement | null {
  const normalizedToolName = normalizeToolName(toolName ?? "");
  const diffs = extractInlineDiffPreviews(toolName ?? "", toolArgs).filter(isVisibleInlineDiff);
  if (diffs.length === 0) return null;
  if (diffs.length === 1) {
    return renderInlineDiffBlock(
      diffs[0],
      basePath,
      normalizedToolName,
      undefined,
      expanded,
      onExpandedChange,
    );
  }
  return (
    <div className="space-y-2">
      {diffs.map((diff, index) =>
        renderInlineDiffBlock(
          diff,
          basePath,
          normalizedToolName,
          index,
          expanded,
          onExpandedChange,
        ),
      )}
    </div>
  );
}

function isVisibleInlineDiff(diff: { filePath: string }): boolean {
  return !diff.filePath.includes(".claude/plans/");
}

function renderInlineDiffBlock(
  diff: InlineDiffPreview,
  basePath: string | undefined,
  toolName: string,
  index: number | undefined,
  expanded: boolean | undefined,
  onExpandedChange: ((next: boolean) => void) | undefined,
): ReactElement {
  return (
    <InlineDiffBlock
      key={index === undefined ? undefined : `${diff.filePath}:${index}`}
      filePath={diff.filePath}
      oldContent={diff.oldContent}
      newContent={diff.newContent}
      basePath={basePath}
      toolName={toolName}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  );
}
