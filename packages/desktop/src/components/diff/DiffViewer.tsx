import { memo, useMemo, useRef, type ReactNode } from "react";
import type { ThemeAppearance, ThemeId } from "@/lib/themes";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useTheme } from "@/hooks/useTheme";
import { GIT_DIFF_VIEW_MODE_KEY, parseGitDiffViewMode } from "@/lib/git-diff-view-mode";
import { DiffContent } from "./DiffContent";
import { DiffLayout } from "./DiffLayout";
import { GitDiffToolbar } from "./GitDiffToolbar";
import { GitDiffFileTree } from "./GitDiffFileTree";
import { useDiffData, type DiffMode } from "./useDiffData";
import { useOpenDiffInEditor, type OpenDiffInEditor } from "./OpenDiffInEditorContext";
import { useGitFileIndexActions } from "./useGitFileIndexActions";
import { useGitFileListCollapse, type GitFileListCollapseState } from "./useGitFileListCollapse";
import { useDiffViewerComments } from "./useDiffViewerComments";
import { useDiffViewerNavigation } from "./useDiffViewerNavigation";
import type { GitNavigationAdapterRegistrar } from "./gitNavigation";

interface DiffViewerProps {
  featureId: number;
  mode: DiffMode;
  targetBranch?: string;
  commitSha?: string | null;
  fileListCollapsed?: boolean;
  onFileListCollapsedChange?: (collapsed: boolean) => void;
  onOpenFileInEditor?: OpenDiffInEditor;
  registerNavigationAdapter?: GitNavigationAdapterRegistrar;
  afterToolbar?: ReactNode;
}

type DiffData = ReturnType<typeof useDiffData>;

interface LoadedDiffViewerProps {
  featureId: number;
  mode: DiffMode;
  targetBranch?: string;
  data: DiffData;
  fileList: GitFileListCollapseState;
  diffMode: "unified" | "split";
  themeAppearance: ThemeAppearance;
  themeId: ThemeId;
  openFileInEditor?: OpenDiffInEditor;
  registerNavigationAdapter?: GitNavigationAdapterRegistrar;
}

function DiffViewerMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      className={`flex h-full items-center justify-center bg-background px-4 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}
      role={error ? "alert" : "status"}
    >
      <p>{children}</p>
    </div>
  );
}

function DiffQueryErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
      role="alert"
    >
      {message}
    </div>
  );
}

const DiffViewerLayout = memo(function DiffViewerLayout({
  data,
  fileList,
  tree,
  content,
}: {
  data: DiffData;
  fileList: GitFileListCollapseState;
  tree: ReactNode;
  content: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <DiffQueryErrorBanner message={data.errorMessage} />
      <DiffLayout
        collapsed={fileList.showCollapsedRail}
        controlled={fileList.isControlled}
        disabled={fileList.isLoading}
        sidebar={tree}
        content={content}
        onCollapsedChange={fileList.setCollapsed}
      />
    </div>
  );
});

function LoadedDiffViewer({
  featureId,
  mode,
  targetBranch,
  data,
  fileList,
  diffMode,
  themeAppearance,
  themeId,
  openFileInEditor,
  registerNavigationAdapter,
}: LoadedDiffViewerProps) {
  const indexActions = useGitFileIndexActions(featureId);
  const diffAreaRef = useRef<HTMLDivElement>(null);
  const indexMutable =
    (mode === "uncommitted" || mode === "worktree") && data.selectedCommit === null;
  const navigation = useDiffViewerNavigation({
    featureId,
    data,
    indexActions,
    diffAreaRef,
    onOpenFileInEditor: openFileInEditor,
    indexMutable,
    registerNavigationAdapter,
  });
  const comments = useDiffViewerComments(featureId, data);
  const content = useMemo(
    () => (
      <DiffContent
        diffAreaRef={diffAreaRef}
        files={data.changedFiles}
        featureId={featureId}
        mode={mode}
        targetBranch={targetBranch}
        selectedCommit={data.selectedCommit}
        diffMode={diffMode}
        collapsedFiles={navigation.collapsedFiles}
        activeFilePath={navigation.activeFilePath}
        viewedFilesSet={data.viewedFilesSet}
        isViewedPending={data.markViewed.isPending || data.unmarkViewed.isPending}
        commentLinesByFile={comments.commentLinesByFile}
        activeCommentWidget={comments.activeCommentWidget}
        memoizedActiveWidget={comments.activeWidget}
        commentCallbacks={comments.callbacks}
        onToggleFile={navigation.toggleFile}
        onMarkViewedFile={navigation.markFileViewed}
        onUnmarkViewedFile={navigation.unmarkFileViewed}
        onOpenFileInEditor={openFileInEditor}
        indexActions={indexMutable ? indexActions : undefined}
        onAddComment={comments.addComment}
        themeAppearance={themeAppearance}
        themeId={themeId}
      />
    ),
    [
      comments,
      data,
      diffAreaRef,
      diffMode,
      featureId,
      indexActions,
      indexMutable,
      mode,
      navigation,
      openFileInEditor,
      targetBranch,
      themeAppearance,
      themeId,
    ],
  );
  const tree = useMemo(
    () => (
      <GitDiffFileTree
        model={navigation.tree.model}
        files={data.changedFiles}
        expandedFiles={navigation.expandedFiles}
        indexActions={indexActions}
        displayMode={navigation.tree.displayMode}
        isDisplayModePending={navigation.tree.isDisplayModePending}
        onDisplayModeChange={navigation.tree.setDisplayMode}
        resolveFilePath={navigation.tree.resolveFilePath}
        onToggleExpand={navigation.toggleFile}
        onOpenFileInEditor={openFileInEditor}
        onCollapse={fileList.isControlled ? undefined : fileList.collapse}
      />
    ),
    [data.changedFiles, fileList, indexActions, navigation, openFileInEditor],
  );
  return <DiffViewerLayout data={data} fileList={fileList} tree={tree} content={content} />;
}

function DiffViewerImpl({
  featureId,
  mode,
  targetBranch,
  commitSha,
  fileListCollapsed,
  onFileListCollapsedChange,
  onOpenFileInEditor,
  registerNavigationAdapter,
  afterToolbar,
}: DiffViewerProps) {
  const contextOpenFileInEditor = useOpenDiffInEditor();
  const openFileInEditor = onOpenFileInEditor ?? contextOpenFileInEditor;
  const {
    value,
    setValue: setDiffMode,
    isLoading: isDiffModeLoading,
    isSaving: isDiffModeSaving,
  } = useDebouncedSetting(GIT_DIFF_VIEW_MODE_KEY, 0, { immediateCache: false });
  const diffMode = parseGitDiffViewMode(value);
  const fileList = useGitFileListCollapse({
    controlledValue: fileListCollapsed,
    onControlledChange: onFileListCollapsedChange,
  });
  const { theme } = useTheme();
  const data = useDiffData(featureId, mode, targetBranch, commitSha);

  let content: ReactNode;
  if (data.isLoading) {
    content = <DiffViewerMessage>Loading diff...</DiffViewerMessage>;
  } else if (data.errorMessage && data.changedFiles.length === 0) {
    content = <DiffViewerMessage error>{data.errorMessage}</DiffViewerMessage>;
  } else if (data.changedFiles.length === 0) {
    content = <DiffViewerMessage>No changes detected</DiffViewerMessage>;
  } else {
    content = (
      <LoadedDiffViewer
        featureId={featureId}
        mode={mode}
        targetBranch={targetBranch}
        data={data}
        fileList={fileList}
        diffMode={diffMode}
        themeAppearance={theme.appearance}
        themeId={theme.id}
        openFileInEditor={openFileInEditor}
        registerNavigationAdapter={registerNavigationAdapter}
      />
    );
  }
  const supportsViewed = data.selectedCommit === null;
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <GitDiffToolbar
        diffMode={diffMode}
        onDiffModeChange={setDiffMode}
        isPreferenceLoading={isDiffModeLoading || isDiffModeSaving}
        viewedCount={supportsViewed ? data.viewedFilesSet.size : undefined}
        fileCount={supportsViewed ? data.changedFiles.length : undefined}
        isViewedPending={data.markViewed.isPending || data.unmarkViewed.isPending}
      />
      {afterToolbar}
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  );
}

// Mounted beside a streaming agent; stable props keep unrelated stream
// updates from repainting the virtualized tree and diff instances.
export const DiffViewer = memo(DiffViewerImpl);
