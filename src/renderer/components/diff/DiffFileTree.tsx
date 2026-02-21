import { useState, useMemo, useCallback } from "react";
import { Search, ChevronDown, ChevronRight, Plus, Minus } from "lucide-react";

export interface ChangedFileEntry {
  file: string;
  status: string;
  oldFile?: string;
  additions: number;
  deletions: number;
}

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
      return "text-[#50fa7b]"; // added = green
    case "M":
      return "text-[#f1fa8c]"; // modified = yellow
    case "D":
      return "text-[#ff5555]"; // deleted = red
    case "R":
      return "text-[#8be9fd]"; // renamed = blue
    default:
      return "text-[#f8f8f2]";
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
}

export function DiffFileTree({
  files,
  expandedFiles,
  selectedFile,
  viewedFiles,
  onToggleExpand,
  onSelectFile,
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
            className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs text-[#f8f8f2] hover:bg-[#44475a]"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => toggleDir(node.path)}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3 shrink-0 text-[#6272a4]" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0 text-[#6272a4]" />
            )}
            <span className="truncate font-mono text-[#bd93f9]">{node.name}</span>
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
        className={`group flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-[#44475a] ${
          isSelected ? "bg-[#44475a]" : ""
        } ${isViewed ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/collapse button for this file's diff */}
        <button
          className="shrink-0 rounded px-0.5 text-[#6272a4] hover:text-[#f8f8f2]"
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

        {/* File name - clickable to scroll */}
        <button
          className={`min-w-0 flex-1 truncate text-left font-mono hover:text-[#bd93f9] ${isViewed ? "text-[#6272a4]" : "text-[#f8f8f2]"}`}
          onClick={() => onSelectFile(fileEntry.file)}
          title={fileEntry.file}
        >
          {node.name}
        </button>

        {/* Viewed indicator */}
        {isViewed && (
          <span className="shrink-0 text-[#50fa7b]" title="Viewed">✓</span>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#21222c]">
      {/* Search filter */}
      <div className="relative border-b border-[#6272a4] px-2 py-1.5">
        <Search className="absolute left-3.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#6272a4]" />
        <input
          type="text"
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded bg-[#282a36] py-1 pl-6 pr-2 text-xs text-[#f8f8f2] placeholder-[#6272a4] outline-none focus:ring-1 focus:ring-[#bd93f9]"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.map((node) => renderNode(node, 0))}
        {files.length === 0 && (
          <p className="px-3 py-2 text-xs text-[#6272a4]">No changed files</p>
        )}
      </div>
    </div>
  );
}
