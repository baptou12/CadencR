import { useCallback, useEffect, useRef } from "react";
import type { FileTree, FileTreeDirectoryHandle } from "@pierre/trees";
import type { GitDiffTreeDisplayMode, GitDiffTreePresentation } from "./gitDiffTreePresentation";

interface DirectoryExpansionSnapshot {
  collapsedPaths: readonly string[];
}

interface UseGitDiffTreeDisplayModeOptions {
  displayMode: GitDiffTreeDisplayMode;
  onDisplayModeChange: (displayMode: GitDiffTreeDisplayMode) => void;
  model: FileTree;
  presentation: GitDiffTreePresentation;
  hierarchicalPaths: readonly string[];
}

export function selectGitDiffTreePath(model: FileTree, treePath: string): boolean {
  const item = model.getItem(treePath);
  if (item == null || item.isDirectory()) return false;
  for (const selectedPath of model.getSelectedPaths()) {
    if (selectedPath !== treePath) model.getItem(selectedPath)?.deselect();
  }
  item.select();
  item.focus();
  model.scrollToPath(treePath, { focus: true, offset: "nearest" });
  return true;
}

function captureDirectoryExpansion(
  model: FileTree,
  hierarchicalPaths: readonly string[],
): DirectoryExpansionSnapshot {
  const collapsedPaths: string[] = [];
  for (const path of hierarchicalPaths) {
    if (!path.endsWith("/")) continue;
    const item = model.getItem(path);
    if (!item?.isDirectory()) continue;
    if (!(item as FileTreeDirectoryHandle).isExpanded()) collapsedPaths.push(path);
  }
  return { collapsedPaths };
}

function restoreDirectoryExpansion(
  model: FileTree,
  snapshot: DirectoryExpansionSnapshot,
  hierarchicalPaths: readonly string[],
): void {
  const collapsedPaths = new Set(snapshot.collapsedPaths);
  for (const path of hierarchicalPaths) {
    if (!path.endsWith("/") || collapsedPaths.has(path)) continue;
    const item = model.getItem(path);
    if (item?.isDirectory()) (item as FileTreeDirectoryHandle).expand();
  }
  for (const path of collapsedPaths) {
    const item = model.getItem(path);
    if (item?.isDirectory()) (item as FileTreeDirectoryHandle).collapse();
  }
}

function resolveActivePath(model: FileTree, presentation: GitDiffTreePresentation): string | null {
  const treePath = model.getFocusedPath() ?? model.getSelectedPaths().at(-1) ?? null;
  return treePath ? (presentation.filePathByTreePath.get(treePath) ?? null) : null;
}

export function useGitDiffTreeDisplayMode({
  displayMode,
  onDisplayModeChange,
  model,
  presentation,
  hierarchicalPaths,
}: UseGitDiffTreeDisplayModeOptions): (displayMode: GitDiffTreeDisplayMode) => void {
  const expansionSnapshotRef = useRef<DirectoryExpansionSnapshot | null>(null);
  const selectionToRestoreRef = useRef<string | null | undefined>(undefined);
  const setDisplayMode = useCallback(
    (nextDisplayMode: GitDiffTreeDisplayMode): void => {
      if (nextDisplayMode === displayMode) return;
      selectionToRestoreRef.current = resolveActivePath(model, presentation);
      if (displayMode === "tree") {
        expansionSnapshotRef.current = captureDirectoryExpansion(model, hierarchicalPaths);
      }
      onDisplayModeChange(nextDisplayMode);
    },
    [displayMode, hierarchicalPaths, model, onDisplayModeChange, presentation],
  );
  useEffect(() => {
    if (selectionToRestoreRef.current !== undefined) {
      const filePath = selectionToRestoreRef.current;
      const treePath = filePath ? presentation.treePathByFilePath.get(filePath) : null;
      if (treePath) selectGitDiffTreePath(model, treePath);
      selectionToRestoreRef.current = undefined;
    }
    if (displayMode === "tree" && expansionSnapshotRef.current) {
      restoreDirectoryExpansion(model, expansionSnapshotRef.current, hierarchicalPaths);
      expansionSnapshotRef.current = null;
    }
  }, [displayMode, hierarchicalPaths, model, presentation]);
  return setDisplayMode;
}
