import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useCreateEditorFile,
  useCreateEditorFolder,
  useRenameEditorPath,
  useTrashEditorPath,
  useGetEditorRoot,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { desktopBridge } from "@/lib/desktop-bridge";
import { invalidateByUrlPrefix, queryClient } from "@/lib/queryClient";

export type FileTreeMutations = ReturnType<typeof useFileTreeMutations>;

/**
 * Centralized mutations for file-tree edit operations and the
 * "Reveal in Finder" desktop command. Every mutation invalidates the
 * `/api/editor/tree` cache on success so the tree refreshes via the
 * canonical refetch (no optimistic updates — see `no-optimistic-updates.md`).
 * Errors surface as sonner toasts (see `error-handling.md`).
 */
export function useFileTreeMutations(projectId: number, featureId: number) {
  const qc = useQueryClient();

  function invalidateTree(): Promise<void> {
    return invalidateByUrlPrefix(qc, "/api/editor/tree");
  }

  const createFile = useCreateEditorFile({
    mutation: {
      onSuccess: () => {
        void invalidateTree();
        toast.success("File created");
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Failed to create file")),
    },
  });

  const createFolder = useCreateEditorFolder({
    mutation: {
      onSuccess: () => {
        void invalidateTree();
        toast.success("Folder created");
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Failed to create folder")),
    },
  });

  const rename = useRenameEditorPath({
    mutation: {
      onSuccess: () => {
        void invalidateTree();
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Failed to rename")),
    },
  });

  const trash = useTrashEditorPath({
    mutation: {
      onSuccess: () => {
        void invalidateTree();
        toast.success("Moved to trash");
      },
      onError: (err) => toast.error(apiErrorMessage(err, "Failed to move to trash")),
    },
  });

  // Lazily fetch (and cache) the editor root so we can build absolute paths
  // for the native "Reveal in Finder" command.
  const rootQuery = useGetEditorRoot(
    { project_id: projectId, feature_id: featureId },
    { query: { staleTime: 60_000 } },
  );

  const reveal = useCallback(
    async (relativePath: string) => {
      try {
        const root = rootQuery.data?.root;
        if (!root) {
          toast.error("Editor root unavailable");
          return;
        }
        const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
        const absolute = root.endsWith(sep)
          ? `${root}${relativePath}`
          : `${root}${sep}${relativePath}`;
        await desktopBridge.revealInFinder(absolute);
      } catch (err) {
        toast.error(typeof err === "string" ? err : "Failed to reveal in file manager");
      }
    },
    [rootQuery.data?.root],
  );

  /**
   * Submit a "create file"/"create folder" with a name typed into either the
   * inline tree row or the popover. Centralized here so the two callers
   * (`InlineCreateRow`, `FileTreeItem`) stay in sync.
   */
  const submitCreate = useCallback(
    (kind: "file" | "folder", parentDir: string, name: string, onSuccess: () => void) => {
      const childPath = parentDir ? `${parentDir}/${name}` : name;
      if (kind === "file") {
        createFile.mutate(
          { data: { project_id: projectId, feature_id: featureId, file_path: childPath } },
          { onSuccess },
        );
      } else {
        createFolder.mutate(
          { data: { project_id: projectId, feature_id: featureId, dir_path: childPath } },
          { onSuccess },
        );
      }
    },
    [createFile, createFolder, projectId, featureId],
  );

  // Memoize the return so consumers (FileTreeItem, InlineCreateRow) get stable
  // refs and downstream `React.memo` actually short-circuits.
  return useMemo(
    () => ({ createFile, createFolder, rename, trash, reveal, submitCreate }),
    [createFile, createFolder, rename, trash, reveal, submitCreate],
  );
}

/**
 * Context that lets the FileTree call `useFileTreeMutations` once at the top
 * and share the result with hundreds of rows. Per-row use of the hook would
 * subscribe each row to the `/api/editor/root` query and instantiate four
 * mutation hooks unnecessarily — see `frontend-performance.md`.
 */
const FileTreeMutationsContext = createContext<FileTreeMutations | null>(null);

interface ProviderProps {
  projectId: number;
  featureId: number;
  children: ReactNode;
}

export function FileTreeMutationsProvider({ projectId, featureId, children }: ProviderProps) {
  const value = useFileTreeMutations(projectId, featureId);
  return (
    <FileTreeMutationsContext.Provider value={value}>{children}</FileTreeMutationsContext.Provider>
  );
}

export function useFileTreeMutationsContext(): FileTreeMutations {
  const ctx = useContext(FileTreeMutationsContext);
  if (!ctx) {
    throw new Error("useFileTreeMutationsContext used outside <FileTreeMutationsProvider>");
  }
  return ctx;
}

/**
 * Re-export to allow non-React callers (e.g. WS handlers) to invalidate the
 * editor tree.
 */
export function invalidateEditorTree(): Promise<void> {
  return invalidateByUrlPrefix(queryClient, "/api/editor/tree");
}
