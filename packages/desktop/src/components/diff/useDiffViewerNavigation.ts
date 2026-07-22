import type { ChangedFile } from "@/api/generated";
import { FileStageState } from "@/api/generated";
import { getGitFileActionAvailability, type GitFileIndexActions } from "./useGitFileIndexActions";
import {
  resolvedStageState,
  useGitDiffFileTreeModel,
  type GitDiffTreeNavigationAdapter,
} from "./useGitDiffFileTreeModel";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { useDiffData } from "./useDiffData";
import { useCollapseLargeFilesOnLoad } from "./useLargeFileCollapse";
import { scrollFileToTop } from "./scroll-to-file";
import { openGitFileInEditor } from "./gitFileEditorHandoff";
import type { GitNavigationAdapterRegistrar, GitNavigationAdapter } from "./gitNavigation";

type DiffData = ReturnType<typeof useDiffData>;

interface UseDiffViewerNavigationOptions {
  featureId: number;
  data: DiffData;
  indexActions: GitFileIndexActions;
  diffAreaRef: RefObject<HTMLDivElement | null>;
  onOpenFileInEditor?: (filePath: string) => void;
  indexMutable: boolean;
  registerNavigationAdapter?: GitNavigationAdapterRegistrar;
}

export interface DiffViewerNavigationState {
  tree: ReturnType<typeof useGitDiffFileTreeModel>;
  collapsedFiles: Set<string>;
  expandedFiles: Set<string>;
  activeFilePath: string | null;
  toggleFile: (filePath: string) => void;
  markFileViewed: (filePath: string) => void;
  unmarkFileViewed: (filePath: string) => void;
}

interface DiffNavigationAdapterState {
  tree: GitDiffTreeNavigationAdapter;
  collapsedFiles: ReadonlySet<string>;
  fileByPath: ReadonlyMap<string, ChangedFile>;
  viewedFiles: ReadonlySet<string>;
  viewedPending: boolean;
  viewedSupported: boolean;
  indexActions: GitFileIndexActions;
  indexMutable: boolean;
  diffAreaRef: RefObject<HTMLDivElement | null>;
  revealFile: (filePath: string) => void;
  collapseFile: (filePath: string) => void;
  markFileViewed: (filePath: string) => void;
  unmarkFileViewed: (filePath: string) => void;
  openFileInEditor?: (filePath: string) => void;
}

function runIndexAction(state: DiffNavigationAdapterState, action: "stage" | "reset"): boolean {
  if (!state.indexMutable || state.indexActions.isPending) return false;
  const path = state.tree.getActivePath();
  const file = path ? state.fileByPath.get(path) : undefined;
  if (!file) return false;
  const stageState = resolvedStageState(file);
  const availability = getGitFileActionAvailability(stageState);
  if (action === "stage" && availability.canStage) {
    state.indexActions.stage(file.file, {
      conflicted: stageState === FileStageState.conflicted,
    });
  } else if (action === "reset" && availability.canReset) state.indexActions.reset(file.file);
  else return false;
  return true;
}

function useDiffNavigationAdapter(state: DiffNavigationAdapterState): GitNavigationAdapter {
  const stateRef = useRef(state);
  stateRef.current = state;
  return useMemo<GitNavigationAdapter>(
    () => ({
      getActiveItem: () => stateRef.current.tree.getActivePath(),
      moveSelection: (offset) => {
        const current = stateRef.current;
        const path = current.tree.moveSelection(offset);
        if (!path) return false;
        current.revealFile(path);
        return true;
      },
      open: () => {
        const current = stateRef.current;
        const path = current.tree.getActivePath();
        if (!path) return false;
        current.revealFile(path);
        return true;
      },
      back: () => {
        const current = stateRef.current;
        const path = current.tree.getActivePath();
        if (!path) return false;
        if (!current.collapsedFiles.has(path)) current.collapseFile(path);
        else return current.tree.focusActive();
        return true;
      },
      toggleViewed: () => {
        const current = stateRef.current;
        const path = current.tree.getActivePath();
        if (!path || !current.viewedSupported || current.viewedPending) return false;
        if (current.viewedFiles.has(path)) current.unmarkFileViewed(path);
        else current.markFileViewed(path);
        return true;
      },
      stage: () => runIndexAction(stateRef.current, "stage"),
      reset: () => runIndexAction(stateRef.current, "reset"),
      scrollHalfPage: (direction) => {
        const area = stateRef.current.diffAreaRef.current;
        if (!area) return false;
        area.scrollBy({ top: direction * (area.clientHeight / 2), behavior: "smooth" });
        return true;
      },
      openInEditor: () => {
        const current = stateRef.current;
        const path = current.tree.getActivePath();
        if (!path || !current.openFileInEditor) return false;
        current.openFileInEditor(path);
        return true;
      },
    }),
    [],
  );
}

