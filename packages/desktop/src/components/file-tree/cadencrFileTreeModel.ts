import type {
  FileTree as FileTreeModel,
  FileTreeDirectoryHandle,
  FileTreeOptions,
} from "@pierre/trees";
import type { FileTreeEntry } from "@/api/generated";

/** Convert a backend entry to Pierre's trailing-slash directory identity. */
export function toPierrePath(entry: Pick<FileTreeEntry, "path" | "is_dir">): string {
  return entry.is_dir ? `${entry.path}/` : entry.path;
}

/** Strip Pierre's trailing-slash directory marker, returning the FS path. */
export function fromPierrePath(pierrePath: string): string {
  return pierrePath.endsWith("/") ? pierrePath.slice(0, -1) : pierrePath;
}

/** Build Pierre paths plus the minimal set of ignored subtree roots. */
export function buildPierreInputs(
  entries: readonly Pick<FileTreeEntry, "path" | "is_dir" | "is_gitignored">[],
): { paths: readonly string[]; ignoredRoots: readonly string[] } {
  const paths: string[] = [];
  const ignoredDirSet = new Set<string>();
  for (const entry of entries) {
    paths.push(toPierrePath(entry));
    if (entry.is_gitignored && entry.is_dir) ignoredDirSet.add(entry.path);
  }
  const ignoredRoots: string[] = [];
  for (const entry of entries) {
    if (!entry.is_gitignored) continue;
    const index = entry.path.lastIndexOf("/");
    const parent = index === -1 ? "" : entry.path.slice(0, index);
    if (parent === "" || !ignoredDirSet.has(parent)) ignoredRoots.push(toPierrePath(entry));
  }
  return { paths, ignoredRoots };
}

type PierreGitStatus = "added" | "deleted" | "ignored" | "modified" | "renamed" | "untracked";

/** Map the editor tree's friendly change kinds onto Pierre Git statuses. */
export function gitStatusFromUncommittedFiles(
  files: readonly { path: string; change_kind: string }[] | undefined,
): FileTreeOptions["gitStatus"] {
  if (files == null || files.length === 0) return [];
  const entries: { path: string; status: PierreGitStatus }[] = [];
  for (const file of files) {
    const status = toPierreGitStatus(file.change_kind);
    if (status != null) entries.push({ path: file.path, status });
  }
  return entries;
}

function toPierreGitStatus(kind: string): PierreGitStatus | null {
  switch (kind) {
    case "added":
    case "deleted":
    case "modified":
    case "renamed":
    case "untracked":
      return kind;
    default:
      return null;
  }
}

/** Snapshot directory expansion overrides that still exist in the next path set. */
function collectDirectoryExpansionState(
  model: FileTreeModel,
  paths: readonly string[],
): { expandedPaths: string[]; collapsedPaths: string[] } {
  const expanded: string[] = [];
  const collapsed: string[] = [];
  for (const path of paths) {
    if (!path.endsWith("/")) continue;
    const item = model.getItem(path);
    if (item == null || !item.isDirectory()) continue;
    const directory = item as FileTreeDirectoryHandle;
    if (directory.isExpanded()) expanded.push(path);
    else collapsed.push(path);
  }
  return { expandedPaths: expanded, collapsedPaths: collapsed };
}

/**
 * Reset a Pierre model without losing surviving directory expansion or
 * collapse overrides. Pierre itself preserves selection, focus, and search
 * across `resetPaths`; callers may also expand every directory for the first
 * empty-to-populated load.
 */
export function resetFileTreePathsPreservingState(
  model: FileTreeModel,
  paths: readonly string[],
  options: { expandAllDirectories?: boolean } = {},
): void {
  const previous = collectDirectoryExpansionState(model, paths);
  const initialExpandedPaths = options.expandAllDirectories
    ? paths.filter((path) => path.endsWith("/"))
    : previous.expandedPaths;
  model.resetPaths(paths, { initialExpandedPaths });
  if (options.expandAllDirectories) return;
  for (const path of previous.collapsedPaths) {
    const item = model.getItem(path);
    if (item?.isDirectory()) (item as FileTreeDirectoryHandle).collapse();
  }
}
