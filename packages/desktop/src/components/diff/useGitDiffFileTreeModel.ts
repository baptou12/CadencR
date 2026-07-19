import { useCallback, useMemo, useRef } from "react";
import {
  prepareFileTreeInput,
  type FileTree,
  type FileTreeOptions,
  type FileTreeRowDecoration,
} from "@pierre/trees";
import { useFileTreeSelection, useFileTreeSelector } from "@pierre/trees/react";
import {
  ConflictKind,
  FileStageState,
  type ChangedFile,
  type ConflictKind as ConflictKindValue,
  type FileStageState as FileStageStateValue,
} from "@/api/generated";
import { useCadencrFileTree } from "@/components/file-tree/CadencrFileTree";
import { useFileTreeShadowStylesheet } from "@/components/file-tree/useFileTreeShadowStylesheet";
import {
  buildGitDiffTreePresentation,
  buildGitDiffTreeShadowCss,
  type GitDiffTreeDisplayMode,
  type GitDiffTreePresentation,
} from "./gitDiffTreePresentation";
import { selectGitDiffTreePath, useGitDiffTreeDisplayMode } from "./useGitDiffTreeDisplayMode";
import { useGitDiffTreeDisplaySetting } from "./useGitDiffTreeDisplaySetting";
import type { GitFileIndexActions } from "./useGitFileIndexActions";

type PierreGitStatus = NonNullable<FileTreeOptions["gitStatus"]>[number]["status"];

/** Stable Pierre-owned selection seam for the Phase 3 Git keyboard controller. */
export interface GitDiffTreeNavigationAdapter {
  getActivePath: () => string | null;
  selectPath: (filePath: string) => boolean;
  moveSelection: (offset: -1 | 1) => string | null;
  focusActive: () => boolean;
}

interface GitDiffFileTreeModelResult {
  model: FileTree;
  activePath: string | null;
  displayMode: GitDiffTreeDisplayMode;
  isDisplayModePending: boolean;
  setDisplayMode: (displayMode: GitDiffTreeDisplayMode) => void;
  resolveFilePath: (treePath: string) => string | null;
  navigation: GitDiffTreeNavigationAdapter;
}

interface UseGitDiffFileTreeModelOptions {
  files: readonly ChangedFile[];
  viewedFiles: ReadonlySet<string>;
  indexActions: GitFileIndexActions;
  onSelectionChange: (filePath: string) => void;
}

/** Include explicit ancestor directories so expanded state survives path resets. */
export function buildGitDiffTreePaths(files: readonly Pick<ChangedFile, "file">[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    const segments = file.file.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      paths.add(`${segments.slice(0, index).join("/")}/`);
    }
    paths.add(file.file);
  }
  return [...paths];
}

export function statusFromChangedFile(file: ChangedFile): PierreGitStatus {
  const stageState = resolvedStageState(file);
  if (stageState === FileStageState.conflicted) return "modified";
  if (stageState === FileStageState.untracked) return "untracked";
  if (file.status.startsWith("A")) return "added";
  if (file.status.startsWith("D")) return "deleted";
  if (file.status.startsWith("R") || file.status.startsWith("C")) return "renamed";
  return "modified";
}

export function buildGitDiffTreeStatus(
  files: readonly ChangedFile[],
): NonNullable<FileTreeOptions["gitStatus"]> {
  return files.map((file) => ({ path: file.file, status: statusFromChangedFile(file) }));
}

export function resolvedStageState(file: ChangedFile): FileStageStateValue {
  if (file.stage_state != null) return file.stage_state;
  return file.is_staged ? FileStageState.staged : FileStageState.not_applicable;
}

export function conflictKindLabel(kind: ConflictKindValue | null | undefined): string {
  switch (kind) {
    case ConflictKind.dd:
      return "both deleted";
    case ConflictKind.au:
      return "added by us";
    case ConflictKind.ud:
      return "deleted by them";
    case ConflictKind.ua:
      return "added by them";
    case ConflictKind.du:
      return "deleted by us";
    case ConflictKind.aa:
      return "both added";
    case ConflictKind.uu:
      return "both modified";
    default:
      return "unmerged";
  }
}

export function isUnavailableDeleteConflict(file: ChangedFile): boolean {
  return (
    resolvedStageState(file) === FileStageState.conflicted && file.conflict_kind === ConflictKind.dd
  );
}

function stageStateDecoration(file: ChangedFile): string | null {
  switch (resolvedStageState(file)) {
    case FileStageState.untracked:
      return "Untracked";
    case FileStageState.unstaged:
      return "Unstaged";
    case FileStageState.staged:
      return "Staged";
    case FileStageState.both:
      return "Staged + unstaged";
    case FileStageState.conflicted:
      return "Conflict";
    default:
      return null;
  }
}

