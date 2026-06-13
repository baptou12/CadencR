import { useState, useMemo, useCallback } from "react";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  PanelLeft,
  BookmarkCheck,
} from "lucide-react";
import { CopyButton } from "./CopyButton";

export type { ChangedFileEntry } from "./DiffFileTreeHelpers";
import type { ChangedFileEntry } from "./DiffFileTreeHelpers";

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  file?: ChangedFileEntry;
}

function sortNodes(nodes: TreeNode[]) {
  nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const n of nodes) {
    if (n.isDirectory) sortNodes(n.children);
  }
}

function buildTree(files: ChangedFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const f of files) {
    const parts = f.file.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      const isLast = i === parts.length - 1;

      let existing = current.find((n) => n.name === name && n.isDirectory === !isLast);
      if (!existing) {
        existing = {
          name,
          path,
          isDirectory: !isLast,
          children: [],
          file: isLast ? f : undefined,
        };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  sortNodes(root);
  return root;
}

function statusColor(status: string): string {
  switch (status.charAt(0).toUpperCase()) {
    case "A":
      return "text-[var(--numstat-add-fg)]"; // added = green
    case "M":
      return "text-[var(--acc-yellow)]"; // modified = yellow
    case "D":
      return "text-[var(--numstat-del-fg)]"; // deleted = red
    case "R":
      return "text-[var(--acc-cyan)]"; // renamed = blue
    default:
      return "text-foreground";
  }
}

function statusIcon(status: string): string {
  switch (status.charAt(0).toUpperCase()) {
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
      return "R";
    default:
      return "?";
  }
}

function matchesFilter(node: TreeNode, filter: string): boolean {
  if (!filter) return true;
  const lf = filter.toLowerCase();
  if (!node.isDirectory) {
    return node.path.toLowerCase().includes(lf);
  }
  return node.children.some((c) => matchesFilter(c, lf));
}

interface DiffFileTreeProps {
  files: ChangedFileEntry[];
  expandedFiles: Set<string>;
  selectedFile: string | null;
  viewedFiles?: Set<string>;
  onToggleExpand: (filePath: string) => void;
  onSelectFile: (filePath: string) => void;
  onCollapse?: () => void;
}

export function DiffFileTree({
  files,
  expandedFiles,
  selectedFile,
  viewedFiles,
  onToggleExpand,
  onSelectFile,
  onCollapse,
}: DiffFileTreeProps) {
  const [filter, setFilter] = useState("");
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(files), [files]);

  const toggleDir = useCallback((dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (!matchesFilter(node, filter)) return null;

    if (node.isDirectory) {
      const isCollapsed = collapsedDirs.has(node.path);
      return (
        <div key={node.path}>
          <button
            className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs text-foreground hover:bg-accent"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => toggleDir(node.path)}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-mono text-primary">{node.name}</span>
          </button>
          {!isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    // File node
    const fileEntry = node.file!;
    const isSelected = selectedFile === fileEntry.file;
    const isExpanded = expandedFiles.has(fileEntry.file);
    const isViewed = viewedFiles?.has(fileEntry.file) ?? false;

    return (
      <div
        key={node.path}
        className={`group flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-accent ${
          isSelected ? "bg-accent" : ""
        } ${isViewed ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/collapse button for this file's diff */}
        <button
          className="shrink-0 rounded px-0.5 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(fileEntry.file);
          }}
          title={isExpanded ? "Collapse diff" : "Expand diff"}
        >
          {isExpanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        </button>

        {/* Status icon */}
        <span className={`shrink-0 font-mono font-bold ${statusColor(fileEntry.status)}`}>
          {statusIcon(fileEntry.status)}
        </span>

        {/* Staged badge — visual only, no stage/unstage controls in scope.
            Only renders when the backend reports `is_staged`; today the
            /api/git/changed-files endpoint doesn't emit it (TODO in
            DiffFileTreeHelpers.tsx), so this stays inert until then. */}
        {fileEntry.is_staged && (
          <BookmarkCheck
            className="h-3 w-3 shrink-0 text-[var(--numstat-add-fg)]"
            aria-label="Staged"
            data-testid="staged-badge"
          />
        )}

        {/* File name - clickable to scroll */}
        <button
          className={`min-w-0 flex-1 truncate text-left font-mono hover:text-primary ${isViewed ? "text-muted-foreground" : "text-foreground"}`}
          onClick={() => onSelectFile(fileEntry.file)}
          title={fileEntry.file}
        >
          {node.name}
        </button>

        {/* Copy path button */}
        <CopyButton text={fileEntry.file} />

        {/* Viewed indicator */}
        {isViewed && (
          <span className="shrink-0 text-[var(--numstat-add-fg)]" title="Viewed">
            ✓
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Search filter */}
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-transparent py-1 pl-6 pr-2 text-xs text-foreground placeholder-[#6272a4] outline-none"
          />
        </div>
        {onCollapse && (
          <button
            type="button"
            title="Collapse file list"
            aria-label="Collapse Git file list"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onCollapse}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* File tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {tree.map((node) => renderNode(node, 0))}
        {files.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">No changed files</p>
        )}
      </div>
    </div>
  );
}
