import { useState, useMemo, useRef, useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  useGetFileBlobShas,
  useGetCommitLog,
  useGetDiff,
  useGetFileContentBatch,
  getGetFileContentQueryKey,
  useListDiffViewed,
  useMarkDiffViewed,
  useUnmarkDiffViewed,
  useListDiffComments,
  useCreateDiffComment,
  useUpdateDiffComment,
  useDeleteDiffComment,
  type FileContent,
  type FileContentBatchItem,
  type GetFileContentBatchBody,
  getListDiffViewedQueryKey,
  getListDiffCommentsQueryKey,
} from "@/api/generated";
import { parseUnifiedDiff, countHunkStats } from "@/lib/parse-unified-diff";
import type { CommitEntry } from "./DiffFileTree";

/**
 * Seed individual `useGetFileContent` caches from a batch response. Keys are
 * derived from the request variables (`params`) — *not* from any React state
 * the caller might be holding — so a late response from a previous
 * commit/branch/mode cannot poison the cache for the current view.
 *
 * Exposed for unit testing: this is the surface that the original race bug
 * lived on, and it must stay verifiable without standing up a full hook.
 */
export function seedBatchFileContentCache(
  client: QueryClient,
  items: FileContentBatchItem[],
  params: GetFileContentBatchBody,
): void {
  for (const item of items) {
    client.setQueryData(
      getGetFileContentQueryKey({
        feature_id: params.feature_id,
        file_path: item.file_path,
        mode: params.mode,
        // Batch body uses `string | null`; query params use `string | undefined` —
        // coerce so the seeded key matches what `useGetFileContent` computes.
        target_branch: params.target_branch ?? undefined,
        commit_sha: params.commit_sha ?? undefined,
      }),
      {
        old_content: item.old_content,
        new_content: item.new_content,
        old_size: item.old_size,
        new_size: item.new_size,
        is_binary: item.is_binary,
        is_large: item.is_large,
      } as FileContent,
    );
  }
}

export interface FileMeta {
  section: import("@/lib/parse-unified-diff").FileDiffSection;
  displayName: string;
  additions: number;
  deletions: number;
}

export function useDiffData(featureId: number, mode: "worktree" | "branch", targetBranch?: string) {
  const queryClient = useQueryClient();
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [commitLimit, setCommitLimit] = useState(20);

  // ---- Diff & file content ----
  const { data: diffResponse, isLoading } = useGetDiff({
    feature_id: featureId,
    mode,
    target_branch: targetBranch,
    commit_sha: selectedCommit ?? undefined,
  });
  const rawDiff = diffResponse?.diff;

  const fileSections = useMemo(() => parseUnifiedDiff(rawDiff ?? ""), [rawDiff]);
  const fileNames = useMemo(
    () => fileSections.map((s) => (s.newFileName !== "/dev/null" ? s.newFileName : s.oldFileName)),
    [fileSections],
  );

  const fileMeta: FileMeta[] = useMemo(
    () =>
      fileSections.map((section) => {
        const displayName =
          section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName;
        const { additions, deletions } = countHunkStats(section.hunks);
        return { section, displayName, additions, deletions };
      }),
    [fileSections],
  );

  // ---- Batch file content prefetch ----
  // Seeding runs in `onSuccess` (via `seedBatchFileContentCache`) so cache
  // keys are derived from the request variables — not from current React
  // state. A late response from a previous commit/branch/mode therefore
  // cannot seed the cache under the *new* key, which `staleTime: Infinity`
  // would otherwise pin indefinitely.
  const batchFileContent = useGetFileContentBatch({
    mutation: {
      onSuccess: (items, variables) =>
        seedBatchFileContentCache(queryClient, items, variables.data),
    },
  });

  const batchMutate = batchFileContent.mutate;
  useEffect(() => {
    if (fileNames.length === 0) return;
    batchMutate({
      data: {
        feature_id: featureId,
        file_paths: fileNames,
        mode,
        target_branch: targetBranch,
        commit_sha: selectedCommit ?? undefined,
      },
    });
  }, [batchMutate, featureId, fileNames, mode, targetBranch, selectedCommit]);

  // ---- Blob SHAs & viewed tracking ----
  const { data: blobShasList = [] } = useGetFileBlobShas({ feature_id: featureId });
  const blobShas: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of blobShasList) {
      if (item.sha) map[item.file_path] = item.sha;
    }
    return map;
  }, [blobShasList]);

  const { data: viewedList = [] } = useListDiffViewed(featureId);
  const viewedFilesSet = useMemo(() => {
    const set = new Set<string>();
    for (const v of viewedList) {
      const currentSha = blobShas[v.file_path];
      if (currentSha && currentSha !== v.blob_sha) continue;
      set.add(v.file_path);
    }
    return set;
  }, [viewedList, blobShas]);

  const markViewed = useMarkDiffViewed({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListDiffViewedQueryKey(featureId) }),
    },
  });
  const unmarkViewed = useUnmarkDiffViewed({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListDiffViewedQueryKey(featureId) }),
    },
  });

  // ---- Commit log ----
  const { data: commitData } = useGetCommitLog(
    { feature_id: featureId, limit: commitLimit },
    { query: { keepPreviousData: true } },
  );
  const commits = useMemo(
    () =>
      (commitData?.commits ?? []).map((c) => ({
        sha: c.sha,
        shortSha: c.short_sha,
        message: c.message,
        body: c.body,
        author: c.author,
        date: c.date,
        isPushed: c.is_pushed,
      })) as CommitEntry[],
    [commitData],
  );
  const isOnBaseBranch = commitData?.is_on_base_branch ?? true;

  // ---- Comments ----
  const { data: comments = [] } = useListDiffComments(featureId);

  const createComment = useCreateDiffComment({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListDiffCommentsQueryKey(featureId) }),
    },
  });
  const updateComment = useUpdateDiffComment({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListDiffCommentsQueryKey(featureId) }),
    },
  });
  const deleteComment = useDeleteDiffComment({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getListDiffCommentsQueryKey(featureId) }),
    },
  });

  // ---- Auto-collapse viewed files ----
  const hasInitializedCollapse = useRef(false);

  return {
    isLoading,
    rawDiff,
    fileMeta,
    fileNames,
    selectedCommit,
    setSelectedCommit,
    commits,
    isOnBaseBranch,
    commitLimit,
    setCommitLimit,
    blobShas,
    viewedFilesSet,
    markViewed,
    unmarkViewed,
    createComment,
    updateComment,
    deleteComment,
    comments,
    hasInitializedCollapse,
  };
}
