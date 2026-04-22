import { useState, useMemo, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
} from "@/api/generated";
import { parseUnifiedDiff, countHunkStats } from "@/lib/parse-unified-diff";
import type { CommitEntry } from "./DiffFileTree";

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
    featureId,
    mode,
    targetBranch,
    commitSha: selectedCommit ?? undefined,
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
  const { data: batchFileContentList } = useGetFileContentBatch(
    { featureId, filePaths: fileNames, mode, targetBranch, commitSha: selectedCommit ?? undefined },
    { enabled: fileNames.length > 0 },
  );

  useEffect(() => {
    if (!batchFileContentList) return;
    const items = batchFileContentList;
    let i = 0;
    let rafId: number;

    function seedNext() {
      if (i >= items.length) return;
      const item = items[i++];
      const key = getGetFileContentQueryKey({
        featureId,
        filePath: item.file_path,
        mode,
        targetBranch,
        commitSha: selectedCommit ?? undefined,
      });
      queryClient.setQueryData(key, {
        old_content: item.old_content,
        new_content: item.new_content,
      } as FileContent);
      rafId = requestAnimationFrame(seedNext);
    }

    rafId = requestAnimationFrame(seedNext);
    return () => cancelAnimationFrame(rafId);
  }, [batchFileContentList, featureId, mode, targetBranch, selectedCommit, queryClient]);

  // ---- Blob SHAs & viewed tracking ----
  const { data: blobShasList = [] } = useGetFileBlobShas({ featureId });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diff-viewed", featureId] }),
  });
  const unmarkViewed = useUnmarkDiffViewed({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diff-viewed", featureId] }),
  });

  // ---- Commit log ----
  const { data: commitData } = useGetCommitLog(
    { featureId, limit: commitLimit },
    { keepPreviousData: true },
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diff-comments", featureId] }),
  });
  const updateComment = useUpdateDiffComment({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diff-comments", featureId] }),
  });
  const deleteComment = useDeleteDiffComment({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["diff-comments", featureId] }),
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
