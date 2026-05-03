import { memo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileSymbolIcon, FolderSymbolIcon } from "./file-icons";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import FileTreeItemMenu from "./FileTreeItemMenu";
import FileTreeInputPopover from "./FileTreeInputPopover";
import FileTreeConfirmPopover from "./FileTreeConfirmPopover";
import { useFileTreeEditStore } from "@/stores/file-tree-edit-store";
import { useFileTreeMutationsContext } from "@/hooks/useFileTreeMutations";
import type { FileTreeEntry } from "@/api/generated";

interface FileTreeItemProps {
  entry: FileTreeEntry;
  depth: number;
  isExpanded: boolean;
  isActive: boolean;
  projectId: number;
  featureId: number;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  /**
   * Called by the menu's "New File…" / "New Folder…" items so the parent
   * `FileTree` can auto-expand the folder before the create-popover opens.
   */
  onWillCreate?: (folderPath: string) => void;
}

function parentDirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function FileTreeItem({
  entry,
  depth,
  isExpanded,
  isActive,
  projectId,
  featureId,
  onToggle,
  onOpenFile,
  onWillCreate,
}: FileTreeItemProps) {
  // Narrow selectors: only the matching row re-renders when rename/delete
  // state changes anywhere in the tree.
  const isRenaming = useFileTreeEditStore((s) => s.editingPath === entry.path);
  const isConfirmingDelete = useFileTreeEditStore((s) => s.confirming?.path === entry.path);

  const { rename, trash, reveal } = useFileTreeMutationsContext();

  function handleClick() {
    if (entry.is_dir) {
      onToggle(entry.path);
    } else {
      onOpenFile(entry.path);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  function openCreate(kind: "file" | "folder") {
    const { startCreate } = useFileTreeEditStore.getState();
    if (entry.is_dir) {
      // Create inside this folder; auto-expand so the inline input shows.
      if (!isExpanded) onToggle(entry.path);
      onWillCreate?.(entry.path);
      startCreate({ parentDir: entry.path, kind });
    } else {
      // Create a sibling of this file in its parent dir.
      startCreate({ parentDir: parentDirOf(entry.path), kind });
    }
  }

  function handleRenameSubmit(newName: string) {
    rename.mutate(
      {
        data: {
          project_id: projectId,
          feature_id: featureId,
          old_path: entry.path,
          new_name: newName,
        },
      },
      { onSuccess: () => useFileTreeEditStore.getState().cancel() },
    );
  }

  function handleDeleteConfirm() {
    trash.mutate(
      {
        data: {
          project_id: projectId,
          feature_id: featureId,
          path: entry.path,
        },
      },
      { onSuccess: () => useFileTreeEditStore.getState().cancel() },
    );
  }

  const row = (
    <div
      role="treeitem"
      aria-expanded={entry.is_dir ? isExpanded : undefined}
      aria-selected={isActive}
      tabIndex={0}
      className={cn(
        "flex items-center gap-1 px-2 py-0.5 text-sm rounded cursor-pointer select-none",
        "hover:bg-accent transition-colors",
        isActive && "bg-accent text-accent-foreground font-medium",
        entry.is_gitignored && "opacity-50",
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {entry.is_dir ? (
        <span className="w-3 h-3 shrink-0 text-muted-foreground">
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      ) : (
        <span className="w-3 h-3 shrink-0" />
      )}
      {entry.is_dir ? (
        <FolderSymbolIcon folderName={entry.name} className="shrink-0 flex items-center" />
      ) : (
        <FileSymbolIcon fileName={entry.name} className="shrink-0 flex items-center" />
      )}
      <span className="truncate">{entry.name}</span>
    </div>
  );

  // Wrap row in the active popover (rename or confirm-delete). Only one is
  // active at a time; otherwise just the context menu wrapper.
  let wrapped = row;
  if (isRenaming) {
    wrapped = (
      <FileTreeInputPopover
        open
        onOpenChange={(o) => {
          if (!o) useFileTreeEditStore.getState().cancel();
        }}
        mode="rename"
        defaultValue={entry.name}
        pending={rename.isPending}
        onSubmit={handleRenameSubmit}
      >
        {row}
      </FileTreeInputPopover>
    );
  } else if (isConfirmingDelete) {
    const message = entry.is_dir
      ? `Move folder "${entry.name}" and all its contents to Trash?`
      : `Move "${entry.name}" to Trash?`;
    wrapped = (
      <FileTreeConfirmPopover
        open
        onOpenChange={(o) => {
          if (!o) useFileTreeEditStore.getState().cancel();
        }}
        message={message}
        confirmLabel="Move to Trash"
        pending={trash.isPending}
        onConfirm={handleDeleteConfirm}
      >
        {row}
      </FileTreeConfirmPopover>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{wrapped}</ContextMenuTrigger>
      <FileTreeItemMenu
        entry={entry}
        onOpen={() => onOpenFile(entry.path)}
        onReveal={() => void reveal(entry.path)}
        onRename={() => useFileTreeEditStore.getState().startRename(entry.path)}
        onDelete={() =>
          useFileTreeEditStore
            .getState()
            .startConfirmDelete({ path: entry.path, isDir: entry.is_dir })
        }
        onNewFile={() => openCreate("file")}
        onNewFolder={() => openCreate("folder")}
      />
    </ContextMenu>
  );
}

export default memo(FileTreeItem);
