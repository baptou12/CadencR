import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, ChevronDown, ChevronRight, Plus, Minus, GitCommit, Circle } from "lucide-react";
import { CopyButton } from "./CopyButton";

function AutoScrollText({ text, className }: { text: string; className?: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const textEl = textRef.current;
    if (!wrapper || !textEl) return;
    const overflow = textEl.scrollWidth - wrapper.clientWidth;
    if (overflow > 0) {
      textEl.style.setProperty("--scroll-distance", `-${overflow}px`);
      setOverflows(true);
    } else {
      textEl.style.removeProperty("--scroll-distance");
      setOverflows(false);
    }
  }, [text]);

  return (
    <div ref={wrapperRef} className={`auto-scroll-wrapper min-w-0 flex-1 overflow-hidden ${className ?? ""}`}>
      <span ref={textRef} className="auto-scroll-text" data-overflows={overflows}>{text}</span>
    </div>
  );
}

function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

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

export interface CommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  body: string;
  author: string;
  date: string;
  isPushed: boolean;
}

interface DiffFileTreeProps {
  files: ChangedFileEntry[];
  expandedFiles: Set<string>;
  selectedFile: string | null;
  viewedFiles?: Set<string>;
  onToggleExpand: (filePath: string) => void;
  onSelectFile: (filePath: string) => void;
  commits?: CommitEntry[];
  selectedCommit: string | null;
  onSelectCommit: (sha: string | null) => void;
  isOnBaseBranch?: boolean;
  onLoadMoreCommits?: () => void;
}

export function DiffFileTree({
  files,
  expandedFiles,
  selectedFile,
  viewedFiles,
  onToggleExpand,
  onSelectFile,
  commits = [],
  selectedCommit,
  onSelectCommit,
  isOnBaseBranch = true,
  onLoadMoreCommits,
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

        {/* Copy path button */}
        <CopyButton text={fileEntry.file} />

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

      {/* File tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {tree.map((node) => renderNode(node, 0))}
        {files.length === 0 && (
          <p className="px-3 py-2 text-xs text-[#6272a4]">No changed files</p>
        )}
      </div>

      {/* Commit list */}
      {commits.length > 0 && (
        <div className="flex h-1/3 shrink-0 flex-col border-t border-[#6272a4]">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6272a4]">
            <GitCommit className="h-3 w-3" />
            <span>Commits ({commits.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Working Changes entry (only on feature branches) */}
            {!isOnBaseBranch && (
              <button
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-[#44475a] ${
                  selectedCommit === null ? "bg-[#44475a] text-[#f8f8f2]" : "text-[#6272a4]"
                }`}
                onClick={() => onSelectCommit(null)}
              >
                <Circle className="h-2.5 w-2.5 shrink-0 fill-[#f1fa8c] text-[#f1fa8c]" />
                <span className="truncate">Working Changes</span>
              </button>
            )}
            {/* Commits — feature branch: newest first; base branch: already newest-first from git log */}
            {(isOnBaseBranch ? commits : commits.toReversed()).map((commit) => {
              const relDate = formatRelativeDate(commit.date);
              return (
                <button
                  key={commit.sha}
                  className={`flex w-full items-start gap-1.5 px-3 py-0.5 text-left text-xs hover:bg-[#44475a] ${
                    selectedCommit === commit.sha ? "bg-[#44475a]" : ""
                  }`}
                  onClick={() => onSelectCommit(selectedCommit === commit.sha ? null : commit.sha)}
                  title={`${commit.shortSha} ${commit.message}\n${commit.author} - ${commit.date}`}
                >
                  <Circle
                    className={`mt-0.5 h-2.5 w-2.5 shrink-0 ${
                      commit.isPushed
                        ? "fill-[#50fa7b] text-[#50fa7b]"
                        : "fill-[#ffb86c] text-[#ffb86c]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 font-mono text-[#bd93f9]">{commit.shortSha}</span>
                      <AutoScrollText text={commit.message} className="text-[#f8f8f2]" />
                    </div>
                    <div className="text-[10px] leading-tight text-[#6272a4]">
                      {commit.author} · {relDate}
                    </div>
                  </div>
                </button>
              );
            })}
            {/* Load more button (only on base branch where we paginate) */}
            {isOnBaseBranch && onLoadMoreCommits && (
              <button
                className="flex w-full items-center justify-center py-1.5 text-xs text-[#bd93f9] hover:bg-[#44475a]"
                onClick={onLoadMoreCommits}
              >
                Load more...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
