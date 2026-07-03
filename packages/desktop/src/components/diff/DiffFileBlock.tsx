import { memo, useCallback, useState } from "react";
import type { ThemeAppearance, ThemeId } from "@/lib/themes";
import { firstChangedNewLine } from "@/lib/diff-line";
import { type FileDiffSection, hasTextHunks } from "@/lib/parse-unified-diff";
import { LARGE_DIFF_BYTES, isLargeDiffByLines } from "@/lib/diff-thresholds";
import { DiffFileHeader } from "./DiffFileHeader";
import {
  type CommentLineData,
  type ActiveWidget,
  type CommentCallbacks,
} from "./diff-comment-decorations";
import { LargeDiffPlaceholder } from "./LargeDiffPlaceholder";
import { PatchDiffView, type CommentSide } from "./PatchDiffView";
import { ProgressiveLargeDiff } from "./ProgressiveLargeDiff";
import { DiffStatusIcon, deriveChangeType } from "./DiffStatusIcon";

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
  onOpenFileInEditor?: (filePath: string, lineNumber?: number) => void;
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

interface DiffFileBodyProps {
  section: FileDiffSection;
  patch: string;
  diffMode: "unified" | "split";
  additions: number;
  deletions: number;
  forceDisplay: boolean;
  onDisplayLargeDiff: () => void;
  commentLines?: CommentLineData[];
  activeWidget?: ActiveWidget | null;
  commentCallbacks?: CommentCallbacks;
  onAddLineComment?: (lineNumber: number, side: CommentSide) => void;
  themeAppearance: ThemeAppearance;
  themeId: ThemeId;
  isFocused: boolean;
}

/** Body of an expanded file: binary/no-hunk/large placeholders or the diff. */
function DiffFileBody({
  section,
  patch,
  diffMode,
  additions,
  deletions,
  forceDisplay,
  onDisplayLargeDiff,
  commentLines,
  activeWidget,
  commentCallbacks,
  onAddLineComment,
  themeAppearance,
  themeId,
  isFocused,
}: DiffFileBodyProps) {
  const hasHunks = hasTextHunks(section);
  const isBinary = !hasHunks && isBinaryPatch(patch);
  // Rendering a file's diff is O(patch size) synchronous work on the main
  // thread (`parseUnifiedDiff` at render + Pierre's tokenize/hydrate). For a
  // large file that freezes the UI on expand — the very thing the user hits on
  // a giant rebase diff. Gate it behind an explicit "Display diff" opt-in.
  const isLarge =
    hasHunks &&
    !isBinary &&
    (isLargeDiffByLines(additions, deletions) || patch.length >= LARGE_DIFF_BYTES);

  if (isBinary) {
    return (
      <LargeDiffPlaceholder
        variant="binary"
        sizeBytes={0}
        additions={additions}
        deletions={deletions}
      />
    );
  }
  if (!hasHunks) {
    return (
      <div className="border-t border-border bg-[var(--editor-bg)] px-4 py-3 font-mono text-xs text-muted-foreground">
        No text hunks in this file diff.
      </div>
    );
  }
  if (isLarge && !forceDisplay) {
    return (
      <LargeDiffPlaceholder
        variant="large"
        sizeBytes={patch.length}
        additions={additions}
        deletions={deletions}
        onDisplay={onDisplayLargeDiff}
      />
    );
  }
  // Large opted-in files render chunk-by-chunk so even a multi-MB single-hunk
  // patch never blocks the main thread.
  const DiffBody = isLarge ? ProgressiveLargeDiff : PatchDiffView;
  return (
    <DiffBody
      patch={patch}
      mode={diffMode}
      commentLines={commentLines}
      activeWidget={activeWidget}
      commentCallbacks={commentCallbacks}
      themeAppearance={themeAppearance}
      themeId={themeId}
      focused={isFocused}
      disableFileHeader
      onAddComment={onAddLineComment}
    />
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
  onOpenFileInEditor,
  onAddComment,
  themeAppearance,
  themeId,
}: DiffFileBlockProps) {
  const patch = section.hunks[0] ?? "";
  const [shownPatch, setShownPatch] = useState(patch);
  const [forceDisplay, setForceDisplay] = useState(false);
  // Reset the opt-in when the underlying patch changes so a newly-huge revision
  // of the same file re-gates to the placeholder instead of auto-rendering.
  // Done during render (not in an effect) so the stale `forceDisplay` never
  // commits a large new patch for a frame before the reset lands.
  if (shownPatch !== patch) {
    setShownPatch(patch);
    setForceDisplay(false);
  }
  const onDisplayLargeDiff = useCallback((): void => setForceDisplay(true), []);
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
  const onOpenFile = useCallback(
    (): void => onOpenFileInEditor?.(displayName, firstChangedNewLine(section.hunks[0] ?? "")),
    [displayName, onOpenFileInEditor, section.hunks],
  );

  // One header for both states: collapsed renders it alone (cheap — no Pierre);
  // expanded renders it above a Pierre body whose own header is disabled, so the
  // row looks identical either way (font, status icon, counts, edit, viewed).
  const header = (
    <DiffFileHeader
      displayName={displayName}
      additions={additions}
      deletions={deletions}
      isCollapsed={isCollapsed}
      isFocused={isFocused}
      isFileViewed={isFileViewed}
      showViewedCheckbox={showViewedCheckbox}
      statusIcon={<DiffStatusIcon type={deriveChangeType(section)} appearance={themeAppearance} />}
      themeAppearance={themeAppearance}
      onToggle={onToggle}
      onOpenFileInEditor={onOpenFileInEditor ? onOpenFile : undefined}
      onMarkViewed={onMarkViewed}
      onUnmarkViewed={onUnmarkViewed}
    />
  );

  if (isCollapsed) return header;

  return (
    <>
      {header}
      <DiffFileBody
        section={section}
        patch={patch}
        diffMode={diffMode}
        additions={additions}
        deletions={deletions}
        forceDisplay={forceDisplay}
        onDisplayLargeDiff={onDisplayLargeDiff}
        commentLines={commentLines}
        activeWidget={activeWidget}
        commentCallbacks={commentCallbacks}
        onAddLineComment={onAddComment ? onAddLineComment : undefined}
        themeAppearance={themeAppearance}
        themeId={themeId}
        isFocused={isFocused}
      />
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
