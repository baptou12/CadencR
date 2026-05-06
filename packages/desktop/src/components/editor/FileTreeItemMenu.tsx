import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import type { FileTreeEntry } from "@/api/generated";

interface FileTreeItemMenuProps {
  entry: FileTreeEntry;
  onOpen: () => void;
  onReveal: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}

/**
 * Context menu items for a file or folder row in the editor's file tree.
 *
 * Both files and folders expose New File / New Folder. For folders the
 * new entry is created inside the folder; for files it's created in the
 * file's parent directory (sibling).
 */
export default function FileTreeItemMenu({
  entry,
  onOpen,
  onReveal,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}: FileTreeItemMenuProps) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={onNewFile}>New File…</ContextMenuItem>
      <ContextMenuItem onSelect={onNewFolder}>New Folder…</ContextMenuItem>
      <ContextMenuSeparator />
      {!entry.is_dir && (
        <>
          <ContextMenuItem onSelect={onOpen}>Open</ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onSelect={onReveal}>Reveal in File Manager</ContextMenuItem>
      <ContextMenuItem onSelect={onRename}>
        Rename
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={onDelete}>
        Move to Trash
        <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
