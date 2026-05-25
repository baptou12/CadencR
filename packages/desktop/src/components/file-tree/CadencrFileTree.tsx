import { startTransition, useEffect, useMemo, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  FileTree as PierreFileTree,
  useFileTree as usePierreFileTree,
  type FileTreeProps as PierreFileTreeProps,
} from "@pierre/trees/react";
import type {
  FileTree as FileTreeModel,
  FileTreeDirectoryHandle,
  FileTreeDragAndDropConfig,
  FileTreeOptions,
  FileTreeRenamingConfig,
  FileTreeSearchMode,
} from "@pierre/trees";
import { useFileTreeIconSet, type FileTreeIconSet } from "@/hooks/useFileTreeIconSet";
import { useFileTreeShadowStylesheet } from "@/components/file-tree/useFileTreeShadowStylesheet";
import type { FileTreeEntry } from "@/api/generated";
import { cn } from "@/lib/utils";

/**
 * Pierre encodes path identity with a trailing slash for directories and no
 * slash for files. Convert one of our backend entries to that form.
 *
 * Exported so consumers building their own paths array stay in sync.
 */
export function toPierrePath(entry: Pick<FileTreeEntry, "path" | "is_dir">): string {
  return entry.is_dir ? `${entry.path}/` : entry.path;
}

/** Strip pierre's trailing-slash directory marker, returning the FS-form path. */
export function fromPierrePath(pierrePath: string): string {
  return pierrePath.endsWith("/") ? pierrePath.slice(0, -1) : pierrePath;
}

/**
 * Collapse a list of entries to (a) pierre-form paths for the model and
 * (b) the minimal set of gitignored "roots" — entries whose immediate
 * parent isn't itself gitignored. Fuses three iterations into one so we
 * don't walk a 50k-entry tree multiple times per refetch.
 *
 * Returned `ignoredRoots` use pierre form (trailing slash for dirs).
 */
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
    const idx = entry.path.lastIndexOf("/");
    const parent = idx === -1 ? "" : entry.path.slice(0, idx);
    if (parent === "" || !ignoredDirSet.has(parent)) ignoredRoots.push(toPierrePath(entry));
  }
  return { paths, ignoredRoots };
}

/**
 * Build pierre's `GitStatusEntry[]` from the backend's uncommitted-files
 * response. Pierre's `change_kind` enum is a 1:1 match for our porcelain-v2
 * tokens after a narrowing guard.
 *
 * IMPORTANT: never feed `is_gitignored` entries as `status: "ignored"` —
 * pierre walks each entry's ancestors into a `directoriesWithChanges` set
 * that drives the "folder has changes" dot, even for ignored entries, so
 * doing so dots every folder above `node_modules/`. Gitignored dimming is
 * routed through `ignoredPathPrefixes` instead (shadow-root CSS).
 */
export function gitStatusFromUncommittedFiles(
  files: readonly { path: string; change_kind: string }[] | undefined,
): FileTreeOptions["gitStatus"] {
  if (files == null || files.length === 0) return [];
  const entries: { path: string; status: PierreGitStatus }[] = [];
  for (const file of files) {
    const status = toPierreGitStatus(file.change_kind);
    if (status == null) continue;
    entries.push({ path: file.path, status });
  }
  return entries;
}

type PierreGitStatus = "added" | "deleted" | "ignored" | "modified" | "renamed" | "untracked";

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

/**
 * Paths of every currently-expanded directory, used to seed `resetPaths`'s
 * `initialExpandedPaths` so a refetch never collapses the user's open
 * folders. Directories that no longer exist after the reset (e.g. a renamed
 * folder) are silently dropped.
 */
function collectExpandedDirectoryPaths(model: FileTreeModel, paths: readonly string[]): string[] {
  const expanded: string[] = [];
  for (const path of paths) {
    if (!path.endsWith("/")) continue;
    const item = model.getItem(path);
    if (item == null || !item.isDirectory()) continue;
    // `isDirectory(): true` is a literal-typed method, not a TS
    // predicate, so narrow explicitly to access `isExpanded`.
    const dir = item as FileTreeDirectoryHandle;
    if (dir.isExpanded()) expanded.push(path);
  }
  return expanded;
}

