import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type {
  ContextMenuItem as FileTreeContextMenuItem,
  ContextMenuOpenContext as FileTreeContextMenuOpenContext,
  FileTreeRenameEvent,
} from "@pierre/trees";
import { useGetUncommittedFiles, useTreeAll } from "@/api/generated";
import { useEditorState } from "@/hooks/useEditorState";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useFileTreeMutations } from "@/hooks/useFileTreeMutations";
import {
  buildPierreInputs,
  CadencrFileTree,
  fromPierrePath,
  gitStatusFromUncommittedFiles,
  useCadencrFileTree,
} from "@/components/file-tree/CadencrFileTree";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { useDeferredFullTreeLoad } from "./useDeferredFullTreeLoad";
import { useFileTreeDraft, type DraftKind } from "./useFileTreeDraft";
import { apiErrorMessage } from "@/lib/api-errors";
import { validateSimpleName } from "@/lib/validate-name";

interface FileTreeProps {
  projectId: number;
  featureId: number;
}

/** Parent dir of an FS-form path; "" for top-level entries. */
function parentDirOf(fsPath: string): string {
  const idx = fsPath.lastIndexOf("/");
  return idx === -1 ? "" : fsPath.slice(0, idx);
}

/** Basename of an FS-form path. */
function basenameOf(fsPath: string): string {
  return fsPath.slice(fsPath.lastIndexOf("/") + 1);
}

/**
 * Editor file tree, backed by `@pierre/trees`. Pierre owns rendering,
 * virtualization, inline rename, drag-and-drop. We own data fetching
 * (`useTreeAll`), mutations (`useFileTreeMutations`), the context menu,
 * the inline-create draft (`useFileTreeDraft`), and tree-level
 * shortcuts (Enter = rename, ⌘⌫ = trash).
 */
