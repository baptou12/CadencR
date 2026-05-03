/**
 * Per-feature ephemeral state for the file-tree edit popovers (rename,
 * create file, create folder, delete confirmation).
 *
 * The popovers are anchored on individual `FileTreeItem` rows but the
 * orchestration lives at the `FileTree` level. Hoisting the state into a
 * tiny Zustand store keeps `FileTreeItem` stateless and avoids prop-
 * drilling through `TreeNode` / `EntryRow`.
 *
 * Consumers MUST select via narrow selectors (per `frontend-performance.md`):
 *
 *   const editingPath = useFileTreeEditStore((s) => s.editingPath);
 *   const startRename = useFileTreeEditStore((s) => s.startRename);
 *
 * Never call `useFileTreeEditStore()` without a selector.
 */
import { create } from "zustand";

export interface CreatingState {
  /**
   * Directory the new entry will be created in (server-side `dir_path`).
   * The inline input is rendered inside the `TreeNode` whose `dirPath`
   * matches this value — root uses `""`.
   */
  parentDir: string;
  kind: "file" | "folder";
}

export interface ConfirmingState {
  path: string;
  isDir: boolean;
}

interface FileTreeEditState {
  editingPath: string | null;
  creating: CreatingState | null;
  confirming: ConfirmingState | null;
  startRename: (path: string) => void;
  startCreate: (state: CreatingState) => void;
  startConfirmDelete: (state: ConfirmingState) => void;
  cancel: () => void;
}

export const useFileTreeEditStore = create<FileTreeEditState>((set) => ({
  editingPath: null,
  creating: null,
  confirming: null,
  startRename: (path) => set({ editingPath: path, creating: null, confirming: null }),
  startCreate: (state) => set({ creating: state, editingPath: null, confirming: null }),
  startConfirmDelete: (state) => set({ confirming: state, editingPath: null, creating: null }),
  cancel: () => set({ editingPath: null, creating: null, confirming: null }),
}));
