import { useState, useCallback } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { useFileTree } from "@/api/generated";
import { useEditorState } from "@/hooks/useEditorState";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import FileTreeItem from "./FileTreeItem";
import type { FileTreeEntry } from "@/api/generated";

interface FileTreeProps {
  projectPath: string;
  featureId: number;
}

interface TreeNodeProps {
  projectPath: string;
  dirPath: string;
  depth: number;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  refreshKey: number;
}

function TreeNode({
  projectPath,
  dirPath,
  depth,
  activeFilePath,
  expandedDirs,
  onToggle,
  onOpenFile,
  refreshKey: _refreshKey,
}: TreeNodeProps) {
  const { data: entries, isLoading, isError } = useFileTree(
    { projectPath, dirPath },
    { enabled: true },
  );

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  if (isError || !entries) {
    return (
      <div className="px-4 py-0.5 text-xs text-destructive" style={{ paddingLeft: `${8 + depth * 12}px` }}>
        Failed to load
      </div>
    );
  }

  return (
    <>
      {entries.map((entry) => (
        <EntryRow
          key={entry.path}
          entry={entry}
          depth={depth}
          projectPath={projectPath}
          activeFilePath={activeFilePath}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          refreshKey={_refreshKey}
        />
      ))}
    </>
  );
}

interface EntryRowProps {
  entry: FileTreeEntry;
  depth: number;
  projectPath: string;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  refreshKey: number;
}

function EntryRow({ entry, depth, projectPath, activeFilePath, expandedDirs, onToggle, onOpenFile, refreshKey }: EntryRowProps) {
  const isExpanded = expandedDirs.has(entry.path);
  const isActive = activeFilePath === entry.path;

  return (
    <>
      <FileTreeItem
        entry={entry}
        depth={depth}
        isExpanded={isExpanded}
        isActive={isActive}
        onToggle={onToggle}
        onOpenFile={onOpenFile}
      />
      {entry.is_dir && isExpanded && (
        <TreeNode
          projectPath={projectPath}
          dirPath={entry.path}
          depth={depth + 1}
          activeFilePath={activeFilePath}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          refreshKey={refreshKey}
        />
      )}
    </>
  );
}

export default function FileTree({ projectPath, featureId }: FileTreeProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const { activePaneId, panes, openFile } = useEditorState(featureId);
  const activeFilePath = panes[activePaneId]?.activeFilePath ?? null;
  const { value: maxTabsSetting } = useDebouncedSetting("editor_max_tabs");
  const maxTabs = parseInt(maxTabsSetting ?? "10", 10);

  const { isFetching, refetch } = useFileTree(
    { projectPath, dirPath: "" },
    { enabled: true },
  );

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void refetch();
  }, [refetch]);

  const handleToggle = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleOpenFile = useCallback(
    (filePath: string) => {
      openFile(activePaneId, filePath, maxTabs);
    },
    [openFile, activePaneId, maxTabs],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end px-2 py-0.5 border-b border-border shrink-0">
        <button
          type="button"
          title="Refresh file tree"
          aria-label="Refresh file tree"
          className="rounded p-0.5 hover:bg-accent transition-colors text-muted-foreground"
          onClick={handleRefresh}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1" role="tree" aria-label="File tree">
        <TreeNode
          projectPath={projectPath}
          dirPath=""
          depth={0}
          activeFilePath={activeFilePath}
          expandedDirs={expandedDirs}
          onToggle={handleToggle}
          onOpenFile={handleOpenFile}
          refreshKey={refreshKey}
        />
      </div>
    </div>
  );
}
