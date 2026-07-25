import { memo, useCallback, useState, type ReactNode } from "react";
import { FileStageState, type ChangedFile } from "@/api/generated";
import type { ThemeAppearance, ThemeId } from "@/lib/themes";
import { firstChangedNewLine } from "@/lib/diff-line";
import { type FileDiffSection, hasTextHunks } from "@/lib/parse-unified-diff";
import type { PrThreadLine } from "@/lib/pr-review-threads";
import { LARGE_DIFF_BYTES, isLargeDiffByLines } from "@/lib/diff-thresholds";
import { isImageFile } from "@/lib/file-language";
import { DiffFileHeader } from "./DiffFileHeader";
import {
  type CommentLineData,
  type ActiveWidget,
  type CommentCallbacks,
} from "./diff-comment-decorations";
import { LargeDiffPlaceholder } from "./LargeDiffPlaceholder";
import { PatchDiffView, type CommentSide } from "./PatchDiffView";
import { ProgressiveLargeDiff } from "./ProgressiveLargeDiff";
import { DiffStatusIcon, deriveChangeTypeFromStatus } from "./DiffStatusIcon";
import { useFileDiffSection } from "./useFileDiffSection";
import type { DiffMode } from "./useDiffData";
import { DiffImageView } from "./DiffImageView";
import type { GitFileIndexActions } from "./useGitFileIndexActions";
import { GitConflictFileBanner } from "./GitConflictFileBanner";
import type { OpenDiffInEditor } from "./OpenDiffInEditorContext";
import { resolvedStageState } from "./useGitDiffFileTreeModel";

