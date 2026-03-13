import { useState, useMemo, useCallback, useRef, useEffect, type RefObject } from "react";
import { DiffView, DiffFile, DiffModeEnum, SplitSide } from "@git-diff-view/react";
import { getDiffViewHighlighter, type DiffHighlighter } from "@git-diff-view/shiki";
import "@git-diff-view/react/styles/diff-view.css";
import "./dracula-diff.css";
import { trpc } from "@/trpc";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFileContent,
  useGetFileBlobShas,
  useGetCommitLog,
  useGetDiff,
  useGetFileContentBatch,
  getGetFileContentQueryKey,
  type FileContent,
} from "@/api/generated";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { Checkbox } from "@/components/ui/checkbox";
import { DiffFileTree, type ChangedFileEntry, type CommitEntry } from "./DiffFileTree";
import {
  CommentWidgetLine,
  CommentExtendLine,
  type DiffComment,
} from "./DiffCommentWidget";
import { parseUnifiedDiff, langFromPath, countHunkStats } from "@/lib/parse-unified-diff";

// Pre-warm the shiki highlighter at module load time so it's ready (or nearly
// ready) by the time the user opens the diff viewer for the first time.
// getDiffViewHighlighter caches internally — subsequent calls return the same
// singleton, so this is safe to call at import time.
const shikiPromise = getDiffViewHighlighter();

function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
    // ref is stable — intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isNearViewport;
}

interface DiffFileBlockProps {
  section: import("@/lib/parse-unified-diff").FileDiffSection;
  featureId: number;
  mode: "worktree" | "branch";
  targetBranch?: string;
  commitSha?: string;
  diffMode: DiffModeEnum;
  shikiHighlighter: DiffHighlighter | null;
  displayName: string;
  isCollapsed: boolean;
  buildExtendData: (filePath: string) => { oldFile: Record<string, { data: DiffComment[] }>; newFile: Record<string, { data: DiffComment[] }> };
  activeWidget: { filePath: string; lineNumber: number; side: SplitSide } | null;
  setActiveWidget: (w: { filePath: string; lineNumber: number; side: SplitSide } | null) => void;
  getCommentsForLine: (filePath: string, lineNumber: number, side: "old" | "new") => DiffComment[];
  createComment: { mutate: (args: { featureId: number; filePath: string; lineNumber: number; side: "old" | "new"; content: string }) => void };
  updateComment: { mutate: (args: { id: number; content: string }) => void };
  deleteComment: { mutate: (args: { id: number }) => void };
}

