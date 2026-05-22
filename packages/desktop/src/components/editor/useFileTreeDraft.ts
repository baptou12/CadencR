import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { FileTree as FileTreeModel, FileTreeRenameEvent } from "@pierre/trees";
import type { useFileTreeMutations } from "@/hooks/useFileTreeMutations";
import { fromPierrePath } from "@/components/file-tree/CadencrFileTree";
import { validateSimpleName } from "@/lib/validate-name";

export type DraftKind = "file" | "folder";

interface DraftState {
  pierrePath: string;
  kind: DraftKind;
  parentDir: string;
}

/**
 * Pierre stores paths as strings and uses the leaf name as the initial
 * value of the rename input. We give drafts a single-space leaf for two
 * reasons:
 *
 *  - `input.select()` (which pierre runs on focus) selects the whole
 *    leaf, so a single space looks effectively empty and any keystroke
 *    replaces it.
 *  - Pierre's controller treats `value.trim().length === 0` on commit as
 *    "remove the placeholder" — so pressing Enter on an unmodified draft
 *    just discards it instead of creating a literally-named file.
 *
 * Only one draft is alive at a time, so the constant leaf is safe.
 */
const DRAFT_LEAF = " ";

function makeDraftPath(parentDir: string, kind: DraftKind): string {
  const trailing = kind === "folder" ? "/" : "";
  return parentDir ? `${parentDir}/${DRAFT_LEAF}${trailing}` : `${DRAFT_LEAF}${trailing}`;
}

interface UseFileTreeDraftOptions {
  model: FileTreeModel;
  projectId: number;
  featureId: number;
  mutations: ReturnType<typeof useFileTreeMutations>;
  /** Called after the backend confirms a file create so the editor can open it. */
  onFileCreated: (fsPath: string) => void;
  /** Reset on feature change so a stale draft doesn't leak into a new feature. */
  featureKey: number;
}

interface UseFileTreeDraftResult {
  /** Begin an inline-create draft under `parentDir`. */
  startCreate: (kind: DraftKind, parentDir: string) => void;
  /** True if `pierrePath` is the active draft (so callers can skip it). */
  isDraftPath: (pierrePath: string | null) => boolean;
  /**
   * Try to handle a pierre `onRename` event as a draft-create commit.
   * Returns `true` if this was a create (caller should stop), `false` if
   * it's a regular rename (caller handles it).
   */
  tryHandleAsCreate: (event: FileTreeRenameEvent) => boolean;
}

/**
 * Owns the "draft" state for inline file/folder creation. Pierre doesn't
 * have a first-class "draft" API — the official pattern is
 * `model.add(placeholder) + model.startRenaming(placeholder, {removeIfCanceled: true})`.
 * This hook wraps that pattern so the main `FileTree` doesn't have to
 * juggle the ref + onMutation cleanup + create-vs-rename branching.
 *
 * Pierre lifecycle (handled here):
 *  - Escape / blur-with-empty-input → controller removes the placeholder
 *  - Enter with empty/whitespace → controller removes the placeholder
 *  - Enter with text → controller calls `onRename`; `tryHandleAsCreate`
 *    detects the draft path and routes to `createFile`/`createFolder`.
 */
export function useFileTreeDraft({
  model,
  projectId,
  featureId,
  mutations,
  onFileCreated,
  featureKey,
}: UseFileTreeDraftOptions): UseFileTreeDraftResult {
  const draftRef = useRef<DraftState | null>(null);

  // Clear `draftRef` whenever pierre removes the placeholder we added.
  // Pierre auto-removes drafts on Escape or empty-Enter — without this
  // listener, `draftRef` would keep pointing at a path that no longer
  // exists, and the next `startCreate` would try to remove it and throw.
  useEffect(() => {
    const unsubscribe = model.onMutation("remove", (event) => {
      if (draftRef.current && event.path === draftRef.current.pierrePath) {
        draftRef.current = null;
      }
    });
    return unsubscribe;
  }, [model]);

  // Drop any in-flight draft when the feature changes.
  useEffect(() => {
    draftRef.current = null;
  }, [featureKey]);

  const startCreate = useCallback(
    (kind: DraftKind, parentDir: string) => {
      // Cancel any prior draft so we never accumulate orphan
      // placeholders. Guard with `getItem` because pierre may have
      // already removed the draft itself (e.g. the user pressed
      // Escape) — calling `model.remove` on a missing path throws.
      const previous = draftRef.current;
      if (previous) {
        draftRef.current = null;
        if (model.getItem(previous.pierrePath) != null) {
          model.remove(
            previous.pierrePath,
            previous.kind === "folder" ? { recursive: true } : undefined,
          );
        }
      }
      const pierrePath = makeDraftPath(parentDir, kind);
      draftRef.current = { pierrePath, kind, parentDir };
      model.add(pierrePath);
      const started = model.startRenaming(pierrePath, { removeIfCanceled: true });
      if (!started) {
        draftRef.current = null;
        if (model.getItem(pierrePath) != null) {
          model.remove(pierrePath, kind === "folder" ? { recursive: true } : undefined);
        }
        toast.error("Could not start inline create");
      }
    },
    [model],
  );

  const isDraftPath = useCallback(
    (pierrePath: string | null) =>
      pierrePath != null && pierrePath === draftRef.current?.pierrePath,
    [],
  );

  const tryHandleAsCreate = useCallback(
    (event: FileTreeRenameEvent): boolean => {
      const draft = draftRef.current;
      if (draft == null || event.sourcePath !== draft.pierrePath) return false;

      const fsDest = fromPierrePath(event.destinationPath);
      const newName = fsDest.slice(fsDest.lastIndexOf("/") + 1);

      // Validate first; pierre has already locally moved the placeholder
      // to `pierreDest` at this point, so on bad input we clean it up.
      const validationError = validateSimpleName(newName);
      if (validationError) {
        toast.error(validationError);
        draftRef.current = null;
        if (model.getItem(event.destinationPath) != null) {
          model.remove(
            event.destinationPath,
            draft.kind === "folder" ? { recursive: true } : undefined,
          );
        }
        return true;
      }

      draftRef.current = null;
      const recursive = draft.kind === "folder";
      const onCreateError = () => {
        if (model.getItem(event.destinationPath) != null) {
          model.remove(event.destinationPath, recursive ? { recursive: true } : undefined);
        }
      };
      const childPath = draft.parentDir ? `${draft.parentDir}/${newName}` : newName;
      const requestBase = { project_id: projectId, feature_id: featureId } as const;
      if (draft.kind === "file") {
        mutations.createFile.mutate(
          { data: { ...requestBase, file_path: childPath } },
          {
            onSuccess: () => onFileCreated(childPath),
            onError: onCreateError,
          },
        );
      } else {
        mutations.createFolder.mutate(
          { data: { ...requestBase, dir_path: childPath } },
          { onError: onCreateError },
        );
      }
      return true;
    },
    [featureId, model, mutations.createFile, mutations.createFolder, onFileCreated, projectId],
  );

  return { startCreate, isDraftPath, tryHandleAsCreate };
}
