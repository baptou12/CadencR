import { memo, useCallback, type ReactNode } from "react";
import type { ThemeAppearance, ThemeId } from "@/lib/themes";
import { type FileDiffSection, hasTextHunks } from "@/lib/parse-unified-diff";
import { DiffFileHeader, DiffFileHeaderPrefix, DiffFileHeaderViewed } from "./DiffFileHeader";
import {
  type CommentLineData,
  type ActiveWidget,
  type CommentCallbacks,
} from "./diff-comment-decorations";
import { LargeDiffPlaceholder } from "./LargeDiffPlaceholder";
import { PatchDiffView, type CommentSide } from "./PatchDiffView";

export interface DiffFileBlockProps {
  section: FileDiffSection;
  diffMode: "unified" | "split";
  displayName: string;
  isCollapsed: boolean;
  isFocused: boolean;
  isFileViewed: boolean;
  showViewedCheckbox: boolean;
  additions: number;
  deletions: number;
  commentLines?: CommentLineData[];
  activeWidget?: ActiveWidget | null;
  commentCallbacks?: CommentCallbacks;
  onToggleFile: (fileName: string) => void;
  onMarkViewedFile: (fileName: string) => void;
  onUnmarkViewedFile: (fileName: string) => void;
  onAddComment?: (filePath: string, lineNumber: number, side?: CommentSide) => void;
  themeAppearance: ThemeAppearance;
  themeId: ThemeId;
}

function isBinaryPatch(patch: string): boolean {
  return (
    /(?:^|\n)Binary files .* differ(?:\n|$)/.test(patch) ||
    /(?:^|\n)GIT binary patch(?:\n|$)/.test(patch)
  );
}

function DiffFileBlockImpl({
  section,
  diffMode,
  displayName,
  isCollapsed,
  isFocused,
  isFileViewed,
  showViewedCheckbox,
  additions,
  deletions,
  commentLines,
  activeWidget,
  commentCallbacks,
  onToggleFile,
  onMarkViewedFile,
  onUnmarkViewedFile,
  onAddComment,
  themeAppearance,
  themeId,
}: DiffFileBlockProps) {
  const patch = section.hunks[0] ?? "";
  const hasHunks = hasTextHunks(section);
  const isBinary = !hasHunks && isBinaryPatch(patch);
  const onToggle = useCallback((): void => onToggleFile(displayName), [displayName, onToggleFile]);
  const onMarkViewed = useCallback(
    (): void => onMarkViewedFile(displayName),
    [displayName, onMarkViewedFile],
  );
  const onUnmarkViewed = useCallback(
    (): void => onUnmarkViewedFile(displayName),
    [displayName, onUnmarkViewedFile],
  );
  const onAddLineComment = useCallback(
    (lineNumber: number, side: CommentSide): void => onAddComment?.(displayName, lineNumber, side),
    [displayName, onAddComment],
  );

  const renderHeaderPrefix = useCallback(
    (): ReactNode => (
      <div className="group/header flex min-w-0 items-center gap-2 pl-2">
        <DiffFileHeaderPrefix
          displayName={displayName}
          isCollapsed={isCollapsed}
          showName={false}
          onToggle={onToggle}
        />
      </div>
    ),
    [displayName, isCollapsed, onToggle],
  );

  const renderHeaderMetadata = useCallback(
    (): ReactNode =>
      showViewedCheckbox ? (
        <div className="pr-3">
          <DiffFileHeaderViewed
            isFileViewed={isFileViewed}
            onMarkViewed={onMarkViewed}
            onUnmarkViewed={onUnmarkViewed}
          />
        </div>
      ) : null,
    [isFileViewed, onMarkViewed, onUnmarkViewed, showViewedCheckbox],
  );

  if (isCollapsed) {
    return (
      <DiffFileHeader
        displayName={displayName}
        additions={additions}
        deletions={deletions}
        isCollapsed={isCollapsed}
        isFocused={isFocused}
        isFileViewed={isFileViewed}
        showViewedCheckbox={showViewedCheckbox}
        onToggle={onToggle}
        onMarkViewed={onMarkViewed}
        onUnmarkViewed={onUnmarkViewed}
      />
    );
  }

  return (
    <>
      <PatchDiffView
        patch={patch}
        mode={diffMode}
        commentLines={commentLines}
        activeWidget={activeWidget}
        commentCallbacks={commentCallbacks}
        themeAppearance={themeAppearance}
        themeId={themeId}
        collapsed={isCollapsed}
        focused={isFocused}
        renderHeaderPrefix={renderHeaderPrefix}
        renderHeaderMetadata={renderHeaderMetadata}
        onAddComment={onAddComment ? onAddLineComment : undefined}
      />
      {!isCollapsed && isBinary && (
        <LargeDiffPlaceholder
          variant="binary"
          sizeBytes={0}
          additions={additions}
          deletions={deletions}
        />
      )}
      {!hasHunks && !isBinary && (
        <div className="border-t border-border bg-[var(--editor-bg)] px-4 py-3 font-mono text-xs text-muted-foreground">
          No text hunks in this file diff.
        </div>
      )}
    </>
  );
}

function arePropsEqual(prev: DiffFileBlockProps, next: DiffFileBlockProps): boolean {
  for (const key of Object.keys(next) as (keyof DiffFileBlockProps)[]) {
    if (key === "section") continue;
    if (!Object.is(prev[key], next[key])) return false;
  }
  const a = prev.section;
  const b = next.section;
  return (
    a.oldFileName === b.oldFileName &&
    a.newFileName === b.newFileName &&
    a.hunks.length === b.hunks.length &&
    a.hunks.every((hunk, index) => hunk === b.hunks[index])
  );
}

export const DiffFileBlock = memo(DiffFileBlockImpl, arePropsEqual);
