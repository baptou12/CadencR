import { memo, type RefObject } from "react";
import type { ThemeAppearance, ThemeId } from "@/lib/themes";
import type { ChangedFile } from "@/api/generated";
import { useInViewport } from "@/hooks/useInViewport";
import type { DiffMode } from "./useDiffData";
import { DiffFileBlock, type DiffFileBlockProps } from "./DiffFileBlock";
import { DiffVirtualizer } from "./DiffVirtualizer";
import type { CommentSide } from "./PatchDiffView";
import type { ActiveWidget, CommentCallbacks, CommentLineData } from "./diff-comment-decorations";

interface ActiveCommentWidget {
  filePath: string;
  lineNumber: number;
  side: CommentSide;
}

/**
 * One file row. Tracks its own viewport visibility so `DiffFileBlock` only
 * fetches this file's diff when it's on (or near) screen — the outer list
 * mounts every row, so without this a 400-file diff would fire 400 requests.
 */
const DiffRow = memo(function DiffRow({
  scrollRef,
  ...blockProps
}: { scrollRef: RefObject<HTMLDivElement | null> } & Omit<DiffFileBlockProps, "isVisible">) {
  const { setRef, inView } = useInViewport(scrollRef);
  return (
    <div
      ref={setRef}
      data-file={blockProps.displayName}
      className="relative isolate border-b border-border"
    >
      <DiffFileBlock {...blockProps} isVisible={inView} />
    </div>
  );
});

interface DiffContentProps {
  diffAreaRef: RefObject<HTMLDivElement | null>;
  files: ChangedFile[];
  featureId: number;
  mode: DiffMode;
  targetBranch?: string;
  selectedCommit: string | null;
  diffMode: "unified" | "split";
  collapsedFiles: Set<string>;
  focusedFileIndex: number;
  viewedFilesSet: Set<string>;
  commentLinesByFile: Map<string, CommentLineData[]>;
  activeCommentWidget: ActiveCommentWidget | null;
  memoizedActiveWidget: ActiveWidget | null;
  commentCallbacks: CommentCallbacks;
  onToggleFile: (fileName: string) => void;
  onMarkViewedFile: (fileName: string) => void;
  onUnmarkViewedFile: (fileName: string) => void;
  onOpenFileInEditor?: (filePath: string, lineNumber?: number) => void;
  onAddComment: (filePath: string, lineNumber: number, side?: CommentSide) => void;
  themeAppearance: ThemeAppearance;
  themeId: ThemeId;
}

function DiffContentImpl({
  diffAreaRef,
  files,
  featureId,
  mode,
  targetBranch,
  selectedCommit,
  diffMode,
  collapsedFiles,
  focusedFileIndex,
  viewedFilesSet,
  commentLinesByFile,
  activeCommentWidget,
  memoizedActiveWidget,
  commentCallbacks,
  onToggleFile,
  onMarkViewedFile,
  onUnmarkViewedFile,
  onOpenFileInEditor,
  onAddComment,
  themeAppearance,
  themeId,
}: DiffContentProps) {
  return (
    <DiffVirtualizer scrollRef={diffAreaRef}>
      {files.map((file, fileIndex) => (
        <DiffRow
          key={file.file}
          scrollRef={diffAreaRef}
          featureId={featureId}
          mode={mode}
          targetBranch={targetBranch}
          commitSha={selectedCommit}
          status={file.status}
          oldFile={file.old_file ?? undefined}
          diffMode={diffMode}
          displayName={file.file}
          isCollapsed={collapsedFiles.has(file.file)}
          isFocused={fileIndex === focusedFileIndex}
          isFileViewed={viewedFilesSet.has(file.file)}
          showViewedCheckbox={!selectedCommit}
          additions={file.additions}
          deletions={file.deletions}
          commentLines={commentLinesByFile.get(file.file)}
          activeWidget={activeCommentWidget?.filePath === file.file ? memoizedActiveWidget : null}
          commentCallbacks={commentCallbacks}
          onToggleFile={onToggleFile}
          onMarkViewedFile={onMarkViewedFile}
          onUnmarkViewedFile={onUnmarkViewedFile}
          onOpenFileInEditor={onOpenFileInEditor}
          onAddComment={onAddComment}
          themeAppearance={themeAppearance}
          themeId={themeId}
        />
      ))}
    </DiffVirtualizer>
  );
}

export const DiffContent = memo(DiffContentImpl);
