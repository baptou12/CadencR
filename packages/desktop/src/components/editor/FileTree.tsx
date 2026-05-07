import { useState, useCallback, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useFileTree } from "@/api/generated";
import { useEditorState } from "@/hooks/useEditorState";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useFileTreeEditStore } from "@/stores/file-tree-edit-store";
import {
  FileTreeMutationsProvider,
  useFileTreeMutationsContext,
} from "@/hooks/useFileTreeMutations";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import FileTreeItem from "./FileTreeItem";
import FileTreeInlineCreate from "./FileTreeInlineCreate";
import type { FileTreeEntry } from "@/api/generated";

interface FileTreeProps {
  projectId: number;
  featureId: number;
}

interface TreeNodeProps {
  projectId: number;
  featureId: number;
  dirPath: string;
  depth: number;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onWillCreate: (folderPath: string) => void;
}

/**
 * Inline input row rendered at the top of any `TreeNode` whose `dirPath`
 * matches the active `creating.parentDir`. This unifies the create UX
 * across right-click contexts: in the empty root area, on a folder row,
 * and on a file row — the input always shows up as a new tree row at
 * `dirPath`'s level, never as a popover.
 */
function InlineCreateRow({ dirPath, depth }: { dirPath: string; depth: number }) {
  // Narrow selector: only this dirPath's row re-renders when `creating` flips
  // in or out of matching state. Returning the same `null` keeps the
  // subscription quiet for every non-matching node.
  //
  // The inline row is only used when no anchor row exists (the root context
  // menu); when `anchorPath` is set, `FileTreeItem` renders a popover at
  // that row instead.
  const creating = useFileTreeEditStore((s) =>
    s.creating?.parentDir === dirPath && s.creating.anchorPath === undefined ? s.creating : null,
  );
  const { createFile, createFolder, submitCreate } = useFileTreeMutationsContext();

  if (!creating) return null;

  function handleSubmit(name: string) {
    if (!creating) return;
    submitCreate(creating.kind, creating.parentDir, name, () =>
      useFileTreeEditStore.getState().cancel(),
    );
  }

  return (
    <FileTreeInlineCreate
      kind={creating.kind}
      depth={depth}
      pending={createFile.isPending || createFolder.isPending}
      onSubmit={handleSubmit}
      onCancel={() => useFileTreeEditStore.getState().cancel()}
    />
  );
}

function TreeNode({
  projectId,
  featureId,
  dirPath,
  depth,
  activeFilePath,
  expandedDirs,
  onToggle,
  onOpenFile,
  onWillCreate,
}: TreeNodeProps) {
  const {
    data: entries,
    isLoading,
    isError,
  } = useFileTree(
    { project_id: projectId, feature_id: featureId, dir_path: dirPath },
    { query: { enabled: true } },
  );

  // Render the inline create row even during loading/error states so the
  // user can keep typing while the tree refetches.
  const inlineCreate = <InlineCreateRow dirPath={dirPath} depth={depth} />;

  if (isLoading) {
    return (
      <>
        {inlineCreate}
        <div
          className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Loading…</span>
        </div>
      </>
    );
  }

  if (isError || !entries) {
    return (
      <>
        {inlineCreate}
        <div
          className="px-4 py-0.5 text-xs text-destructive"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          Failed to load
        </div>
      </>
    );
  }

  return (
    <>
      {inlineCreate}
      {entries.map((entry) => (
        <EntryRow
          key={entry.path}
          entry={entry}
          depth={depth}
          projectId={projectId}
          featureId={featureId}
          activeFilePath={activeFilePath}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onWillCreate={onWillCreate}
        />
      ))}
    </>
  );
}

interface EntryRowProps {
  entry: FileTreeEntry;
  depth: number;
  projectId: number;
  featureId: number;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onWillCreate: (folderPath: string) => void;
}

function EntryRow({
  entry,
  depth,
  projectId,
  featureId,
  activeFilePath,
  expandedDirs,
  onToggle,
  onOpenFile,
  onWillCreate,
}: EntryRowProps) {
  const isExpanded = expandedDirs.has(entry.path);
  const isActive = activeFilePath === entry.path;

  return (
    <>
      <FileTreeItem
        entry={entry}
        depth={depth}
        isExpanded={isExpanded}
        isActive={isActive}
        projectId={projectId}
        featureId={featureId}
        onToggle={onToggle}
        onOpenFile={onOpenFile}
        onWillCreate={onWillCreate}
      />
      {entry.is_dir && isExpanded && (
        <TreeNode
          projectId={projectId}
          featureId={featureId}
          dirPath={entry.path}
          depth={depth + 1}
          activeFilePath={activeFilePath}
          expandedDirs={expandedDirs}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          onWillCreate={onWillCreate}
        />
      )}
    </>
  );
}

export default function FileTree({ projectId, featureId }: FileTreeProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const { activePaneId, panes, openFile } = useEditorState(featureId);
  const activeFilePath = panes[activePaneId]?.activeFilePath ?? null;
  const { value: maxTabsSetting } = useDebouncedSetting("editor_max_tabs");
  const maxTabs = useMemo(() => parseInt(maxTabsSetting ?? "10", 10), [maxTabsSetting]);

  function startRootCreate(kind: "file" | "folder") {
    useFileTreeEditStore.getState().startCreate({ parentDir: "", kind });
  }

  // Cancel any in-flight edit popover when the feature changes — stale state
  // from another feature would point at a path that no longer exists.
  useEffect(() => {
    useFileTreeEditStore.getState().cancel();
  }, [featureId]);

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

  const handleWillCreate = useCallback((folderPath: string) => {
    setExpandedDirs((prev) => {
      if (prev.has(folderPath)) return prev;
      const next = new Set(prev);
      next.add(folderPath);
      return next;
    });
  }, []);

  return (
    <FileTreeMutationsProvider projectId={projectId} featureId={featureId}>
      <div className="flex flex-col h-full">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="flex-1 overflow-y-auto py-1" role="tree" aria-label="File tree">
              <TreeNode
                projectId={projectId}
                featureId={featureId}
                dirPath=""
                depth={0}
                activeFilePath={activeFilePath}
                expandedDirs={expandedDirs}
                onToggle={handleToggle}
                onOpenFile={handleOpenFile}
                onWillCreate={handleWillCreate}
              />
              {/* Spacer that fills the rest of the tree area so right-click on
                  the empty space below entries still hits the root trigger. */}
              <div className="min-h-[200px]" aria-hidden />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent
            // The selected item opens an inline-input row whose `onBlur`
            // cancels editing. Radix's default focus restoration would
            // immediately steal focus from that input back to the trigger
            // (the tree div), firing the cancel. Skip focus restoration —
            // the inline row focuses its own input.
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <ContextMenuItem onSelect={() => startRootCreate("file")}>New File…</ContextMenuItem>
            <ContextMenuItem onSelect={() => startRootCreate("folder")}>
              New Folder…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </FileTreeMutationsProvider>
  );
}