export default function FileTree({ projectId, featureId }: FileTreeProps) {
  const { activePaneId, panes, openFile, renameFilePath } = useEditorState(featureId);
  const activeFilePath = panes[activePaneId]?.activeFilePath ?? null;
  const { value: maxTabsSetting } = useDebouncedSetting("editor_max_tabs");
  const maxTabs = useMemo(() => parseInt(maxTabsSetting ?? "10", 10), [maxTabsSetting]);

  const mutations = useFileTreeMutations(projectId, featureId);

  // Two-pass fetch: tracked first (fast — walker skips gitignored dirs
  // wholesale), then all entries (slow — walks node_modules etc.). The
  // pane unblocks as soon as `tracked` lands; `all` upgrades the model
  // in place once it resolves.
  const tracked = useTreeAll({
    project_id: projectId,
    feature_id: featureId,
    exclude_gitignored: true,
  });
  const fullTreeEnabled = useDeferredFullTreeLoad({
    featureId,
    trackedReady: tracked.data != null,
  });
  const all = useTreeAll(
    {
      project_id: projectId,
      feature_id: featureId,
      exclude_gitignored: false,
    },
    { query: { enabled: fullTreeEnabled } },
  );

  const entries = all.data ?? tracked.data;
  // One pass to produce both the pierre `paths` array and the minimal set
  // of gitignored "roots" feeding `useGitignoredDimming`.
  const { paths, ignoredPathPrefixes } = useMemo(() => {
    if (entries == null) return EMPTY_INPUTS;
    const { paths: p, ignoredRoots } = buildPierreInputs(entries);
    return { paths: p, ignoredPathPrefixes: ignoredRoots };
  }, [entries]);

  // Live uncommitted-file statuses. WS git handler invalidates
  // `/api/git/uncommitted-files` on every `git.status` envelope; pierre
  // decorates changed rows and dots every ancestor folder. We deliberately
  // don't feed gitignored entries here — pierre's ancestor walk would dot
  // the project root via every `node_modules/` (see
  // `gitStatusFromUncommittedFiles`).
  const uncommitted = useGetUncommittedFiles({ feature_id: featureId });
  const gitStatus = useMemo(
    () => gitStatusFromUncommittedFiles(uncommitted.data),
    [uncommitted.data],
  );

  // ── Open-file & focus bridge ───────────────────────────────────────────
  const initialSelectedPaths = useMemo(
    () => (activeFilePath ? [activeFilePath] : undefined),
    // Only set the initial selection once when the model is constructed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { model } = useCadencrFileTree({
    paths,
    gitStatus,
    ignoredPathPrefixes,
    // Pierre's built-in search input is hidden — search is reached through
    // the global CMD+P file-picker (see `EditorFuzzyShortcut`).
    search: false,
    fileTreeSearchMode: "expand-matches",
    initialSelectedPaths,
    renaming: {
      canRename: (item: { path: string }) => item.path !== "",
      onError: (message: string) => toast.error(message),
      onRename: (event: FileTreeRenameEvent) => handleRename(event),
    },
    dragAndDrop: {
      canDrag: (selected: readonly string[]) => selected.length > 0,
      canDrop: ({ target }: { target: { kind: string } }) =>
        target.kind === "directory" || target.kind === "root",
      onDropComplete: (event: {
        draggedPaths: readonly string[];
        target: { directoryPath: string | null };
      }) => handleDropComplete(event.draggedPaths, event.target.directoryPath),
      onDropError: (message: string) => toast.error(message),
    },
  });

  // ── Inline-create draft state (Pierre placeholder + rename) ────────────
  const onFileCreated = useCallback(
    (fsPath: string) => {
      openFile(activePaneId, fsPath, maxTabs);
    },
    [activePaneId, maxTabs, openFile],
  );
  const { startCreate, isDraftPath, tryHandleAsCreate } = useFileTreeDraft({
    model,
    projectId,
    featureId,
    mutations,
    onFileCreated,
    featureKey: featureId,
  });

  // Open files only on explicit click — pierre retargets `e.target` to
  // the shadow host, so `closest()` won't find the row. Walk
  // `composedPath()` (which crosses the shadow boundary) instead. Using
  // selection as the trigger conflated rename/move with file open.
  const handleTreeClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0 || e.defaultPrevented) return;
      const path = e.nativeEvent.composedPath();
      let row: HTMLElement | null = null;
      for (const node of path) {
        if (node instanceof HTMLElement && node.hasAttribute("data-item-path")) {
          row = node;
          break;
        }
      }
      if (!row) return;
      if (row.getAttribute("data-item-type") !== "file") return;
      const pierrePath = row.getAttribute("data-item-path");
      if (!pierrePath || isDraftPath(pierrePath)) return;
      openFile(activePaneId, fromPierrePath(pierrePath), maxTabs);
    },
    [activePaneId, isDraftPath, maxTabs, openFile],
  );

  // Pierre fires `onRename` for both renames and inline-draft commits.
  // Try create first; otherwise treat as a rename of an existing entry.
  const handleRename = useCallback(
    (event: FileTreeRenameEvent) => {
      if (tryHandleAsCreate(event)) return;

      const pierreSource = event.sourcePath;
      const pierreDest = event.destinationPath;
      const fsSource = fromPierrePath(pierreSource);
      const fsDest = fromPierrePath(pierreDest);
      const newName = basenameOf(fsDest);

      const validationError = validateSimpleName(newName);
      if (validationError) {
        toast.error(validationError);
        model.move(pierreDest, pierreSource);
        return;
      }

      mutations.rename.mutate(
        {
          data: {
            project_id: projectId,
            feature_id: featureId,
            old_path: fsSource,
            new_name: newName,
          },
        },
        {
          onSuccess: () => {
            // Keep any open tab for the renamed path (and tabs under a
            // renamed folder) pointing at the new filesystem path.
            renameFilePath(fsSource, fsDest);
          },
          onError: () => {
            // Pierre already mutated its local model. Reverse it.
            model.move(pierreDest, pierreSource);
          },
        },
      );
    },
    [featureId, model, mutations.rename, projectId, renameFilePath, tryHandleAsCreate],
  );

  const handleDropComplete = useCallback(
    (draggedPaths: readonly string[], pierreTargetDir: string | null) => {
      const fsParent = pierreTargetDir ? fromPierrePath(pierreTargetDir) : "";
      for (const pierreSource of draggedPaths) {
        const fsSource = fromPierrePath(pierreSource);
        const basename = basenameOf(fsSource);
        const fsDest = fsParent ? `${fsParent}/${basename}` : basename;
        mutations.move.mutate(
          {
            data: {
              project_id: projectId,
              feature_id: featureId,
              old_path: fsSource,
              new_parent_path: fsParent,
            },
          },
          {
            onSuccess: () => {
              // Update any open tabs whose path is (or sits under) the
              // moved source so they follow the file/folder.
              renameFilePath(fsSource, fsDest);
            },
            onError: () => {
              const trailing = pierreSource.endsWith("/") ? "/" : "";
              const pierreDest = `${fsDest}${trailing}`;
              model.move(pierreDest, pierreSource);
            },
          },
        );
      }
    },
    [featureId, model, mutations.move, projectId, renameFilePath],
  );

  // Direct trash, no confirmation: the backend moves to the system trash
  // (recoverable from Finder/Explorer). We strip the row from pierre's
  // local model on success so it disappears before the slow refetch
  // reconciles (`tree-all` can take 100s of ms on monorepos).
  const trashPath = useCallback(
    (pierrePath: string) => {
      const fsPath = fromPierrePath(pierrePath);
      if (!fsPath) return;
      const isFolder = pierrePath.endsWith("/");
      mutations.trash.mutate(
        {
          data: { project_id: projectId, feature_id: featureId, path: fsPath },
        },
        {
          onSuccess: () => {
            if (model.getItem(pierrePath) != null) {
              model.remove(pierrePath, isFolder ? { recursive: true } : undefined);
            }
          },
          onError: (err) => toast.error(apiErrorMessage(err, "Failed to move to trash")),
        },
      );
    },
    [featureId, model, mutations.trash, projectId],
  );

  // ── Context-menu actions ───────────────────────────────────────────────
  const handleMenuAction = useCallback(
    (
      action: "new-file" | "new-folder" | "open" | "reveal" | "rename" | "delete",
      item: FileTreeContextMenuItem,
      context: FileTreeContextMenuOpenContext,
    ) => {
      const fsItemPath = fromPierrePath(item.path);
      switch (action) {
        case "new-file":
        case "new-folder": {
          const kind: DraftKind = action === "new-file" ? "file" : "folder";
          // For a directory: the new entry lands inside it. For a file: the
          // new entry lands next to it (in its parent dir).
          const parentDir = item.kind === "directory" ? fsItemPath : parentDirOf(fsItemPath);
          context.close({ restoreFocus: false });
          startCreate(kind, parentDir);
          return;
        }
        case "open":
          context.close();
          openFile(activePaneId, fsItemPath, maxTabs);
          return;
        case "reveal":
          context.close();
          void mutations.reveal(fsItemPath);
          return;
        case "rename":
          context.close({ restoreFocus: false });
          model.startRenaming(item.path);
          return;
        case "delete":
          context.close();
          trashPath(item.path);
          return;
        default:
          return;
      }
    },
    [activePaneId, maxTabs, model, mutations, openFile, startCreate, trashPath],
  );

  const renderContextMenu = useCallback(
    (item: FileTreeContextMenuItem, context: FileTreeContextMenuOpenContext) => (
      <FileTreeContextMenu item={item} context={context} onAction={handleMenuAction} />
    ),
    [handleMenuAction],
  );

  // Tree-level shortcuts: Enter → rename focused row; ⌘⌫ → move to trash.
  // Pierre owns arrow keys, F2, etc.
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Skip when typing inside pierre's rename input / search box.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      // Skip while pierre's context menu is open; it owns the active
      // verb and would otherwise double-fire trash/rename through both
      // the menu row and this handler.
      if (document.querySelector("[data-file-tree-context-menu-root]")) return;
      const focusedPierrePath = model.getFocusedPath();
      if (!focusedPierrePath) return;
      // Pierre owns keys while the draft placeholder is being renamed.
      if (isDraftPath(focusedPierrePath)) return;

      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        model.startRenaming(focusedPierrePath);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
        e.preventDefault();
        trashPath(focusedPierrePath);
        return;
      }
    },
    [isDraftPath, model, trashPath],
  );

  return (
    <div className="flex h-full flex-col" onKeyDown={handleTreeKeyDown} onClick={handleTreeClick}>
      <CadencrFileTree
        model={model}
        // Only block on the fast (`tracked`) query — the slow (`all`)
        // query upgrades the tree in place once it arrives.
        isLoading={tracked.isLoading && !tracked.data}
        errorMessage={tracked.isError && !tracked.data ? "Failed to load file tree" : null}
        renderContextMenu={renderContextMenu}
        aria-label="Project file tree"
      />
    </div>
  );
}

// Stable empty inputs so the memo doesn't churn while the queries are in
// flight (`useTreeAll().data` is `undefined` before the first response).
const EMPTY_INPUTS: { paths: readonly string[]; ignoredPathPrefixes: readonly string[] } = {
  paths: [],
  ignoredPathPrefixes: [],
};