export interface CadencrFileTreeHookOptions {
  /**
   * Flat list of paths to render. Must be stable (memoize at the caller) —
   * the model is created once and `resetPaths` is called when this changes.
   */
  paths: readonly string[];
  gitStatus?: FileTreeOptions["gitStatus"];
  renaming?: FileTreeRenamingConfig | false;
  dragAndDrop?: FileTreeDragAndDropConfig | false;
  search?: boolean;
  fileTreeSearchMode?: FileTreeSearchMode;
  initialSelectedPaths?: readonly string[];
  iconSet?: FileTreeIconSet;
  /**
   * Pierre-form paths (trailing slash for dirs, no slash for files) that
   * should be rendered dimmed, along with all of their descendants. Used
   * for `.gitignore`d sub-trees. Pass only the topmost ignored path in
   * each sub-tree — descendants are matched via a prefix selector, so
   * passing every entry would just bloat the stylesheet.
   *
   * Implemented by injecting a `<style>` element into pierre's shadow
   * root rather than via pierre's `gitStatus`/`ignored` channel, because
   * that channel unconditionally adds every entry's ancestors to the
   * "contains changes" set (see `gitStatusFromUncommittedFiles` notes).
   */
  ignoredPathPrefixes?: readonly string[];
}

export interface CadencrFileTreeHookResult {
  model: FileTreeModel;
}

/**
 * Reusable wrapper around `@pierre/trees`'s `useFileTree`. Plumbs in:
 *
 *  - The workspace-level icon-set preference (overridable per-instance).
 *  - Live updates of `paths` via `model.resetPaths()`.
 *  - Live updates of `gitStatus` via `model.setGitStatus()`.
 *
 * Both the editor file tree and (in a follow-up) the git tab compose this
 * hook with their own data source.
 */
