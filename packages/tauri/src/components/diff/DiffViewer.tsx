import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { PanelLeft } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { DiffFileTree, type ChangedFileEntry } from "./DiffFileTree";
import { DiffFileBlock } from "./DiffFileBlock";
import { DiffFileHeader } from "./DiffFileHeader";
import { useDiffData } from "./useDiffData";
import { useDiffKeyboard } from "./useDiffKeyboard";
import type { ActiveWidget, CommentCallbacks, CommentLineData } from "./diff-comment-decorations";
import type { DiffComment } from "./DiffCommentWidget";

interface DiffViewerProps {
  featureId: number;
  mode: "worktree" | "branch";
  targetBranch?: string;
}

const GIT_SIDEBAR_COLLAPSED_SETTING = "git_sidebar_collapsed";

export function DiffViewer({ featureId, mode, targetBranch }: DiffViewerProps) {
  const [diffMode, setDiffMode] = useState<"unified" | "split">("unified");
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [focusedFileIndex, setFocusedFileIndex] = useState(-1);
  const [activeCommentWidget, setActiveCommentWidget] = useState<{
    filePath: string;
    lineNumber: number;
  } | null>(null);
  const diffAreaRef = useRef<HTMLDivElement>(null);
  const {
    value: persistedFileListCollapsed,
    setValue: persistFileListCollapsed,
    isLoading: isFileListCollapseLoading,
  } = useDebouncedSetting(GIT_SIDEBAR_COLLAPSED_SETTING, 0);
  const isFileListCollapsed = persistedFileListCollapsed === "true";
  const showFileListRail = isFileListCollapseLoading || isFileListCollapsed;

  const data = useDiffData(featureId, mode, targetBranch);

  // Build per-file comment line data
  const commentLinesByFile = useMemo(() => {
    const map = new Map<string, CommentLineData[]>();
    for (const c of data.comments as DiffComment[]) {
      const lines = map.get(c.file_path) ?? [];
      const existing = lines.find((l) => l.lineNumber === c.line_number);
      if (existing) {
        existing.comments.push(c);
      } else {
        lines.push({ lineNumber: c.line_number, comments: [c] });
      }
      map.set(c.file_path, lines);
    }
    return map;
  }, [data.comments]);

  const callbacksRef = useRef<{ activeWidget: typeof activeCommentWidget; data: typeof data }>({
    activeWidget: activeCommentWidget,
    data,
  });
  callbacksRef.current = { activeWidget: activeCommentWidget, data };

  // Single stable callback shared by every `DiffFileBlock`. The block calls
  // it with its own filePath, so we don't need a per-file Map (which would
  // leak entries across feature/branch switches).
  const handleAddComment = useCallback(
    (filePath: string, lineNumber: number) => setActiveCommentWidget({ filePath, lineNumber }),
    [],
  );

  // Memoize the active widget object so the file currently holding it gets a
  // stable reference. Every other file is passed `null` (primitive — always
  // equal), so `DiffFileBlock`'s `React.memo` bails out for them.
  const memoizedActiveWidget = useMemo<ActiveWidget | null>(
    () => (activeCommentWidget ? { lineNumber: activeCommentWidget.lineNumber } : null),
    [activeCommentWidget],
  );

  const stableCallbacks = useMemo<CommentCallbacks>(
    () => ({
      onSubmit: (lineNumber: number, content: string) => {
        const { activeWidget, data: d } = callbacksRef.current;
        if (!activeWidget || !content) {
          return;
        }
        d.createComment.mutate({
          featureId,
          data: {
            feature_id: featureId,
            file_path: activeWidget.filePath,
            line_number: lineNumber,
            side: "new",
            content,
          },
        });
        setActiveCommentWidget(null);
      },
      onClose: () => setActiveCommentWidget(null),
      onEdit: (id: number, content: string) =>
        callbacksRef.current.data.updateComment.mutate({ id, data: { content } }),
      onDelete: (id: number) => callbacksRef.current.data.deleteComment.mutate({ id }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [featureId],
  );

  // Auto-collapse viewed files on initial load
  useEffect(() => {
    if (!data.hasInitializedCollapse.current && data.viewedFilesSet.size > 0) {
      data.hasInitializedCollapse.current = true;
      setCollapsedFiles((prev) => new Set([...prev, ...data.viewedFilesSet]));
    }
  }, [data.viewedFilesSet, data.hasInitializedCollapse]);

  const scrollToFileIndex = useCallback(
    (index: number) => {
      const name = data.fileNames[index];
      if (!name) return;
      setSelectedFile(name);
      requestAnimationFrame(() => {
        const el = diffAreaRef.current?.querySelector(`[data-file="${CSS.escape(name)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [data.fileNames],
  );

  const toggleFile = useCallback((fileName: string) => {
    setSelectedFile(fileName);
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }, []);

  useDiffKeyboard({
    fileNames: data.fileNames,
    focusedFileIndex,
    setFocusedFileIndex,
    scrollToFileIndex,
    toggleFile,
    blobShas: data.blobShas,
    viewedFilesSet: data.viewedFilesSet,
    markViewed: data.markViewed,
    unmarkViewed: data.unmarkViewed,
    featureId,
    diffAreaRef,
    setCollapsedFiles,
  });

  const changedFileEntries: ChangedFileEntry[] = useMemo(() => {
    if (showFileListRail) return [];
    return data.fileMeta.map(({ section, displayName, additions, deletions }) => {
      const status =
        section.oldFileName === "/dev/null" ? "A" : section.newFileName === "/dev/null" ? "D" : "M";
      return { file: displayName, status, additions, deletions };
    });
  }, [data.fileMeta, showFileListRail]);

  const expandedFiles = useMemo(() => {
    if (showFileListRail) return new Set<string>();
    const set = new Set<string>();
    for (const e of changedFileEntries) {
      if (!collapsedFiles.has(e.file)) set.add(e.file);
    }
    return set;
  }, [changedFileEntries, collapsedFiles, showFileListRail]);

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
    requestAnimationFrame(() => {
      const el = diffAreaRef.current?.querySelector(`[data-file="${CSS.escape(filePath)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const setFileListCollapsed = useCallback(
    (collapsed: boolean): void => {
      persistFileListCollapsed(String(collapsed));
    },
    [persistFileListCollapsed],
  );

  if (data.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">Loading diff...</p>
      </div>
    );
  }

  if (!data.rawDiff?.trim()) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <p className="text-muted-foreground">No changes detected</p>
      </div>
    );
  }

  const diffContent = (
    <div ref={diffAreaRef} className="h-full overflow-y-auto">
      {data.fileMeta.map(({ section, displayName, additions, deletions }, fileIndex) => {
        const isCollapsed = collapsedFiles.has(displayName);
        const isFileViewed = data.viewedFilesSet.has(displayName);
        const currentBlobSha = data.blobShas[displayName] ?? "";
        const isFocused = fileIndex === focusedFileIndex;

        return (
          <div
            key={displayName}
            data-file={displayName}
            className="relative isolate border-b border-border"
          >
            <DiffFileHeader
              displayName={displayName}
              additions={additions}
              deletions={deletions}
              isCollapsed={isCollapsed}
              isFocused={isFocused}
              isFileViewed={isFileViewed}
              showViewedCheckbox={!data.selectedCommit}
              onToggle={() => toggleFile(displayName)}
              onMarkViewed={() => {
                data.markViewed.mutate({
                  featureId,
                  data: {
                    feature_id: featureId,
                    file_path: displayName,
                    blob_sha: currentBlobSha,
                  },
                });
                setCollapsedFiles((prev) => new Set([...prev, displayName]));
              }}
              onUnmarkViewed={() =>
                data.unmarkViewed.mutate({
                  featureId,
                  params: { file_path: displayName },
                })
              }
            />
            <DiffFileBlock
              section={section}
              featureId={featureId}
              mode={mode}
              targetBranch={targetBranch}
              commitSha={data.selectedCommit ?? undefined}
              diffMode={diffMode}
              displayName={displayName}
              isCollapsed={isCollapsed}
              forceRender={selectedFile === displayName}
              additions={additions}
              deletions={deletions}
              commentLines={commentLinesByFile.get(displayName)}
              activeWidget={
                activeCommentWidget?.filePath === displayName ? memoizedActiveWidget : null
              }
              commentCallbacks={stableCallbacks}
              onAddComment={handleAddComment}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Commit header */}
      {data.selectedCommit &&
        (() => {
          const commit = data.commits.find((c) => c.sha === data.selectedCommit);
          return (
            <div className="border-b border-border px-4 py-2 text-sm text-foreground">
              <div className="flex items-center gap-3">
                <span className="font-mono text-primary">{data.selectedCommit.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 text-foreground">{commit?.message}</span>
                <button
                  className="shrink-0 rounded bg-accent px-2 py-0.5 text-xs text-foreground hover:bg-muted-foreground"
                  onClick={() => data.setSelectedCommit(null)}
                >
                  Working Changes
                </button>
              </div>
              {commit?.body && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                  {commit.body}
                </p>
              )}
            </div>
          );
        })()}

      {/* Diff area + file tree */}
      {showFileListRail ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex w-9 shrink-0 justify-center border-r border-border bg-card pt-2">
            <button
              type="button"
              title="Expand file list"
              aria-label="Expand Git file list"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              disabled={isFileListCollapseLoading}
              onClick={() => setFileListCollapsed(false)}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">{diffContent}</div>
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={25} minSize={1} maxSize="300px" className="overflow-hidden">
            <DiffFileTree
              files={changedFileEntries}
              expandedFiles={expandedFiles}
              selectedFile={selectedFile}
              viewedFiles={data.viewedFilesSet}
              onToggleExpand={toggleFile}
              onSelectFile={handleSelectFile}
              commits={data.commits}
              selectedCommit={data.selectedCommit}
              onSelectCommit={data.setSelectedCommit}
              isOnBaseBranch={data.isOnBaseBranch}
              onLoadMoreCommits={() => data.setCommitLimit((l) => l + 20)}
              onCollapse={() => setFileListCollapsed(true)}
            />
          </ResizablePanel>
          <ResizableHandle className="bg-accent" />
          <ResizablePanel defaultSize={75} className="overflow-hidden">
            {diffContent}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Bottom bar */}
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
            {data.viewedFilesSet.size}/{data.fileMeta.length} viewed
          </span>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <button
              className={`rounded px-2 py-0.5 text-xs ${diffMode === "split" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              onClick={() => setDiffMode("split")}
            >
              Split
            </button>
            <button
              className={`rounded px-2 py-0.5 text-xs ${diffMode === "unified" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              onClick={() => setDiffMode("unified")}
            >
              Unified
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