function DiffFileBlock({
  section,
  featureId,
  mode,
  targetBranch,
  commitSha,
  diffMode,
  shikiHighlighter,
  displayName,
  isCollapsed,
  buildExtendData,
  activeWidget,
  setActiveWidget,
  getCommentsForLine,
  createComment,
  updateComment,
  deleteComment,
}: DiffFileBlockProps) {
  const filePath = section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName;

  const sentinelRef = useRef<HTMLDivElement>(null);
  const isNearViewport = useNearViewport(sentinelRef);

  // Only fire the tRPC query and build the DiffFile when the block is both
  // near the viewport and not collapsed — avoids work for off-screen files.
  const shouldRender = isNearViewport && !isCollapsed;

  const { data: fileContent } = useGetFileContent(
    { featureId, filePath, mode, targetBranch, commitSha },
    { enabled: shouldRender },
  );

  // Build the DiffFile without syntax highlighting so the diff paints
  // immediately. Only build lines for the active diff mode (split or unified)
  // — building both doubles the construction cost for no benefit.
  const diffFile = useMemo(() => {
    if (!shouldRender) return null;
    const lang = langFromPath(filePath);
    const oldContent = fileContent?.old_content ?? "";
    const newContent = fileContent?.new_content ?? "";
    try {
      const file = DiffFile.createInstance({
        oldFile: { fileName: section.oldFileName, fileLang: lang, content: oldContent },
        newFile: { fileName: section.newFileName, fileLang: lang, content: newContent },
        hunks: section.hunks,
      });
      file.initTheme("dark");
      file.initRaw();
      if (diffMode === DiffModeEnum.Unified) {
        file.buildUnifiedDiffLines();
      } else {
        file.buildSplitDiffLines();
      }
      return file;
    } catch {
      return null;
    }
  }, [shouldRender, section, filePath, fileContent, diffMode]);

  // Apply syntax highlighting after the initial unstyled paint so the diff is
  // interactive immediately. DiffView subscribes to the DiffFile via
  // useSyncExternalStore, so notifyAll() triggers a re-render with tokens.
  useEffect(() => {
    if (!diffFile || !shikiHighlighter) return;
    diffFile.initSyntax({ registerHighlighter: shikiHighlighter });
    diffFile.notifyAll();
  }, [diffFile, shikiHighlighter]);

  // Not yet near the viewport — render a sentinel placeholder so the
  // IntersectionObserver can detect when the file scrolls into range.
  // 200px is a rough estimate of a collapsed file header + a small diff.
  // The 500px rootMargin on the observer fires early enough that any layout
  // shift from this estimate being off is not visible to the user.
  if (!isNearViewport) {
    return <div ref={sentinelRef} style={{ minHeight: "200px" }} />;
  }

  if (isCollapsed || !diffFile) return null;

  return (
    <DiffView
      diffFile={diffFile}
      diffViewMode={diffMode}
      diffViewWrap={true}
      diffViewTheme="dark"
      diffViewFontSize={13}
      diffViewHighlight={true}
      registerHighlighter={shikiHighlighter ?? undefined}
      diffViewAddWidget={true}
      extendData={buildExtendData(displayName)}
      renderExtendLine={({ side, data, lineNumber }) => {
        const lineComments = data as DiffComment[] | undefined;
        if (!lineComments || lineComments.length === 0) return null;
        if (
          activeWidget &&
          activeWidget.filePath === displayName &&
          activeWidget.lineNumber === lineNumber &&
          activeWidget.side === side
        ) {
          return null;
        }
        return (
          <CommentExtendLine
            comments={lineComments}
            onEdit={(id, content) => updateComment.mutate({ id, content })}
            onDelete={(id) => deleteComment.mutate({ id })}
          />
        );
      }}
      onAddWidgetClick={(lineNumber, side) => {
        setActiveWidget({ filePath: displayName, lineNumber, side });
      }}
      renderWidgetLine={({ lineNumber, side, onClose }) => {
        if (
          !activeWidget ||
          activeWidget.filePath !== displayName ||
          activeWidget.lineNumber !== lineNumber ||
          activeWidget.side !== side
        ) {
          return null;
        }
        const sideStr = side === SplitSide.old ? "old" : "new";
        const lineComments = getCommentsForLine(displayName, lineNumber, sideStr);
        return (
          <CommentWidgetLine
            comments={lineComments}
            onClose={() => {
              setActiveWidget(null);
              onClose();
            }}
            onSubmit={(content) => {
              createComment.mutate({
                featureId,
                filePath: displayName,
                lineNumber,
                side: sideStr,
                content,
              });
              setActiveWidget(null);
              onClose();
            }}
            onEdit={(id, content) => updateComment.mutate({ id, content })}
            onDelete={(id) => deleteComment.mutate({ id })}
          />
        );
      }}
    />
  );
}

export interface DiffViewerProps {
  featureId: number;
  mode: "worktree" | "branch";
  targetBranch?: string;
}