function useViewedFileActions(
  featureId: number,
  data: DiffData,
  setCollapsedFiles: Dispatch<SetStateAction<Set<string>>>,
) {
  const stateRef = useRef({ data, featureId });
  stateRef.current = { data, featureId };
  const markFileViewed = useCallback(
    (filePath: string): void => {
      const current = stateRef.current;
      current.data.markViewed.mutate({
        featureId: current.featureId,
        data: {
          feature_id: current.featureId,
          file_path: filePath,
          blob_sha: current.data.blobShas[filePath] ?? "",
        },
      });
      setCollapsedFiles((previous) => new Set([...previous, filePath]));
    },
    [setCollapsedFiles],
  );
  const unmarkFileViewed = useCallback((filePath: string): void => {
    const current = stateRef.current;
    current.data.unmarkViewed.mutate({
      featureId: current.featureId,
      params: { file_path: filePath },
    });
  }, []);
  return useMemo(() => ({ markFileViewed, unmarkFileViewed }), [markFileViewed, unmarkFileViewed]);
}

function useExpandedFiles(data: DiffData, collapsedFiles: Set<string>): Set<string> {
  return useMemo(() => {
    const expanded = new Set<string>();
    for (const file of data.changedFiles) {
      if (!collapsedFiles.has(file.file)) expanded.add(file.file);
    }
    return expanded;
  }, [collapsedFiles, data.changedFiles]);
}

function useCollapseInitialization(
  data: DiffData,
  setCollapsedFiles: Dispatch<SetStateAction<Set<string>>>,
): void {
  useEffect(() => {
    if (data.hasInitializedCollapse.current || data.viewedFilesSet.size === 0) return;
    data.hasInitializedCollapse.current = true;
    setCollapsedFiles((previous) => new Set([...previous, ...data.viewedFilesSet]));
  }, [data.hasInitializedCollapse, data.viewedFilesSet, setCollapsedFiles]);
  useCollapseLargeFilesOnLoad(data.changedFiles, setCollapsedFiles);
}

function useFocusedFileEditorOpener(
  fileByPath: ReadonlyMap<string, ChangedFile>,
  onOpenFileInEditor: ((filePath: string) => void) | undefined,
): (filePath: string) => void {
  return useCallback(
    (filePath: string): void => {
      const file = fileByPath.get(filePath);
      if (file && onOpenFileInEditor) {
        openGitFileInEditor(file, () => onOpenFileInEditor(filePath));
      }
    },
    [fileByPath, onOpenFileInEditor],
  );
}

export function useDiffViewerNavigation({
  featureId,
  data,
  indexActions,
  diffAreaRef,
  onOpenFileInEditor,
  indexMutable,
  registerNavigationAdapter,
}: UseDiffViewerNavigationOptions): DiffViewerNavigationState {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const revealFile = useCallback(
    (filePath: string): void => {
      setCollapsedFiles((previous) => {
        if (!previous.has(filePath)) return previous;
        const next = new Set(previous);
        next.delete(filePath);
        return next;
      });
      if (diffAreaRef.current) scrollFileToTop(diffAreaRef.current, filePath);
    },
    [diffAreaRef],
  );
  const tree = useGitDiffFileTreeModel({
    files: data.changedFiles,
    viewedFiles: data.viewedFilesSet,
    indexActions,
    onSelectionChange: revealFile,
  });
  useCollapseInitialization(data, setCollapsedFiles);
  const fileByPath = useMemo(
    () => new Map(data.changedFiles.map((file) => [file.file, file])),
    [data.changedFiles],
  );
  const openFocusedFileInEditor = useFocusedFileEditorOpener(fileByPath, onOpenFileInEditor);

  const collapseFile = useCallback((filePath: string): void => {
    setCollapsedFiles((previous) =>
      previous.has(filePath) ? previous : new Set([...previous, filePath]),
    );
  }, []);
  const toggleFile = useCallback(
    (filePath: string): void => {
      tree.navigation.selectPath(filePath);
      setCollapsedFiles((previous) => {
        const next = new Set(previous);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        return next;
      });
    },
    [tree.navigation],
  );
  const { markFileViewed, unmarkFileViewed } = useViewedFileActions(
    featureId,
    data,
    setCollapsedFiles,
  );

  const expandedFiles = useExpandedFiles(data, collapsedFiles);
  const adapter = useDiffNavigationAdapter({
    tree: tree.navigation,
    collapsedFiles,
    fileByPath,
    viewedFiles: data.viewedFilesSet,
    viewedPending: data.markViewed.isPending || data.unmarkViewed.isPending,
    viewedSupported: data.selectedCommit === null,
    indexActions,
    indexMutable,
    diffAreaRef,
    revealFile,
    collapseFile,
    markFileViewed,
    unmarkFileViewed,
    openFileInEditor: onOpenFileInEditor ? openFocusedFileInEditor : undefined,
  });
  useEffect(() => registerNavigationAdapter?.(adapter), [adapter, registerNavigationAdapter]);

  return useMemo(
    () => ({
      tree,
      collapsedFiles,
      expandedFiles,
      activeFilePath: tree.activePath,
      toggleFile,
      markFileViewed,
      unmarkFileViewed,
    }),
    [collapsedFiles, expandedFiles, markFileViewed, toggleFile, tree, unmarkFileViewed],
  );
}