export function useCadencrFileTree({
  paths,
  gitStatus,
  renaming,
  dragAndDrop,
  search = true,
  fileTreeSearchMode = "expand-matches",
  initialSelectedPaths,
  iconSet,
  ignoredPathPrefixes,
}: CadencrFileTreeHookOptions): CadencrFileTreeHookResult {
  const { iconSet: globalIconSet } = useFileTreeIconSet();
  const effectiveIconSet = iconSet ?? globalIconSet;

  // Snapshot the initial inputs — pierre's model is built once and then
  // mutated via methods. Subsequent paths/gitStatus updates are applied via
  // effects below. Pierre re-sorts internally on `resetPaths`, so we hand
  // it raw paths and rely on its canonical ordering.
  const initialOptions = useMemo<FileTreeOptions>(
    () => ({
      paths,
      gitStatus,
      renaming: renaming === false ? undefined : renaming,
      dragAndDrop: dragAndDrop === false ? undefined : dragAndDrop,
      search,
      fileTreeSearchMode,
      initialSelectedPaths,
      icons: effectiveIconSet,
    }),
    // We intentionally only seed once. Updates flow through model methods
    // (see effects below) so we don't tear down and re-create the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { model } = usePierreFileTree(initialOptions);

  // Update paths in-place on refetch. `resetPaths` on tens of thousands of
  // paths is heavy → wrap in `startTransition`. It also clears expansion
  // state, so seed `initialExpandedPaths` from the current model to keep
  // open folders open.
  useEffect(() => {
    startTransition(() => {
      const expanded = collectExpandedDirectoryPaths(model, paths);
      model.resetPaths(paths, { initialExpandedPaths: expanded });
    });
  }, [model, paths]);

  // Diff/apply walks the model once; transition for the same reason.
  useEffect(() => {
    startTransition(() => {
      model.setGitStatus(gitStatus);
    });
  }, [model, gitStatus]);

  // React to the user toggling the icon-set preference live.
  useEffect(() => {
    model.setIcons(effectiveIconSet);
  }, [model, effectiveIconSet]);

  useGitignoredDimming(model, ignoredPathPrefixes);

  return { model };
}

/**
 * Dim every row whose `data-item-path` starts with one of the given
 * (pierre-form) prefixes — used for `.gitignore`d sub-trees. We do this
 * via shadow-root CSS rather than pierre's `gitStatus`/`ignored` channel
 * because pierre's git pipeline unconditionally adds every ignored
 * entry's ancestors to `directoriesWithChanges`, which would dot the
 * project root for every `node_modules/` we mark.
 *
 * Pierre stamps `data-item-path` on every visible row inside its open
 * shadow root, so a single prefix selector per ignored sub-tree dims
 * the directory and everything below it as virtualization scrolls
 * rows in and out.
 */
function useGitignoredDimming(model: FileTreeModel, prefixes: readonly string[] | undefined): void {
  const css = useMemo(() => buildGitignoredCSS(prefixes), [prefixes]);
  useFileTreeShadowStylesheet(model, "data-cadencr-gitignored", css);
}

function buildGitignoredCSS(prefixes: readonly string[] | undefined): string {
  if (prefixes == null || prefixes.length === 0) return "";
  // Files keep their exact `data-item-path`; directories carry a trailing
  // slash and match descendants via the `^=` prefix selector (which also
  // matches the dir row itself because `^=` is a starts-with test).
  const rowSelectors: string[] = [];
  const iconSelectors: string[] = [];
  for (const prefix of prefixes) {
    const escaped = CSS.escape(prefix);
    const rowSel = prefix.endsWith("/")
      ? `[data-item-path^="${escaped}"]`
      : `[data-item-path="${escaped}"]`;
    rowSelectors.push(rowSel);
    iconSelectors.push(`${rowSel} > [data-item-section="icon"]`);
  }
  // Mirror pierre's built-in `[data-item-git-status='ignored']` look:
  // the row text gets the muted token (`--trees-status-ignored`), the
  // icon gets `opacity: 0.5` because pierre paints it with its own
  // `--trees-fg-muted` color rule that wouldn't pick up a `color:` here.
  return [
    `${rowSelectors.join(",\n")} {\n  color: var(--trees-status-ignored);\n}`,
    `${iconSelectors.join(",\n")} {\n  opacity: 0.5;\n}`,
  ].join("\n");
}

export interface CadencrFileTreeProps extends Omit<PierreFileTreeProps, "model"> {
  /**
   * The pierre model returned from `useCadencrFileTree`. Owning the model in
   * the consumer lets it call rename/move/add/remove methods on it directly.
   */
  model: FileTreeModel;
  /**
   * When true (typically while the backend is fetching the tree), render a
   * centered spinner instead of the (empty) tree. Per `explicit-state.md`.
   */
  isLoading?: boolean;
  /** Error message; rendered instead of the tree when set. */
  errorMessage?: string | null;
  /** Optional placeholder when the tree is empty (no paths). */
  emptyState?: ReactNode;
  className?: string;
}

/**
 * Reusable file-tree shell built around `@pierre/trees`. Renders a loader,
 * error, or empty placeholder when appropriate; otherwise hands off to
 * pierre's `<FileTree>` component.
 */
export function CadencrFileTree({
  model,
  isLoading,
  errorMessage,
  emptyState,
  className,
  ...pierreProps
}: CadencrFileTreeProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div
        className={cn("flex h-full items-center justify-center", className)}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading file tree…</span>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center px-4 text-center text-xs text-destructive",
          className,
        )}
        role="alert"
      >
        {errorMessage}
      </div>
    );
  }

  if (emptyState) {
    return (
      <div className={cn("relative h-full w-full", className)}>
        <PierreFileTree model={model} className="h-full w-full" {...pierreProps} />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {emptyState}
        </div>
      </div>
    );
  }

  return (
    <PierreFileTree model={model} className={cn("h-full w-full", className)} {...pierreProps} />
  );
}