export function DiffViewer({ featureId, mode, targetBranch }: DiffViewerProps) {
  const [diffMode, setDiffMode] = useState<DiffModeEnum>(DiffModeEnum.Unified);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [shikiHighlighter, setShikiHighlighter] = useState<DiffHighlighter | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);

  useEffect(() => {
    shikiPromise.then((h) => setShikiHighlighter(h));
  }, []);

  const { data: viewedList = [] } = trpc.diffViewed.list.useQuery({ featureId });
  const { data: blobShasList = [] } = useGetFileBlobShas({ featureId });
  const blobShas: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const item of blobShasList) {
      if (item.sha) map[item.file_path] = item.sha;
    }
    return map;
  }, [blobShasList]);
  const [commitLimit, setCommitLimit] = useState(20);
  const { data: commitData } = useGetCommitLog(
    { featureId, limit: commitLimit },
    { keepPreviousData: true },
  );
  const commits = useMemo(() =>
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

  const viewedFilesSet = useMemo(() => {
    const set = new Set<string>();
    for (const v of viewedList) {
      const currentSha = (blobShas as Record<string, string>)[v.file_path];
      // If we have a current SHA and it doesn't match, the file changed since viewed — skip it.
      // If there's no current SHA (e.g. branch mode, committed files), trust the DB record.
      if (currentSha && currentSha !== v.blob_sha) {
        continue;
      }
      set.add(v.file_path);
    }
    return set;
  }, [viewedList, blobShas]);

  // Auto-collapse viewed files on initial load
  const hasInitializedCollapse = useRef(false);
  useEffect(() => {
    if (!hasInitializedCollapse.current && viewedFilesSet.size > 0) {
      hasInitializedCollapse.current = true;
      setCollapsedFiles((prev) => new Set([...prev, ...viewedFilesSet]));
    }
  }, [viewedFilesSet]);

  const [focusedFileIndex, setFocusedFileIndex] = useState(-1);

  const [activeWidget, setActiveWidget] = useState<{
    filePath: string;
    lineNumber: number;
    side: SplitSide;
  } | null>(null);
  const diffAreaRef = useRef<HTMLDivElement>(null);

  const { data: diffResponse, isLoading } = useGetDiff({
    featureId,
    mode,
    targetBranch,
    commitSha: selectedCommit ?? undefined,
  });
  const rawDiff = diffResponse?.diff;

  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  const markViewed = trpc.diffViewed.markViewed.useMutation({
    onSuccess: () => utils.diffViewed.list.invalidate({ featureId }),
  });
  const unmarkViewed = trpc.diffViewed.unmarkViewed.useMutation({
    onSuccess: () => utils.diffViewed.list.invalidate({ featureId }),
  });

  const { data: comments = [] } = trpc.diffComments.list.useQuery({ featureId });

  const createComment = trpc.diffComments.create.useMutation({
    onSuccess: () => utils.diffComments.list.invalidate({ featureId }),
  });
  const updateComment = trpc.diffComments.update.useMutation({
    onSuccess: () => utils.diffComments.list.invalidate({ featureId }),
  });
  const deleteComment = trpc.diffComments.delete.useMutation({
    onSuccess: () => utils.diffComments.list.invalidate({ featureId }),
  });

  const commentsByFileAndLine = useMemo(() => {
    const map = new Map<string, DiffComment[]>();
    for (const c of comments) {
      const key = `${c.file_path}:${c.line_number}:${c.side}`;
      const arr = map.get(key) ?? [];
      arr.push(c as DiffComment);
      map.set(key, arr);
    }
    return map;
  }, [comments]);

  const getCommentsForLine = useCallback(
    (filePath: string, lineNumber: number, side: "old" | "new") => {
      return commentsByFileAndLine.get(`${filePath}:${lineNumber}:${side}`) ?? [];
    },
    [commentsByFileAndLine],
  );

  const buildExtendData = useCallback(
    (filePath: string) => {
      const oldFile: Record<string, { data: DiffComment[] }> = {};
      const newFile: Record<string, { data: DiffComment[] }> = {};
      for (const c of comments) {
        if (c.file_path !== filePath) continue;
        const target = c.side === "old" ? oldFile : newFile;
        const key = String(c.line_number);
        if (!target[key]) {
          target[key] = { data: [] };
        }
        target[key].data.push(c as DiffComment);
      }
      return { oldFile, newFile };
    },
    [comments],
  );

  const fileSections = useMemo(() => parseUnifiedDiff(rawDiff ?? ""), [rawDiff]);

  const fileNames = useMemo(
    () =>
      fileSections.map((section) =>
        section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName,
      ),
    [fileSections],
  );

  // Batch prefetch all file contents in a single call, then seed
  // individual per-file cache keys so DiffFileBlock queries resolve instantly.
  const { data: batchFileContentList } = useGetFileContentBatch(
    {
      featureId,
      filePaths: fileNames,
      mode,
      targetBranch,
      commitSha: selectedCommit ?? undefined,
    },
    { enabled: fileNames.length > 0 },
  );

  // Seed the per-file cache one file per animation frame so the browser stays
  // responsive.  Seeding all files at once causes every visible DiffFileBlock
  // to rebuild its DiffFile synchronously in a single React render, blocking
  // interaction for hundreds of milliseconds.
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

  const fileMeta = useMemo(() => {
    return fileSections.map((section) => {
      const displayName = section.newFileName !== "/dev/null" ? section.newFileName : section.oldFileName;
      const { additions, deletions } = countHunkStats(section.hunks);
      return { section, displayName, additions, deletions };
    });
  }, [fileSections]);

  const scrollToFileIndex = useCallback(
    (index: number) => {
      const name = fileNames[index];
      if (!name) return;
      setSelectedFile(name);
      requestAnimationFrame(() => {
        const el = diffAreaRef.current?.querySelector(`[data-file="${CSS.escape(name)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [fileNames],
  );

  const toggleFile = useCallback((fileName: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) {
        next.delete(fileName);
      } else {
        next.add(fileName);
      }
      return next;
    });
  }, []);

  // Keyboard shortcuts: Ctrl+J (next), Ctrl+K (prev), Ctrl+E (toggle expand), Ctrl+H (toggle viewed)
  const focusedFileIndexRef = useRef(focusedFileIndex);
  focusedFileIndexRef.current = focusedFileIndex;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      const idx = focusedFileIndexRef.current;

      if (e.code === "KeyJ") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const next = Math.min(idx + 1, fileNames.length - 1);
        setFocusedFileIndex(next);
        scrollToFileIndex(next);
      } else if (e.code === "KeyK") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const next = Math.max(idx - 1, 0);
        setFocusedFileIndex(next);
        scrollToFileIndex(next);
      } else if (e.code === "KeyL") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (idx >= 0 && idx < fileNames.length) {
          toggleFile(fileNames[idx]);
        }
      } else if (e.code === "KeyD") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (diffAreaRef.current) {
          diffAreaRef.current.scrollBy({ top: diffAreaRef.current.clientHeight / 2, behavior: "smooth" });
        }
      } else if (e.code === "KeyU") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (diffAreaRef.current) {
          diffAreaRef.current.scrollBy({ top: -diffAreaRef.current.clientHeight / 2, behavior: "smooth" });
        }
      } else if (e.code === "KeyH") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (idx >= 0 && idx < fileNames.length) {
          const name = fileNames[idx];
          const sha = (blobShas as Record<string, string>)[name] ?? "";
          if (viewedFilesSet.has(name)) {
            unmarkViewed.mutate({ featureId, filePath: name });
          } else {
            markViewed.mutate({ featureId, filePath: name, blobSha: sha });
            setCollapsedFiles((p) => new Set([...p, name]));
          }
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [fileNames, blobShas, viewedFilesSet, featureId, scrollToFileIndex, toggleFile, markViewed, unmarkViewed]);

  const totalAdditions = fileMeta.reduce((sum, { additions }) => sum + additions, 0);
  const totalDeletions = fileMeta.reduce((sum, { deletions }) => sum + deletions, 0);

  const changedFileEntries: ChangedFileEntry[] = useMemo(
    () =>
      fileMeta.map(({ section, displayName, additions, deletions }) => {
        const status = section.oldFileName === "/dev/null" ? "A" : section.newFileName === "/dev/null" ? "D" : "M";
        return {
          file: displayName,
          status,
          additions,
          deletions,
        };
      }),
    [fileMeta],
  );

  const expandedFiles = useMemo(() => {
    const set = new Set<string>();
    for (const e of changedFileEntries) {
      if (!collapsedFiles.has(e.file)) set.add(e.file);
    }
    return set;
  }, [changedFileEntries, collapsedFiles]);

  const handleSelectFile = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath);
      // Ensure the file is expanded
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
      // Scroll to the file in the diff area
      requestAnimationFrame(() => {
        const el = diffAreaRef.current?.querySelector(`[data-file="${CSS.escape(filePath)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#282a36] text-[#f8f8f2]">
        <p className="text-[#6272a4]">Loading diff...</p>
      </div>
    );
  }

  if (!rawDiff?.trim()) {
    return (
      <div className="flex h-full items-center justify-center bg-[#282a36] text-[#f8f8f2]">
        <p className="text-[#6272a4]">No changes detected</p>
      </div>
    );
  }

  return (
    <div className="dracula-diff flex h-full flex-col overflow-hidden bg-[#282a36]">
      {/* Header bar */}
      {selectedCommit ? (() => {
        const commit = commits.find((c) => c.sha === selectedCommit);
        return (
          <div className="border-b border-[#6272a4] px-4 py-2 text-sm text-[#f8f8f2]">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[#bd93f9]">{selectedCommit.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 text-[#f8f8f2]">{commit?.message}</span>
              <span className="shrink-0 text-xs text-[#50fa7b]">+{totalAdditions}</span>
              <span className="shrink-0 text-xs text-[#ff5555]">-{totalDeletions}</span>
              <span className="shrink-0 text-xs text-[#6272a4]">{fileMeta.length} file{fileMeta.length !== 1 ? "s" : ""}</span>
              <button
                className="shrink-0 rounded bg-[#44475a] px-2 py-0.5 text-xs text-[#f8f8f2] hover:bg-[#6272a4]"
                onClick={() => setSelectedCommit(null)}
              >
                Working Changes
              </button>
              <div className="flex items-center gap-2">
                <button
                  className={`rounded px-2 py-0.5 text-xs ${diffMode === DiffModeEnum.Split ? "bg-[#44475a] text-[#f8f8f2]" : "text-[#6272a4]"}`}
                  onClick={() => setDiffMode(DiffModeEnum.Split)}
                >
                  Split
                </button>
                <button
                  className={`rounded px-2 py-0.5 text-xs ${diffMode === DiffModeEnum.Unified ? "bg-[#44475a] text-[#f8f8f2]" : "text-[#6272a4]"}`}
                  onClick={() => setDiffMode(DiffModeEnum.Unified)}
                >
                  Unified
                </button>
              </div>
            </div>
            {commit?.body && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-[#6272a4]">{commit.body}</p>
            )}
          </div>
        );
      })() : (
        <div className="flex items-center gap-4 border-b border-[#6272a4] px-4 py-2 text-sm text-[#f8f8f2]">
          <span>{fileMeta.length} file{fileMeta.length !== 1 ? "s" : ""} changed</span>
          <span className="text-[#50fa7b]">+{totalAdditions}</span>
          <span className="text-[#ff5555]">-{totalDeletions}</span>
          <span className="text-[#6272a4]">{viewedFilesSet.size}/{fileMeta.length} viewed</span>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2 text-[10px] text-[#6272a4]">
              <span><kbd className="rounded bg-[#44475a] px-1 py-0.5 text-[#f8f8f2]">⌃J</kbd> next</span>
              <span><kbd className="rounded bg-[#44475a] px-1 py-0.5 text-[#f8f8f2]">⌃K</kbd> prev</span>
              <span><kbd className="rounded bg-[#44475a] px-1 py-0.5 text-[#f8f8f2]">⌃L</kbd> expand</span>
              <span><kbd className="rounded bg-[#44475a] px-1 py-0.5 text-[#f8f8f2]">⌃H</kbd> viewed</span>
              <span><kbd className="rounded bg-[#44475a] px-1 py-0.5 text-[#f8f8f2]">⌃D</kbd>/<kbd className="rounded bg-[#44475a] px-1 py-0.5 text-[#f8f8f2]">⌃U</kbd> scroll</span>
            </div>
            <div className="h-4 w-px bg-[#6272a4]" />
            <button
              className={`rounded px-2 py-0.5 text-xs ${diffMode === DiffModeEnum.Split ? "bg-[#44475a] text-[#f8f8f2]" : "text-[#6272a4]"}`}
              onClick={() => setDiffMode(DiffModeEnum.Split)}
            >
              Split
            </button>
            <button
              className={`rounded px-2 py-0.5 text-xs ${diffMode === DiffModeEnum.Unified ? "bg-[#44475a] text-[#f8f8f2]" : "text-[#6272a4]"}`}
              onClick={() => setDiffMode(DiffModeEnum.Unified)}
            >
              Unified
            </button>
          </div>
        </div>
      )}

      {/* Diff area + file tree */}
      <div className="flex min-h-0 flex-1">
        {/* File tree sidebar */}
        <div className="w-80 shrink-0 border-r border-[#6272a4] overflow-hidden">
          <DiffFileTree
            files={changedFileEntries}
            expandedFiles={expandedFiles}
            selectedFile={selectedFile}
            viewedFiles={viewedFilesSet}
            onToggleExpand={toggleFile}
            onSelectFile={handleSelectFile}
            commits={commits}
            selectedCommit={selectedCommit}
            onSelectCommit={setSelectedCommit}
            isOnBaseBranch={isOnBaseBranch}
            onLoadMoreCommits={() => setCommitLimit((l) => l + 20)}
          />
        </div>
        <div ref={diffAreaRef} className="flex-1 overflow-y-auto">
        {fileMeta.map(({ section, displayName, additions, deletions }, fileIndex) => {
          const isCollapsed = collapsedFiles.has(displayName);
          const isFileViewed = viewedFilesSet.has(displayName);
          const currentBlobSha = (blobShas as Record<string, string>)[displayName] ?? "";
          const isFocused = fileIndex === focusedFileIndex;

          return (
            <div key={displayName} data-file={displayName} className="border-b border-[#6272a4]">
              {/* File header */}
              <div className={`group/header sticky top-0 z-10 flex w-full items-center gap-2 bg-[#343746] px-4 py-1.5 text-sm text-[#f8f8f2] hover:bg-[#44475a] ${isFocused ? "ring-1 ring-inset ring-[#bd93f9] bg-[#44475a]" : ""}`}>
                <button
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  onClick={() => toggleFile(displayName)}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#6272a4]" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-[#6272a4]" />
                  )}
                  <span className="font-mono text-xs truncate">{displayName}</span>
                  <CopyButton text={displayName} hoverClass="opacity-0 group-hover/header:opacity-100" sizeClass="h-3.5 w-3.5" />
                </button>
                <span className="text-xs text-[#50fa7b] shrink-0">+{additions}</span>
                <span className="text-xs text-[#ff5555] shrink-0">-{deletions}</span>
                {/* Viewed checkbox (hidden when viewing a commit) */}
                {!selectedCommit && (
                  <div
                    className="flex items-center gap-1.5 text-xs text-[#6272a4] ml-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={isFileViewed}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          markViewed.mutate({ featureId, filePath: displayName, blobSha: currentBlobSha });
                          setCollapsedFiles((prev) => new Set([...prev, displayName]));
                        } else {
                          unmarkViewed.mutate({ featureId, filePath: displayName });
                        }
                      }}
                      className="h-3.5 w-3.5 cursor-pointer"
                    />
                    <span className="cursor-pointer select-none" onClick={() => {
                      if (isFileViewed) {
                        unmarkViewed.mutate({ featureId, filePath: displayName });
                      } else {
                        markViewed.mutate({ featureId, filePath: displayName, blobSha: currentBlobSha });
                        setCollapsedFiles((prev) => new Set([...prev, displayName]));
                      }
                    }}>Viewed</span>
                  </div>
                )}
              </div>

              {/* Diff content */}
              <DiffFileBlock
                section={section}
                featureId={featureId}
                mode={mode}
                targetBranch={targetBranch}
                commitSha={selectedCommit ?? undefined}
                diffMode={diffMode}
                shikiHighlighter={shikiHighlighter}
                displayName={displayName}
                isCollapsed={isCollapsed}
                buildExtendData={buildExtendData}
                activeWidget={activeWidget}
                setActiveWidget={setActiveWidget}
                getCommentsForLine={getCommentsForLine}
                createComment={createComment}
                updateComment={updateComment}
                deleteComment={deleteComment}
              />
            </div>
          );
        })}
        </div>

      </div>
    </div>
  );
}
