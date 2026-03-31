import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFileIcon } from "./file-icons";
import type { FileTreeEntry } from "@/api/generated";

interface FileTreeItemProps {
  entry: FileTreeEntry;
  depth: number;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}

export default function FileTreeItem({
  entry,
  depth,
  isExpanded,
  isActive,
  onToggle,
  onOpenFile,
}: FileTreeItemProps) {
  const Icon = entry.is_dir
    ? isExpanded
      ? FolderOpen
      : Folder
    : getFileIcon(entry.name);

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

  return (
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
      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{entry.name}</span>
    </div>
  );
}
