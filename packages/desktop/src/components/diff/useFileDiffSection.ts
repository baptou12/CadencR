import { useMemo } from "react";
import { useGetFileDiff } from "@/api/generated";
import { parseUnifiedDiff, type FileDiffSection } from "@/lib/parse-unified-diff";
import { apiErrorMessage } from "@/lib/api-errors";
import type { DiffMode } from "./useDiffData";

const EMPTY_SECTION: FileDiffSection = {
  oldFileName: "/dev/null",
  newFileName: "/dev/null",
  hunks: [],
};

export interface FileDiffSectionResult {
  /** Parsed patch for the file, or `null` while the fetch is pending / gated. */
  section: FileDiffSection | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export interface UseFileDiffSectionParams {
  featureId: number;
  filePath: string;
  /**
   * Pre-rename path for a rename/copy entry (from the changed-files list),
   * forwarded so the backend can scope the diff to both paths and detect the
   * rename instead of reporting a whole-file addition.
   */
  oldFilePath?: string;
  mode: DiffMode;
  targetBranch?: string;
  commitSha: string | null;
  /**
   * Gates only the *fetch* — driven by the row's expanded + virtualized-visible
   * state — so a collapsed / off-screen file that was never fetched costs
   * nothing, while a file that HAS been fetched keeps its parsed section after
   * it scrolls out of view (react-query retains the cached data), so scrolling
   * back doesn't re-mount / re-tokenize Pierre or re-request the diff.
   */
  enabled: boolean;
}

/**
 * Fetch and parse the unified diff for a *single* file, lazily. This is the
 * per-file replacement for the old monolithic `/api/git/diff` fetch: the diff
 * pane calls it once per expanded, on-screen file, so the payload and the
 * synchronous parse are bounded to the files the user is actually looking at
 * instead of the whole working tree.
 *
 * The parse runs on the main thread (memoized on the raw diff) — safe because a
 * single file's patch is small; the genuinely large single-file case is still
 * gated behind the "Display diff" opt-in + `ProgressiveLargeDiff` chunking
 * downstream.
 */
export function useFileDiffSection({
  featureId,
  filePath,
  oldFilePath,
  mode,
  targetBranch,
  commitSha,
  enabled,
}: UseFileDiffSectionParams): FileDiffSectionResult {
  const { data, isLoading, isError, error } = useGetFileDiff(
    {
      feature_id: featureId,
      file_path: filePath,
      old_file_path: oldFilePath,
      mode,
      target_branch: targetBranch,
      commit_sha: commitSha ?? undefined,
    },
    { query: { enabled } },
  );

  const raw = data?.diff;
  const section = useMemo<FileDiffSection | null>(() => {
    if (raw === undefined) return null;
    // The backend emits exactly one `diff --git` block per file, so the first
    // parsed section is the whole patch. An empty-but-loaded diff yields
    // EMPTY_SECTION so the row shows "No text hunks", not a perpetual loader.
    return parseUnifiedDiff(raw)[0] ?? EMPTY_SECTION;
  }, [raw]);

  // NB: don't gate `section` on `enabled` — once fetched, keep the parsed diff
  // mounted through scroll-out. `data`/`isLoading`/`isError` already reflect the
  // cache: an un-fetched, disabled row has `data === undefined` → `section` null.
  const errorMessage = isError ? apiErrorMessage(error, "Failed to load this file's diff") : null;
  return useMemo(() => ({ section, isLoading, errorMessage }), [errorMessage, isLoading, section]);
}
