import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { FileTree as FileTreeModel, FileTreeDirectoryHandle } from "@pierre/trees";
import { getFileTreeQueryOptions, type FileTreeEntry, type FileTreeParams } from "@/api/generated";
import { toPierrePath } from "@/components/file-tree/CadencrFileTree";

interface UseLazyIgnoredFileTreeEntriesOptions {
  model: FileTreeModel;
  projectId: number;
  featureId: number;
  trackedEntries: readonly FileTreeEntry[] | undefined;
  onEntriesChange: (entries: readonly FileTreeEntry[]) => void;
}

interface DirectoryQueryResult {
  dirPath: string;
  entries: readonly FileTreeEntry[] | undefined;
}

const ROOT_DIR = ".";

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Gitignored directory paths whose contents should load lazily on expand.
 * Unions the fast `tracked` query with the lazily-fetched entries: a
 * tracked-but-ignored directory (issue #41) is surfaced by the backend in
 * the tracked query, so it never lands in `lazyEntries` — yet expanding it
 * must still pull in its untracked ignored children.
 */
export function knownIgnoredDirectoryPaths(
  trackedEntries: readonly FileTreeEntry[] | undefined,
  lazyEntries: readonly FileTreeEntry[],
): readonly string[] {
  const paths = new Set<string>();
  for (const entry of trackedEntries ?? []) {
    if (entry.is_dir && entry.is_gitignored) paths.add(entry.path);
  }
  for (const entry of lazyEntries) {
    if (entry.is_dir && entry.is_gitignored) paths.add(entry.path);
  }
  return [...paths];
}

function entriesSignature(entries: readonly FileTreeEntry[]): string {
  return entries
    .map(
      (entry) => `${entry.path}\t${entry.is_dir ? "d" : "f"}\t${entry.is_gitignored ? "i" : "-"}`,
    )
    .join("\n");
}

export function mergeFileTreeEntries(
  trackedEntries: readonly FileTreeEntry[] | undefined,
  lazyIgnoredEntries: readonly FileTreeEntry[],
): readonly FileTreeEntry[] | undefined {
  if (trackedEntries == null) return lazyIgnoredEntries.length > 0 ? lazyIgnoredEntries : undefined;
  if (lazyIgnoredEntries.length === 0) return trackedEntries;

  const seen = new Set<string>();
  const merged: FileTreeEntry[] = [];
  for (const entry of trackedEntries) {
    seen.add(entry.path);
    merged.push(entry);
  }
  for (const entry of lazyIgnoredEntries) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    merged.push(entry);
  }
  return merged;
}

export function collectLazyIgnoredEntries(
  queryResults: readonly DirectoryQueryResult[],
  trackedEntries: readonly FileTreeEntry[] | undefined,
): readonly FileTreeEntry[] {
  const trackedPaths = new Set((trackedEntries ?? []).map((entry) => entry.path));
  const seen = new Set<string>();
  const entries: FileTreeEntry[] = [];

  for (const result of queryResults) {
    for (const entry of result.entries ?? []) {
      if (trackedPaths.has(entry.path) || seen.has(entry.path)) continue;
      if (result.dirPath === ROOT_DIR && !entry.is_gitignored) continue;
      seen.add(entry.path);
      entries.push(result.dirPath === ROOT_DIR ? entry : { ...entry, is_gitignored: true });
    }
  }
  return entries;
}

function readExpandedIgnoredDirectories(
  model: FileTreeModel,
  ignoredDirectoryPaths: readonly string[],
): readonly string[] {
  const expanded: string[] = [];
  for (const path of ignoredDirectoryPaths) {
    const item = model.getItem(toPierrePath({ path, is_dir: true }));
    if (item == null || !item.isDirectory()) continue;
    if ((item as FileTreeDirectoryHandle).isExpanded()) expanded.push(path);
  }
  return expanded;
}

export function useLazyIgnoredFileTreeEntries({
  model,
  projectId,
  featureId,
  trackedEntries,
  onEntriesChange,
}: UseLazyIgnoredFileTreeEntriesOptions): void {
  const [expandedIgnoredDirs, setExpandedIgnoredDirs] = useState<readonly string[]>([]);
  const ignoredDirsRef = useRef<readonly string[]>([]);
  const entriesSignatureRef = useRef("");
  const queryDirs = useMemo(() => [ROOT_DIR, ...expandedIgnoredDirs], [expandedIgnoredDirs]);

  const queries = useQueries({
    queries: queryDirs.map((dirPath) => {
      const params: FileTreeParams = {
        project_id: projectId,
        feature_id: featureId,
        dir_path: dirPath,
      };
      return getFileTreeQueryOptions(params, { query: { staleTime: 30_000 } });
    }),
  });

  const queryDataVersion = queries
    .map((query, index) => `${queryDirs[index] ?? ROOT_DIR}:${query.dataUpdatedAt}`)
    .join(",");
  const lazyEntries = useMemo(() => {
    const queryResults: DirectoryQueryResult[] = queries.map((query, index) => ({
      dirPath: queryDirs[index] ?? ROOT_DIR,
      entries: query.data,
    }));
    return collectLazyIgnoredEntries(queryResults, trackedEntries);
  }, [featureId, projectId, queryDataVersion, trackedEntries]);

  const ignoredDirs = useMemo(
    () => knownIgnoredDirectoryPaths(trackedEntries, lazyEntries),
    [trackedEntries, lazyEntries],
  );
  const syncExpanded = useCallback((): void => {
    const next = readExpandedIgnoredDirectories(model, ignoredDirsRef.current);
    setExpandedIgnoredDirs((current) => (sameStringArray(current, next) ? current : next));
  }, [model]);

  useEffect(() => {
    ignoredDirsRef.current = ignoredDirs;
    syncExpanded();
  }, [ignoredDirs, syncExpanded]);

  useEffect(() => {
    syncExpanded();
    return model.subscribe(syncExpanded);
  }, [model, syncExpanded]);

  useEffect(() => {
    const signature = entriesSignature(lazyEntries);
    if (entriesSignatureRef.current === signature) return;
    entriesSignatureRef.current = signature;
    onEntriesChange(lazyEntries);
  }, [lazyEntries, onEntriesChange]);
}
