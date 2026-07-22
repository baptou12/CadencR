import { useCallback, useMemo, useRef } from "react";
import type {
  FileTree,
  FileTreeOptions,
  FileTreeRowDecoration,
  FileTreeSortComparator,
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
import {
  useGitDiffTreeDisplaySetting,
  type GitDiffTreeDisplayMode,
} from "./useGitDiffTreeDisplaySetting";
import type { GitFileIndexActions } from "./useGitFileIndexActions";

type PierreGitStatus = NonNullable<FileTreeOptions["gitStatus"]>[number]["status"];

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

/** 0 = conflicted (sort first), 1 = everything else. */
export function conflictSortRank(file: ChangedFile): 0 | 1 {
  return resolvedStageState(file) === FileStageState.conflicted ? 0 : 1;
}

/** Flat-list ordering: conflicted files first, then path name. */
export function sortChangedFilesForDiff(files: readonly ChangedFile[]): ChangedFile[] {
  return [...files].sort((left, right) => {
    const byConflict = conflictSortRank(left) - conflictSortRank(right);
    if (byConflict !== 0) return byConflict;
    return left.file.localeCompare(right.file);
  });
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

function visibleFilePaths(model: FileTree, filePaths: ReadonlySet<string>): string[] {
  return model.getVisiblePaths().filter((path) => filePaths.has(path));
}

function selectGitDiffTreePath(model: FileTree, filePath: string): boolean {
  const item = model.getItem(filePath);
  if (item == null || item.isDirectory()) return false;
  for (const selectedPath of model.getSelectedPaths()) {
    if (selectedPath !== filePath) model.getItem(selectedPath)?.deselect();
  }
  item.select();
  item.focus();
  model.scrollToPath(filePath, { focus: true, offset: "nearest" });
  return true;
}

function useNavigationAdapter(model: FileTree, filePaths: ReadonlySet<string>) {
  const filePathsRef = useRef(filePaths);
  filePathsRef.current = filePaths;
  return useMemo<GitDiffTreeNavigationAdapter>(
    () => ({
      getActivePath: () => {
        const path = model.getFocusedPath() ?? model.getSelectedPaths().at(-1) ?? null;
        return path && filePathsRef.current.has(path) ? path : null;
      },
      selectPath: (filePath) =>
        filePathsRef.current.has(filePath) && selectGitDiffTreePath(model, filePath),
      moveSelection: (offset) => {
        const paths = visibleFilePaths(model, filePathsRef.current);
        if (paths.length === 0) return null;
        const active = model.getFocusedPath() ?? model.getSelectedPaths().at(-1) ?? null;
        const currentIndex = active == null ? -1 : paths.indexOf(active);
        const nextIndex =
          currentIndex < 0 ? (offset === 1 ? 0 : paths.length - 1) : currentIndex + offset;
        const nextPath = paths[Math.max(0, Math.min(paths.length - 1, nextIndex))];
        if (!nextPath) return null;
        selectGitDiffTreePath(model, nextPath);
        return nextPath;
      },
      focusActive: () => {
        const path = model.getFocusedPath() ?? model.getSelectedPaths().at(-1) ?? null;
        return path ? selectGitDiffTreePath(model, path) : false;
      },
    }),
    [model],
  );
}

function useActivePath(model: FileTree, filePaths: ReadonlySet<string>): string | null {
  const selectedPaths = useFileTreeSelection(model);
  const focusedPath = useFileTreeSelector(model, (current) => current.getFocusedPath());
  if (focusedPath && filePaths.has(focusedPath)) return focusedPath;
  return selectedPaths.findLast((path) => filePaths.has(path)) ?? null;
}

export function useGitDiffFileTreeModel({
  files,
  viewedFiles,
  indexActions,
  onSelectionChange,
}: UseGitDiffFileTreeModelOptions): GitDiffFileTreeModelResult {
  const {
    displayMode,
    setDisplayMode,
    isPending: isDisplayModePending,
  } = useGitDiffTreeDisplaySetting();
  const paths = useMemo(() => buildGitDiffTreePaths(files), [files]);
  const gitStatus = useMemo(() => buildGitDiffTreeStatus(files), [files]);
  const fileByPath = useMemo(() => new Map(files.map((file) => [file.file, file])), [files]);
  const filePaths = useMemo(() => new Set(fileByPath.keys()), [fileByPath]);
  const conflictPaths = useMemo(
    () =>
      new Set(
        files
          .filter((file) => resolvedStageState(file) === FileStageState.conflicted)
          .map((file) => file.file),
      ),
    [files],
  );
  const conflictPathsRef = useRef(conflictPaths);
  conflictPathsRef.current = conflictPaths;
  const conflictFirstSort = useMemo<FileTreeSortComparator>(
    () => (left, right) => {
      if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
      const leftConflict = conflictPathsRef.current.has(left.path) ? 0 : 1;
      const rightConflict = conflictPathsRef.current.has(right.path) ? 0 : 1;
      if (leftConflict !== rightConflict) return leftConflict - rightConflict;
      return left.basename.localeCompare(right.basename, undefined, { sensitivity: "base" });
    },
    [],
  );
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]): void => {
      const selectedPath = selectedPaths.findLast((path) => filePaths.has(path));
      if (selectedPath) onSelectionChange(selectedPath);
    },
    [filePaths, onSelectionChange],
  );
  const renderRowDecoration = useCallback(
    ({ item }: { item: { kind: "directory" | "file"; path: string } }) => {
      if (item.kind === "directory") return null;
      const file = fileByPath.get(item.path);
      return file ? gitDiffTreeDecoration(file, viewedFiles.has(file.file), indexActions) : null;
    },
    [fileByPath, indexActions, viewedFiles],
  );
  const { model } = useCadencrFileTree({
    paths,
    gitStatus,
    filesOnly: displayMode === "filenames",
    initialExpansion: "open",
    search: true,
    searchBlurBehavior: "retain",
    fileTreeSearchMode: "hide-non-matches",
    stickyFolders: true,
    renaming: false,
    dragAndDrop: false,
    sort: conflictFirstSort,
    composition: {
      contextMenu: { enabled: true, triggerMode: "both", buttonVisibility: "when-needed" },
    },
    onSelectionChange: handleSelectionChange,
    renderRowDecoration,
    rowDecorationVersion: renderRowDecoration,
  });
  const activePath = useActivePath(model, filePaths);
  const navigation = useNavigationAdapter(model, filePaths);
  const resolveFilePath = useCallback(
    (treePath: string) => (filePaths.has(treePath) ? treePath : null),
    [filePaths],
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