export function gitDiffTreeDecoration(
  file: ChangedFile,
  viewed: boolean,
  indexActions: Pick<GitFileIndexActions, "pendingAction" | "pendingPath" | "error">,
): FileTreeRowDecoration | null {
  const parts: string[] = [];
  const state = stageStateDecoration(file);
  if (state) parts.push(state);
  if (viewed) parts.push("Viewed");
  if (indexActions.pendingPath === file.file) {
    parts.push(indexActions.pendingAction === "stage" ? "Staging…" : "Unstaging…");
  }
  if (indexActions.error?.filePath === file.file) parts.push("Action failed");
  if (parts.length === 0) return null;
  const conflict = resolvedStageState(file) === FileStageState.conflicted;
  const detail = conflict ? `Conflict: ${conflictKindLabel(file.conflict_kind)}.` : "";
  const error = indexActions.error?.filePath === file.file ? ` ${indexActions.error.message}` : "";
  return { text: parts.join(" · "), title: `${detail}${error}`.trim() || undefined };
}

interface NavigationState {
  orderedFileTreePaths: readonly string[];
  treePathByFilePath: ReadonlyMap<string, string>;
  filePathByTreePath: ReadonlyMap<string, string>;
}

function isVisibleThroughExpandedAncestors(model: FileTree, treePath: string): boolean {
  let separatorIndex = treePath.indexOf("/");
  while (separatorIndex >= 0) {
    const directoryPath = treePath.slice(0, separatorIndex + 1);
    const directory = model.getItem(directoryPath);
    if (directory && "isExpanded" in directory && !directory.isExpanded()) return false;
    separatorIndex = treePath.indexOf("/", separatorIndex + 1);
  }
  return true;
}

function canNavigateToTreePath(
  model: FileTree,
  state: NavigationState,
  treePath: string,
  searchActive: boolean,
): boolean {
  return (
    state.filePathByTreePath.has(treePath) &&
    (searchActive || isVisibleThroughExpandedAncestors(model, treePath))
  );
}

function adjacentVisibleFileTreePath(
  model: FileTree,
  state: NavigationState,
  activeTreePath: string | null,
  offset: -1 | 1,
): string | null {
  const searchActive = model.getSearchValue().length > 0;
  const paths = searchActive ? model.getSearchMatchingPaths() : state.orderedFileTreePaths;
  if (paths.length === 0) return null;
  const currentIndex = activeTreePath == null ? -1 : paths.indexOf(activeTreePath);
  const startIndex = currentIndex < 0 ? 0 : currentIndex + offset;
  const step = currentIndex < 0 ? 1 : offset;
  for (let index = startIndex; index >= 0 && index < paths.length; index += step) {
    const path = paths[index];
    if (path && canNavigateToTreePath(model, state, path, searchActive)) return path;
  }
  return activeTreePath && canNavigateToTreePath(model, state, activeTreePath, searchActive)
    ? activeTreePath
    : null;
}

function useNavigationAdapter(model: FileTree, state: NavigationState) {
  const stateRef = useRef(state);
  stateRef.current = state;
  return useMemo<GitDiffTreeNavigationAdapter>(
    () => ({
      getActivePath: () => {
        const treePath = model.getFocusedPath() ?? model.getSelectedPaths().at(-1) ?? null;
        return treePath ? (stateRef.current.filePathByTreePath.get(treePath) ?? null) : null;
      },
      selectPath: (filePath) => {
        const treePath = stateRef.current.treePathByFilePath.get(filePath);
        return treePath ? selectGitDiffTreePath(model, treePath) : false;
      },
      moveSelection: (offset) => {
        const { filePathByTreePath } = stateRef.current;
        const activeTreePath = model.getFocusedPath() ?? model.getSelectedPaths().at(-1) ?? null;
        const nextTreePath = adjacentVisibleFileTreePath(
          model,
          stateRef.current,
          activeTreePath,
          offset,
        );
        if (!nextTreePath) return null;
        selectGitDiffTreePath(model, nextTreePath);
        return filePathByTreePath.get(nextTreePath) ?? null;
      },
      focusActive: () => {
        const treePath = model.getFocusedPath() ?? model.getSelectedPaths().at(-1) ?? null;
        return treePath ? selectGitDiffTreePath(model, treePath) : false;
      },
    }),
    [model],
  );
}

