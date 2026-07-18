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
import { useDiffKeyboard } from "./useDiffKeyboard";
import { useCollapseLargeFilesOnLoad } from "./useLargeFileCollapse";
import { scrollFileToTop } from "./scroll-to-file";
import { useGitDiffFileTreeModel } from "./useGitDiffFileTreeModel";
import type { GitFileIndexActions } from "./useGitFileIndexActions";
import { openGitFileInEditor } from "./gitFileEditorHandoff";

type DiffData = ReturnType<typeof useDiffData>;

interface UseDiffViewerNavigationOptions {
  featureId: number;
  data: DiffData;
  indexActions: GitFileIndexActions;
  diffAreaRef: RefObject<HTMLDivElement | null>;
  onOpenFileInEditor?: (filePath: string) => void;
}

export interface DiffViewerNavigationState {
  tree: ReturnType<typeof useGitDiffFileTreeModel>;
  collapsedFiles: Set<string>;
  expandedFiles: Set<string>;
  focusedFileIndex: number;
  toggleFile: (filePath: string) => void;
  markFileViewed: (filePath: string) => void;
  unmarkFileViewed: (filePath: string) => void;
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
  data: DiffData,
  onOpenFileInEditor: ((filePath: string) => void) | undefined,
): (filePath: string) => void {
  const fileByPath = useMemo(
    () => new Map(data.changedFiles.map((file) => [file.file, file])),
    [data.changedFiles],
  );
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
  const focusedFileIndex = tree.activePath ? data.fileNames.indexOf(tree.activePath) : -1;
  useCollapseInitialization(data, setCollapsedFiles);
  const openFocusedFileInEditor = useFocusedFileEditorOpener(data, onOpenFileInEditor);

  const selectFileIndex = useCallback(
    (index: number): void => {
      const filePath = data.fileNames[index];
      if (filePath) tree.navigation.selectPath(filePath);
    },
    [data.fileNames, tree.navigation],
  );
  const scrollToFileIndex = useCallback(
    (index: number): void => {
      const filePath = data.fileNames[index];
      if (filePath) revealFile(filePath);
    },
    [data.fileNames, revealFile],
  );
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

  useDiffKeyboard({
    fileNames: data.fileNames,
    focusedFileIndex,
    setFocusedFileIndex: selectFileIndex,
    scrollToFileIndex,
    toggleFile,
    viewedFilesSet: data.viewedFilesSet,
    markFileViewed,
    unmarkFileViewed,
    diffAreaRef,
    onOpenFocusedFileInEditor: onOpenFileInEditor ? openFocusedFileInEditor : undefined,
  });
  const expandedFiles = useExpandedFiles(data, collapsedFiles);

  return useMemo(
    () => ({
      tree,
      collapsedFiles,
      expandedFiles,
      focusedFileIndex,
      toggleFile,
      markFileViewed,
      unmarkFileViewed,
    }),
    [
      collapsedFiles,
      expandedFiles,
      focusedFileIndex,
      markFileViewed,
      toggleFile,
      tree,
      unmarkFileViewed,
    ],
  );
}
