import { extractInlineDiffPreviews } from "@/lib/tool-adapter";
import { createUnifiedPatch } from "@/lib/create-unified-patch";
import { countPatchStats } from "@/lib/patch-stats";

export interface ToolNumStat {
  additions: number;
  deletions: number;
}

/**
 * Aggregate `+A` / `-D` line counts for a file-change tool call (Edit / Write /
 * ApplyPatch / NotebookEdit) from its args. Returns `null` when the tool carries
 * no inline diff to count. Pass the *raw* (un-normalized) tool name — the diff
 * extractor branches on the original name to recognise apply-patch variants.
 */
export function computeToolNumStat(
  toolName: string,
  toolArgs: string | undefined,
): ToolNumStat | null {
  const diffs = extractInlineDiffPreviews(toolName, toolArgs);
  if (diffs.length === 0) return null;
  return diffs.reduce<ToolNumStat>(
    (acc, diff) => {
      const stats = countPatchStats(createUnifiedPatch(diff));
      return {
        additions: acc.additions + stats.additions,
        deletions: acc.deletions + stats.deletions,
      };
    },
    { additions: 0, deletions: 0 },
  );
}