function useActiveTreePath(model: FileTree, presentation: GitDiffTreePresentation): string | null {
  const selectedPaths = useFileTreeSelection(model);
  const focusedTreePath = useFileTreeSelector(model, (current) => current.getFocusedPath());
  const selectedPath =
    selectedPaths
      .map((path) => presentation.filePathByTreePath.get(path))
      .findLast((path) => path != null) ?? null;
  const focusedPath = focusedTreePath
    ? (presentation.filePathByTreePath.get(focusedTreePath) ?? null)
    : null;
  return focusedPath ?? selectedPath;
}

function useGitPierreModel(
  presentation: GitDiffTreePresentation,
  onSelectionChange: (selectedPaths: readonly string[]) => void,
  renderRowDecoration: NonNullable<FileTreeOptions["renderRowDecoration"]>,
): FileTree {
  const { model } = useCadencrFileTree({
    paths: presentation.paths,
    gitStatus: presentation.gitStatus,
    initialExpansion: "open",
    search: true,
    searchBlurBehavior: "retain",
    fileTreeSearchMode: "hide-non-matches",
    stickyFolders: true,
    renaming: false,
    dragAndDrop: false,
    composition: {
      contextMenu: { enabled: true, triggerMode: "both", buttonVisibility: "when-needed" },
    },
    onSelectionChange,
    renderRowDecoration,
    rowDecorationVersion: renderRowDecoration,
  });
  return model;
}

export function useGitDiffFileTreeModel({
  files,
  viewedFiles,
  indexActions,
  onSelectionChange,
}: UseGitDiffFileTreeModelOptions): GitDiffFileTreeModelResult {
  const {
    displayMode,
    setDisplayMode: persistDisplayMode,
    isPending: isDisplayModePending,
  } = useGitDiffTreeDisplaySetting();
  const hierarchicalPaths = useMemo(() => buildGitDiffTreePaths(files), [files]);
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.file, file])), [files]);
  const presentation = useMemo(
    () =>
      buildGitDiffTreePresentation({
        files,
        displayMode,
        statusFromFile: statusFromChangedFile,
        hierarchicalPaths,
      }),
    [displayMode, files, hierarchicalPaths],
  );
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]): void => {
      const selectedPath = selectedPaths
        .map((path) => presentation.filePathByTreePath.get(path))
        .findLast((path) => path != null);
      if (selectedPath) onSelectionChange(selectedPath);
    },
    [onSelectionChange, presentation.filePathByTreePath],
  );
  const renderRowDecoration = useCallback(
    ({ item }: { item: { kind: "directory" | "file"; path: string } }) => {
      if (item.kind === "directory") return null;
      const filePath = presentation.filePathByTreePath.get(item.path);
      const file = filePath ? fileByPath.get(filePath) : undefined;
      return file ? gitDiffTreeDecoration(file, viewedFiles.has(file.file), indexActions) : null;
    },
    [fileByPath, indexActions, presentation.filePathByTreePath, viewedFiles],
  );
  const model = useGitPierreModel(presentation, handleSelectionChange, renderRowDecoration);
  const shadowCss = useMemo(
    () => buildGitDiffTreeShadowCss(presentation.labels),
    [presentation.labels],
  );
  useFileTreeShadowStylesheet(model, "data-cadencr-git-diff-layout", shadowCss);
  const setDisplayMode = useGitDiffTreeDisplayMode({
    displayMode,
    onDisplayModeChange: persistDisplayMode,
    model,
    presentation,
    hierarchicalPaths,
  });
  const activePath = useActiveTreePath(model, presentation);
  const navigationState = useMemo<NavigationState>(
    () => ({
      orderedFileTreePaths: prepareFileTreeInput(presentation.paths).paths.filter((path) =>
        presentation.filePathByTreePath.has(path),
      ),
      treePathByFilePath: presentation.treePathByFilePath,
      filePathByTreePath: presentation.filePathByTreePath,
    }),
    [presentation.filePathByTreePath, presentation.paths, presentation.treePathByFilePath],
  );
  const navigation = useNavigationAdapter(model, navigationState);
  const resolveFilePath = useCallback(
    (treePath: string) => presentation.filePathByTreePath.get(treePath) ?? null,
    [presentation.filePathByTreePath],
  );

  return useMemo(
    () => ({
      model,
      activePath,
      displayMode,
      isDisplayModePending,
      setDisplayMode,
      resolveFilePath,
      navigation,
    }),
    [
      activePath,
      displayMode,
      isDisplayModePending,
      model,
      navigation,
      resolveFilePath,
      setDisplayMode,
    ],
  );
}