export interface DiffFileBlockProps {
  featureId: number;
  mode: DiffMode;
  targetBranch?: string;
  commitSha?: string | null;
  file: ChangedFile;
  /**
   * Whether the row is on (or near) screen. All rows mount — the outer list
   * isn't component-virtualized — so this gates the per-file diff fetch to the
   * files actually in view instead of firing one request per changed file.
   */
  isVisible: boolean;
  diffMode: "unified" | "split";
  isCollapsed: boolean;
  isFocused: boolean;
  isFileViewed: boolean;
  isViewedPending: boolean;
  showViewedCheckbox: boolean;
  commentLines?: CommentLineData[];
  /** Unresolved forge review threads anchored to this file. */
  remoteThreadLines?: PrThreadLine[];
  activeReviewThreadId?: string | null;
  selectedReviewThreadIds?: ReadonlySet<string>;
  onReviewThreadSelectedChange?: (threadId: string, selected: boolean) => void;
  activeWidget?: ActiveWidget | null;
  commentCallbacks?: CommentCallbacks;
  onToggleFile: (fileName: string) => void;
  onMarkViewedFile: (fileName: string) => void;
  onUnmarkViewedFile: (fileName: string) => void;
  onOpenFileInEditor?: OpenDiffInEditor;
  indexActions?: GitFileIndexActions;
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

/** One-line status row under a file header (loading / error / no-hunks). */
function DiffFileNotice({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`border-t border-border bg-[var(--editor-bg)] px-4 py-3 font-mono text-xs ${
        tone === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </div>
  );
}

interface DiffFileBodyProps {
  featureId: number;
  displayName: string;
  oldFile?: string;
  status: string;
  mode: DiffMode;
  targetBranch?: string;
  commitSha?: string | null;
  section: FileDiffSection;
  patch: string;
  diffMode: "unified" | "split";
  additions: number;
  deletions: number;
  forceDisplay: boolean;
  onDisplayLargeDiff: () => void;
  commentLines?: CommentLineData[];
  remoteThreadLines?: PrThreadLine[];
  activeReviewThreadId?: string | null;
  selectedReviewThreadIds?: ReadonlySet<string>;
  onReviewThreadSelectedChange?: (threadId: string, selected: boolean) => void;
  activeWidget?: ActiveWidget | null;
  commentCallbacks?: CommentCallbacks;
  onAddLineComment?: (lineNumber: number, side: CommentSide) => void;
  themeAppearance: ThemeAppearance;
  themeId: ThemeId;
  isFocused: boolean;
}

/** Body of an expanded file: binary/no-hunk/large placeholders or the diff. */
function DiffFileBodyImpl({
  featureId,
  displayName,
  oldFile,
  status,
  mode,
  targetBranch,
  commitSha,
  section,
  patch,
  diffMode,
  additions,
  deletions,
  forceDisplay,
  onDisplayLargeDiff,
  commentLines,
  remoteThreadLines,
  activeReviewThreadId,
  selectedReviewThreadIds,
  onReviewThreadSelectedChange,
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
    if (isImageFile(displayName)) {
      return (
        <DiffImageView
          featureId={featureId}
          filePath={displayName}
          oldFilePath={oldFile}
          status={status}
          mode={mode}
          targetBranch={targetBranch}
          commitSha={commitSha}
        />
      );
    }
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
    return <DiffFileNotice>No text hunks in this file diff.</DiffFileNotice>;
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
      remoteThreadLines={remoteThreadLines}
      activeReviewThreadId={activeReviewThreadId}
      selectedReviewThreadIds={selectedReviewThreadIds}
      onReviewThreadSelectedChange={onReviewThreadSelectedChange}
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

const DiffFileBody = memo(DiffFileBodyImpl);

function DiffFileBlockHeader({ props, patch }: { props: DiffFileBlockProps; patch?: string }) {
  const {
    file,
    isCollapsed,
    isFocused,
    isFileViewed,
    isViewedPending,
    showViewedCheckbox,
    onToggleFile,
    onMarkViewedFile,
    onUnmarkViewedFile,
    onOpenFileInEditor,
    themeAppearance,
    indexActions,
  } = props;
  const { status, file: displayName, additions, deletions } = file;
  const conflicted = resolvedStageState(file) === FileStageState.conflicted;
  const onToggle = useCallback((): void => onToggleFile(displayName), [displayName, onToggleFile]);
  const onMarkViewed = useCallback(
    (): void => onMarkViewedFile(displayName),
    [displayName, onMarkViewedFile],
  );
  const onUnmarkViewed = useCallback(
    (): void => onUnmarkViewedFile(displayName),
    [displayName, onUnmarkViewedFile],
  );
  const onOpenFile = useCallback(
    (): void => onOpenFileInEditor?.(displayName, firstChangedNewLine(patch ?? "")),
    [displayName, onOpenFileInEditor, patch],
  );

  return (
    <>
      <DiffFileHeader
        displayName={displayName}
        additions={additions}
        deletions={deletions}
        isCollapsed={isCollapsed}
        isFocused={isFocused}
        isFileViewed={isFileViewed}
        isViewedPending={isViewedPending}
        showViewedCheckbox={showViewedCheckbox}
        statusIcon={
          <DiffStatusIcon type={deriveChangeTypeFromStatus(status)} appearance={themeAppearance} />
        }
        themeAppearance={themeAppearance}
        onToggle={onToggle}
        onOpenFileInEditor={onOpenFileInEditor ? onOpenFile : undefined}
        file={file}
        indexActions={indexActions}
        onMarkViewed={onMarkViewed}
        onUnmarkViewed={onUnmarkViewed}
      />
      {conflicted && (
        <GitConflictFileBanner
          file={file}
          indexActions={indexActions}
          onOpenFileInEditor={onOpenFileInEditor ? onOpenFile : undefined}
        />
      )}
    </>
  );
}

function ExpandedDiffFileBlock(props: DiffFileBlockProps) {
  const {
    featureId,
    mode,
    targetBranch,
    commitSha,
    file,
    isVisible,
    diffMode,
    commentLines,
    remoteThreadLines,
    activeReviewThreadId,
    selectedReviewThreadIds,
    onReviewThreadSelectedChange,
    activeWidget,
    commentCallbacks,
    onAddComment,
    themeAppearance,
    themeId,
    isFocused,
  } = props;
  const { status, file: displayName, additions, deletions } = file;
  const oldFile = file.old_file ?? undefined;
  // Fetch this file's patch lazily — only when it's expanded AND on screen.
  // All rows mount (the outer list isn't component-virtualized), so gating on
  // visibility is what keeps a 400-file diff from firing 400 requests on open.
  const { section, isLoading, errorMessage } = useFileDiffSection({
    featureId,
    filePath: displayName,
    oldFilePath: oldFile,
    mode,
    targetBranch,
    commitSha: commitSha ?? null,
    enabled: isVisible,
  });
  const patch = section?.hunks[0] ?? "";
  const [shownPatch, setShownPatch] = useState(patch);
  const [forceDisplay, setForceDisplay] = useState(false);
  const reviewNeedsDisplay =
    activeReviewThreadId != null &&
    remoteThreadLines?.some((line) =>
      line.threads.some((thread) => thread.id === activeReviewThreadId),
    ) === true;
  // Reset the opt-in when the underlying patch changes so a newly-huge revision
  // of the same file re-gates to the placeholder instead of auto-rendering.
  // Done during render (not in an effect) so the stale `forceDisplay` never
  // commits a large new patch for a frame before the reset lands.
  if (shownPatch !== patch) {
    setShownPatch(patch);
    setForceDisplay(false);
  }
  const onDisplayLargeDiff = useCallback((): void => setForceDisplay(true), []);
  const onAddLineComment = useCallback(
    (lineNumber: number, side: CommentSide): void => onAddComment?.(displayName, lineNumber, side),
    [displayName, onAddComment],
  );
  return (
    <>
      <DiffFileBlockHeader props={props} patch={patch} />
      {errorMessage ? (
        <DiffFileNotice tone="error">{errorMessage}</DiffFileNotice>
      ) : section === null || isLoading ? (
        <DiffFileNotice>Loading diff…</DiffFileNotice>
      ) : (
        <DiffFileBody
          featureId={featureId}
          displayName={displayName}
          oldFile={oldFile}
          status={status}
          mode={mode}
          targetBranch={targetBranch}
          commitSha={commitSha}
          section={section}
          patch={patch}
          diffMode={diffMode}
          additions={additions}
          deletions={deletions}
          forceDisplay={forceDisplay || reviewNeedsDisplay}
          onDisplayLargeDiff={onDisplayLargeDiff}
          commentLines={commentLines}
          remoteThreadLines={remoteThreadLines}
          activeReviewThreadId={activeReviewThreadId}
          selectedReviewThreadIds={selectedReviewThreadIds}
          onReviewThreadSelectedChange={onReviewThreadSelectedChange}
          activeWidget={activeWidget}
          commentCallbacks={commentCallbacks}
          onAddLineComment={onAddComment ? onAddLineComment : undefined}
          themeAppearance={themeAppearance}
          themeId={themeId}
          isFocused={isFocused}
        />
      )}
    </>
  );
}

function DiffFileBlockImpl(props: DiffFileBlockProps) {
  // A collapsed row stays header-only: no per-file patch or image requests.
  if (props.isCollapsed) return <DiffFileBlockHeader props={props} />;
  return <ExpandedDiffFileBlock {...props} />;
}

export const DiffFileBlock = memo(DiffFileBlockImpl);
